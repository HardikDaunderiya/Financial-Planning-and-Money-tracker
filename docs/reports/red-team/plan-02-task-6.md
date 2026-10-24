# Red team: plan-02 task 6 (sign-in screens, hydration gate, protected routes, error boundaries)

Commit 03764ec. Tests: `app/src/redteam/redteam-login.test.tsx` (run `cd app && npx jest src/redteam/redteam-login`).
Tests prefixed FINDING assert the secure behaviour and currently FAIL (11). Tests prefixed held pass (27).
Product code untouched. Nothing committed. Server not involved (Jest + RNTL + expo-router/testing-library only).

Counts: Critical 0, High 0, Medium 3, Low 8.

## Findings

### M1 Medium: Resend is allowed while a verify is in flight, and its completion un-locks the form
Tests: `RT code entry > FINDING: Resend can be tapped while a verify is in flight`, `FINDING: resend finishing while a verify is pending wipes the typed code and un-busies the form`.
Repro: type 6 digits (verify pending, slow network), tap "Resend code".
Observed: `requestCode` is called (a new OTP is issued, which would invalidate the code being checked, so a correct code can come back OTP_INVALID/EXPIRED). When the resend settles, `setBusy(false)` and `setCode("")` run although the verify is still pending: input becomes editable again, boxes clear, and a second code can be typed and submitted (the `submitting` ref blocks it, but the UI lies).
Expected: Resend disabled and busy state owned jointly while any request is in flight; resend must not clear a code that is being verified.
Rule: spec 4.7 / app standards on single in-flight action per control; OTP integrity.

### M2 Medium: opaque secrets in `error.message` reach the log (dev console and prod sink)
Test: `RT error boundary > FINDING: an opaque refresh token inside an error message reaches the log`.
Repro: `AppErrorBoundary`/`RouteErrorFallback`/`installGlobalHandlers` log `{message: error.message}`; message `refresh failed for Zm9vYmFy...` (43-char base64url, no `eyJ` prefix).
Observed: passes `redact` unchanged (email, JWT, money, 6-digit run are caught; an opaque refresh token is not) and is emitted to console in dev and to the sink in prod.
Expected: message field either not logged from caught errors (log error name/code only) or redaction drops long unbroken base64/hex-like tokens (for example any run of 24+ `[A-Za-z0-9_-]`).
Rule: spec 4.7 no tokens in logs; LOG-09.

### M3 Medium: keyboard "Send" re-submits the email while a request is in flight
Test: `RT email entry > FINDING: keyboard Send (submitEditing) while a request is in flight does not re-send`.
Repro: enter a valid email, press Send on the keyboard twice (or button then keyboard).
Observed: `requestCode` called twice (two OTP emails, burns the per-email rate limit, the first code is invalidated by the second). The button is disabled while loading but `onSubmitEditing` has no guard (`send()` has no in-flight ref, unlike CodeForm).
Expected: exactly one request.
Rule: idempotency/double-tap standard; OTP rate limit.

### L1 Low: zero-width characters accepted inside the email
Test: `FINDING: zero-width characters inside the email are not rejected or stripped`. `pri​ya@exam‍ple.com` is sent as typed. Expected: reject or strip U+200B-U+200D, U+2060, U+FEFF (they are not `\s`). Rule: input validation (4.7).

### L2 Low: bidi override accepted in the email
Test: `FINDING: a right-to-left override in the email is sent`. `a‮bc@x.com` passes. Also then rendered in "Sent to ..." and could visually spoof the address. Expected: reject control/format characters (Cf).

### L3 Low: no client length cap on the email
Test: `FINDING: 300-character email is sent to the server`. 290+ char local part passes the regex and is POSTed (server must reject, RFC max 254). Expected: cap at 254 client-side and `maxLength` on the field.

### L4 Low: pasted noise is reduced to 6 digits and submitted
Test: `FINDING: pasted text mixing letters and 7+ digits is silently cut to 6 digits and submitted`. `"order 12-3456-789 ref"` sends `123456` to verify (burns one of 5 OTP attempts). Expected: submit only when the stripped text is exactly 6 digits (or when the paste is a clean code), otherwise show validation without a request.

### L5 Low: /login-code accepts an unvalidated, unbounded email param
Tests: `RT hostile deep-link params > FINDING: the code screen accepts an unvalidated 10,000-char email param and would POST it`, `RT routes > FINDING: /login-code with a hostile (non-email) param is accepted instead of sent back to /login`. Deep link `/login-code?email=<b>hi</b>` (or 10k chars) renders the code screen and verify POSTs it. Rendering is inert text (held), but the value should be validated with the same rule as EmailForm and otherwise redirect to /login.

### L6 Low: array email param reaches CodeForm as an array
Test: `RT routes > FINDING: /login-code with array email param is passed as an array`. `/login-code?email=a@b.com&email=c@d.com`: `useLocalSearchParams` returns `string[]`, typed as `string`; screen renders "Sent to a@b.com,c@d.com" and would POST an array as `email`. No crash. Expected: take a string only.

### L7 Low (observation, not a failing test): route collision risk
`app/index.tsx` and a future `app/(tabs)/index.tsx` both resolve to `/`. In my harness a stub `(tabs)/index` made the real `_layout` loop ("Maximum update depth exceeded", 600+ errors, test hung) when a signed-out deep link hit a protected route. Renamed my stub to `(tabs)/home` and it passes. Task 8 should not name the tabs landing screen `index`, and `index.tsx` redirects to `/(tabs)`, which needs a real target. Not a product bug today; flagging because the hang is severe if it occurs.

### L8 Low (observation): harness note
Tests for the real `_layout` mock `react-native-gesture-handler` (ESM not transformed by jest config) and `@/lib/storage` / `useProfile`. The jest transformIgnorePatterns omit react-native-gesture-handler, so the root layout cannot be imported in Jest without a mock.

## Defended (one line each)
- held: NBSP, ideographic space and U+2003 around the email are trimmed.
- held: uppercase email lowercased before sending.
- held: two `@` rejected with no request; embedded space/newline rejected.
- held: double tap on "Send code" sends once (button loading disables it).
- held: full-width digits (１２３４５６) never submit; Arabic-Indic digits never submit; letters-only never submit.
- held: "123 456" paste submits 123456; 7+ digits never send more than 6.
- held: rapid repeated 6-digit input while pending verifies once.
- held: re-render/rerender while verify pending calls verify and onVerified once.
- held: unmount mid-verify does not call onVerified or throw.
- held: rapid Resend taps (no verify pending) send one request.
- held: OTP_LOCKED shows the mapped message only (server text never shown), locks input, offers "Send a new code".
- held: wrong code clears the boxes.
- held: HTML in the email param renders as inert text.
- held: signed out, deep link to a (tabs) screen lands on /login; to /onboarding/income lands on /login.
- held: signed in, deep link to /login and to /login-code?email= does not show the login screens.
- held: signed out, /login-code with no email redirects to /login; array param does not crash.
- held: error boundary and route fallback never display the error message (email, code, JWT, amount).
- held: dev console and prod sink drop email, 6-digit code, JWT and amount from `message`.
- held: sign-in failure flow logs no email or code to console.

## Not covered
Back navigation from the code screen on a device, real OTP server behaviour (lockout after 5, enumeration timing), web CSP/CORS (no web build in this task), real-device airplane mode.
