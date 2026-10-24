import { useQuery } from "@tanstack/react-query";
import { isApiError } from "@/lib/api-errors";
import { profileApi, type Profile } from "./api";

export const profileKeys = { profile: ["profile"] as const };

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
