import { useRouter } from "expo-router";
import React from "react";
import { View } from "react-native";
import { ErrorState } from "@/components/ui/error-state";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { useFinishSetup, useFixedCosts } from "@/features/profile/hooks";
import { PersonalityScreen } from "@/features/profile/screens/personality-screen";
import { useSetup } from "@/features/profile/setup-store";
import { describeError } from "@/lib/api-errors";
import { todayIst } from "@/lib/dates";
import { messageFor } from "@/lib/errors";
import { spacing } from "@/theme";

export default function PersonalityRoute() {
  const router = useRouter();
  const finish = useFinishSetup();
  const costs = useFixedCosts();
  const { reset } = useSetup();
  // The figure on the button depends on fixed costs: never compute it before they are known.
  if (!costs.data) {
    return (
      <Screen>
        {costs.error ? (
          <ErrorState body={describeError(costs.error, messageFor)} onRetry={() => void costs.refetch()} />
        ) : (
          <View testID="personality-loading" style={{ gap: spacing.md }}>
            <Skeleton height={44} />
            <Skeleton height={120} />
          </View>
        )}
      </Screen>
    );
  }
  const fixedPaise = costs.data.reduce((s, c) => s + c.amountPaise, 0);
  return (
    <PersonalityScreen
      today={todayIst()}
      fixedPaise={fixedPaise}
      finish={finish}
      onDone={() => {
        // Navigate first, then clear the draft, so the old screen never renders an emptied draft.
        router.replace("/onboarding/notifications");
        reset();
      }}
      onBack={() => router.back()}
    />
  );
}
