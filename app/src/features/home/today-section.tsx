import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Text } from "@/components/ui/text";
import { spacing } from "@/theme";

/** Plan 3 fills this with the day's spends and enables the button; until then the empty state is the whole section. */
export function TodaySection() {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="title">Today</Text>
      <EmptyState
        title="Your spends show up here. Log one as soon as you pay."
        action={
          <View style={{ gap: spacing.sm }}>
            <Button title="Add first spend" onPress={() => undefined} disabled />
            <Text variant="caption" align="center">
              Or upload last month&apos;s statement
            </Text>
          </View>
        }
      />
    </View>
  );
}
