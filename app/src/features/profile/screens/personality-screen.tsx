import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { StepHeader } from "@/components/ui/step-header";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { firstCyclePreview, perDayPreview, realityCheck } from "@/lib/budget";
import { messageFor } from "@/lib/errors";
import { formatRupees } from "@/lib/money";
import { colors, spacing } from "@/theme";
import type { ProfileRequest } from "../api";
import { FIRST_CYCLE_NOT_SAVED, FirstCycleNotSavedError } from "../finish-errors";
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
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payday = paydayIsComplete(draft.payday) ? draft.payday : { rule: "FIXED_DAY" as const, day: 1 };
  const freePaise = draft.incomePaise - fixedPaise - draft.savingsPaise;
  const next = perDayPreview({ freePaise, today, payday });
  const verdict = realityCheck({
    incomePaise: draft.incomePaise,
    fixedPaise,
    savingsPaise: draft.savingsPaise,
    cycleDays: next.cycleDays,
  }).verdict;
  const base = firstCyclePreview({ monthlySpendablePaise: freePaise, today, payday });
  // The money-left answer counts only while its card is on screen (step 3 shows it when pro-rated and possible).
  const stored = verdict !== "notPossible" && base.proRated ? draft.moneyLeftPaise : null;
  // An answer above the income would be rejected by the server on every retry, so it is not sent.
  const answer = stored !== null && stored <= draft.incomePaise ? stored : null;
  const preview = firstCyclePreview({
    monthlySpendablePaise: freePaise,
    today,
    payday,
    ...(answer !== null ? { moneyLeftPaise: answer } : {}),
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
        moneyLeftPaise: answer,
      });
      setFinished(true);
      onDone();
    } catch (e) {
      setError(e instanceof FirstCycleNotSavedError ? FIRST_CYCLE_NOT_SAVED : describeError(e, messageFor));
    } finally {
      setBusy(false);
    }
  }

  // Once finished the draft is reset; render nothing so no "Start with ₹0 today" flashes.
  if (finished) return null;

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
