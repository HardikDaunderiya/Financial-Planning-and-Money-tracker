import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { colors, motion, radius, spacing } from "@/theme";

/** An inline "X removed · Undo" row that commits after 5 seconds. Not a toast: it carries an action, so it sits in the content. */
export function UndoBar({
  message,
  onUndo,
  onExpire,
}: {
  message: string;
  onUndo: () => void;
  onExpire: () => void;
}) {
  // The latest callback is read through a ref so a re-render never restarts the 5 seconds.
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });
  useEffect(() => {
    const t = setTimeout(() => expire.current(), motion.undoWindow);
    return () => clearTimeout(t);
  }, []);
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: colors.dark,
        borderRadius: radius.md,
        paddingLeft: spacing.md,
        paddingRight: spacing.xs,
        minHeight: 52,
      }}
    >
      <Text variant="label" color={colors.darkText}>
        {message}
      </Text>
      <Button
        title="Undo"
        variant="ghost"
        textColor={colors.darkText}
        onPress={onUndo}
        style={{ paddingHorizontal: spacing.md }}
      />
    </View>
  );
}
