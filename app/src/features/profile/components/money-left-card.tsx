import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { formatDay } from "@/lib/dates";
import { formatRupees, parseRupeesToPaise } from "@/lib/money";
import type { FirstCyclePreview } from "@/lib/budget";
import { colors, radius, spacing } from "@/theme";

export function MoneyLeftCard({
  preview,
  edited,
  maxPaise,
  onChange,
}: {
  preview: FirstCyclePreview;
  edited: boolean;
  maxPaise: number;
  onChange: (paise: number) => void;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <View
      style={{
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: colors.sand,
      }}
    >
      <Text variant="label">Left until payday</Text>
      <Text variant="caption">
        {edited ? "Your figure" : "Our guess for the rest of this cycle. Change it if you know better."}
      </Text>
      {typing !== null ? (
        <View style={{ gap: spacing.sm }}>
          <Field
            label="Money left until payday"
            prefix="₹"
            large
            value={typing}
            onChangeText={(t) => setTyping(t.replace(/[^\d,]/g, ""))}
            keyboardType="number-pad"
            inputMode="numeric"
            autoFocus
          />
          <Button
            title="Done"
            onPress={() => {
              onChange(Math.min(maxPaise, parseRupeesToPaise(typing)));
              setTyping(null);
            }}
          />
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text variant="amount">{formatRupees(preview.poolPaise)}</Text>
          <Button
            title="Change"
            variant="secondary"
            onPress={() => setTyping(String(preview.poolPaise / 100))}
          />
        </View>
      )}
      <Text variant="labelMuted">{`That's ${formatRupees(preview.dayBudgetPaise)} a day until ${formatDay(preview.cycleEnd)}`}</Text>
    </View>
  );
}
