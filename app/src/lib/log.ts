/* The only module allowed to call console. Everything else logs through `log`. */
import { reporting, type ReportingSink } from "./reporting";

type ConsoleLike = Pick<Console, "debug" | "info" | "warn" | "error">;

const FORBIDDEN_KEYS =
  /(amount|paise|merchant|email|token|password|otp|^code$|secret|raw|upi|note$|name$|total|budget|spent|left)/i;
const FORBIDDEN_VALUES = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // email
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/, // JWT
  /\b\d{6}\b/, // OTP code
  /[₹]\s?\d/, // a rupee amount
];

/** Drops any field whose key or value could identify money, a person or a secret (LOG-09). */
export function redact(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    if (typeof value === "string" && FORBIDDEN_VALUES.some((re) => re.test(value))) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redact(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export type Logger = {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
};

export function createLogger(opts: {
  dev: boolean;
  console: ConsoleLike;
  sink?: ReportingSink | null | (() => ReportingSink | null);
}): Logger {
  const sinkOf = () => (typeof opts.sink === "function" ? opts.sink() : (opts.sink ?? null));
  const emit = (
    level: "debug" | "info" | "warn" | "error",
    event: string,
    data?: Record<string, unknown>,
  ) => {
    const safe = redact(data);
    if (opts.dev) {
      opts.console[level](event, safe);
      return;
    }
    if (level === "debug") return;
    sinkOf()?.report(level, event, safe);
  };
  return {
    debug: (e, d) => emit("debug", e, d),
    info: (e, d) => emit("info", e, d),
    warn: (e, d) => emit("warn", e, d),
    error: (e, d) => emit("error", e, d),
  };
}

export const log: Logger = createLogger({ dev: __DEV__, console, sink: () => reporting.sink });
