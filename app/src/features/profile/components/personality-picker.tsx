import React from "react";
import { View } from "react-native";
import { RadioCard } from "@/components/ui/radio-card";
import { Gullak } from "@/features/gullak/gullak";
import { sampleLine } from "@/features/gullak/lines";
import type { Mood } from "@/features/gullak/moods";
import { Text } from "@/components/ui/text";
import { colors, radius, spacing } from "@/theme";
import type { Personality } from "../api";

const FALLBACK = { id: "CHILL", label: "Chill friend", desc: "Calm, no judgement", mood: "calm" } as const;

export const personalities: { id: Personality; label: string; desc: string; mood: Mood }[] = [
  { id: "CHILL", label: "Chill friend", desc: "Calm, no judgement", mood: "calm" },
  { id: "SAVAGE", label: "Savage", desc: "Roasts you, lovingly", mood: "fainted" },
  { id: "MOM", label: "Indian mom", desc: "Worried, a little dramatic", mood: "nervous" },
  { id: "HYPE", label: "Hype-man", desc: "Cheers every small win", mood: "celebrating" },
];

export function PersonalityPicker({
  value,
  dayBudgetPaise,
  onChange,
}: {
  value: Personality;
  dayBudgetPaise: number;
  onChange: (p: Personality) => void;
}) {
  const current = personalities.find((p) => p.id === value) ?? FALLBACK;
  return (
    <View style={{ gap: spacing.md }}>
      <View
        style={{
          alignItems: "center",
          gap: spacing.sm,
          padding: spacing.md,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Gullak mood={current.mood} stage="clay" size={120} />
        <Text variant="body" align="center">
          {sampleLine(value, dayBudgetPaise)}
        </Text>
      </View>
      <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
        {personalities.map((p) => (
          <RadioCard
            key={p.id}
            title={p.label}
            description={p.desc}
            checked={p.id === value}
            onPress={() => onChange(p.id)}
          />
        ))}
      </View>
    </View>
  );
}
