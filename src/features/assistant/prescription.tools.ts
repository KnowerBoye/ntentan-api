// ─────────────────────────────────────────────
import { getFirestore } from "@/lib/firebase";
import {
  isPrescriptionActiveOnDate,
  getNextDoseDateTime,
  getLastDoseDateTime,
  displayDate,
  displayTime,
  displayTimeSlots,
  todayISO,
} from "@/lib/DateHelpers";
import {
  Prescription,
  QueryPrescriptionsInput,
  PrescriptionQueryResult,
  ToolResult,
} from "@/types/assistant";
import { embedText } from "@/lib/embeddings";
import { logger } from "@/lib/logger";

/**
 * Fetch all medications for a user from the subcollection:
 *   users/{userId}/medications
 */
async function fetchAll(userId: string): Promise<Prescription[]> {
  const db = getFirestore();
  const snap = await db
    .collection("users")
    .doc(userId)
    .collection("medications")
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Prescription, "id">),
  }));
}

// ── Cosine similarity ──────────────────────────

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, ai, i) => sum + ai * b[i], 0);
}

function magnitude(v: number[]): number {
  return Math.sqrt(v.reduce((sum, vi) => sum + vi * vi, 0));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = dotProduct(a, b);
  const mag = magnitude(a) * magnitude(b);
  return mag === 0 ? 0 : dot / mag;
}

// ── Matchers ──────────────────────────────────

/**
 * Match medications by drug name.
 *
 * Strategy:
 * 1. If a drugName is provided, embed it via Vertex AI and compute
 *    cosine similarity against each medication's `name_embedding` vector.
 *    Return medications with similarity above a threshold (sorted best-first).
 * 2. Fall back to simple substring matching if vectors are unavailable.
 * 3. If no drugName, return all medications.
 */
async function matchDrugs(
  all: Prescription[],
  drugName?: string
): Promise<Prescription[]> {
  if (!drugName) return all;

  const queryLower = drugName.toLowerCase();

  // ── Try vector search first ──
  try {
    const queryVector = await embedText(drugName);
    const SIMILARITY_THRESHOLD = 0.6;

    const scored = all
      .filter((p) => p.name_embedding && Array.isArray(p.name_embedding))
      .map((p) => ({
        prescription: p,
        // Firestore VectorValue is a Float32Array, convert to regular array
        similarity: cosineSimilarity(
          queryVector,
          Array.from((p.name_embedding as unknown) as Float32Array)
        ),
      }))
      .filter(({ similarity }) => similarity >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity);

    if (scored.length > 0) {
      return scored.map(({ prescription }) => prescription);
    }

    // Vector search returned nothing — fall through to substring
    logger.debug("Vector search returned no results, falling back to substring match", {
      drugName,
    });
  } catch (err) {
    logger.warn("Vector embedding failed, falling back to substring match", {
      drugName,
      error: String(err),
    });
  }

  // ── Fallback: substring match ──
  return all.filter((p) =>
    p.name.toLowerCase().includes(queryLower)
  );
}

// ── Main query function ──────────────────────

export async function queryPrescriptions(
  input: QueryPrescriptionsInput
): Promise<ToolResult<PrescriptionQueryResult>> {
  try {
    const { userId, intent, targetDate, drugName } = input;
    const today = todayISO();
    const all = await fetchAll(userId);

    let prescriptions: Prescription[] = [];
    let contextNote = "";

    switch (intent) {
      case "today": {
        const date = targetDate ?? today;
        const matched = drugName ? await matchDrugs(all, drugName) : all;
        prescriptions = matched.filter((p) => isPrescriptionActiveOnDate(p, date));

        if (prescriptions.length) {
          const details = prescriptions
            .map(
              (p) =>
                `${p.name} ${p.strength} — ${p.unitsPerDose} ${p.dosage} — ${displayTimeSlots(p.timeSlots)}` +
                (p.instruction ? ` (${p.instruction})` : "")
            )
            .join("\n");
          contextNote = `Found ${prescriptions.length} medication(s) scheduled for ${displayDate(date)}:\n${details}`;
        } else {
          contextNote = `No medications are scheduled for ${displayDate(date)}.`;
        }
        break;
      }

      case "on_date": {
        const date = targetDate ?? today;
        const matched = drugName ? await matchDrugs(all, drugName) : all;
        prescriptions = matched.filter((p) => isPrescriptionActiveOnDate(p, date));

        const isPast = date < today;
        if (prescriptions.length) {
          const details = prescriptions
            .map(
              (p) =>
                `${p.name} ${p.strength} — ${p.unitsPerDose} ${p.dosage} — ${displayTimeSlots(p.timeSlots)}` +
                (p.instruction ? ` (${p.instruction})` : "")
            )
            .join("\n");
          contextNote = `Found ${prescriptions.length} medication(s) ${isPast ? "that were" : "scheduled to be"} taken on ${displayDate(date)}:\n${details}`;
        } else {
          contextNote = `No medications ${isPast ? "were" : "are"} scheduled for ${displayDate(date)}.`;
        }
        break;
      }

      case "next": {
        const matched = drugName ? await matchDrugs(all, drugName) : all;
        const withNext = matched
          .map((p) => ({ p, next: getNextDoseDateTime(p) }))
          .filter((x) => x.next !== null)
          .sort((a, b) => {
            if (a.next!.date !== b.next!.date)
              return a.next!.date.localeCompare(b.next!.date);
            const order: Record<string, number> = { morning: 0, afternoon: 1, evening: 2 };
            return (order[a.next!.time] ?? 99) - (order[b.next!.time] ?? 99);
          });

        if (!withNext.length) {
          contextNote = drugName
            ? `No upcoming doses found for "${drugName}".`
            : "No upcoming doses found.";
        } else {
          const { p, next } = withNext[0];
          contextNote = `Next dose of ${p.name} ${p.strength}: ${displayTime(next!.time)} on ${displayDate(next!.date)}.`;
          prescriptions = [p];
        }
        break;
      }

      case "last": {
        const matched = drugName ? await matchDrugs(all, drugName) : all;
        const withLast = matched
          .map((p) => ({ p, last: getLastDoseDateTime(p) }))
          .filter((x) => x.last !== null)
          .sort((a, b) => {
            if (a.last!.date !== b.last!.date)
              return b.last!.date.localeCompare(a.last!.date);
            const order: Record<string, number> = { morning: 0, afternoon: 1, evening: 2 };
            return (order[b.last!.time] ?? 99) - (order[a.last!.time] ?? 99);
          });

        if (!withLast.length) {
          contextNote = drugName
            ? `No past dose history found for "${drugName}".`
            : "No past dose history found.";
        } else {
          const { p, last } = withLast[0];
          contextNote = `Last dose of ${p.name} ${p.strength}: ${displayTime(last!.time)} on ${displayDate(last!.date)}.`;
          prescriptions = [p];
        }
        break;
      }

      case "check": {
        const date = targetDate ?? today;
        const matched = drugName ? await matchDrugs(all, drugName) : all;
        prescriptions = matched.filter((p) => isPrescriptionActiveOnDate(p, date));

        const isPast = date <= today;
        if (prescriptions.length) {
          const slotSummary = prescriptions
            .map((p) => `${p.name} — ${displayTimeSlots(p.timeSlots)}`)
            .join("; ");
          contextNote = isPast
            ? `Yes – ${drugName ?? "this medication"} was scheduled for ${displayDate(date)}: ${slotSummary}.`
            : `${drugName ?? "This medication"} is scheduled for ${displayDate(date)}: ${slotSummary}.`;
        } else {
          contextNote = `No prescription for ${drugName ?? "that medication"} was found on ${displayDate(date)}.`;
        }
        break;
      }

      case "all_active": {
        const matched = drugName ? await matchDrugs(all, drugName) : all;
        prescriptions = matched;

        if (prescriptions.length) {
          const details = prescriptions
            .map(
              (p) =>
                `${p.name} ${p.strength} — ${p.unitsPerDose} ${p.dosage} — ${displayTimeSlots(p.timeSlots)}` +
                (p.instruction ? ` (${p.instruction})` : "")
            )
            .join("\n");
          contextNote = `Found ${prescriptions.length} prescription(s) on record:\n${details}`;
        } else {
          contextNote = "No prescriptions found on record.";
        }
        break;
      }

      default:
        return { success: false, error: `Unknown intent: ${intent}` };
    }

    return {
      success: true,
      data: {
        intent,
        targetDate,
        prescriptions,
        contextNote,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}