import React from "react";
import { Pressable, View } from "react-native";
import { colors, radius, spacing, touchTarget } from "@/theme";
import { Text } from "./text";

export type RadioCardProps = {
  title: string;
  description?: string;
  checked: boolean;
  onPress: () => void;
  /** Extra content under the title (a sample line, a cycle line). */
  children?: React.ReactNode;
  testID?: string;
};

/** The selected-card pattern from the setup mockups: 1px control border, 2px ink border when checked. */
export function RadioCard({ title, description, checked, onPress, children, testID }: RadioCardProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ checked }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: touchTarget + 12,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: checked ? 2 : 1,
        borderColor: checked ? colors.ink : colors.control,
        backgroundColor: checked ? colors.surface : "transparent",
        gap: spacing.xs,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm }}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: radius.full,
            borderWidth: checked ? 6 : 2,
            borderColor: checked ? colors.ink : colors.control,
            backgroundColor: colors.surface,
          }}
        />
        <Text variant={checked ? "bodyStrong" : "body"}>{title}</Text>
      </View>
      {description ? <Text variant="labelMuted">{description}</Text> : null}
      {children}
    </Pressable>
  );
}
