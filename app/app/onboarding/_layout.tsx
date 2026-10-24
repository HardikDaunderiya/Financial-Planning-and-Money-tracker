import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";
import React, { useState } from "react";
import { SetupProvider } from "@/features/profile/setup-store";
import { useProfile } from "@/features/profile/hooks";
import { colors } from "@/theme";

export default function OnboardingLayout() {
  const profile = useProfile();
  // Finishing setup saves the profile while the user is still in this flow (notifications step comes next), so
  // only a profile that existed before the user started here sends them home.
  const [startedSetup, setStartedSetup] = useState(false);
  if (profile.data === null && !startedSetup) setStartedSetup(true);
  if (profile.data && !startedSetup) return <Redirect href="/home" />;
  return (
    <SetupProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />
    </SetupProvider>
  );
}
