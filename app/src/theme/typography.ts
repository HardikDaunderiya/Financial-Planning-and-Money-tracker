import type { TextStyle } from "react-native";
import { colors } from "./colors";

/** Family names registered by useFonts in the root layout; the same on iOS, Android and web. */
export const fonts = {
  ui400: "DMSans-400",
  ui500: "DMSans-500",
  ui700: "DMSans-700",
  head600: "Bricolage-600",
  head700: "Bricolage-700",
} as const;

export const type = {
  caption: { fontFamily: fonts.ui400, fontSize: 12, lineHeight: 16, color: colors.muted },
  label: { fontFamily: fonts.ui500, fontSize: 14, lineHeight: 20, color: colors.ink },
  labelMuted: { fontFamily: fonts.ui500, fontSize: 14, lineHeight: 20, color: colors.muted },
  body: { fontFamily: fonts.ui400, fontSize: 16, lineHeight: 24, color: colors.ink },
  bodyMuted: { fontFamily: fonts.ui400, fontSize: 16, lineHeight: 24, color: colors.muted },
  bodyStrong: { fontFamily: fonts.ui700, fontSize: 16, lineHeight: 24, color: colors.ink },
  title: { fontFamily: fonts.head600, fontSize: 20, lineHeight: 26, color: colors.ink },
  amount: { fontFamily: fonts.head700, fontSize: 24, lineHeight: 30, color: colors.ink },
  heading: { fontFamily: fonts.head700, fontSize: 28, lineHeight: 34, color: colors.ink },
  hero: { fontFamily: fonts.head700, fontSize: 44, lineHeight: 50, color: colors.ink },
  display: { fontFamily: fonts.head700, fontSize: 72, lineHeight: 78, color: colors.ink },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;
