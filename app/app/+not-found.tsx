import { Link } from "expo-router";
import React from "react";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";

export default function NotFound() {
  return (
    <Screen>
      <Text variant="heading">That page does not exist</Text>
      <Link href="/" asChild>
        <Text variant="body" style={{ textDecorationLine: "underline" }} accessibilityRole="link">
          Go home
        </Text>
      </Link>
    </Screen>
  );
}
