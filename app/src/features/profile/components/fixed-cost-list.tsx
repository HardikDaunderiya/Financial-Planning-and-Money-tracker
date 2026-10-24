import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { formatRupees, parseRupeesToPaise } from "@/lib/money";
import { colors, radius, spacing, touchTarget } from "@/theme";
import type { FixedCost } from "../api";

export const presets: { name: string; amountPaise: number }[] = [
  { name: "Rent", amountPaise: 1000000 },
  { name: "Cook", amountPaise: 200000 },
  { name: "Maid", amountPaise: 150000 },
  { name: "Monthly groceries", amountPaise: 150000 },
  { name: "Wi-Fi", amountPaise: 70000 },
  { name: "Phone bill", amountPaise: 29900 },
  { name: "EMI", amountPaise: 450000 },
  { name: "Gym", amountPaise: 150000 },
];

/** Lowercase the first letter after a verb ("Remove rent") unless the name has capitals of its own (EMI, Wi-Fi). */
function afterVerb(name: string): string {
  const second = name.charAt(1);
  const plain =
    second !== "" && second === second.toLowerCase() && name.slice(1) === name.slice(1).toLowerCase();
  return plain ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

export function FixedCostRow({
  cost,
  onEdit,
  onRemove,
}: {
  cost: FixedCost;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const amount = formatRupees(cost.amountPaise);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: touchTarget + 8,
        gap: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${cost.name}, ${amount}`}
        onPress={onEdit}
        style={{
          flex: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: touchTarget,
        }}
      >
        <Text variant="body">{cost.name}</Text>
        <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
          {amount}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${afterVerb(cost.name)}`}
        onPress={onRemove}
        hitSlop={6}
        style={{ width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="x" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

export function FixedCostForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
  error,
}: {
  initial?: FixedCost;
  onSubmit: (v: { name: string; amountPaise: number }) => void;
  onCancel: () => void;
  submitLabel: "Add" | "Save";
  busy: boolean;
  error?: string | undefined;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amountPaise / 100) : "");
  const paise = parseRupeesToPaise(amount);
  const valid = name.trim().length > 0 && name.trim().length <= 60 && paise > 0;
  return (
    <View
      style={{
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Field label="Name" value={name} onChangeText={setName} maxLength={60} autoFocus={!initial} />
      <Field
        label="Amount per month"
        prefix="₹"
        value={amount}
        onChangeText={(t) => {
          const p = parseRupeesToPaise(t);
          setAmount(p ? String(p / 100) : "");
        }}
        maxLength={10}
        keyboardType="number-pad"
        inputMode="numeric"
        error={error}
      />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title={submitLabel}
          onPress={() => onSubmit({ name: name.trim(), amountPaise: paise })}
          disabled={!valid}
          loading={busy}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}
