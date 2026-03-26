
// ─────────────────────────────────────────────
import { getFirestore, Collections } from "@/lib/firebase";
import {
  isPrescriptionActiveOnDate,
  getNextDoseDateTime,
  getLastDoseDateTime,
  displayDate,
  displayTime,
  todayISO,
} from "@/lib/DateHelpers";
import {
  Prescription,
  QueryPrescriptionsInput,
  PrescriptionQueryResult,
  ToolResult,
} from "@/types/assistant";


async function fetchAll(userId: string): Promise<Prescription[]> {
  const db = getFirestore();
  const snap = await db
    .collection(Collections.PRESCRIPTIONS)
    .where("userId", "==", userId)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Prescription, "id">),
  }));
}


function matchesDrug(p: Prescription, drugName?: string): boolean {
  if (!drugName) return true;
  return p.name.toLowerCase().includes(drugName.toLowerCase());
}


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
        prescriptions = all.filter(
          (p) => isPrescriptionActiveOnDate(p, date) && matchesDrug(p, drugName)
        );
        contextNote = prescriptions.length
          ? `Found ${prescriptions.length} medication(s) scheduled for ${displayDate(date)}.`
          : `No medications are scheduled for ${displayDate(date)}.`;
        break;
      }


      case "on_date": {
        const date = targetDate ?? today;
        prescriptions = all.filter(
          (p) => isPrescriptionActiveOnDate(p, date) && matchesDrug(p, drugName)
        );
        const isPast = date < today;
        contextNote = prescriptions.length
          ? `Found ${prescriptions.length} medication(s) ${isPast ? "that were" : "scheduled to be"} taken on ${displayDate(date)}.`
          : `No medications ${isPast ? "were" : "are"} scheduled for ${displayDate(date)}.`;
        break;
      }


      case "next": {
        const candidates = all.filter((p) => matchesDrug(p, drugName));
        const withNext = candidates
          .map((p) => ({ p, next: getNextDoseDateTime(p) }))
          .filter((x) => x.next !== null)
          .sort((a, b) => {
            // Sort by date then time slot order
            if (a.next!.date !== b.next!.date)
              return a.next!.date.localeCompare(b.next!.date);
            const order = { morning: 0, afternoon: 1, evening: 2 };
            return order[a.next!.time] - order[b.next!.time];
          });

        if (!withNext.length) {
          prescriptions = [];
          contextNote = drugName
            ? `No upcoming doses found for "${drugName}".`
            : "No upcoming doses found.";
        } else {
          const { p, next } = withNext[0];
          prescriptions = [p];
          contextNote = `Next dose of ${p.name}: ${displayTime(next!.time)} on ${displayDate(next!.date)}.`;
        }
        break;
      }


      case "last": {
        const candidates = all.filter((p) => matchesDrug(p, drugName));
        const withLast = candidates
          .map((p) => ({ p, last: getLastDoseDateTime(p) }))
          .filter((x) => x.last !== null)
          .sort((a, b) => {
            // Most recent first
            if (a.last!.date !== b.last!.date)
              return b.last!.date.localeCompare(a.last!.date);
            const order = { morning: 0, afternoon: 1, evening: 2 };
            return order[b.last!.time] - order[a.last!.time];
          });

        if (!withLast.length) {
          prescriptions = [];
          contextNote = drugName
            ? `No past dose history found for "${drugName}".`
            : "No past dose history found.";
        } else {
          const { p, last } = withLast[0];
          prescriptions = [p];
          contextNote = `Last dose of ${p.name}: ${displayTime(last!.time)} on ${displayDate(last!.date)}.`;
        }
        break;
      }


      case "check": {
        const date = targetDate ?? today;
        prescriptions = all.filter(
          (p) => isPrescriptionActiveOnDate(p, date) && matchesDrug(p, drugName)
        );
        const isPast = date <= today;
        if (prescriptions.length) {
          contextNote = isPast
            ? `Yes – ${drugName ?? "this medication"} was scheduled for ${displayDate(date)} (${displayTime(prescriptions[0].time)}).`
            : `${drugName ?? "This medication"} is scheduled for ${displayDate(date)} (${displayTime(prescriptions[0].time)}).`;
        } else {
          contextNote = `No prescription for ${drugName ?? "that medication"} was found on ${displayDate(date)}.`;
        }
        break;
      }


      case "all_active": {
        prescriptions = all.filter((p) => matchesDrug(p, drugName));
        contextNote = prescriptions.length
          ? `Found ${prescriptions.length} prescription(s) on record.`
          : "No prescriptions found on record.";
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