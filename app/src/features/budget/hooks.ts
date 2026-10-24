import { useQuery } from "@tanstack/react-query";
import { budgetApi, type Today } from "./api";
import { parseToday } from "./today";

export const todayKey = ["today"] as const;

export function useToday() {
  return useQuery<Today>({
    queryKey: todayKey,
    queryFn: async () => parseToday(await budgetApi.getToday()),
    staleTime: 30_000,
  });
}
