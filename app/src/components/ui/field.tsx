import React, { useId } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { colors, fonts, radius, spacing, touchTarget } from "@/theme";
import { Text } from "./text";

export type FieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  /** A fixed prefix such as ₹, drawn inside the box. */
  prefix?: string;
  large?: boolean;
};

export function Field({ label, hint, error, prefix, large, ...input }: FieldProps) {
  const id = useId();
  const border = error ? colors.bad : colors.control;
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="label" nativeID={`${id}-label`}>
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: large ? 64 : touchTarget + 4,
          borderWidth: 1,
          borderColor: border,
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.md,
          gap: spacing.sm,
        }}
      >
        {prefix ? (
          <Text variant={large ? "hero" : "body"} color={colors.muted}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          accessibilityLabelledBy={`${id}-label`}
          placeholderTextColor={colors.control}
          style={{
            flex: 1,
            fontFamily: large ? fonts.head700 : fonts.ui400,
            fontSize: large ? 44 : 16,
            color: colors.ink,
            paddingVertical: spacing.sm,
          }}
          {...input}
        />
      </View>
      {error ? (
        <Text variant="caption" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
}
