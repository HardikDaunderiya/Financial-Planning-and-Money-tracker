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

export type ProfileRequest = Omit<Profile, "paydayDay"> & { paydayDay?: number };

export type FixedCost = { id: string; name: string; amountPaise: number };

export const profileApi = {
  get: () => api.get<Profile>("/me/profile"),
  put: (body: ProfileRequest) => api.put<Profile>("/me/profile", body),
};

export const fixedCostApi = {
  list: () => api.get<FixedCost[]>("/me/fixed-costs"),
  add: (body: { name: string; amountPaise: number }) => api.post<FixedCost>("/me/fixed-costs", body),
  patch: (id: string, body: { name?: string; amountPaise?: number }) =>
    api.patch<FixedCost>(`/me/fixed-costs/${id}`, body),
  remove: (id: string) => api.del<void>(`/me/fixed-costs/${id}`),
};
