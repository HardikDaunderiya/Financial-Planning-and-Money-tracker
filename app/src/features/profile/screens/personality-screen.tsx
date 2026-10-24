import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { StepHeader } from "@/components/ui/step-header";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { firstCyclePreview } from "@/lib/budget";
import { messageFor } from "@/lib/errors";
import { formatRupees } from "@/lib/money";
import { colors, spacing } from "@/theme";
import type { ProfileRequest } from "../api";
import { PersonalityPicker } from "../components/personality-picker";
import { TimePicker, morningOptions, nightOptions } from "../components/time-picker";
import { paydayIsComplete, useSetup } from "../setup-store";

export type FinishSetupInput = ProfileRequest & { moneyLeftPaise: number | null };

type Props = {
  today: string;
  fixedPaise: number;
  finish: (input: FinishSetupInput) => Promise<void>;
  onDone: () => void;
  onBack: () => void;
};

export function PersonalityScreen({ today, fixedPaise, finish, onDone, onBack }: Props) {
  const { draft, set } = useSetup();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payday = paydayIsComplete(draft.payday) ? draft.payday : { rule: "FIXED_DAY" as const, day: 1 };
  const preview = firstCyclePreview({
    monthlySpendablePaise: draft.incomePaise - fixedPaise - draft.savingsPaise,
    today,
    payday,
    ...(draft.moneyLeftPaise !== null ? { moneyLeftPaise: draft.moneyLeftPaise } : {}),
  });

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await finish({
        incomePaise: draft.incomePaise,
        savingsPaise: draft.savingsPaise,
        paydayRule: payday.rule,
        ...(payday.rule === "FIXED_DAY" ? { paydayDay: payday.day } : {}),
        personality: draft.personality,
        morningTime: draft.morningTime,
        nightTime: draft.nightTime,
        timezone: "Asia/Kolkata",
        moneyLeftPaise: draft.moneyLeftPaise,
      });
      onDone();
    } catch (e) {
      setError(describeError(e, messageFor));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      testID="setup-personality"
      footer={
        <View style={{ gap: spacing.xs }}>
          {error ? (
            <Text variant="label" color={colors.bad} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button
            title={`Start with ${formatRupees(preview.dayBudgetPaise)} today`}
            onPress={() => void start()}
            loading={busy}
          />
          <Text variant="caption" align="center">
            You can change this any time in Me
          </Text>
        </View>
      }
    >
      <StepHeader step={4} total={4} name="Personality" onBack={onBack} />
      <Text variant="heading">Gullak&apos;s personality</Text>
      <PersonalityPicker
        value={draft.personality}
        dayBudgetPaise={preview.dayBudgetPaise}
        onChange={(personality) => set({ personality })}
      />
      <Text variant="title">Daily messages</Text>
      <TimePicker
        title="Morning budget"
        value={draft.morningTime}
        options={morningOptions}
        onChange={(morningTime) => set({ morningTime })}
      />
      <TimePicker
        title="Night report"
        value={draft.nightTime}
        options={nightOptions}
        onChange={(nightTime) => set({ nightTime })}
      />
    </Screen>
  );
}
