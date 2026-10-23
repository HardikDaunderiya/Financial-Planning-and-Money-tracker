import React from "react";
import { View } from "react-native";
import { colors, radius } from "@/theme";

export type ProgressBarProps = { value: number; label: string; tone?: "ink" | "good" | "warn" | "bad"; height?: number };

/** A single-colour bar. value is 0..100; anything above 100 fills the bar. */
export function ProgressBar({ value, label, tone = "ink", height = 8 }: ProgressBarProps) {
  const fill = { ink: colors.muted, good: colors.good, warn: colors.warnInk, bad: colors.bad }[tone];
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ now: clamped, min: 0, max: 100 }}
      style={{ height, borderRadius: radius.full, backgroundColor: colors.sand, overflow: "hidden" }}
    >
      <View style={{ width: `${clamped}%`, height: "100%", backgroundColor: fill, borderRadius: radius.full }} />
    </View>
  );
}
