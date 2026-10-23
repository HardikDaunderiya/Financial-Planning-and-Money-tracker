export type ReportLevel = "info" | "warn" | "error";

/** Where production logs go. Off by default; a provider (Sentry or similar) can be plugged in later. */
export interface ReportingSink {
  report(level: ReportLevel, event: string, data?: Record<string, unknown>): void;
}

let current: ReportingSink | null = null;

export const reporting = {
  setSink(sink: ReportingSink | null): void {
    current = sink;
  },
  get sink(): ReportingSink | null {
    return current;
  },
};
