import { useRouter } from "expo-router";
import React from "react";
import { FixedCostsScreen } from "@/features/profile/screens/fixed-costs-screen";

export default function FixedCostsRoute() {
  const router = useRouter();
  return (
    <FixedCostsScreen onContinue={() => router.push("/onboarding/savings")} onBack={() => router.back()} />
  );
}
