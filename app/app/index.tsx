import { Redirect, type Href } from "expo-router";
import React from "react";
import { View } from "react-native";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { useSession } from "@/features/auth/session";
import { useProfile } from "@/features/profile/hooks";
import { colors, spacing } from "@/theme";

// These routes arrive in Tasks 8 and 10; until the typed-route file knows them the hrefs are cast.
const ONBOARDING = "/onboarding/income" as unknown as Href;
const HOME = "/home" as unknown as Href;

export default function Index() {
  const { status } = useSession();
  const profile = useProfile({ enabled: status === "signedIn" });
  if (status === "signedOut") return <Redirect href="/login" />;
  if (profile.error) {
    return (
      <Centered>
        <ErrorState body="Could not load your profile" onRetry={() => void profile.refetch()} />
      </Centered>
    );
  }
  if (profile.data === undefined) {
    if (profile.isFetching) {
      return (
        <Centered testID="profile-loading">
          <Skeleton height={28} width="60%" />
          <Skeleton height={16} />
        </Centered>
      );
    }
    // Paused (offline) or disabled with nothing cached: say so and let the user retry.
    return (
      <Centered>
        <ErrorState
          body="No connection. Check your network and try again."
          onRetry={() => void profile.refetch()}
        />
      </Centered>
    );
  }
  if (profile.data === null) return <Redirect href={ONBOARDING} />;
  return <Redirect href={HOME} />;
}

function Centered({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        justifyContent: "center",
        gap: spacing.md,
        padding: spacing.md,
        backgroundColor: colors.ground,
      }}
    >
      {children}
    </View>
  );
}
