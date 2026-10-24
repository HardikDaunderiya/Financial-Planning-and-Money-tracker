import React from "react";
import { View } from "react-native";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useProfile } from "@/features/profile/hooks";
import { formatRupees } from "@/lib/money";
import { colors, radius, spacing } from "@/theme";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function GoalsRoute() {
  const profile = useProfile();
  return (
    <Screen testID="goals">
      <Text variant="heading">Goals</Text>
      {profile.data ? (
        <View
          style={{
            padding: spacing.md,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            backgroundColor: colors.sand,
            gap: spacing.xs,
          }}
        >
          <Text variant="label">Saving every month</Text>
          <Text variant="amount">{formatRupees(profile.data.savingsPaise)}</Text>
        </View>
      ) : null}
      <EmptyState
        title="No goals yet"
        body="Set a goal like Goa by March and Gullak tells you whether you are on track"
      />
    </Screen>
  );
}
