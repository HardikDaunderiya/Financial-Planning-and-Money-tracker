import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError } from "@/lib/api-errors";
import { fixedCostApi, profileApi, type FixedCost, type Profile, type ProfileRequest } from "./api";

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

export function useRemoveFixedCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fixedCostApi.remove(id),
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
