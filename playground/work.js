const { GoogleGenAI, Modality } = require("@google/genai");
const { WebSocketServer } = require("ws");
const { createServer } = require("http");
const  dotenv = require("dotenv")

dotenv.config()

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `
You are a medication label reading assistant. Your job is to guide the user 
to correctly position a medication in front of their camera so you can 
read its label clearly.

## Your behavior:

### When NO medication  is visible:
Respond with positioning status "no_object" and guide the user to bring the medication into frame.

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
- Give only ONE instruction at a time — do not overwhelm the user
- Be concise and friendly in your guidance text
- Only return status "success" when you are confident you can read the label text
- Always return valid JSON matching the schema exactly
`;

// Response schema
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["no_object", "positioning", "success"],
      description: "Current scan state"
    },
    instruction: {
      type: "string",
      enum: [
        "move_up", "move_down", "move_left", "move_right",
        "rotate_left", "rotate_right", "flip",
        "move_closer", "move_farther", "hold_still", "none"
      ],
      description: "Directional instruction for the user"
    },
    guidance_text: {
      type: "string",
      description: "Human-friendly message shown to the user"
    },
    medication: {
      type: "object",
      description: "Only populated when status is 'success'",
      properties: {
        drug_name:       { type: "string" },
        // dosage:          { type: "string" },
        // instructions:    { type: "string" },
        // quantity:        { type: "string" },
        // refills:         { type: "string" },
        // prescriber:      { type: "string" },
        // patient_name:    { type: "string" },
        // pharmacy:        { type: "string" },
        // expiry_date:     { type: "string" },
        // raw_label_text:  { type: "string" }
      }
    }
  },
  required: ["status", "instruction", "guidance_text"]
};

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", async (clientWs) => {
  console.log("Client connected");


  const responseQueue = [];

  const session = await ai.live.connect({
    model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
    config: {
    responseModalities: [Modality.TEXT],
    systemInstruction: SYSTEM_PROMPT,
    responseMimeType: "application/json",
    responseSchema: RESPONSE_SCHEMA,
    },
    callbacks: {
      onopen: () => {
        console.log("Gemini session open");
      },
      onmessage: (message) => {
        // ✅ Push all messages into the queue
        responseQueue.push(message);
      },
      onerror: (e) => {
        console.error("Gemini error:", e.error ?? e.message);
      },
      onclose: (e) => {
        console.log("Gemini closed:", e.reason);
        if (clientWs.readyState === clientWs.OPEN) clientWs.close();
      },
    },
  });

  // ✅ Drain the queue and forward to browser
  async function processQueue() {
    while (true) {
      if (clientWs.readyState !== clientWs.OPEN) break;

      const message = responseQueue.shift();

      if (!message) {
        await new Promise((resolve) => setTimeout(resolve, 50)); // wait for next message
        continue;
      }

      const text = message?.serverContent?.modelTurn?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join("");

      if (text) {
        console.log("Gemini response:", text);
        clientWs.send(text);
      }
    }
  }

  processQueue(); // run in background — no await

  // Browser → Gemini
  clientWs.on("message", async (chunk) => {
    try {
      await session.sendRealtimeInput({
        video: {
          data: Buffer.from(chunk).toString("base64"),
          mimeType: "image/jpeg",
        },
      });
    } catch (err) {
      console.error("Send error:", err.message);
    }
  });

  clientWs.on("close", () => {
    console.log("Client disconnected");
    session.close();
  });

  clientWs.on("error", (err) => console.error("Client WS error:", err));
});

server.listen(8080, () => console.log("Server running on ws://localhost:8080"));