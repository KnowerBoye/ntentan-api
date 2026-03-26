
import { format, parseISO, addDays, subDays, isAfter, isBefore, isEqual } from "date-fns";
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

/** Format time-of-day slot for display */
export function displayTime(slot: "morning" | "afternoon" | "evening"): string {
  const w = TIME_WINDOWS[slot];
  return `${w.label} (${w.start}–${w.end})`;
}

/** Current time-of-day slot */
export function currentTimeSlot(): "morning" | "afternoon" | "evening" {
  const hhmm = nowHHMM();
  if (hhmm >= "06:00" && hhmm < "12:00") return "morning";
  if (hhmm >= "12:00" && hhmm < "17:00") return "afternoon";
  return "evening";
}

/**
 * Returns true if a prescription should be taken on `targetDate`.
 *
 * Logic:
 *   - occurrence = "daily"     → always active (no end date in schema, assumed ongoing)
 *   - occurrence = "specified" → only active on p.date (must equal targetDate)
 */
export function isPrescriptionActiveOnDate(
  p: Prescription,
  targetDate: string // YYYY-MM-DD
): boolean {
  if (p.occurrence === "daily") return true;
  if (p.occurrence === "specified") return p.date === targetDate;
  return false;
}

/**
 * For "next dose" queries: find the next upcoming date+time slot
 * for a prescription, starting from now.
 *
 * Returns { date: YYYY-MM-DD, time: slot } or null if not schedulable.
 */
export function getNextDoseDateTime(p: Prescription): {
  date: string;
  time: "morning" | "afternoon" | "evening";
} | null {
  const today = todayISO();
  const slot = p.time;
  const window = TIME_WINDOWS[slot];
  const currentTime = nowHHMM();

  if (p.occurrence === "specified") {
    // One-off prescription: only valid if its date is today-or-future
    if (!p.date) return null;
    if (p.date < today) return null; // already past
    if (p.date === today && currentTime >= window.end) return null; // today but time passed
    return { date: p.date, time: slot };
  }

  // Daily: check if today's slot is still upcoming
  if (currentTime < window.end) {
    return { date: today, time: slot };
  }
  // Slot passed today → next occurrence is tomorrow
  return { date: format(addDays(parseISO(today), 1), "yyyy-MM-dd"), time: slot };
}

/**
 * For "last dose" queries: find the most recent past date+time slot.
 * For daily prescriptions this is always today or yesterday.
 */
export function getLastDoseDateTime(p: Prescription): {
  date: string;
  time: "morning" | "afternoon" | "evening";
} | null {
  const today = todayISO();
  const slot = p.time;
  const window = TIME_WINDOWS[slot];
  const currentTime = nowHHMM();

  if (p.occurrence === "specified") {
    if (!p.date) return null;
    if (p.date > today) return null; // future-only, never taken
    if (p.date === today && currentTime < window.start) return null; // not yet today
    return { date: p.date, time: slot };
  }

  // Daily: if today's slot has started, last dose = today
  if (currentTime >= window.start) {
    return { date: today, time: slot };
  }
  // Slot hasn't started yet today → last dose was yesterday
  return { date: format(subDays(parseISO(today), 1), "yyyy-MM-dd"), time: slot };
}