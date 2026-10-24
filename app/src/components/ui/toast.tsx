import React from "react";
import { View } from "react-native";
import { colors, radius, shadows, spacing } from "@/theme";
import { Text } from "./text";

/** A passive notice. It never carries an action (APP-28): anything that needs a decision renders inline. */
export function Toast({ message, tone = "ink" }: { message: string; tone?: "ink" | "bad" }) {
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: tone === "bad" ? colors.badTint : colors.dark,
        paddingVertical: spacing.cm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        borderCurve: "continuous",
        boxShadow: shadows.toast,
      }}
    >
      <Text variant="label" color={tone === "bad" ? colors.bad : colors.darkText}>
        {message}
      </Text>
    </View>
  );
}
