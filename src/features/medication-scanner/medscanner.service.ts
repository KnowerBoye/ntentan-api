import { ContentEmbedding, GoogleGenAI, Modality, Type } from "@google/genai";
import dotenv from "dotenv"
import { Socket } from "socket.io";

import { FieldValue } from "@google-cloud/firestore";
import { Medication, MedicationLabelFields, emitMedScannerResponse } from "@/types/medscanner";
import { getFirestore } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import { ExternalServiceError } from "@/lib/errors";
import { emitSocketError } from "@/lib/socket-error-handler";

dotenv.config()


const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
const LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;



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


const ai = new GoogleGenAI({ 
  // vertexai: true,
  // project: PROJECT_ID,
  // location: LOCATION,
   apiKey : GEMINI_API_KEY,

});

const embeddingAi = new GoogleGenAI({
  vertexai: true,
  project: PROJECT_ID,
  location: LOCATION,
  // googleAuthOptions : {
  //   keyFilename : GOOGLE_APPLICATION_CREDENTIALS
  // }

})



  const firestore = getFirestore();



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


    // Notify client that processing has started
    if (clientWs.connected) {
        emitMedScannerResponse(clientWs, { status: "processing" });
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

        let result = JSON.parse(text)

        if(result.status === "success"){

          const {drug_name , raw_label_text} = result.medication

          const medicationFields = await extractMedicationFields({drug_name , raw_label_text})

          if (!clientWs.user?.uid) {
            logger.error("Med-scanner: user not authenticated on socket", {
              socketId: clientWs.id,
            });
            emitSocketError(
              clientWs,
              new ExternalServiceError("Authentication", "User not authenticated"),
              "error"
            );
            return;
          }

          const match = await findBestMatch(clientWs.user.uid, medicationFields)

          const successResponse = {
            status: "success" as const,
            instruction: "none" as const,
            guidance_text: result.guidance_text,
            prescription_match: match,
          };

          if (clientWs.connected) {
            emitMedScannerResponse(clientWs, successResponse);
          }
        } else {
          // positioning / no_object — forward from Gemini as-is
          if (clientWs.connected) {
            emitMedScannerResponse(clientWs, {
              status: result.status,
              instruction: result.instruction,
              guidance_text: result.guidance_text,
            });
          }
        }
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));


        console.log(err)

        logger.error("Gemini error in med-scanner", {
          socketId: clientWs.id,
          message: error.message,
          stack: error.stack,
        });

        emitSocketError(
          clientWs,
          new ExternalServiceError("Gemini API", error.message),
          "error"
        );

        // decide based on demo whether to actually disconnect or just continue next buffer
        if (clientWs.connected) {
          clientWs.disconnect(true);
        }
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


/**
 * Extracts structured medication fields from raw OCR scan data.
 *
 * @param {Object} ocrResult - The success payload from your OCR model
 * @param {string} ocrResult.drug_name - The drug name parsed by OCR
 * @param {string[]} ocrResult.raw_label_text - Raw tokens from the label
 * @returns {Promise<Object>} MedicationFields
 */
export async function extractMedicationFields(ocrResult : {drug_name : string , raw_label_text : string[]}) : Promise<MedicationLabelFields> {
  const { drug_name, raw_label_text } = ocrResult;

  const labelContext = [
    `Parsed drug name: ${drug_name}`,
    `Raw label tokens: ${raw_label_text.join(", ")}`,
  ].join("\n");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash", 
    contents: [
      `You are a pharmacology assistant helping to structure medication label data for a prescription lookup system.

Extract structured fields from the following OCR scan of a medication label.

${labelContext}

Notes:
- The label may be for a non-prescription product (e.g. a topical repellent) — extract what you can.
- Return null for fields you cannot determine with reasonable confidence.
- The confidence score should reflect how reliably this label maps to a medication record.`,
    ],
    config: {
      // Enforce JSON output matching our exact schema
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          brand_name: {
            type: Type.STRING,
            nullable: true,
            description: "The commercial or brand name of the product (e.g. 'Medisoft', 'Panadol')",
          },
          generic_name: {
            type: Type.STRING,
            nullable: true,
            description: "The active ingredient or INN generic name (e.g. 'Paracetamol', 'DEET'). For combination products, list the primary active ingredient.",
          },
          manufacturer: {
            type: Type.STRING,
            nullable: true,
            description: "The name of the manufacturing company or brand owner",
          },
          dosage_form: {
            type: Type.STRING,
            nullable: true,
            description: "Physical form of the product: tablet, capsule, cream, spray, liquid, etc.",
          },
          concentration: {
            type: Type.STRING,
            nullable: true,
            description: "Strength, concentration, or net quantity (e.g. '500mg', '5%', '100ml')",
          },
          product_category: {
            type: Type.STRING,
            nullable: true,
            description: "High-level therapeutic or product category (e.g. 'analgesic', 'topical repellent', 'antibiotic')",
          },
          confidence: {
            type: Type.NUMBER,
            description: "Confidence score for the overall extraction (0 = very uncertain, 1 = highly confident)",
          },
          unmatched_tokens: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Label tokens that could not be mapped to any known field",
          },
        },
        required: [
          "brand_name",
          "generic_name",
          "manufacturer",
          "dosage_form",
          "concentration",
          "product_category",
          "confidence",
          "unmatched_tokens",
        ],
      },
    },
  });

  // The SDK guarantees the text returned matches your schema type definition
  if (!response.text) {
    throw new ExternalServiceError("Gemini API", "Model failed to yield a response body.");
  }

  return JSON.parse(response.text);
}






const EMBEDDING_MODEL = "text-embedding-005";
const EMBEDDING_FIELD = "name_embedding"; 
const TOP_N = 5;

// Distance threshold — Firestore uses DOT_PRODUCT by default with
// text-embedding-004 (normalised vectors), so distance is in [0, 1].
// Below this value = good match; above = likely unrelated.
const DISTANCE_THRESHOLD = 0.15;



/**
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedText(text : string) : Promise<number[]> {
  const response = await embeddingAi.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [{ text }]
  })

 
  if (response.embeddings?.[0]?.values) {
    return response.embeddings[0].values;
  }

  throw new ExternalServiceError("Embedding API", "Failed to extract valid embedding values array from response.");
}



/**
 * @param {Object} fields
 * @returns {string}
 */
function buildQueryString(fields : MedicationLabelFields) : string {
  return [
    fields.brand_name,
    fields.generic_name,
    fields.concentration,
    fields.product_category,
    fields.dosage_form,
  ]
    .filter(Boolean)           
    .join(" ")
    .trim();
}


/**
 * Search a user's medication subcollection using vector similarity.
 *
 * @param {string} userId
 * @param {MedicationLabelFields} extractedFields
 * @returns {Promise<SearchResult[]>}
 *
 * @typedef {Object} SearchResult
 * @property {string}  id           - Firestore document ID
 * @property {string}  name         - Medication name from DB
 * @property {string}  dosage       - Dosage from DB
 * @property {number}  distance     - Vector distance (lower = more similar)
 * @property {boolean} withinThreshold - Whether this is a confident match
 */
export async function searchUserMedications(userId : string, extractedFields : MedicationLabelFields) : Promise<{
  medication : Medication;
  distance: number;
  withinThreshold: boolean;
}[]> {


  const queryString = buildQueryString(extractedFields);



  // console.log(`[search] Query string: "${queryString}"`);


  const queryVector = await embedText(queryString);

      // console.log("vector" , queryVector)


  const medicationsRef = firestore
    .collection("users")
    .doc(userId)
    .collection("medications");

  const vectorQuery = medicationsRef.findNearest({
    vectorField: EMBEDDING_FIELD,
    //@ts-ignore
    //temp ignore to debug
    queryVector: FieldValue.vector(queryVector),
    limit: TOP_N,
    distanceMeasure: "COSINE",
    distanceResultField: "vector_distance", 
  });

  const snapshot = await vectorQuery.get();

  if (snapshot.empty) return []

  const results = snapshot.docs.map((doc) => {
    const data = doc.data();
    const distance = data.vector_distance ?? null;

    return {
      medication: { ...doc.data() } as Medication,
      distance,
      withinThreshold:
        distance !== null ? distance <= DISTANCE_THRESHOLD : false,
    };
  });

  // Sort ascending by distance (closest first)
  results.sort((a, b) => a.distance - b.distance);

  return results;
}


/**
 * Returns the single best matching medication, or null if no confident match.
 *
 * @param {string} userId
 * @param {MedicationLabelFields} extractedFields
 * @returns {Promise<SearchResult|null>}
 */
export async function findBestMatch(userId : string, extractedFields : MedicationLabelFields) {
  const results = await searchUserMedications(userId, extractedFields);
  const best = results[0] ?? null;

  if (!best || !best.withinThreshold) {
    console.log("[search] No confident match found.");
    return null;
  }

  return best;
}

