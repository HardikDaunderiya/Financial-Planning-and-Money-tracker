# Red team report: plan-02 task 10 (Home, tabs, Me, sign-out wipe)

Branch plan-02-app-foundation, commit dd759f2. Tests (Jest + RNTL), split in three files because the deep-link router test poisons later tests in the same file:
- `app/src/redteam/redteam-home.test.tsx` (sign-out wipe, A then B, logs)
- `app/src/redteam/redteam-home-ui.test.tsx` (Me taps, hostile payloads, foreground refetch, failing signOut)
- `app/src/redteam/redteam-home-route.test.tsx` (deep link while signed out)

Run: `cd app && npx jest src/redteam/redteam-home --forceExit` (use --forceExit; do not run the three files in one worker if you reorder them).
Tests that FAIL assert the correct behaviour and show a finding. No product code was changed.

Totals: Critical 0, High 0, Medium 6, Low 6.

## Findings

### M1 Medium: a late-restoring persister puts user A's cached Home in front of user B
- Test: `RT A then B never sees A > FINDING: a persister that restores late (after sign-out) does not put A's cache in front of B`
- Repro: A's `gullak.query-cache` holds a `["today"]` entry. Mount `PersistQueryClientProvider` with a restore that resolves slowly. Fire `authEvents.emitSignedOut()` (forced sign-out), sign in B, then let the restore finish.
- Observed: the restore hydrates the global `queryClient` after `forget()` cleared it. B's Home renders A's line "A-LINE Priya owes ₹4,321 to Raj" and A's figures until B's own fetch lands.
- Expected: after sign-out nothing from the previous user can enter the cache (restore cancelled or ignored once the session ended; or cache keyed per user).
- Rule: task-10 brief ("cached figures never shown to the next user"); spec 4.7 sign-out wipe.
- Likelihood is low on its own (restore is milliseconds), but it chains with M2: if the app is killed before the wipe finishes, A's cache is still on disk and is restored on the next launch.

### M2 Medium: signOut() resolves before the persisted wipe has finished
- Test: `RT sign-out leaves nothing > FINDING: signOut() resolves only after the persisted wipe finished`
- Repro: make `persister.removeClient` slow, tap sign-out, check whether `signOut()` has resolved.
- Observed: `forget()` in `session.tsx` calls `void kv.remove(setupDraft)`, `void kv.remove(email)` and `wipeCache().catch(...)` without awaiting. The sign-out promise (and the UI) finish while the cache, email and draft may still be on disk. A kill right after the tap leaves A's figures and email on the device. Wipe failures are only logged.
- Expected: `forget` awaited by `signOut`; the UI shows signed out only when storage is clean, or the wipe is retried on next launch when no session exists.
- Rule: 4.7 sign-out leaves nothing; task 10 brief.

### M3 Medium: an unknown mood from the server blanks Home
- Test: `RT hostile server payloads on Home > FINDING: an unknown mood does not crash Home`
- Repro: `getToday` returns `mood: "ECSTATIC"`.
- Observed: `fromServerMood` returns undefined, Gullak throws `Cannot read properties of undefined (reading 'eyes')`; the whole Home falls to the route error boundary, figures lost.
- Expected: unknown mood maps to a safe default (e.g. calm); figures still shown. A new server mood after a release must not brick every old app.
- Rule: ERR-13 / engineering standards (tolerant reader).

### M4 Medium: a malformed date from the server crashes Home
- Test: `RT hostile server payloads on Home > FINDING: a malformed cycleEnd date does not crash Home`
- Repro: `date: "garbage"`, `cycleEnd: "not-a-date"`.
- Observed: `RangeError: Invalid time value` from `Intl.DateTimeFormat.formatToParts` in `lib/dates.ts`; Home shows the error boundary.
- Expected: formatting falls back to an empty string / hides the line; figures remain.
- Rule: ERR-13.

### M5 Medium: foreground refetch is not rate-limited and cancels in-flight requests
- Test: `RT Home foreground refetch > FINDING: 20 rapid AppState active flips send at most 2 requests`
- Repro: 20 x (background, active) in a row while a request is in flight.
- Observed: 20 requests to `/budget/today` (`refetch()` defaults to `cancelRefetch: true`, so each flip aborts the previous and starts a new one).
- Expected: at most 1-2 requests (`refetch({ cancelRefetch: false })`, or skip when the data is fresher than staleTime).
- Rule: 4.7 / standards on request volume; battery and server load.

### M6 Medium: a rejecting signOut gives an unhandled rejection and no message
- Test: `RT Me sign-out failure > FINDING: a rejecting signOut leaves Me usable and does not raise an unhandled rejection`
- Repro: `signOut` rejects (e.g. `SecureStore.deleteItemAsync` throws, `store.clear()` rejects in `runSignOut`).
- Observed: `me-screen.tsx` does `void signOut().finally(...)`: nothing catches, unhandled rejection, button just re-enables, user is told nothing and is still signed in with tokens possibly half cleared.
- Expected: catch, show "Could not sign out, try again", log by error class only.
- Rule: standards (every async action has an error path).

### L1 Low: the persisted query-cache key survives sign-out as an empty shell
- Tests: `RT sign-out leaves nothing > FINDING: after user sign-out gullak.query-cache is gone` and `... forced onSignedOut ... leaves no query-cache key`
- Observed: after `queryClient.clear()` the persist subscription re-writes `gullak.query-cache` as `{"buster":"","timestamp":...,"clientState":{"mutations":[],"queries":[]}}` (after `removeClient`). No figures remain, but the key does, against "nothing may remain".
- Expected: key absent (unsubscribe persistence before clearing, or remove last).

### L2 Low: negative `daysLeft` renders "-3 days left in this cycle"
- Test: `FINDING: negative daysLeft is not shown as '-3 days left'`. Clamp to 0 or hide.

### L3 Low: non-numeric money fields render "₹NaN" and a "NaN%" bar width
- Test: `FINDING: NaN-like fields (strings/null) do not render 'NaN' or 'undefined'`. A contract violation, but the screen shows `₹NaN`, `x days left`, `width: "NaN%"`. Validate the response at the API boundary.

### L4 Low: a 2,000-char server `line` is not capped
- Test: `FINDING: a 2,000-char line is capped`. `Hero` renders the line with no `numberOfLines`, pushing the figures far below the fold.

### L5 Low: bidi override characters in the server `line` are rendered raw
- Test: `FINDING: an RTL override (U+202E) in the line cannot reverse the surrounding text`. U+202E reaches the Text node. Strip bidi controls (U+202A-202E, U+2066-2069) from server prose.

### L6 Low: email on Me is unbounded and may contain bidi controls
- Test: `FINDING: email with RTL override / 10k chars on Me is bounded`. Cap with `numberOfLines={1}` / `ellipsizeMode`.

### Note (not a failing test): offline sign-out
Local sign-out succeeds offline (held, see below) but the refresh token is not revoked server-side until it expires; only a `auth.logout_offline` warning is logged. Acceptable per the code comment, but no retry exists. Consider queueing the revoke.

## Defended (one line each)
- User sign-out removes `gullak.me.email`, `gullak.setup-draft` and the SecureStore `gullak.session` entry.
- Sign out A then sign in B: B's Home shows only B's line and figures; A's line and "₹1,234" never render; email is B's.
- B signing in with no email argument does not inherit A's email.
- Sign-out while offline (logout rejects with NetworkError) still clears tokens, email and ends signedOut.
- Double-tap "Yes, sign out" calls `signOut` once (button goes busy and disabled).
- Deep link to `/me` while signed out lands on `/login`; the screen never renders (and `/home` is covered by the task 6 test).
- HTML/script/onerror in `line` renders as inert text.
- budgetPaise 0 with spentPaise 0: "left of ₹0 today", no NaN or Infinity.
- A date in another year (1999, 2031) formats without crashing.
- `leftPaise` of 1e21 shows no exponent notation.
- Logs: a full sign-in, Home render with a sensitive line, and sign-out wrote no email, amount, line text or token to any console level.
