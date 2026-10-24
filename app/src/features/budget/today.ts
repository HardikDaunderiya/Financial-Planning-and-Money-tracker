import { UnknownError } from "@/lib/api-errors";
import { log } from "@/lib/log";
import type { ServerMood } from "@/features/gullak/moods";
import type { Today } from "./api";

const MOODS: readonly ServerMood[] = ["HAPPY", "CALM", "NERVOUS", "FAINTED"];
const MAX_LINE = 280;
const BIDI = /[‪-‮⁦-⁩]/g;

function bad(): never {
  throw new UnknownError("Unexpected response");
}

function isoDate(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return bad();
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return bad();
  return v;
}

function paise(v: unknown): number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : bad();
}

/** The edge check for GET /budget/today: anything off is an UnknownError, so Home shows Retry, never garbage. */
export function parseToday(raw: unknown): Today {
  if (typeof raw !== "object" || raw === null) return bad();
  const r = raw as Record<string, unknown>;
  const date = isoDate(r.date);
  const cycleStart = isoDate(r.cycleStart);
  const cycleEnd = isoDate(r.cycleEnd);
  if (cycleStart > cycleEnd) return bad();
  const daysLeft = r.daysLeft;
  if (typeof daysLeft !== "number" || !Number.isSafeInteger(daysLeft) || daysLeft < 1) return bad();
  if (typeof r.line !== "string") return bad();
  let mood: ServerMood;
  if (MOODS.includes(r.mood as ServerMood)) {
    mood = r.mood as ServerMood;
  } else {
    log.warn("today.unknown_mood", { kind: "unknown_mood" });
    mood = "NERVOUS";
  }
  const clean = r.line.replace(BIDI, "");
  const line = clean.length > MAX_LINE ? `${clean.slice(0, MAX_LINE - 1)}…` : clean;
  return {
    date,
    budgetPaise: paise(r.budgetPaise),
    spentPaise: paise(r.spentPaise),
    leftPaise: paise(r.leftPaise),
    overPaise: paise(r.overPaise),
    poolOverPaise: paise(r.poolOverPaise),
    mood,
    line,
    daysLeft,
    cycleStart,
    cycleEnd,
  };
}
