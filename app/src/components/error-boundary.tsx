import React, { useEffect } from "react";
import { View } from "react-native";
import { log } from "@/lib/log";
import { colors, spacing } from "@/theme";
import { ErrorState } from "./ui/error-state";

type Props = {
  children: React.ReactNode;
  report?: (event: string, data: Record<string, unknown>) => void;
  full?: boolean;
};
type State = { failed: boolean };

/** Catches render errors (ERR-15). Retry re-mounts the children. The error reaches the logger, never the user. */
export class AppErrorBoundary extends React.Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    (this.props.report ?? log.error)("boundary.caught", { kind: error.name });
  }

  override render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <View
          style={{
            flex: this.props.full ? 1 : undefined,
            justifyContent: "center",
            padding: spacing.md,
            backgroundColor: colors.ground,
          }}
        >
          <ErrorState onRetry={() => this.setState({ failed: false })} />
        </View>
      );
    }
    return this.props.children;
  }
}

/** The shape expo-router hands to a route's exported ErrorBoundary. */
export function RouteErrorFallback({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => {
    log.error("route.caught", { kind: error.name });
  }, [error]);
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: spacing.md, backgroundColor: colors.ground }}>
      <ErrorState onRetry={() => void retry()} />
    </View>
  );
}
