import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { budgetApi } from "@/features/budget/api";
import { isApiError } from "@/lib/api-errors";
import { fixedCostApi, profileApi, type FixedCost, type Profile, type ProfileRequest } from "./api";
import { FirstCycleNotSavedError } from "./finish-errors";
import type { FinishSetupInput } from "./screens/personality-screen";

export const profileKeys = { profile: ["profile"] as const, fixedCosts: ["fixed-costs"] as const };

/** `data === null` means the user has not finished setup (409 SETUP_INCOMPLETE). */
export function useProfile(options: { enabled?: boolean } = {}) {
  return useQuery<Profile | null>({
    queryKey: profileKeys.profile,
    queryFn: async () => {
      try {
        return await profileApi.get();
      } catch (e) {
        if (isApiError(e, "SETUP_INCOMPLETE")) return null;
        throw e;
      }
    },
    enabled: options.enabled ?? true,
  });
}

export function useFixedCosts() {
  return useQuery<FixedCost[]>({ queryKey: profileKeys.fixedCosts, queryFn: fixedCostApi.list });
}

export function useAddFixedCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; amountPaise: number }) => fixedCostApi.add(body),
    onSuccess: (created) =>
      qc.setQueryData<FixedCost[]>(profileKeys.fixedCosts, (old) => [...(old ?? []), created]),
  });
}

export function usePatchFixedCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; amountPaise?: number } }) =>
      fixedCostApi.patch(id, body),
    onSuccess: (updated) =>
      qc.setQueryData<FixedCost[]>(profileKeys.fixedCosts, (old) =>
        (old ?? []).map((f) => (f.id === updated.id ? updated : f)),
      ),
  });
}

/**
 * Removes a fixed cost. The cache updates live in these options (not in per-call callbacks) so they still run
 * when the screen has unmounted. A NOT_FOUND counts as removed and refetches the list to catch up.
 */
export function useRemoveFixedCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        await fixedCostApi.remove(id);
      } catch (e) {
        if (!isApiError(e, "NOT_FOUND")) throw e;
        void qc.invalidateQueries({ queryKey: profileKeys.fixedCosts });
      }
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: profileKeys.fixedCosts });
      const previous = qc.getQueryData<FixedCost[]>(profileKeys.fixedCosts) ?? [];
      qc.setQueryData<FixedCost[]>(
        profileKeys.fixedCosts,
        previous.filter((f) => f.id !== id),
      );
      return { previous };
    },
    onError: (_e, _id, ctx) => {
      if (ctx) qc.setQueryData(profileKeys.fixedCosts, ctx.previous);
    },
  });
}

export function usePutProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileRequest) => profileApi.put(body),
    onSuccess: (profile) => {
      qc.setQueryData(profileKeys.profile, profile);
      void qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

/**
 * PUT the profile, then pin the first cycle's pool when the user gave a money-left figure. If the override fails
 * after the profile saved, a retry sends only the override (the ref remembers the profile is saved).
 */
export function useFinishSetup() {
  const qc = useQueryClient();
  const profileSaved = useRef(false);
  return useCallback(
    async ({ moneyLeftPaise, ...profile }: FinishSetupInput) => {
      if (!profileSaved.current) {
        const saved = await profileApi.put(profile);
        profileSaved.current = true;
        qc.setQueryData(profileKeys.profile, saved);
      }
      if (moneyLeftPaise !== null) {
        let today;
        try {
          today = await budgetApi.setFirstCycle(moneyLeftPaise);
        } catch {
          throw new FirstCycleNotSavedError();
        }
        qc.setQueryData(["today"], today);
      } else {
        await qc.invalidateQueries({ queryKey: ["today"] });
      }
      profileSaved.current = false;
    },
    [qc],
  );
}
