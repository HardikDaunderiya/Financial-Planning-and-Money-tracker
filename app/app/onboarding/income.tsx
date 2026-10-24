import { useRouter } from "expo-router";
import React from "react";
import { IncomeScreen } from "@/features/profile/screens/income-screen";
import { useSetup } from "@/features/profile/setup-store";
import { todayIst } from "@/lib/dates";

export default function IncomeRoute() {
  const router = useRouter();
  const { hydrated } = useSetup();
  if (!hydrated) return null;
  return <IncomeScreen today={todayIst()} onContinue={() => router.push("/onboarding/fixed-costs")} />;
}
