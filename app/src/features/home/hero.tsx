import React from "react";
import { View } from "react-native";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Text } from "@/components/ui/text";
import { Gullak } from "@/features/gullak/gullak";
import { fromServerMood } from "@/features/gullak/moods";
import type { Today } from "@/features/budget/api";
import { formatDay } from "@/lib/dates";
import { formatRupees } from "@/lib/money";
import { colors, radius, spacing } from "@/theme";

const FIRST_RUN_LINE = "Hi, I'm your Gullak. Log a spend and I'll keep count.";

export function percentUsed(t: Today): number {
  if (t.budgetPaise <= 0) return t.spentPaise > 0 ? 100 : 0;
  return Math.min(100, Math.round((t.spentPaise * 100) / t.budgetPaise));
}

export function Hero({ today, firstRun }: { today: Today; firstRun: boolean }) {
  const mood = fromServerMood(today.mood);
  const used = percentUsed(today);
  const tone = mood === "fainted" ? "bad" : mood === "nervous" ? "warn" : "ink";
  return (
    <View
      style={{
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <Gullak mood={mood} stage="clay" size={160} />
        <Text variant="body" align="center">
          {firstRun ? FIRST_RUN_LINE : today.line}
        </Text>
      </View>
      <View style={{ alignItems: "center" }}>
        <Text variant="display" style={{ fontVariant: ["tabular-nums"] }}>
          {formatRupees(today.leftPaise)}
        </Text>
        <Text variant="bodyMuted">{`left of ${formatRupees(today.budgetPaise)} today`}</Text>
      </View>
      <ProgressBar value={used} label="Budget used" tone={tone} />
      {firstRun ? (
        <Text variant="labelMuted">Your streak starts tonight if you stay under</Text>
      ) : (
        <Text variant="label">{`${formatRupees(today.spentPaise)} spent`}</Text>
      )}
      <Text variant="caption">{`${today.daysLeft} day${today.daysLeft === 1 ? "" : "s"} left in this cycle, until ${formatDay(today.cycleEnd)}`}</Text>
    </View>
  );
}
