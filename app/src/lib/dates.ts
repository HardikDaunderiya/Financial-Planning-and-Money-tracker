export const IST = "Asia/Kolkata";

const day = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: IST,
});
const dayLong = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: IST,
});
const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: IST });
const isoParts = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  timeZone: IST,
});

/** "2026-10-23" → a Date at noon UTC, safe to format in IST without crossing a day. */
function fromIso(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function partsOf(formatter: Intl.DateTimeFormat, date: Date): (type: string) => string {
  const parts = formatter.formatToParts(date);
  return (t) => parts.find((p) => p.type === t)?.value ?? "";
}

function monthOf(value: string): string {
  return value.replace("Sept", "Sep").replace(/\.$/, "");
}

/** "2026-10-23" → "Fri, 23 Oct" */
export function formatDay(date: string): string {
  const get = partsOf(day, fromIso(date));
  return `${get("weekday")}, ${get("day")} ${monthOf(get("month"))}`;
}

/** "2026-10-23" → "Fri, 23 Oct 2026" */
export function formatDayLong(date: string): string {
  const get = partsOf(dayLong, fromIso(date));
  return `${get("weekday")}, ${get("day")} ${monthOf(get("month"))} ${get("year")}`;
}

/** "2026-10-23" → "23 Oct" */
export function formatDayMonth(date: string): string {
  const get = partsOf(dayMonth, fromIso(date));
  return `${get("day")} ${monthOf(get("month"))}`;
}

/** The calendar date in Asia/Kolkata for an instant, as "YYYY-MM-DD". */
export function todayIst(now: Date = new Date()): string {
  const get = partsOf(isoParts, now);
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The hour (0–23) in Asia/Kolkata. */
export function hourIst(now: Date = new Date()): number {
  const h = partsOf(isoParts, now)("hour") || "0";
  return Number.parseInt(h, 10) % 24;
}

export function greeting(now: Date = new Date()): string {
  const h = hourIst(now);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** "5 minutes ago", "2 hours ago", "yesterday", "3 days ago". */
export function relativeTime(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/** Days from a to b inclusive, both "YYYY-MM-DD". */
export function daysInclusive(a: string, b: string): number {
  return Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86_400_000) + 1;
}

export function addDays(date: string, n: number): string {
  const d = fromIso(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
