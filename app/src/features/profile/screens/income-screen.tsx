import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { StepHeader } from "@/components/ui/step-header";
import { Text } from "@/components/ui/text";
import { formatRupees, parseRupeesToPaise } from "@/lib/money";
import { spacing } from "@/theme";
import { PaydayPicker } from "../components/payday-picker";
import { paydayIsComplete, useSetup } from "../setup-store";

/** 5000000 paise → "50,000" (Indian grouping, no symbol). */
const grouped = (paise: number) => formatRupees(paise).slice(1);

export function IncomeScreen({ today, onContinue }: { today: string; onContinue: () => void }) {
  const { draft, set } = useSetup();
  const [typed, setTyped] = useState(draft.incomePaise ? grouped(draft.incomePaise) : "");
  const canContinue = draft.incomePaise > 0 && paydayIsComplete(draft.payday);
  return (
    <Screen
      testID="setup-income"
      footer={<Button title="Continue" onPress={onContinue} disabled={!canContinue} />}
    >
      <StepHeader step={1} total={4} name="Income" />
      <Text variant="heading">Your salary</Text>
      <Text variant="bodyMuted">{"I'll turn it into a daily budget. Takes 2 minutes."}</Text>
      <Field
        label="Take-home pay per month"
        prefix="₹"
        large
        value={typed}
        onChangeText={(t) => {
          const paise = parseRupeesToPaise(t);
          setTyped(paise ? grouped(paise) : "");
          set({ incomePaise: paise });
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        hint={
          draft.incomePaise
            ? `${formatRupees(draft.incomePaise)} a month. After tax and PF. Only you can see this.`
            : "After tax and PF. Only you can see this."
        }
      />
      <View style={{ height: spacing.sm }} />
      <PaydayPicker value={draft.payday} today={today} onChange={(payday) => set({ payday })} />
    </Screen>
  );
}
