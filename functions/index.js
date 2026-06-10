/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });



const  { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { GoogleGenAI, Type } = require("@google/genai");
const dotenv = require("dotenv")

dotenv.config();



const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
const LOCATION = "us-central1";
const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_FIELD = "name_embedding";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const firestore = new Firestore({ projectId: PROJECT_ID });

// Initialize the single, modern Google GenAI SDK client for Vertex AI
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
  googleAuthOptions : {
    keyFilename : process.env.GOOGLE_APPLICATION_CREDENTIALS
  }

});

// ---------------------------------------------------------------------------
// Enrich name + dosage into a full composite string via LLM
// ---------------------------------------------------------------------------

/**
 * @param {string} name
 * @param {string} dosage
 * @returns {Promise<string>}
 */
async function buildCompositeString(name, dosage) {
  const response = await ai.models.generateContent({
    model: "models/gemini-2.5-flash", 
    contents: [
      `Medication name: ${name}
        Dosage: ${dosage}

        Generate a concise, information-rich composite text optimized for semantic search embeddings.

        Requirements:
        - Include the medication name and dosage exactly as provided.
        - Normalize and expand dosage expressions and common medical abbreviations when possible.
        - Include the generic medication name, active ingredient(s), formulation, when known or inferable.
        - Include the pharmacologic class and therapeutic category.
        - Include common indications, conditions treated, and typical clinical use cases.
        - Include relevant synonyms, alternate spellings, and recognized medical terminology.
        - Preserve clinically important distinctions between strengths, formulations, and routes.
        - Do not include brand names, marketing terms, unsupported assumptions, or explanatory commentary.
        - Output a single natural-language paragraph optimized for vector embeddings and semantic retrieval.
        `,
    ],
    config: {
      // Direct structured extraction via response schema configuration
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          composite: {
            type: Type.STRING,
            description:
              "Space-separated enriched string containing brand name, likely generic/INN name, " +
              "dosage, dosage form, and therapeutic category. E.g. " +
              "'LUFART DS Artemether Lumefantrine 80mg 480mg antimalarial tablets'. " +
              "If you cannot determine a field, omit it rather than guessing.",
          },
        },
        required: ["composite"],
      },
    },
  });

  if (!response.text) {
    throw new Error("No response text returned from enrichment LLM");
  }

  const result = JSON.parse(response.text);
  return result.composite;
}

/**
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const response = await embeddingAi.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });



  if (response.embeddings?.[0]?.values) {
    return response.embeddings[0].values;
  }

  throw new Error("Failed to extract valid embedding values array from response.");
}


  const embedMedicationOnWrite = onDocumentWritten(
  "users/{userId}/medications/{medicationId}",
  async (event) => {
    const { userId, medicationId } = event.params;

  
    if (!event.data.after.exists) return 

    const after = event.data.after.data();
    const before = event.data.before.exists ? event.data.before.data() : null;

   
    const nameChanged = after.name !== before?.name;
    const dosageChanged = after.dosage !== before?.dosage;
    const embeddingMissing = !after[EMBEDDING_FIELD];

    if (!nameChanged && !dosageChanged && !embeddingMissing) return

    const { name, dosage } = after;

    if (!name) return

    console.log(`[embed] Enriching and embedding: "${name}" / "${dosage}"`);

    try {
      const composite = await buildCompositeString(name, dosage ?? "");

      console.log(`[embed] Composite string: "${composite}"`);

      const vector = await embedText(composite);

      await firestore
        .collection("users")
        .doc(userId)
        .collection("medications")
        .doc(medicationId)
        .update({
          [EMBEDDING_FIELD]: FieldValue.vector(vector),
          composite_string: composite,   // stored for debugging/inspection
          embedded_at: FieldValue.serverTimestamp(),
        });

      console.log(`[embed] Successfully embedded ${medicationId}`);
    } catch (err) {
      // Log and swallow — don't crash the write transaction pipeline
      console.error(`[embed] Failed to embed ${medicationId}:`, err);
    }
  }
);