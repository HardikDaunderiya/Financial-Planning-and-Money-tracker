# Red team: plan-02 task 5 (dev OTP route, first-cycle override, profile and fixed-cost guard races)

Commit da14837, branch plan-02-app-foundation. Method: MockMvc tests on the Testcontainers Postgres (real concurrency, real row locks).
Test file: server/src/test/java/in/gullak/security/RedTeamPlan02Task5Test.java
Run: `cd server && ./gradlew test --tests 'in.gullak.security.RedTeamPlan02Task5Test'`
Result: 28 tests, 26 pass (defended), 2 fail on purpose (they assert the secure behaviour and name the finding).
Count: Critical 0, High 0, Medium 1, Low 1.
Spec basis: 4.7 (authorisation, input validation, no sensitive data in logs), spec 2.1 (first cycle), API-FC-08, API-PRO-02, API-X-03.

## Medium

### M1. "Money left until payday" is charged twice for spends already logged in the first cycle
Test: `findingMoneyLeftAnswerIsDoubleChargedForEarlierSpends` (fails)
Request: user finishes setup on 23 Oct, a Rs 2,000 spend is logged on 22 Oct (cycle 1-31 Oct); `PUT /api/v1/budget/first-cycle {"moneyLeftPaise":600000}`.
Happened: 200 with `budgetPaise` 44,400, i.e. (600,000 - 200,000) / 9. The pool is pinned to the answer and `compute` still subtracts every earlier spend of the cycle from it.
Should: the answer is what the user has now, so the budget is 600,000 / 9 = 66,600. (Spends made before the answer are already inside the answer.) The same flaw works as an exploit: after overspending, re-posting a bigger number is the only way to clear the overrun, and the endpoint can be called at any point in the first cycle, not just during onboarding. Fix options: store the override together with the spend total at the time of the answer (pool = answer + spent_before_answer), or reject the call once the cycle has any spend.
Rule: spec 2.1 (money left until payday); BUD-32.

## Low

### L1. The override has no ceiling tied to the user's own plan
Test: `findingOverrideHasNoCeilingTiedToTheUsersOwnPlan` (fails)
Request: user with monthly spendable Rs 15,000: `PUT /api/v1/budget/first-cycle {"moneyLeftPaise":1500001}` and up to 10,000,000,000 (Rs 10 crore, `MAX_INCOME_PAISE`).
Happened: 200 every time; any number of times during the first cycle; the daily budget (and so mood, and any later XP/streak rules that read it) follows.
Should: a ceiling such as the monthly spendable or income, or a one-time answer; the change is logged without the amount (log is fine already).
Rule: 4.7 input limits (a limit weaker than specified); game integrity (a farmed budget).

## Defended (one line each)

- Dev OTP route under the `test` profile: POST /api/v1/auth/dev/otp, with trailing slash, /auth/dev, upper-case path: 404 in the standard `{code:NOT_FOUND,message}` shape, no OTP in the body.
- GET on the dev path returns 401 (the public matcher is POST only), no leak, no code; observed only.
- No DevOtpController bean and no `/auth/dev` handler mapping in the test application context.
- ApplicationContextRunner-style contexts with profiles prod, test, default, staging and prod+test: controller bean absent; with `local` it is present (control).
- No `spring.profiles`, `group:` or include in application.yml, application-prod.yml, application-local.yml; prod file never names `local`.
- First-cycle override with B's token only ever writes B's own cycle; A's cycle and pool are untouched.
- Mass assignment on the override body (`userId`, `id`, `poolOverridePaise`, `closedAt`, `first`, `xp`, `status` with another user's cycle id): ignored; B's cycle unchanged, A's pool is exactly what was sent.
- Override after the first cycle (and months later after a gap): 422 FIRST_CYCLE_OVER, nothing leaked in the body.
- Override on a cycle with `closed_at` set directly in Postgres: 422 FIRST_CYCLE_OVER, pro-rated pool unchanged.
- Override before setup: 409 SETUP_INCOMPLETE, no cycle row created.
- No token, garbage token, token in the query string: 401.
- 23 bad bodies (negative, Long.MIN, decimal 6000.5 and 6000.0, 1e3, string, boolean, array, object, Long.MAX, Long.MAX+1, 26-digit number, over the max, null, missing, `[]`, `null`, empty, truncated JSON, SQL string, RTL-mark string): all 400/413/415 and the stored pool is unchanged.
- Boundary: exactly MAX_INCOME_PAISE accepted without overflow, 0 accepted, MAX+1 gives 400.
- Wrong content type 415 typed; POST, DELETE, PATCH, GET on the route 405.
- Two overrides in parallel on a user with no cycle yet: both 200, exactly one cycle, final pool is one of the two values, `today` agrees.
- 12 overrides and 12 `today` reads in parallel: all 200, one cycle.
- Override then payday change: cycle keeps its end date and the override; the next cycle has no override and the endpoint is then closed.
- Payday change before the first cycle exists: still one pro-rated cycle.
- 20 parallel fixed-cost adds of Rs 2,000 against Rs 30,000 spendable: exactly 14 created (201), 6 rejected (422), total Rs 28,000, never a 500.
- 10 parallel adds mixed with 10 parallel edits: only 200/201/422, total stays under spendable.
- 4 parallel first-time profile PUTs with different bodies: all 200, one row, every column from the same winning body (no mixed row).
- Parallel first-time PUTs, half valid and half failing the guard: only 200/422, row is the valid one, no half-created row.
- Profile PUT racing a fixed-cost delete, 15 rounds: PUT is 200 or 422, delete 204, invariant income - fixed - savings > 0 held every round.
- Deadlock hunt: 4 threads x 150 iterations (profile PUT, fixed-cost PATCH, fixed-cost POST, today plus first-cycle) for one user: no 5xx, no `deadlock_detected` in the log, invariant held. Lock order is consistent (profile row first).
- Logs after the run (override amounts, rejected amounts, fixed-cost name and amount, email, OTP code, both tokens): none appear; `cycle.pool_set user=<id>` is logged without an amount.

## Not covered
- Postgres isolation under a second app instance (single JVM only).
- The first-cycle path through the app UI (Plan 2 app tasks).
