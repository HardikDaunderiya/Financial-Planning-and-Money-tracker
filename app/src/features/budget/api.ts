import { api } from "@/lib/client";
import type { ServerMood } from "@/features/gullak/moods";

export type Today = {
  date: string;
  budgetPaise: number;
  spentPaise: number;
  leftPaise: number;
  overPaise: number;
  poolOverPaise: number;
  mood: ServerMood;
  line: string;
  daysLeft: number;
  cycleStart: string;
  cycleEnd: string;
};

export const budgetApi = {
  /** Raw body: `useToday` validates it with `parseToday` before anything renders. */
  getToday: () => api.get<unknown>("/budget/today"),
  setFirstCycle: (moneyLeftPaise: number) => api.put<Today>("/budget/first-cycle", { moneyLeftPaise }),
};
