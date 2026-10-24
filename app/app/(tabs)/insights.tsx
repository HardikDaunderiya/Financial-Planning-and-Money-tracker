import React from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function InsightsRoute() {
  return (
    <Screen testID="insights">
      <Text variant="heading">Insights</Text>
      <EmptyState
        title="Nothing to show yet"
        body="Log spends or upload a statement and your month appears here"
      />
    </Screen>
  );
}
