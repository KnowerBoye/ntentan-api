/**
 * One-time backfill script.
 * Run with: node backfillMedicationEmbeddings.js
 *
 * Iterates every users/{uid}/medications document, enriches name+dosage
 * into a composite string, embeds it, and writes the vector back.
 *
 * Safe to re-run — skips documents that already have a valid embedding
 * unless you pass --force.
 */

const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { GoogleGenAI, Type } = require("@google/genai");
const admin = require("firebase-admin/app");
const firestore = require("firebase-admin/firestore");

const path = require("path");

const dotenv = require("dotenv");
dotenv.config();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------





console.log(process.env.FIREBASE_CREDENTIALS);
const serviceAccount = require("../firebase-cred.json");


admin.initializeApp({
    credential: admin.cert(serviceAccount)
});
let _db = null;
function getFirestore() {
    if (_db)
        return _db;
    _db = firestore.getFirestore();
    return _db;
}


const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
const LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;

// Vertex AI embedding quota is 600 requests/min on the default tier.
// At 100ms between requests we stay well under that.
const DELAY_MS = 100;

const db = getFirestore();

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
    keyFilename : GOOGLE_APPLICATION_CREDENTIALS
  }

})



const EMBEDDING_MODEL = "text-embedding-005";
const EMBEDDING_FIELD = "name_embedding"; 
const TOP_N = 5;

// ---------------------------------------------------------------------------
// Helpers (same logic as embedMedicationOnWrite.js — keep in sync)
// ---------------------------------------------------------------------------

async function buildCompositeString(name, dosage) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash", // Fast, low-latency analog to Haiku
    contents: [
      `Medication name: ${name}\nDosage: ${dosage}\n\n` +
      `Build an enriched composite string for semantic search embedding.`,
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
    contents: [{ text }]
  })

 
  if (response.embeddings?.[0]?.values) {
    return response.embeddings[0].values;
  }

  throw new Error("Failed to extract valid embedding values array from response.");
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));



// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

async function backfill() {
  console.log(`Starting backfill. `);

  const usersSnapshot = await db.collection("users").get();
  console.log(`Found ${usersSnapshot.size} user(s)`);

  let total = 0;
  let skipped = 0;
  let succeeded = 0;
  let failed = 0;

  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    const medicationsSnapshot = await db
      .collection("users")
      .doc(userId)
      .collection("medications")
      .get();

    if (medicationsSnapshot.empty) continue;

    console.log(
      `\nUser ${userId}: ${medicationsSnapshot.size} medication(s)`
    );

    for (const medDoc of medicationsSnapshot.docs) {
      total++;
      const data = medDoc.data();
      const { name, dosage } = data;

      // Skip if already embedded and not forcing
    //   if (!FORCE && data[EMBEDDING_FIELD]) {
    //     console.log(`  [skip] ${medDoc.id} — already embedded`);
    //     skipped++;
    //     continue;
    //   }

      if (!name) {
        console.warn(`  [skip] ${medDoc.id} — missing name`);
        skipped++;
        continue;
      }

      try {
        const composite = await buildCompositeString(name, dosage ?? "");
        const vector = await embedText(composite);

        await medDoc.ref.update({
          [EMBEDDING_FIELD]: FieldValue.vector(vector),
          composite_string: composite,
          embedded_at: FieldValue.serverTimestamp(),
        });

        console.log(`  [ok]   ${medDoc.id} — "${composite}"`);
        succeeded++;
      } catch (err) {
        console.error(`  [fail] ${medDoc.id} —`, err.message);
        failed++;
      }

      await sleep(DELAY_MS);
    }
  }

  console.log("\n--- Backfill complete ---");
  console.log(`Total:     ${total}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Failed:    ${failed}`);
}

backfill().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});