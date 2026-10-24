import { useRouter, type Href } from "expo-router";
import React from "react";
import { FixedCostsScreen } from "@/features/profile/screens/fixed-costs-screen";

export default function FixedCostsRoute() {
  const router = useRouter();
  return (
    <FixedCostsScreen
      onContinue={() => router.push("/onboarding/savings" as unknown as Href)}
      onBack={() => router.back()}
    />
  );
}
