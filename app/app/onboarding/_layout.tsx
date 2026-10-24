import { Stack } from "expo-router/stack";
import React from "react";
import { SetupProvider } from "@/features/profile/setup-store";
import { colors } from "@/theme";

export default function OnboardingLayout() {
  return (
    <SetupProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />
    </SetupProvider>
  );
}
