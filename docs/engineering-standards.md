# Engineering standards: logging and error handling

These rules apply to every line of Gullak code. The manager reviews against them; the build enforces the ones that can be automated.

## 1. Logging

### Backend (Spring Boot)

- SLF4J through Spring's Logback. JSON output (logstash encoder) in every profile except `local`, where it is plain text.
- Every request gets a request ID: taken from `X-Request-Id` if present, else generated. It goes into the MDC with the user ID (the UUID, never the email) and the route template, and is returned in the response header.
- Exactly one INFO line per request: method, route template (not the raw path), status, duration in ms. Written by a filter, not by controllers.
- One INFO line per business event, with ids and counts only. The event names are a fixed vocabulary in `common/log/Events.java`:
  `auth.otp.requested`, `auth.otp.verified`, `auth.session.revoked`, `profile.updated`, `cycle.opened`, `cycle.closed`, `spend.created`, `spend.updated`, `spend.deleted`, `spend.linked`, `spend.unlinked`, `import.received`, `import.previewed`, `import.committed`, `import.discarded`, `goal.created`, `goal.updated`, `goal.paused`, `goal.deleted`, `goal.catchup`, `goal.milestone`, `xp.awarded`, `xp.reversed`, `streak.updated`, `badge.earned`, `push.sent`, `export.requested`, `account.deletion.requested`, `account.restored`, `job.started`, `job.finished`, `job.failed`.
- Levels:
  - DEBUG: developer detail. Off outside `local`.
  - INFO: the request line and business events.
  - WARN: expected failures worth a look. OTP locked, rate limit hit, wrong statement password, parse timeout, push provider retry, reused refresh token.
  - ERROR: unexpected exceptions. Logged once, by the error handler, with the stack trace and an `errorId` that is also returned to the client.
- Never logged, at any level, in any field: amounts, merchant text, raw statement lines, file names, emails, UPI handles, tokens, passwords, OTP codes. A unit test (`SEC-01`, `LOG-05`) greps a day of test traffic for each pattern.
- Parameterised logging only (`log.info("spend.created id={} user={}", id, userId)`), never string concatenation.
- Scheduled jobs log `job.started` and `job.finished` with counts, and `job.failed` with the error id. A job that fails for one user logs that and continues with the next.

### Frontend (Expo)

- One module, `src/lib/log.ts`, with `debug`, `info`, `warn`, `error`. Nothing else calls `console.*`; an ESLint rule enforces it.
- In development, everything prints to the console. In production, `info` and above go to the error-reporting sink behind `lib/reporting.ts` (an interface; a provider such as Sentry can be plugged in later; off by default) and `debug` is dropped.
- Breadcrumbs: screen changes (route name only) and API calls (route template and status only).
- The same redaction rules as the backend. Amounts and merchant names stay on the device.

## 2. Error handling

### Backend

- One exception base: `GullakException(ErrorCode code, HttpStatus status, String message)`. Subclasses: `ValidationException` (400), `AuthException` (401), `ForbiddenException` (403), `NotFoundException` (404), `ConflictException` (409), `UnprocessableException` (422), `TooLargeException` (413), `RateLimitedException` (429).
- `ErrorCode` is one enum. The app mirrors it as a TypeScript union generated from the enum at build time, so the two cannot drift.
- One `@RestControllerAdvice`:
  - `GullakException` → its status and `{code, message}`.
  - `MethodArgumentNotValidException`, `ConstraintViolationException`, `HttpMessageNotReadableException` → 400 `VALIDATION` with a `fields` list.
  - `MaxUploadSizeExceededException` → 413 `TOO_LARGE`.
  - Spring Security failures → 401 `UNAUTHENTICATED` or 403.
  - Anything else → 500 `INTERNAL`, message "Something went wrong", plus `errorId`. Logged once at ERROR.
- Not found is thrown, never returned as null. Cross-user access is a `NotFoundException`.
- No empty catch blocks. No `catch (Exception e)` outside the error handler, job runners and the async boundary. An ArchUnit test enforces both.
- A caught exception is either handled (and the handling is logged at WARN or INFO) or rethrown wrapped with context. It is never swallowed.
- Writes are transactional and roll back on any exception. Idempotent writes (spend create, job runs) use the database to detect repeats, not in-memory state.
- External calls (email, push) have a connect and read timeout (5 s), retry three times with backoff, and give up with a WARN and a queued retry rather than failing the user's request.
- The PDF and CSV parsers run on a bounded executor with a 10 second timeout and a memory cap. A timeout is an `UnprocessableException(UNREADABLE)`, and the thread is interrupted.
- Input is validated at the controller with `jakarta.validation`; services validate business rules and throw typed exceptions. Nothing relies on a database constraint to produce a user-facing error.

### Frontend

- The API client (`src/lib/api.ts`) is the only place that reads HTTP responses. It turns every non-2xx into `ApiError { code, message, status, fields?, errorId? }`, network failures into `NetworkError`, and anything else into `UnknownError`. Features never see a raw response or a raw exception.
- Every query renders a loading state, an error state with a retry, and an empty state. Every mutation handles failure: optimistic updates roll back and the user sees why.
- A root error boundary and one per tab show "Something went wrong" with a retry and send the error to `lib/reporting.ts`. The app never shows a blank screen.
- Unhandled promise rejections are caught globally and logged.
- The offline queue retries network errors with backoff; a 4xx answer is not retried but shown to the user on the spend.
- Each error code maps to a screen or an inline message in `src/lib/errors.ts`. An unmapped code shows a generic message and is logged at WARN so it gets mapped.
- Forms validate before sending and show the server's `fields` list next to the right inputs when the server disagrees.

## 3. Enforcement

- ArchUnit: no empty catch, no broad catch outside allowed packages, controllers return records not entities, repositories are only called from their own feature.
- ESLint: no `console.*` outside `lib/log.ts`, no `any`, no floating promises, exhaustive `switch` on error codes.
- CI fails on any of the above, on test failures, and on a critical dependency vulnerability.
- The log redaction test and the error-shape test (`API-X-02`) run in every CI build.
