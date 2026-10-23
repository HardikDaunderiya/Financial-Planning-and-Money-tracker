import React from "react";
import { ScrollView, View, type ScrollViewProps, type ViewStyle, type StyleProp } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";

type Props = {
  children: React.ReactNode;
  /** Content pinned below the scroll area (a primary button). It never sits under the keyboard because the scroll area shrinks. */
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  scrollProps?: Omit<ScrollViewProps, "children">;
  testID?: string;
};

/** The base of every screen: ground background, safe areas, 16px gutters, 16px rhythm. */
export function Screen({ children, footer, contentStyle, scrollProps, testID }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }} testID={testID}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          {
            paddingTop: insets.top + spacing.md,
            paddingHorizontal: spacing.md,
            paddingBottom: spacing.lg,
            gap: spacing.md,
          },
          contentStyle,
        ]}
        {...scrollProps}
      >
        {children}
      </ScrollView>
      {footer ? (
        <View
          style={{
            paddingHorizontal: spacing.md,
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing.md,
            gap: spacing.sm,
            backgroundColor: colors.ground,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
