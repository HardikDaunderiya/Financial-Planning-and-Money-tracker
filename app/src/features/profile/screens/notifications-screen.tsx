import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { colors, spacing } from "@/theme";

const kinds: { icon: IconName; title: string; body: string }[] = [
  { icon: "sun", title: "Morning budget", body: "Your number for the day, at the time you picked" },
  { icon: "moon", title: "Night report", body: "How the day went, as a short report card" },
  { icon: "alert", title: "Close to the limit", body: "When a spend takes you past 80% of today" },
  { icon: "target", title: "Goals", body: "When a goal needs a catch-up plan, at most every 3 days" },
];

export function NotificationsScreen({
  supported,
  onAllow,
  onSkip,
}: {
  supported: boolean;
  onAllow: () => Promise<void>;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Screen
      testID="setup-notifications"
      footer={
        <View style={{ gap: spacing.sm }}>
          {supported ? (
            <Button
              title="Turn on notifications"
              loading={busy}
              onPress={() => {
                setBusy(true);
                void onAllow().finally(() => setBusy(false));
              }}
            />
          ) : null}
          <Button
            title={supported ? "Not now" : "Continue"}
            variant={supported ? "ghost" : "primary"}
            onPress={onSkip}
          />
        </View>
      }
    >
      <Text variant="heading">{supported ? "Two messages a day" : "Messages arrive on the phone app"}</Text>
      <Text variant="bodyMuted">
        At most 4 a day, never between 11 pm and 7 am, and each one can be switched off in Me
      </Text>
      <View style={{ gap: spacing.md }}>
        {kinds.map((k) => (
          <View key={k.title} style={{ flexDirection: "row", gap: spacing.cm, alignItems: "flex-start" }}>
            <Icon name={k.icon} color={colors.accentDeep} />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text variant="bodyStrong">{k.title}</Text>
              <Text variant="labelMuted">{k.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}
