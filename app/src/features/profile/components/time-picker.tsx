import React from "react";
import { ScrollView, View } from "react-native";
import { Chip } from "@/components/ui/chip";
import { Text } from "@/components/ui/text";
import { spacing } from "@/theme";

function label(t: string): string {
  const [h, m] = t.split(":").map(Number) as [number, number];
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

function range(fromHour: number, toHour: number): string[] {
  const out: string[] = [];
  for (let h = fromHour; h <= toHour; h++)
    for (const m of [0, 30])
      if (!(h === toHour && m === 30))
        out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  return out;
}

export const morningOptions = range(6, 11);
export const nightOptions = range(19, 23);

export function TimePicker({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: string;
  options: string[];
  onChange: (t: string) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="label">{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm }}
      >
        {options.map((t) => (
          <Chip key={t} label={label(t)} selected={t === value} onPress={() => onChange(t)} />
        ))}
      </ScrollView>
    </View>
  );
}
