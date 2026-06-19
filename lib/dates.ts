// Day-granularity date helpers.
//
// Tasks are scheduled with day precision, so we store the date as a
// "YYYY-MM-DD" string. This sidesteps timezone bugs that come from storing a
// full Date and comparing across UTC boundaries — the office works in one
// local timezone, and a "day" means the same thing to everyone.

// 0 = Sunday, 1 = Monday, ... 6 = Saturday.
// Change this to match the office work week (e.g. 6 for a Sat–Fri week).
export const WEEK_STARTS_ON = 6; // Saturday

/** Format a Date as a local "YYYY-MM-DD" string. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a "YYYY-MM-DD" string into a local Date at midnight. */
export function fromDateStr(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

/** Today's date as a "YYYY-MM-DD" string. */
export function todayStr(): string {
  return toDateStr(new Date());
}

export function isValidDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** The 7 date strings of the week containing `date`, starting WEEK_STARTS_ON. */
export function weekDates(date: Date = new Date()): string[] {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - WEEK_STARTS_ON + 7) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - diff);
  return Array.from({ length: 7 }, (_, i) => {
    const cur = new Date(start);
    cur.setDate(start.getDate() + i);
    return toDateStr(cur);
  });
}
