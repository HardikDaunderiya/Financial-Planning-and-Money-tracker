import { api } from "@/lib/client";
import { parseToday } from "./today";
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
  setFirstCycle: async (moneyLeftPaise: number): Promise<Today> =>
    parseToday(await api.put<unknown>("/budget/first-cycle", { moneyLeftPaise })),
};
