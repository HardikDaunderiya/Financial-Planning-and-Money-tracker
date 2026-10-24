import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { StepHeader } from "@/components/ui/step-header";
import { Text } from "@/components/ui/text";
import { firstCyclePreview, perDayPreview, realityCheck, suggestedSavings } from "@/lib/budget";
import { formatRupees } from "@/lib/money";
import { colors, spacing } from "@/theme";
import type { FixedCost } from "../api";
import { MoneyLeftCard } from "../components/money-left-card";
import { RealityCheck } from "../components/reality-check";
import { SavingsStepper } from "../components/savings-stepper";
import { paydayIsComplete, useSetup } from "../setup-store";

function essentialsLabel(costs: FixedCost[]): string {
  if (costs.length === 0) return "No fixed costs";
  return costs.map((c, i) => (i === 0 ? c.name : c.name.toLowerCase())).join(", ");
}

export function SavingsScreen({
  today,
  fixedCosts,
  onContinue,
  onBack,
}: {
  today: string;
  fixedCosts: FixedCost[];
  onContinue: () => void;
  onBack: () => void;
}) {
  const { draft, set } = useSetup();
  const [deferred, setDeferred] = useState(false);
  const fixedPaise = fixedCosts.reduce((s, c) => s + c.amountPaise, 0);
  const payday = paydayIsComplete(draft.payday) ? draft.payday : { rule: "FIXED_DAY" as const, day: 1 };
  const next = perDayPreview({
    freePaise: draft.incomePaise - fixedPaise - draft.savingsPaise,
    today,
    payday,
  });
  const check = realityCheck({
    incomePaise: draft.incomePaise,
    fixedPaise,
    savingsPaise: draft.savingsPaise,
    cycleDays: next.cycleDays,
  });
  const maxSavings = Math.max(0, draft.incomePaise - fixedPaise);
  const suggested = suggestedSavings({
    incomePaise: draft.incomePaise,
    fixedPaise,
    cycleDays: next.cycleDays,
  });
  const preview = firstCyclePreview({
    monthlySpendablePaise: check.freePaise,
    today,
    payday,
    ...(draft.moneyLeftPaise !== null ? { moneyLeftPaise: draft.moneyLeftPaise } : {}),
  });
  const blocked = check.verdict === "notPossible";

  return (
    <Screen
      testID="setup-savings"
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            title={
              blocked
                ? suggested === 0
                  ? "Lower your fixed costs to continue"
                  : "Lower your savings to continue"
                : "Continue"
            }
            onPress={onContinue}
            disabled={blocked}
          />
          {draft.savingsPaise > 0 ? (
            <Button
              title="Set savings later"
              variant="ghost"
              onPress={() => {
                set({ savingsPaise: 0 });
                setDeferred(true);
              }}
            />
          ) : null}
        </View>
      }
    >
      <StepHeader step={3} total={4} name="Savings" onBack={onBack} />
      <Text variant="heading">Monthly savings</Text>
      <Text variant="bodyMuted">This comes out first. Your daily budget is what&apos;s left.</Text>
      <SavingsStepper
        valuePaise={draft.savingsPaise}
        max={maxSavings}
        onChange={(savingsPaise) => set({ savingsPaise })}
      />
      <RealityCheck
        verdict={check.verdict}
        perDayPaise={check.perDayPaise}
        essentialsLeftPaise={draft.incomePaise - fixedPaise}
        suggestedSavingsPaise={suggested}
      />
      {deferred && draft.savingsPaise === 0 ? (
        <Text variant="label" color={colors.warnInk}>
          No savings this month. Set a target later from Me.
        </Text>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        <Row label="Salary" value={formatRupees(draft.incomePaise)} />
        <Row label={essentialsLabel(fixedCosts)} value={`−${formatRupees(fixedPaise)}`} />
        <Row label="Savings" value={`−${formatRupees(draft.savingsPaise)}`} />
        <Row label="Free to spend" value={formatRupees(Math.max(0, check.freePaise))} strong />
        <Row
          label={`Per day in ${next.cycleName} (${next.cycleDays} days)`}
          value={formatRupees(check.perDayPaise)}
          strong
        />
      </View>
      {!blocked && preview.proRated ? (
        <MoneyLeftCard
          preview={preview}
          edited={draft.moneyLeftPaise !== null}
          maxPaise={draft.incomePaise}
          onChange={(moneyLeftPaise) => set({ moneyLeftPaise })}
        />
      ) : null}
    </Screen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}>
      <Text variant={strong ? "bodyStrong" : "body"} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant={strong ? "bodyStrong" : "body"} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
    </View>
  );
}
