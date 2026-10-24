import { Redirect, type Href } from "expo-router";
import React from "react";
import { View } from "react-native";
import { ErrorState } from "@/components/ui/error-state";
import { useSession } from "@/features/auth/session";
import { useProfile } from "@/features/profile/hooks";
import { colors, spacing } from "@/theme";

// These routes arrive in Tasks 7 and 8; until the typed-route file knows them the hrefs are cast.
const ONBOARDING = "/onboarding/income" as unknown as Href;
const HOME = "/(tabs)" as unknown as Href;

export default function Index() {
  const { status } = useSession();
  const profile = useProfile({ enabled: status === "signedIn" });
  if (status === "signedOut") return <Redirect href="/login" />;
  if (profile.isLoading || (profile.data === undefined && !profile.error)) return null;
  if (profile.error) {
    return (
      <View
        style={{ flex: 1, justifyContent: "center", padding: spacing.md, backgroundColor: colors.ground }}
      >
        <ErrorState body="Could not load your profile" onRetry={() => void profile.refetch()} />
      </View>
    );
  }
  if (profile.data === null) return <Redirect href={ONBOARDING} />;
  return <Redirect href={HOME} />;
}
