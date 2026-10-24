import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { colors, radius, spacing } from "@/theme";
import type { Profile } from "../api";
import { personalities } from "../components/personality-picker";

function time(t: string): string {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function MeScreen({
  email,
  profile,
  signOut,
}: {
  email: string | null;
  profile: Profile | null | undefined;
  signOut: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const personality = personalities.find((p) => p.id === profile?.personality)?.label;
  return (
    <Screen testID="me">
      <Text variant="heading">Me</Text>
      <View
        style={{
          padding: spacing.md,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
          gap: spacing.sm,
        }}
      >
        {email ? (
          <Text variant="body" selectable>
            {email}
          </Text>
        ) : null}
        {personality ? <Text variant="bodyMuted">{personality}</Text> : null}
        {profile ? (
          <Text variant="bodyMuted">{`${time(profile.morningTime)} and ${time(profile.nightTime)}`}</Text>
        ) : null}
        <Text variant="caption">Editing these arrives with a later update</Text>
      </View>
      {confirming ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="bodyStrong">Sign out of Gullak on this phone?</Text>
          <Button
            title="Yes, sign out"
            variant="danger"
            loading={busy}
            onPress={() => {
              setBusy(true);
              void signOut().finally(() => setBusy(false));
            }}
          />
          <Button title="Keep me signed in" variant="secondary" onPress={() => setConfirming(false)} />
        </View>
      ) : (
        <Button title="Sign out" variant="secondary" onPress={() => setConfirming(true)} />
      )}
    </Screen>
  );
}
