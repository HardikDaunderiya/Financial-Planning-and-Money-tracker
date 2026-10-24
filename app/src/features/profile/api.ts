import { api } from "@/lib/client";

export type PaydayRuleName = "FIXED_DAY" | "LAST_WORKING_DAY";
export type Personality = "CHILL" | "SAVAGE" | "MOM" | "HYPE";

export type Profile = {
  incomePaise: number;
  savingsPaise: number;
  paydayRule: PaydayRuleName;
  paydayDay?: number;
  personality: Personality;
  morningTime: string; // "08:00"
  nightTime: string; // "22:00"
  timezone: "Asia/Kolkata";
};

export const profileApi = {
  get: () => api.get<Profile>("/me/profile"),
};
