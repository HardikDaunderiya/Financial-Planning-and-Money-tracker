import { cycleContaining, type PaydayRule } from "./cycle";
import { addDays, daysInclusive } from "./dates";

/** Round paise down to a whole rupee. */
export function wholeRupees(paise: number): number {
  return Math.floor(paise / 100) * 100;
}

export type FirstCyclePreview = {
  cycleStart: string;
  cycleEnd: string;
  daysLeft: number;
  poolPaise: number;
  dayBudgetPaise: number;
  proRated: boolean;
};

/**
 * Mirrors the server (spec 2.1, BUD-32): the first cycle's pool is monthly spendable × days left ÷ cycle days,
 * rounded down to whole rupees, unless the user states what they have left. On payday itself nothing is pro-rated.
 */
export function firstCyclePreview(input: {
  monthlySpendablePaise: number;
  today: string;
  payday: PaydayRule;
  moneyLeftPaise?: number;
}): FirstCyclePreview {
  const cycle = cycleContaining(input.today, input.payday);
  const daysLeft = daysInclusive(input.today, cycle.end);
  const proRated = daysLeft < cycle.days;
  const computed = proRated
    ? wholeRupees(Math.floor((input.monthlySpendablePaise * daysLeft) / cycle.days))
    : input.monthlySpendablePaise;
  const poolPaise = input.moneyLeftPaise ?? computed;
  return {
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
    daysLeft,
    poolPaise,
    dayBudgetPaise: poolPaise > 0 ? wholeRupees(Math.floor(poolPaise / daysLeft)) : 0,
    proRated,
  };
}

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Per day in November (30 days)": the next full cycle after today's. */
export function perDayPreview(input: { freePaise: number; today: string; payday: PaydayRule }): {
  perDayPaise: number;
  cycleName: string;
  cycleDays: number;
} {
  const current = cycleContaining(input.today, input.payday);
  const next = cycleContaining(addDays(current.end, 1), input.payday);
  const name = monthNames[Number(next.start.slice(5, 7)) - 1] ?? "";
  return {
    perDayPaise: input.freePaise > 0 ? wholeRupees(Math.floor(input.freePaise / next.days)) : 0,
    cycleName: name,
    cycleDays: next.days,
  };
}

export type Verdict = "doable" | "tight" | "notPossible";

/** The setup reality check (APP-20): nothing free → not possible; under ₹250 a day → tight; else doable. */
export function realityCheck(input: {
  incomePaise: number;
  fixedPaise: number;
  savingsPaise: number;
  cycleDays: number;
}): { verdict: Verdict; freePaise: number; perDayPaise: number; maxSavingsPaise: number } {
  const freePaise = input.incomePaise - input.fixedPaise - input.savingsPaise;
  const perDayPaise = freePaise > 0 ? wholeRupees(Math.floor(freePaise / input.cycleDays)) : 0;
  const maxSavingsPaise = Math.max(0, input.incomePaise - input.fixedPaise - 100);
  const verdict: Verdict = freePaise <= 0 ? "notPossible" : perDayPaise < 25000 ? "tight" : "doable";
  return { verdict, freePaise, perDayPaise, maxSavingsPaise };
}
