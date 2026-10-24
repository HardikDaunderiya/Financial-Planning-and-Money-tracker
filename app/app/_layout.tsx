import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
} from "@expo-google-fonts/bricolage-grotesque";
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppErrorBoundary } from "@/components/error-boundary";
import { SessionProvider, useSession } from "@/features/auth/session";
import { persistOptions, queryClient, wireOnlineManager } from "@/lib/query";
import { installGlobalHandlers } from "@/lib/unhandled";
import { colors } from "@/theme";

void SplashScreen.preventAutoHideAsync();
installGlobalHandlers();
wireOnlineManager();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    "DMSans-400": DMSans_400Regular,
    "DMSans-500": DMSans_500Medium,
    "DMSans-700": DMSans_700Bold,
    "Bricolage-600": BricolageGrotesque_600SemiBold,
    "Bricolage-700": BricolageGrotesque_700Bold,
  });
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ground }}>
      <SafeAreaProvider>
        <AppErrorBoundary full>
          <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
            <SessionProvider>
              <Gate ready={fontsLoaded}>
                <Navigation />
              </Gate>
            </SessionProvider>
          </PersistQueryClientProvider>
        </AppErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Nothing renders until fonts and the stored session are known, so the first frame is never the wrong screen. */
function Gate({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  const { status } = useSession();
  const hydrated = ready && status !== "loading";
  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync();
  }, [hydrated]);
  if (!hydrated) return null;
  return children;
}

function Navigation() {
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
