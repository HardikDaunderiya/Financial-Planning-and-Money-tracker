import React from "react";
import { View, type DimensionValue } from "react-native";
import { colors, radius } from "@/theme";

/** A static placeholder block (no shimmer: it would animate on every load, which fails the motion gate). */
export function Skeleton({ width = "100%", height = 16, round = false }: { width?: DimensionValue; height?: number; round?: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: round ? radius.full : radius.sm, backgroundColor: colors.sand }}
    />
  );
}
