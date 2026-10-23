import React from "react";
import Svg, { Path } from "react-native-svg";
import { colors } from "@/theme";

const paths = {
  home: "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6",
  chart: "M4 20V11M10 20V5M16 20v-6M2 20h20",
  target: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2",
  user: "M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8M4 21c1-4 4-6 8-6s7 2 8 6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  flame: "M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7c1 2 2 3 3 3c0-2 0-4 0-7z",
  food: "M3 12h18M4 12a8 8 0 0 0 16 0M9 8c0-2 2-2 2-4M14 8c0-2 2-2 2-4",
  cart: "M3 4h2l2 11h11l2-8H6M9 20h.01M17 20h.01",
  bag: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  coffee: "M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3",
  tv: "M3 7h18v12H3zM8 3l4 4 4-4",
  people: "M9 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6M3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 1 3 3 3 5",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v4h16v-4",
  check: "M5 12l5 5 9-10",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  up: "M12 19V5M5 12l7-7 7 7",
  alert: "M12 3l10 18H2zM12 10v4M12 17.5v.5",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a4 4 0 0 0 3 4M17 6h3v1a4 4 0 0 1-3 4M12 14v4M8 21h8",
  moon: "M20 14a8 8 0 1 1-10-10a6 6 0 0 0 10 10z",
  car: "M5 16v-5l2-5h10l2 5v5zM5 16v2M19 16v2M8 13h.01M16 13h.01",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  x: "M6 6l12 12M18 6L6 18",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
  backspace: "M9 6h11v12H9l-6-6zM12 9l5 6M17 9l-5 6",
  share: "M12 15V3M7 8l5-5 5 5M5 12v8h14v-8",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5l-1.5-1.5M19 19l1.5 1.5M5 19l-1.5 1.5M19 5l1.5-1.5M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8",
} as const;

export type IconName = keyof typeof paths;

export type IconProps = { name: IconName; size?: number; color?: string; strokeWidth?: number; label?: string };

/** Decorative by default; pass `label` only when the icon is the sole content of a control. */
export function Icon({ name, size = 24, color = colors.ink, strokeWidth = 2, label }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      testID={`icon-${name}`}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? "auto" : "no-hide-descendants"}
      {...(label ? { accessibilityLabel: label } : {})}
    >
      <Path d={paths[name]} />
    </Svg>
  );
}
