import{ GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv"
import { Socket } from "socket.io";

dotenv.config()

const SYSTEM_PROMPT = `
You are a medication label reading assistant. Your job is to guide the user 
to correctly position a medication in front of their camera so you can 
read its label clearly.

You MUST always return valid JSON with exactly these fields:

- "status": one of "no_object" | "positioning" | "success"
    - "no_object"   → no medication visible in the frame
    - "positioning" → medication visible but label is not clearly readable
    - "success"     → label is clearly readable and text has been extracted

- "instruction": one of the allowed movement instructions.
    Use "none" when status is "no_object" or "success".

- "guidance_text": a short, friendly message for the user (1 sentence)

- "medication": ONLY include this field when status is "success".
    It must contain:
      - "drug_name": the primary medication name
      - "raw_label_text": array of every readable text line on the label

## Positioning instructions (use when status is "positioning"):
move_up | move_down | move_left | move_right
rotate_left | rotate_right | flip
move_closer | move_farther | hold_still

## Rules:
- Give only ONE instruction at a time
- Never invent field names — use exactly the names above
- Never use status values outside the three listed above
`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["no_object", "positioning", "success"],
      description: "no_object = nothing visible, positioning = visible but label unreadable, success = label fully read"
    },
    instruction: {
      type: "string",
      enum: [
        "move_up", "move_down", "move_left", "move_right",
        "rotate_left", "rotate_right", "flip",
        "move_closer", "move_farther", "hold_still", "none"
      ],
      description: "Use 'none' when status is no_object or success"
    },
    guidance_text: {   
      type: "string",
      description: "Short friendly instruction shown to the user"
    },
    medication: {
      type: "object",
      description: "Only present when status is success",
      properties: {
        drug_name:      { type: "string" },
        raw_label_text: {
          type: "array",
          items: { type: "string" },
          description: "Every readable line of text from the label"
        }
      },
      required: ["drug_name", "raw_label_text"]
    }
  },
  required: ["status", "instruction", "guidance_text"]
};

// buffer config
const BUFFER_MAX_FRAMES = 5;       // max frames to accumulate before forcing a flush
const BUFFER_FLUSH_INTERVAL_MS = 800; // flush every N ms even if buffer isn't full


const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });



export function handleVideoStreamConnection(clientWs :Socket){


// per connection state
    let frameBuffer : string[]  = [];   
    let isInferring   = false; // inference gate: true while model is working
    let flushTimer    = null;  // interval that triggers periodic flushes



    /**
     * build buffer 
     * The most recent frame is last so the model treats it as current
     */

    async function flushBuffer() {
    //no frames or doing infrence


    if (frameBuffer.length === 0 || isInferring) return;

    // Drain buffer lock state
    const frames = frameBuffer.splice(0);
    isInferring = true;


    // Notify client that processing has started (optional but useful for UX)
    if (clientWs.connected) {
        clientWs.emit("response" , JSON.stringify({ status: "processing" }));
    }

    try {

        const parts = [
        { text: SYSTEM_PROMPT },
        ...frames.map((b64) => ({
            inlineData: { mimeType: "image/jpeg", data: b64 },
        })),
        ];

        const response = await ai.models.generateContent({
        model: "models/gemini-2.5-flash",
        contents: [{ role: "user", parts }],
        config : {
            responseMimeType : "application/json" , 
            responseModalities : [Modality.TEXT] , 
            responseSchema : RESPONSE_SCHEMA
        }
     
        });

        const candidate = response.candidates?.[0];
        if (!candidate?.content?.parts) {
        //no contents -- rare occurence
        return;
        }

        const text = candidate.content.parts
        .map((p) => p.text)
        .filter(Boolean)
        .join("");

        console.log(text);

        if (clientWs.connected) {
        clientWs.emit("response" , text);
        }
    } catch (err) {
        // log with sentry

        // decide based on demo wether to actually disconnet or just continute next buffer 
        clientWs.disconnect()
        console.error("Gemini error:", err);
    } finally {
        // release gate for next flush
        isInferring = false;
    }
    }


    // Periodic flush — sends whatever is in the buffer every BUFFER_FLUSH_INTERVAL_MS
    flushTimer = setInterval(flushBuffer, BUFFER_FLUSH_INTERVAL_MS);


    clientWs.on("frame" , (chunk)=>{
        
        const base64Image = Buffer.from(chunk.buf).toString("base64");

        if (isInferring) {
        // Gate is locked: drop the frame (lossy buffer)
        // Swap strategy: keep only the latest frame so the next flush
        // always has the most recent view.
        frameBuffer = [base64Image];
        return;
        }


        frameBuffer.push(base64Image)

        // Eager flush: don't wait for the timer if buffer is already full
        if (frameBuffer.length >= BUFFER_MAX_FRAMES) {
            flushBuffer();
        }

        clientWs.on("disconnect" , ()=>{
            clearInterval(flushTimer)
            frameBuffer = []
        })

    } )




}