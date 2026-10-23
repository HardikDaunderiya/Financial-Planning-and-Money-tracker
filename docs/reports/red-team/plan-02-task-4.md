# Red team: plan-02 task 4 (API client, refresh, token storage, session)

Commit 17d3744, branch plan-02-app-foundation. Method: Jest attacks only, no server. Tests: `cd app && npx jest src/redteam`
Files: app/src/redteam/redteam-api.test.ts, redteam-session.test.tsx, redteam-helpers.ts.
Tests named "FINDING ..." fail on purpose and assert the secure behaviour (20 failing, 15 passing).
Spec basis: 4.7 (refresh rotation, reuse revokes all sessions; tokens only in secure storage; no tokens in logs), SEC-07, ERR-12. Server contract: TokenService.refresh (reuse of a used token -> TOKEN_REUSED + revokeAllForUser).

Count: Critical 0, High 3, Medium 5, Low 5.

## High

### H1. Stale request re-sends an already-rotated refresh token and triggers a global revoke
Test: `RT refresh ... FINDING stale request that expires after another request already rotated ...`
Repro: request X loads (A1,R1) and is slow; request Y loads (A1,R1), gets TOKEN_EXPIRED, refreshes to (A2,R2), `refreshing` resets to null. X's late 401 TOKEN_EXPIRED arrives; api.ts `request()` starts a new `refresh(stored)` using the R1 it captured before the await.
Happened: /auth/refresh is sent twice with R1. Server sees a used token: TOKEN_REUSED and every session of the user is revoked; client signs out. Any slow request on a 15-minute expiry boundary (common on mobile: tab switch, several queries in flight) logs the user out everywhere.
Should: before refreshing, reload the store; if the stored refresh token differs from the one captured, skip the refresh and just retry with the stored access token. Rotation must be strictly once per refresh token.

### H2. A refresh that finishes after sign-out writes the tokens back
Test: `FINDING a refresh finishing after signOut must not resurrect the tokens`
Repro: request gets TOKEN_EXPIRED, refresh is in flight; user taps Sign out (store.clear()); refresh answers 200.
Happened: `deps.tokens.save(next)` runs after the clear; the store holds A2/R2 while the UI says signed out. Next launch hydrates `signedIn` (session.tsx load) with a live 30-day refresh token: the sign-out did not sign out, and the server session was not revoked (logout was sent with R1, which the in-flight refresh consumed).
Should: bump a session generation (or abort the refresh) on signOut/signIn/clear; the refresh result is saved only if the generation is unchanged.

### H3. A refresh from the old session overwrites a newer sign-in
Test: `FINDING a refresh from the old session must not overwrite a newer sign-in`
Repro: refresh in flight for session 1; signIn(new pair) saves NEW; the old refresh resolves.
Happened: store becomes OLD-A2/OLD-R2: the user is silently switched back to the previous account's session (account mix-up: user B signs in on a phone, A's late refresh replaces B's tokens; B now reads A's data). Same root cause as H2 (no generation check, `save` is unconditional).
Should: compare-and-set: save only if the stored refresh token still equals the one that was sent.

## Medium

### M1. Any server error body on /auth/refresh signs the user out (500, 503, 429)
Tests: `FINDING a transient 500/503/429 on /auth/refresh must not sign the user out or wipe tokens` (3 cases)
Repro: /auth/refresh answers 500 `{"code":"INTERNAL"}` (deploy, DB blip) or 429 RATE_LIMITED.
Happened: `refresh()` treats every `ApiError` (status >= 400 with a code) as a rejected session: clears tokens, fires onSignedOut. One bad deploy logs out every active user and their offline data is cleared.
Should: clear only on 401 with UNAUTHENTICATED/TOKEN_EXPIRED/TOKEN_REUSED (or 400/403); on 5xx/429 keep tokens and throw a retryable error.

### M2. Malformed 200/204 from /auth/refresh throws a raw TypeError
Tests: `FINDING empty 200 body / JSON null / 204 gives a typed UnknownError, not a TypeError` (3 cases)
Repro: refresh answers 200 with empty body, `null`, or 204.
Happened: `data as Partial<Tokens>` then `pair.accessToken` on undefined/null: TypeError escapes the typed error model (ERR-12), and (via a screen's catch) renders as "unknown". Tokens are not damaged. (HTML, bad JSON, {} and wrong types were handled: held.)
Should: guard `data` is an object; throw UnknownError.

### M3. Empty-string tokens accepted and saved
Test: `FINDING empty-string tokens in a 200 refresh are rejected, not saved`
Repro: refresh answers 200 `{"accessToken":"","refreshToken":""}` (broken proxy/mock).
Happened: store is overwritten with empty tokens, the real refresh token is lost, user is effectively signed out with a "signed in" UI.
Should: require non-empty strings (ideally a JWT shape for access); keep the old pair otherwise.

### M4. Timeout does not cover reading the body
Test: `FINDING a body that stalls after headers is cut off by the timeout`
Repro: server sends headers then stalls (or a slow-loris proxy). api.ts `clearTimeout(timer)` runs right after `fetchFn` resolves, before `await res.text()`.
Happened: request never settles; loading spinners hang forever; if it is the refresh, `refreshing` never clears, so every later authenticated call waits on it forever (app-wide hang until restart).
Should: keep the timer (and the abort) until the body is read; clear in a `finally`.

### M5. Already-aborted caller signal still sends the request
Test: `FINDING an already-aborted caller signal must not send the request`
Repro: `api.get(path, {signal})` with `signal.aborted === true`. `addEventListener("abort")` never fires for an already-aborted signal.
Happened: the request goes out unaborted (a cancelled mutation, e.g. a quick-add the user backed out of, is still sent).
Should: if `signal.aborted`, throw immediately / pass `signal.aborted` to the controller. Also the refresh and retry ignore the caller signal after the first send only partly (retry uses it but listener is re-added).

## Low

### L1. Abort listeners leak on long-lived signals
Test: `FINDING listeners added to a long-lived caller signal are removed when the request ends`
50 requests on one signal leave 50 listeners (0 removals). Use `{once:true}` and remove in `finally`. Also each retry adds another.

### L2. Server-controlled strings are not bounded
Tests: `FINDING server-supplied message and field messages are bounded ...`, `FINDING the content-type reflected into UnknownError.message is bounded`, `FINDING a FieldError with a huge array is capped`
A 5 MB `message`, 5 MB field message, 100 000 `fields`, or a 100 kB Content-Type are copied into ApiError/UnknownError. Screens currently show `messageFor(code)` (good), but `fields[].message` and `error.message` flow to forms, logs (`unhandled` logs `reason.message`, redaction drops over 200 chars) and error reporting. Cap message (about 500) and fields (about 50).

### L3. signOut fails open if the keystore read throws
Test: `FINDING sign-out must clear local tokens even if the store read throws ...`
`signOut()` calls `store.load()` unguarded; a rejection aborts before `store.clear()`/setStatus: user taps Sign out, nothing happens, tokens stay. Wrap load in try/catch and always clear.

### L4. signOut waits for the network before clearing locally
Test: `FINDING sign-out must not wait indefinitely on the logout call ...`
Tokens stay in the store (and UI signed in) until logout returns or the 15 s timeout (plus the body-stall hole M4: forever). Clear local state first, then fire the logout best-effort.

### L5. signOut sends the refresh token it loaded before an in-flight rotation
Test: `FINDING sign-out must revoke the server session even when the token was rotated mid-flight ...`
Logout is sent with R1 that a refresh just consumed: server treats it as reuse and revokes all sessions (fails safe, but the user is signed out on every device and the live R2 family is only killed by that side effect). Same fix as H1/H2: serialize signOut with the refresh.

Defence in depth (Low, not a failing exploit): persistOptions has no `dehydrateOptions.shouldDehydrateQuery` filter; nothing today puts tokens in a query, but a screen that wraps `authApi.verifyCode` in `useQuery` would persist a token pair to AsyncStorage. Failing test: `FINDING sign-in tokens returned by verifyCode must not be cacheable ...` (counted in the 20). Add an allow-list by query key.

## What held (one line each)
- Dev-mode console during request + refresh cycle contains no access or refresh token (grep of all console methods).
- Prod-mode sink during the cycle contains no token and drops the URL query (`?token=SECRETQ`): route is logged without query.
- Token is never in the URL; refresh token only in the POST body; no Authorization on public calls or on /auth/refresh.
- Full cycle, signIn, signOut and a persisted query cache write nothing token-like to AsyncStorage (native); kv is never used for tokens.
- Native tokens only go through expo-secure-store under one key; web store is in-memory only (storage.web.ts has no web storage calls).
- Concurrent expired requests (3 in parallel) refresh exactly once.
- A retried request that gets TOKEN_EXPIRED again does not loop (one refresh, one retry, then ApiError).
- No refresh attempted for public calls or when no tokens exist.
- Refresh answered with HTML 200, invalid JSON, `{}`, or non-string tokens: UnknownError, stored pair untouched, no sign-out.
- Refresh rejected (TOKEN_REUSED) with 2 concurrent callers: tokens cleared and onSignedOut fired exactly once.
- Network drop during refresh keeps the tokens (NetworkError).
- Prototype-pollution keys (`__proto__`, `constructor.prototype`) in error bodies do not pollute Object.prototype.
- Error codes `__proto__`, `constructor`, `toString`, `hasOwnProperty` map to the generic message.
- HTML 200 and a JSON array/non-object error body become UnknownError; the UI shows `messageFor(code)`, never the server message.
- Timeout becomes NetworkError; a caller abort is not reported as a network failure.
- Offline sign-out (logout NetworkError or 500) still clears tokens and the query cache.

Not covered: web build with real browser storage (storage.web only inspected by reading and via existing tests), real server, expo-secure-store accessibility flags (keychain "when unlocked" option is not set in storage.ts: default is AFTER_FIRST_UNLOCK on iOS; consider WHEN_UNLOCKED_THIS_DEVICE_ONLY, Low).

## Report block
- Task: plan-02-task-4 red team
- Result: 0 Critical, 3 High, 5 Medium, 5 Low (+1 defence-in-depth); 20 failing RedTeam tests, 15 passing
- Fixes needed before merge: H1, H2, H3 (one fix: compare-and-set plus generation counter and serialized signOut), M1, M4
