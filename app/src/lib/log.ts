/* The only module allowed to call console. Everything else logs through `log`. */
import { reporting, type ReportingSink } from "./reporting";

type ConsoleLike = Pick<Console, "debug" | "info" | "warn" | "error">;

const ALLOWED_KEYS = new Set([
  "route",
  "method",
  "status",
  "ms",
  "count",
  "attempt",
  "id",
  "errorCode",
  "reason",
  "key",
  "granted",
  "fatal",
  "kind",
  "screen",
  "message",
]);
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_STRING = 200;
const FORBIDDEN_VALUES = [
  /[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,64}/, // email
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/, // JWT
  /eyJ[A-Za-z0-9_-]{10,}/, // a bare JWT segment
  /[A-Za-z0-9_+/=-]{24,}/, // an opaque token or id-like run
  /(₹|\b(rs|inr)\.?)\s*\d/i, // a money amount
];

/** True when a string could carry an email, a token, a code or an amount. Over-long strings are dropped before any regex runs. */
function isSensitive(value: string): boolean {
  if (value.length > MAX_STRING) return true;
  if (FORBIDDEN_VALUES.some((re) => re.test(value))) return true;
  return /\d{6}/.test(value.replace(/[\s-]/g, "")); // OTP code, even spaced or dashed
}

/**
 * Allow-list redaction (LOG-09): only known keys with string, number or boolean values pass,
 * and strings that look like an email, a token, a code or an amount are dropped. Never throws.
 */
export function redact(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (!data) return out;
  try {
    for (const key of Object.keys(data)) {
      if (key === "__proto__" || !ALLOWED_KEYS.has(key)) continue;
      try {
        const value = data[key];
        if (typeof value === "number" || typeof value === "boolean") {
          out[key] = value;
        } else if (typeof value === "string") {
          if (key === "errorCode") {
            out[key] = ERROR_CODE.test(value) ? value : "invalid";
          } else if (!isSensitive(value)) {
            out[key] = value;
          }
        }
      } catch {
        // a throwing getter: drop the field
      }
    }
  } catch {
    // a hostile object: return what we have
  }
  return { ...out };
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
    try {
      const safe = redact(data);
      if (opts.dev) {
        opts.console[level](event, safe);
        return;
      }
      if (level === "debug") return;
      sinkOf()?.report(level, event, safe);
    } catch {
      // Logging must never break the app.
    }
  };
  return {
    debug: (e, d) => emit("debug", e, d),
    info: (e, d) => emit("info", e, d),
    warn: (e, d) => emit("warn", e, d),
    error: (e, d) => emit("error", e, d),
  };
}

export const log: Logger = createLogger({ dev: __DEV__, console, sink: () => reporting.sink });
