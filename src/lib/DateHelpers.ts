import { format, parseISO, addDays, subDays } from "date-fns";
import { Prescription, TIME_WINDOWS } from "@/types/assistant";

/** Today as YYYY-MM-DD */
export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** Current time as HH:mm */
export function nowHHMM(): string {
  return format(new Date(), "HH:mm");
}

/** Format a YYYY-MM-DD string for display */
export function displayDate(iso: string): string {
  return format(parseISO(iso), "EEEE, MMMM d, yyyy");
}

/** Format a time-of-day slot ID for display (e.g. "morning" → "Morning (06:00–12:00)") */
export function displayTime(slot: string): string {
  const w = TIME_WINDOWS[slot];
  if (!w) return slot; // fallback for unknown slot names
  return `${w.label} (${w.start}–${w.end})`;
}

/** Format all time slots for display */
export function displayTimeSlots(slots: string[]): string {
  return slots.map(displayTime).join(", ");
}

/**
 * Build a canonical slot key from a date and slot ID.
 * e.g. "2026-06-09" + "morning" → "2026-06-09_morning"
 */
export function slotKey(date: string, slot: string): string {
  return `${date}_${slot}`;
}

/**
 * Returns true if a prescription has ANY time slot on `targetDate`
 * that has NOT yet been completed.
 *
 * A slot is "completed" if its slotKey (YYYY-MM-DD_slotId) exists
 * in the prescription's completedSlots array.
 */
export function isPrescriptionActiveOnDate(
  p: Prescription,
  targetDate: string // YYYY-MM-DD
): boolean {
  return p.timeSlots.some((slot) => {
    const key = slotKey(targetDate, slot);
    return !p.completedSlots.includes(key);
  });
}

/**
 * For "next dose" queries: find the next upcoming date+time slot
 * for a prescription, starting from now.
 *
 * Returns { date, time } or null if all slots are completed.
 */
export function getNextDoseDateTime(p: Prescription): {
  date: string;
  time: string;
} | null {
  const today = todayISO();
  const currentTime = nowHHMM();

  // Check today's slots first
  for (const slot of p.timeSlots) {
    const window = TIME_WINDOWS[slot];
    if (!window) continue;
    const key = slotKey(today, slot);

    // Skip if already completed
    if (p.completedSlots.includes(key)) continue;

    // If current time is before the window ends, it's still upcoming
    if (currentTime < window.end) {
      return { date: today, time: slot };
    }
  }

  // All today's slots passed or completed → look at tomorrow
  // (We assume daily recurrence — every day the prescription is active
  //  unless all future slots on record are completed. For MVP, return
  //  the first slot tomorrow.)
  const tomorrow = format(addDays(parseISO(today), 1), "yyyy-MM-dd");
  for (const slot of p.timeSlots) {
    const key = slotKey(tomorrow, slot);
    if (!p.completedSlots.includes(key)) {
      return { date: tomorrow, time: slot };
    }
  }

  // All slots completed for today and tomorrow — no upcoming
  return null;
}

/**
 * For "last dose" queries: find the most recent completed dose.
 *
 * Searches completedSlots and returns the most recent one chronologically.
 */
export function getLastDoseDateTime(p: Prescription): {
  date: string;
  time: string;
} | null {
  if (!p.completedSlots.length) return null;

  // Parse slot keys like "2026-06-09_morning" → sort descending
  const sorted = [...p.completedSlots].sort().reverse();
  const lastKey = sorted[0];
  const [date, time] = lastKey.split("_");

  return { date, time };
}