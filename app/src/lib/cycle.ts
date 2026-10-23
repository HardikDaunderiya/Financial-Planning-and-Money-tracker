import { addDays, daysInclusive } from "./dates";

export type PaydayRule = { rule: "FIXED_DAY"; day: number } | { rule: "LAST_WORKING_DAY" };

export type CycleRange = { start: string; end: string; days: number };

function ym(date: string): { y: number; m: number } {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function shiftMonth(y: number, m: number, by: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + by;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** The payday in month "YYYY-MM" under a rule. Last working day skips Saturday and Sunday only (spec 2.1). */
export function payday(month: string, rule: PaydayRule): string {
  const { y, m } = ym(`${month}-01`);
  if (rule.rule === "FIXED_DAY") return iso(y, m, rule.day);
  let d = daysInMonth(y, m);
  while ([0, 6].includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) d -= 1;
  return iso(y, m, d);
}

/** The cycle that contains a date: from the latest payday on or before it to the day before the next. */
export function cycleContaining(date: string, rule: PaydayRule): CycleRange {
  const { y, m } = ym(date);
  const thisMonth = payday(`${y}-${String(m).padStart(2, "0")}`, rule);
  let start: string;
  let next: string;
  if (date >= thisMonth) {
    start = thisMonth;
    const n = shiftMonth(y, m, 1);
    next = payday(`${n.y}-${String(n.m).padStart(2, "0")}`, rule);
  } else {
    const p = shiftMonth(y, m, -1);
    start = payday(`${p.y}-${String(p.m).padStart(2, "0")}`, rule);
    next = thisMonth;
  }
  const end = addDays(next, -1);
  return { start, end, days: daysInclusive(start, end) };
}

function short(date: string): string {
  const d = Number(date.slice(8, 10));
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${names[Number(date.slice(5, 7)) - 1]}`;
}

/** "Your budget cycle runs 1 Nov – 30 Nov, then 1 Dec – 31 Dec": the two cycles after the one containing today. */
export function cycleLine(today: string, rule: PaydayRule): string {
  const current = cycleContaining(today, rule);
  const first = cycleContaining(addDays(current.end, 1), rule);
  const second = cycleContaining(addDays(first.end, 1), rule);
  return `Your budget cycle runs ${short(first.start)} – ${short(first.end)}, then ${short(second.start)} – ${short(second.end)}`;
}
