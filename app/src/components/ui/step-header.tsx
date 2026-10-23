import React from "react";
import { Pressable, View } from "react-native";
import { colors, spacing, touchTarget } from "@/theme";
import { Icon } from "./icon";
import { Text } from "./text";

export function StepHeader({
  step,
  total,
  name,
  onBack,
}: {
  step: number;
  total: number;
  name: string;
  onBack?: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touchTarget }}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          style={{ width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="left" />
        </Pressable>
      ) : null}
      <Text variant="labelMuted" accessibilityRole="header">
        {`Step ${step} of ${total} · ${name}`}
      </Text>
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: "row", gap: spacing.xs }} accessibilityElementsHidden>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={{
              width: 24,
              height: 3,
              borderRadius: 2,
              backgroundColor: i < step ? colors.ink : colors.line,
            }}
          />
        ))}
      </View>
    </View>
  );
}
