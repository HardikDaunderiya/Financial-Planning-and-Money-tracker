import { useQuery } from "@tanstack/react-query";
import { budgetApi, type Today } from "./api";

export const todayKey = ["today"] as const;

export function useToday() {
  return useQuery<Today>({ queryKey: todayKey, queryFn: budgetApi.getToday, staleTime: 30_000 });
}
