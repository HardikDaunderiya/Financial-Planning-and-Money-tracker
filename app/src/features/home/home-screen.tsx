import { Redirect } from "expo-router";
import { onlineManager } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { ErrorState } from "@/components/ui/error-state";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { Toast } from "@/components/ui/toast";
import { useToday } from "@/features/budget/hooks";
import { describeError, isApiError } from "@/lib/api-errors";
import { formatDay, greeting, relativeTime, todayIst } from "@/lib/dates";
import { messageFor } from "@/lib/errors";
import { kv, kvKeys } from "@/lib/kv";
import { spacing } from "@/theme";
import { Hero } from "./hero";
import { TodaySection } from "./today-section";

const FOREGROUND_REFETCH_MIN_MS = 30_000;

export const FIRST_SPEND_FLAG = kvKeys.firstSpend;

export function HomeScreen({ now = new Date() }: { now?: Date }) {
  const today = useToday();
  const { refetch } = today;
  // The foreground handler reads the latest state through a ref, so the listener is attached once.
  const latest = useRef({ fetching: today.isFetching, updatedAt: today.dataUpdatedAt });
  useEffect(() => {
    latest.current = { fetching: today.isFetching, updatedAt: today.dataUpdatedAt };
  });
  // offlineFirst still tries once while offline, so "paused" alone would miss the first seconds of being offline.
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => {
    return onlineManager.subscribe(setOnline);
  }, []);
  const [everLogged, setEverLogged] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void kv.get(FIRST_SPEND_FLAG).then((v) => alive && setEverLogged(v === "1"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const { fetching, updatedAt } = latest.current;
      if (fetching || Date.now() - updatedAt < FOREGROUND_REFETCH_MIN_MS) return;
      void refetch({ cancelRefetch: false });
    });
    return () => sub.remove();
  }, [refetch]);

  if (isApiError(today.error, "SETUP_INCOMPLETE")) {
    return (
      <View testID="redirect-onboarding">
        <Redirect href="/onboarding/income" />
      </View>
    );
  }

  const data = today.data;
  const firstRun = !!data && data.spentPaise === 0 && everLogged === false;
  const date = data?.date ?? todayIst(now);

  return (
    <Screen testID="home">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="labelMuted">{formatDay(date)}</Text>
        <Text variant="label">{firstRun ? "Day one" : greeting(now)}</Text>
      </View>
      {!data && today.isLoading ? (
        <View testID="home-skeleton" style={{ gap: spacing.md }}>
          <Skeleton height={160} round />
          <Skeleton height={72} width="60%" />
          <Skeleton height={8} />
          <Skeleton height={120} />
        </View>
      ) : !data ? (
        <ErrorState body={describeError(today.error, messageFor)} onRetry={() => void today.refetch()} />
      ) : (
        <>
          {!online || today.fetchStatus === "paused" ? (
            <Toast message={`Updated ${relativeTime(today.dataUpdatedAt, now.getTime())}`} />
          ) : today.error ? (
            <Toast message="Could not refresh. Showing saved data." tone="bad" />
          ) : null}
          <Hero today={data} firstRun={firstRun} />
          <TodaySection />
        </>
      )}
    </Screen>
  );
}
