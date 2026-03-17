// ─────────────────────────────────────────────
//  lib/firebase.ts  –  Firebase Admin singleton
// ─────────────────────────────────────────────
import * as admin from "firebase-admin";
import * as dotenv from "dotenv";

dotenv.config();

let _db: admin.firestore.Firestore | null = null;

export function getFirestore(): admin.firestore.Firestore {
  if (_db) return _db;

  if (!admin.apps.length) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (
      !process.env.FIREBASE_PROJECT_ID ||
      !process.env.FIREBASE_CLIENT_EMAIL ||
      !privateKey
    ) {
      throw new Error(
        "Missing Firebase env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
      );
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  }

  _db = admin.firestore();
  return _db;
}


export const Collections = {
  USERS: "users",
  PRESCRIPTIONS: "prescriptions",  
} as const;