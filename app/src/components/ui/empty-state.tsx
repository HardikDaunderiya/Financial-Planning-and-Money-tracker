import React from "react";
import { View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import { Text } from "./text";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <View
      style={{
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        gap: spacing.sm,
        alignItems: "center",
      }}
    >
      <Text variant="bodyStrong" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="bodyMuted" align="center">
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ alignSelf: "stretch", paddingTop: spacing.sm }}>{action}</View> : null}
    </View>
  );
}
