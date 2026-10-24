import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { useSession } from "@/features/auth/session";
import { log } from "@/lib/log";
import { colors } from "@/theme";

/** Nothing renders until fonts (loaded or failed) and the stored session are known, so the first frame is never the wrong screen. */
export function Gate({
  fontsLoaded,
  fontError,
  children,
}: {
  fontsLoaded: boolean;
  fontError: Error | null;
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const hydrated = (fontsLoaded || fontError !== null) && status !== "loading";
  useEffect(() => {
    if (fontError) log.error("fonts.failed", { reason: fontError.name });
  }, [fontError]);
  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync();
  }, [hydrated]);
  if (!hydrated) return null;
  return children;
}

/** Signed-out users reach only the login screens; signed-in users reach only the app. Anything else falls to +not-found. */
export function Navigation() {
  const { status } = useSession();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="login" />
        <Stack.Screen name="login-code" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}
