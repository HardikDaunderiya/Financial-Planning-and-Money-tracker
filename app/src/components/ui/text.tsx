import React from "react";
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";
import { type, type TypeVariant } from "@/theme";

export type TextProps = RNTextProps & { variant?: TypeVariant; color?: TextStyle["color"]; align?: TextStyle["textAlign"] };

export function Text({ variant = "body", color, align, style, ...props }: TextProps) {
  return <RNText style={[type[variant], color ? { color } : null, align ? { textAlign: align } : null, style]} {...props} />;
}
