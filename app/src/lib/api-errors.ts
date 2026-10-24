import type { ErrorCode } from "./error-codes";

export type FieldError = { field: string; message: string };

/** A 4xx or 5xx the server described in its {code, message} shape. */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly fields: FieldError[] = [],
    readonly errorId?: string,
  ) {
    super(message);
  }
}

/** The request never got an answer: offline, DNS, timeout. Safe to retry. */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
}

/** An answer that is not ours: a proxy's HTML page, a body that is not JSON. */
export class UnknownError extends Error {
  override readonly name = "UnknownError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function isApiError(e: unknown, code?: ErrorCode): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

/** The message a screen shows for any thrown value. */
export function describeError(e: unknown, messageFor: (code: string) => string): string {
  if (e instanceof ApiError) return messageFor(e.code);
  if (e instanceof NetworkError) return "No connection. Check your network and try again.";
  return "Something went wrong. Try again in a moment.";
}
