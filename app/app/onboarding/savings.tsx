import { useRouter, type Href } from "expo-router";
import React from "react";
import { ErrorState } from "@/components/ui/error-state";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { useFixedCosts } from "@/features/profile/hooks";
import { SavingsScreen } from "@/features/profile/screens/savings-screen";
import { describeError } from "@/lib/api-errors";
import { todayIst } from "@/lib/dates";
import { messageFor } from "@/lib/errors";

export default function SavingsRoute() {
  const router = useRouter();
  const costs = useFixedCosts();
  if (costs.isLoading) {
    return (
      <Screen>
        <Skeleton height={44} />
        <Skeleton height={120} />
      </Screen>
    );
  }
  if (costs.error && !costs.data) {
    return (
      <Screen>
        <ErrorState body={describeError(costs.error, messageFor)} onRetry={() => void costs.refetch()} />
      </Screen>
    );
  }
  return (
    <SavingsScreen
      today={todayIst()}
      fixedCosts={costs.data ?? []}
      onContinue={() => router.push("/onboarding/personality" as unknown as Href)}
      onBack={() => router.back()}
    />
  );
}
