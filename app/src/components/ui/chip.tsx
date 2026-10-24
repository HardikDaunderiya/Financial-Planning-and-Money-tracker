import React from "react";
import { Pressable } from "react-native";
import { colors, radius, spacing, touchTarget } from "@/theme";
import { Text } from "./text";

export type ChipProps = {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  icon?: React.ReactNode;
  testID?: string;
};

/** A selectable pill. Selected: 2px ink border (design.md). */
export function Chip({ label, selected = false, disabled = false, onPress, icon, testID }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: touchTarget,
        paddingHorizontal: spacing.md,
        borderRadius: radius.full,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.ink : colors.control,
        backgroundColor: selected ? colors.surface : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      {icon ?? null}
      <Text variant={selected ? "bodyStrong" : "body"}>{label}</Text>
    </Pressable>
  );
}
