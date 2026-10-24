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
  const [typing, setTyping] = useState<{ text: string; opened: number } | null>(null);
  if (typing !== null) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Field
          label="Save every month"
          prefix="₹"
          large
          value={typing.text}
          onChangeText={(raw) => {
            const text = raw.replace(/[^\d,]/g, "");
            setTyping({ ...typing, text });
            // Every valid change commits at once, so a typed value is never lost; an empty field changes nothing.
            if (/\d/.test(text)) onChange(Math.min(max, parseRupeesToPaise(text)));
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          autoFocus
        />
        <Button title="Done" onPress={() => setTyping(null)} />
        <Button
          title="Cancel"
          variant="ghost"
          onPress={() => {
            onChange(typing.opened);
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
      onPressValue={() => setTyping({ text: String(valuePaise / 100), opened: valuePaise })}
    />
  );
}
