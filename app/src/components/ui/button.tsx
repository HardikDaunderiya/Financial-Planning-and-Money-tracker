import React from "react";
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, spacing, touchTarget } from "@/theme";
import { Text } from "./text";

const variants = {
  primary: { background: colors.accent, border: colors.accent, text: colors.onAccent },
  secondary: { background: colors.surface, border: colors.control, text: colors.ink },
  ghost: { background: "transparent", border: "transparent", text: colors.ink },
  danger: { background: colors.badTint, border: colors.badTint, text: colors.bad },
} as const;

export type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: keyof typeof variants;
  disabled?: boolean;
  loading?: boolean;
  /** Icon-only buttons pass `icon` and keep `title` as the accessibility label. */
  icon?: React.ReactNode;
  iconOnly?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Button({ title, onPress, variant = "primary", disabled, loading, icon, iconOnly, style, testID }: ButtonProps) {
  const v = variants[variant];
  const off = !!disabled || !!loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      testID={testID}
      hitSlop={iconOnly ? 6 : undefined}
      pressRetentionOffset={8}
      style={({ pressed }) => [
        {
          minHeight: touchTarget,
          minWidth: iconOnly ? touchTarget : undefined,
          paddingHorizontal: iconOnly ? 0 : spacing.lg,
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: v.border,
          backgroundColor: v.background,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: spacing.sm,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {icon ?? null}
          {iconOnly ? null : (
            <Text variant="bodyStrong" color={v.text}>
              {title}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}
