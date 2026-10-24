import React from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors, fonts, radius, shadows, spacing, touchTarget } from "@/theme";

/** The subset of the navigator's tab-bar props this bar uses (typed structurally; expo-router's Tabs passes a superset). */
export type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    navigate: (name: string) => void;
    emit: (e: { type: "tabPress"; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
  };
  descriptors: Record<string, { options?: { title?: string } }>;
};

const tabs: { name: string; label: string; icon: IconName }[] = [
  { name: "home", label: "Home", icon: "home" },
  { name: "insights", label: "Insights", icon: "chart" },
  { name: "goals", label: "Goals", icon: "target" },
  { name: "me", label: "Me", icon: "user" },
];

/** Design.md signature: a centre terracotta + button. It is enabled by Plan 3, which adds the quick-add route. */
export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  const items = [...tabs.slice(0, 2), null, ...tabs.slice(2)];
  return (
    <View>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: "row",
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingTop: spacing.sm,
          paddingBottom: insets.bottom + spacing.xs,
        }}
      >
        {items.map((t, i) =>
          t === null ? (
            <View key="gap" style={{ flex: 1 }} />
          ) : (
            <Pressable
              key={t.name}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: current === t.name }}
              onPress={() => {
                const route = state.routes.find((r) => r.name === t.name);
                const event = route
                  ? navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true })
                  : { defaultPrevented: false };
                if (!event.defaultPrevented) navigation.navigate(t.name);
              }}
              style={{ flex: 1, alignItems: "center", gap: spacing.xs, minHeight: touchTarget + 4 }}
            >
              <View
                style={{
                  width: 24,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: current === t.name ? colors.ink : "transparent",
                }}
              />
              <Icon name={t.icon} size={22} color={current === t.name ? colors.ink : colors.muted} />
              <Text
                variant="caption"
                color={current === t.name ? colors.ink : colors.muted}
                style={{ fontFamily: current === t.name ? fonts.ui700 : fonts.ui500 }}
              >
                {t.label}
              </Text>
            </Pressable>
          ),
        )}
      </View>
      {/* Outside the tablist: it is an action, not a tab. Plan 3 enables it. */}
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, alignItems: "center" }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a spend"
          accessibilityState={{ disabled: true }}
          disabled
          style={{
            marginTop: -spacing.lg,
            width: 56,
            height: 56,
            borderRadius: radius.full,
            backgroundColor: colors.accent,
            alignItems: "center",
            justifyContent: "center",
            boxShadow: shadows.addButton,
            opacity: 0.5,
          }}
        >
          <Icon name="plus" size={28} color={colors.onAccent} strokeWidth={2.5} />
        </Pressable>
      </View>
    </View>
  );
}
