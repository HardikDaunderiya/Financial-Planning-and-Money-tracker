import React from "react";
import { View } from "react-native";
import { Icon, type IconName } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { formatRupees } from "@/lib/money";
import type { Verdict } from "@/lib/budget";
import { colors, radius, spacing } from "@/theme";

const look: Record<Verdict, { icon: IconName; title: string; ink: string; bg: string }> = {
  doable: { icon: "check", title: "Doable", ink: colors.goodDeep, bg: colors.goodTint },
  tight: { icon: "alert", title: "Possible, but tight", ink: colors.warnInk, bg: colors.warnTint },
  notPossible: { icon: "x", title: "Not possible", ink: colors.bad, bg: colors.badTint },
};

export function RealityCheck({
  verdict,
  perDayPaise,
  essentialsLeftPaise,
  suggestedSavingsPaise,
}: {
  verdict: Verdict;
  perDayPaise: number;
  essentialsLeftPaise: number;
  suggestedSavingsPaise: number;
}) {
  const l = look[verdict];
  const line =
    verdict === "doable"
      ? `You keep ${formatRupees(perDayPaise)} a day for everything else`
      : verdict === "tight"
        ? `${formatRupees(perDayPaise)} a day covers chai and the metro, not much else`
        : essentialsLeftPaise < 0
          ? "Your fixed costs are more than your salary"
          : suggestedSavingsPaise === 0
            ? `Only ${formatRupees(essentialsLeftPaise)} is left after essentials. Lower your fixed costs to continue.`
            : `Only ${formatRupees(essentialsLeftPaise)} is left after essentials. Try ${formatRupees(suggestedSavingsPaise)} or less.`;
  return (
    <View
      accessibilityRole="summary"
      style={{
        flexDirection: "row",
        gap: spacing.cm,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: l.bg,
      }}
    >
      <Icon name={l.icon} color={l.ink} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text variant="bodyStrong" color={l.ink}>
          {l.title}
        </Text>
        <Text variant="label" color={l.ink}>
          {line}
        </Text>
      </View>
    </View>
  );
}
