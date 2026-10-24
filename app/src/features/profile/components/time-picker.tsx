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

/** Half-hour options from `from` to `to` inclusive, both given as "HH:MM". */
function range(from: string, to: string): string[] {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const out: string[] = [];
  for (let m = toMinutes(from); m <= toMinutes(to); m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

// Spec 2.7: no messages between 23:00 and 07:00.
export const morningOptions = range("07:00", "11:00");
export const nightOptions = range("19:00", "22:30");

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
