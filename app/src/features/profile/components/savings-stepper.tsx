import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Stepper } from "@/components/ui/stepper";
import { parseRupeesToPaise } from "@/lib/money";
import { spacing } from "@/theme";

export function SavingsStepper({
  valuePaise,
  max,
  onChange,
}: {
  valuePaise: number;
  max: number;
  onChange: (paise: number) => void;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  if (typing !== null) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Field
          label="Save every month"
          prefix="₹"
          large
          value={typing}
          onChangeText={(t) => setTyping(t.replace(/[^\d,]/g, ""))}
          keyboardType="number-pad"
          inputMode="numeric"
          autoFocus
        />
        <Button
          title="Done"
          onPress={() => {
            onChange(Math.min(max, parseRupeesToPaise(typing)));
            setTyping(null);
          }}
        />
      </View>
    );
  }
  return (
    <Stepper
      label="Save every month"
      valuePaise={valuePaise}
      stepPaise={100000}
      min={0}
      max={max}
      onChange={onChange}
      onPressValue={() => setTyping(String(valuePaise / 100))}
    />
  );
}
