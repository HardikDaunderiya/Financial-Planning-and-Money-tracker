import { useRouter, type Href } from "expo-router";
import React from "react";
import { useFinishSetup, useFixedCosts } from "@/features/profile/hooks";
import { PersonalityScreen } from "@/features/profile/screens/personality-screen";
import { useSetup } from "@/features/profile/setup-store";
import { todayIst } from "@/lib/dates";

export default function PersonalityRoute() {
  const router = useRouter();
  const finish = useFinishSetup();
  const costs = useFixedCosts();
  const { reset } = useSetup();
  const fixedPaise = (costs.data ?? []).reduce((s, c) => s + c.amountPaise, 0);
  return (
    <PersonalityScreen
      today={todayIst()}
      fixedPaise={fixedPaise}
      finish={finish}
      onDone={() => {
        reset();
        router.replace("/onboarding/notifications" as unknown as Href);
      }}
      onBack={() => router.back()}
    />
  );
}
