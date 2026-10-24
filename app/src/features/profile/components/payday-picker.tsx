import React from "react";
import { ScrollView, View } from "react-native";
import { Chip } from "@/components/ui/chip";
import { RadioCard } from "@/components/ui/radio-card";
import { Text } from "@/components/ui/text";
import { cycleLine } from "@/lib/cycle";
import { spacing } from "@/theme";
import type { SetupDraft } from "../setup-store";

type Option = { id: "first" | "last" | "seventh" | "other"; label: string };
const options: Option[] = [
  { id: "first", label: "1st of the month" },
  { id: "last", label: "Last working day" },
  { id: "seventh", label: "7th of the month" },
  { id: "other", label: "Another date" },
];

function ordinal(n: number): string {
  const s =
    n % 10 === 1 && n !== 11
      ? "st"
      : n % 10 === 2 && n !== 12
        ? "nd"
        : n % 10 === 3 && n !== 13
          ? "rd"
          : "th";
  return `${n}${s}`;
}

/** Days 2–28 except 7 (the 1st and 7th have their own cards); 29–31 are not offered (spec 2.1). */
const otherDays = Array.from({ length: 27 }, (_, k) => k + 2).filter((n) => n !== 7);

export type PaydayValue = SetupDraft["payday"];

function optionOf(value: PaydayValue): Option["id"] | null {
  if (value === null) return null;
  if (value.rule === "LAST_WORKING_DAY") return "last";
  if (value.day === 1) return "first";
  if (value.day === 7) return "seventh";
  return value.day === null || otherDays.includes(value.day) ? "other" : null;
}

export function PaydayPicker({
  value,
  today,
  onChange,
}: {
  value: PaydayValue;
  today: string;
  onChange: (v: PaydayValue) => void;
}) {
  const selected = optionOf(value);
  const line =
    value === null
      ? null
      : value.rule === "LAST_WORKING_DAY"
        ? cycleLine(today, value)
        : value.day !== null
          ? cycleLine(today, { rule: "FIXED_DAY", day: value.day })
          : null;
  return (
    <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
      <Text variant="label">When does salary arrive?</Text>
      {options.map((o) => (
        <RadioCard
          key={o.id}
          title={o.label}
          checked={selected === o.id}
          onPress={() => {
            if (o.id === "first") onChange({ rule: "FIXED_DAY", day: 1 });
            else if (o.id === "seventh") onChange({ rule: "FIXED_DAY", day: 7 });
            else if (o.id === "last") onChange({ rule: "LAST_WORKING_DAY" });
            else onChange({ rule: "FIXED_DAY", day: null });
          }}
        >
          {selected === o.id && o.id === "other" ? (
            <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
              <Text variant="labelMuted">Day of the month</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm }}
              >
                {otherDays.map((d) => (
                  <Chip
                    key={d}
                    label={ordinal(d)}
                    selected={value?.rule === "FIXED_DAY" && value.day === d}
                    onPress={() => onChange({ rule: "FIXED_DAY", day: d })}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}
          {selected === o.id && line ? <Text variant="caption">{line}</Text> : null}
        </RadioCard>
      ))}
    </View>
  );
}
