import { isErrorCode, type ErrorCode } from "./error-codes";
import { log } from "./log";

const GENERIC = "Something went wrong. Try again in a moment.";

/** One user-facing message per server code. Screens that need a specific screen for a code handle it before calling this. */
const messages: Record<ErrorCode, string> = {
  VALIDATION: "Check the highlighted fields",
  UNAUTHENTICATED: "Sign in again to continue",
  TOKEN_EXPIRED: "Sign in again to continue",
  TOKEN_REUSED: "You were signed out everywhere for safety. Sign in again.",
  OTP_INVALID: "That code is not right. Check the email and try again.",
  OTP_EXPIRED: "That code has expired. Request a new one.",
  OTP_LOCKED: "Too many tries. Request a new code or try again tomorrow.",
  RATE_LIMITED: "Too many requests. Wait a minute and try again.",
  FORBIDDEN: "You cannot do that here",
  NOT_FOUND: "That no longer exists",
  METHOD_NOT_ALLOWED: GENERIC,
  UNSUPPORTED_MEDIA_TYPE: GENERIC,
  NOT_ACCEPTABLE: GENERIC,
  TOO_LARGE: "That is too big to send",
  NOT_POSSIBLE: "Those numbers do not add up",
  SETUP_INCOMPLETE: "Finish setup first",
  FIRST_CYCLE_OVER: "Your first cycle has ended, so this can no longer be changed",
  INTERNAL: GENERIC,
};

const warned = new Set<string>();
const MAX_WARNED = 100;

/** The message for a code; an unmapped code logs a WARN so it gets mapped (ERR-16). */
export function messageFor(
  code: string,
  deps: { warn: (event: string, data: Record<string, unknown>) => void } = log,
): string {
  if (isErrorCode(code)) {
    return messages[code];
  }
  if (!warned.has(code) && warned.size < MAX_WARNED) {
    warned.add(code);
    deps.warn("error.unmapped", { errorCode: code });
  }
  return GENERIC;
}
