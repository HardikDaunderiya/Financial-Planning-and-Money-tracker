import React from "react";
import { Pressable, View } from "react-native";
import { colors, radius, spacing, touchTarget } from "@/theme";
import { formatRupees } from "@/lib/money";
import { Icon } from "./icon";
import { Text } from "./text";

export type StepperProps = {
  label: string;
  valuePaise: number;
  stepPaise: number;
  min: number;
  max: number;
  onChange: (paise: number) => void;
  /** Tapping the number; Task 9 uses it to open a typed input. */
  onPressValue?: () => void;
  testID?: string;
};

export function Stepper({
  label,
  valuePaise,
  stepPaise,
  min,
  max,
  onChange,
  onPressValue,
  testID,
}: StepperProps) {
  const step = formatRupees(stepPaise);
  const canLess = valuePaise > min;
  const canMore = valuePaise < max;
  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      <Text variant="label">{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.md,
        }}
      >
        <RoundButton
          label={`Save ${step} less`}
          icon="minus"
          disabled={!canLess}
          onPress={() => onChange(Math.max(min, valuePaise - stepPaise))}
        />
        <Pressable
          accessibilityRole={onPressValue ? "button" : "text"}
          accessibilityLabel={
            onPressValue ? `${label}, ${formatRupees(valuePaise)}, tap to type an amount` : undefined
          }
          onPress={onPressValue}
          disabled={!onPressValue}
          style={{ minHeight: touchTarget, justifyContent: "center" }}
        >
          <Text variant="hero" align="center" style={{ fontVariant: ["tabular-nums"] }}>
            {formatRupees(valuePaise)}
          </Text>
        </Pressable>
        <RoundButton
          label={`Save ${step} more`}
          icon="plus"
          disabled={!canMore}
          onPress={() => onChange(Math.min(max, valuePaise + stepPaise))}
        />
      </View>
    </View>
  );
}

function RoundButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: "plus" | "minus";
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 56,
        height: 56,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: colors.control,
        backgroundColor: colors.surface,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      <Icon name={icon} size={24} />
    </Pressable>
  );
}
