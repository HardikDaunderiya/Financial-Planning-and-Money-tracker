import React from "react";
import { View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import { Button } from "./button";
import { Text } from "./text";

export function ErrorState({ title = "Something went wrong", body, onRetry }: { title?: string; body?: string; onRetry: () => void }) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: colors.badTint,
        gap: spacing.sm,
        alignItems: "center",
      }}
    >
      <Text variant="bodyStrong" color={colors.bad} align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" align="center">
          {body}
        </Text>
      ) : null}
      <Button title="Retry" variant="secondary" onPress={onRetry} style={{ alignSelf: "stretch", marginTop: spacing.sm }} />
    </View>
  );
}
