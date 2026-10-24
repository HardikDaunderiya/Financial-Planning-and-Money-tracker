import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
} from "@expo-google-fonts/bricolage-grotesque";
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppErrorBoundary } from "@/components/error-boundary";
import { SessionProvider } from "@/features/auth/session";
import { persistOptions, queryClient, wireOnlineManager } from "@/lib/query";
import { Gate, Navigation } from "@/navigation";
import { installGlobalHandlers } from "@/lib/unhandled";
import { colors } from "@/theme";

void SplashScreen.preventAutoHideAsync();
installGlobalHandlers();
wireOnlineManager();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
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
              <Gate fontsLoaded={fontsLoaded} fontError={fontError}>
                <Navigation />
              </Gate>
            </SessionProvider>
          </PersistQueryClientProvider>
        </AppErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
