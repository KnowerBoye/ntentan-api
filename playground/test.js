const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");
const dotenv = require("dotenv");

dotenv.config();

// ── Gemini Live API endpoint (v1beta) ──────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_WS_URL =
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

// ── System prompt ──────────────────────────────────────────────────────────
// NOTE: responseSchema is NOT supported in Live API generationConfig.
// We instruct the model to return JSON manually and parse it ourselves.
const SYSTEM_PROMPT = `
You are a medication label reading assistant. Your job is to guide the user 
to correctly position a medication in front of their camera so you can 
read its label clearly.

## Your behavior:

### When NO medication is visible:
Return status "no_object" and guide the user to bring the medication into frame.

### When medication IS visible but label is unreadable:
Analyze the current frame and give ONE clear directional instruction from:
- "move_up", "move_down", "move_left", "move_right"
- "rotate_left", "rotate_right"  
- "flip" (turn the medication around)
- "move_closer", "move_farther"
- "hold_still" (almost there, just stabilize)

### When the label IS clearly readable:
Extract ALL visible text from the label and return it as structured data.

## CRITICAL RULES:
- Give only ONE instruction at a time
- Be concise and friendly in your guidance_text
- Only return status "success" when you are confident you can read the label
- ALWAYS respond with ONLY a valid JSON object — no markdown, no explanation, no backticks
- The JSON must always have these exact fields:

{
  "status": "no_object" | "positioning" | "success",
  "instruction": "move_up" | "move_down" | "move_left" | "move_right" | "rotate_left" | "rotate_right" | "flip" | "move_closer" | "move_farther" | "hold_still" | "none",
  "guidance_text": "string",
  "medication": {
    "drug_name": "string or null",
    "dosage": "string or null",
    "instructions": "string or null",
    "quantity": "string or null",
    "refills": "string or null",
    "prescriber": "string or null",
    "patient_name": "string or null",
    "pharmacy": "string or null",
    "expiry_date": "string or null",
    "raw_label_text": "string or null"
  }
}

The "medication" field is only populated when status is "success". Otherwise set all its values to null.
`;

// ── Setup message sent to Gemini after WS opens ────────────────────────────
function buildSetupMessage() {
  return {
    setup: {
      model: "models/gemini-live-2.5-flash-preview",
      generationConfig: {
        responseModalities: ["TEXT"],
      },
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
    },
  };
}

// ── HTTP + WS server ───────────────────────────────────────────────────────
const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (clientWs) => {
  console.log("Client connected");

  // Open raw WebSocket to Gemini
  const geminiWs = new WebSocket(GEMINI_WS_URL);

  let geminiReady = false;
  let textBuffer = ""; // accumulate partial text chunks

  // ── Gemini events ──────────────────────────────────────────────────────
  geminiWs.on("open", () => {
    console.log("Gemini WS open — sending setup");
    geminiWs.send(JSON.stringify(buildSetupMessage()));
  });

  geminiWs.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.error("Failed to parse Gemini message");
      return;
    }

    // Wait for setupComplete before forwarding frames
    if (msg.setupComplete !== undefined) {
      console.log("Gemini setup complete — ready for video");
      geminiReady = true;
      return;
    }

    // Accumulate text from modelTurn parts
    const parts = msg?.serverContent?.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.text) textBuffer += part.text;
    }

    // turnComplete means model finished its response — try to parse & forward
    if (msg?.serverContent?.turnComplete) {
      const json = tryParseJSON(textBuffer);
      textBuffer = "";

      if (json && clientWs.readyState === WebSocket.OPEN) {
        console.log("Gemini response:", JSON.stringify(json));
        clientWs.send(JSON.stringify(json));
      }
    }
  });

  geminiWs.on("close", (code, reason) => {
    console.log(`Gemini closed: ${code} — ${reason}`);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  geminiWs.on("error", (err) => {
    console.error("Gemini WS error:", err.message);
  });

  // ── Client events ──────────────────────────────────────────────────────
  clientWs.on("message", (chunk) => {
    if (!geminiReady || geminiWs.readyState !== WebSocket.OPEN) return;

    // Forward JPEG frame as realtimeInput video
    const payload = {
      realtimeInput: {
        video: {
          data: Buffer.from(chunk).toString("base64"),
          mimeType: "image/jpeg",
        },
      },
    };

    geminiWs.send(JSON.stringify(payload));
  });

  clientWs.on("close", () => {
    console.log("Client disconnected");
    geminiWs.close();
  });

  clientWs.on("error", (err) => console.error("Client WS error:", err.message));
});

// ── JSON parser — strips markdown fences if model adds them ───────────────
function tryParseJSON(raw) {
  if (!raw.trim()) return null;
  try {
    // Strip ```json ... ``` fences just in case
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned);
  } catch {
    console.error("Failed to parse model JSON:", raw);
    return null;
  }
}

server.listen(8080, () => console.log("Server running on ws://localhost:8080"));