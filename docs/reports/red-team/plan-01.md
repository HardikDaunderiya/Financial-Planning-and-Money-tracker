# Red team: plan-01 (server foundation)

Date: 2026-10-23. Branch `plan-01-server-foundation`. Target: Spring Boot server driven through MockMvc against Testcontainers Postgres 17 (OTP codes are only readable in-process). Test users created per test with `signIn()`; nothing outside localhost and the test container was touched.

Attack tests: `server/src/test/java/in/gullak/security/RedTeamPlan01Test.java`
Run: `cd server && ./gradlew test --tests 'in.gullak.security.RedTeam*'` → 36 tests, 27 pass (defended), 9 fail (open findings below).

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 4 (RT-01 to RT-04) |
| Low | 2 (RT-05, RT-06) |

No user can read or change another user's data, and every control in 4.7 that Plan 1 owns is present. The findings are limits and error paths weaker than specified.

## Findings

### RT-01 Medium: no request body size limit (API-X-08)

- Failing tests: `oneMegabyteJsonBodyOnPublicRouteIs413`, `oneMegabyteJsonBodyOnFixedCostsIs413`
- Request: `POST /api/v1/auth/otp/request`, no token, `Content-Type: application/json`, body `{"email":"user-…@example.test","pad":"<1,048,576 × a>"}`. Same with `POST /api/v1/me/fixed-costs` and `{"name":"Rent","amountPaise":100,"pad":"<1 MB>"}`.
- What happened: 204 and 201. The unknown field is ignored (API-X-06), so the whole body is read and parsed. Only `spring.servlet.multipart` limits exist; JSON bodies are bounded only by Jackson's default string limit (~20 MB per string), on an unauthenticated route.
- Should: 413 `TOO_LARGE` for a 1 MB JSON body, before parsing.
- Rule: test case API-X-08 ("Oversized body, 1 MB JSON → 413"); 4.7 "Input limits on every field"; unauthenticated memory/CPU amplification.
- Fix hint: a filter that rejects `Content-Length` above a small cap (e.g. 64 KB) on non-multipart routes and caps chunked bodies, mapped to `TooLargeException`.

### RT-02 Medium: money fields accept JSON strings (API-X-09)

- Failing tests: `fixedCostAmountAsStringIsRejected`, `fixedCostPatchAmountAsStringIsRejected`, `profileIncomeAsStringIsRejected`
- Request: `POST /api/v1/me/fixed-costs` `{"name":"Rent","amountPaise":"100000"}`; `PATCH /api/v1/me/fixed-costs/{id}` `{"amountPaise":"200000"}`; `PUT /api/v1/me/profile` with `"incomePaise":"5000000"`.
- What happened: 201 / 200 / 200; Jackson coerces the string to `Long`. (Decimals, `1e3`, booleans, overflow, negatives and zero are correctly rejected.)
- Should: 400 `VALIDATION`.
- Rule: API-X-09 "every amount field rejects decimals and strings"; standards "Money is paise, integers, everywhere".
- Fix hint: disable scalar coercion from strings for integer types (Jackson `coercionConfigFor(LogicalType.Integer).setCoercion(CoercionInputShape.String, CoercionAction.Fail)`, or `MapperFeature.ALLOW_COERCION_OF_SCALARS` off).

### RT-03 Medium: NUL character in a text field gives 500 (and burns the OTP on sign-in)

- Failing tests: `nulCharacterInFixedCostNameIsValidationNotInternal`, `nulCharacterInFixedCostPatchIsValidationNotInternal`, `nulCharacterInDeviceDoesNotBurnTheCodeWith500`
- Request: `POST /api/v1/me/fixed-costs` `{"name":"Re\u0000nt","amountPaise":100000}`; `PATCH …/{id}` `{"name":"Re\u0000nt"}`; `POST /api/v1/auth/otp/verify` `{"email":…,"code":<right code>,"device":"ph\u0000one"}`.
- What happened: 500 `INTERNAL` with an `error.unexpected` ERROR log; cause `PSQLException: invalid byte sequence for encoding "UTF8": 0x00`. On verify, the OTP is consumed and the user row created in `OtpService.verify`'s transaction, then the token insert fails in `TokenService.issue`'s transaction: the user gets a 500 and a dead code. (A NUL at the end of a name is silently stripped by `String.trim()`, so only mid-string NULs reach Postgres.)
- Should: 400 `VALIDATION` naming the field; the sign-in code must not be spent by a request that then fails.
- Rule: 4.7 "Input limits on every field"; API-X-02 / ERR (expected input never produces 5xx); 7.10 API-X-07 "stored or rejected as text".
- Fix hint: reject control characters (`\p{Cntrl}`, at least `\u0000`) on every free-text field (`name`, `device`, later merchant/notes), ideally one shared constraint; and run verify + issue in one transaction or issue before consuming.

### RT-04 Medium: OTP verify has no per-email rate limit

- Failing test: `verifyIsRateLimitedPerEmailAcrossIps`
- Request: 40 × `POST /api/v1/auth/otp/verify` `{"email":"<one email>","code":"123456"}`, each from a different client IP.
- What happened: 40 × 401 `OTP_INVALID`, never 429. `OtpService.verify` only calls `limiter.check("otp-verify-ip:" + ip, 30, …)`; there is no `otp-verify-email:` key (request has both).
- Should: 429 `RATE_LIMITED` after a per-email threshold on verify.
- Rule: 4.7 "Rate limits per email and per IP on OTP request and verify."
- Impact note: brute force is still capped by the database (5 attempts per code, 10 failures per email per 24 h, both proven below), so this is a missing layer, not an open door. Rated Medium because the spec names the limit.

### RT-05 Low: anyone who knows an email can lock its owner out of sign-in for 24 hours

- No failing test (behaviour matches the spec).
- Steps: `POST /otp/request` for the victim's email, 5 wrong `POST /otp/verify`, request again, 5 more wrong guesses. The email is now `OTP_LOCKED` ("Try again tomorrow") for 24 h; the attacker can repeat daily. Requesting a code every 2 minutes also retires each code the victim receives.
- Should (decision for the founder): accept as the price of brute-force protection, or soften (e.g. count failures per email+IP, or let a fresh code from the real inbox bypass the daily lock once). Existing sessions are not affected.
- Rule: 4.7 OTP rules (this is their side effect).

### RT-06 Low: unauthenticated actuator paths answer 401, not 404

- No failing test. `/actuator/env` etc. fall through to `anyRequest().authenticated()`, so an anonymous caller gets 401; a signed-in caller gets 404 (tested). Nothing leaks, but API-X-11 says "every other actuator path 404". Existing `HealthApiTest` only asserts 4xx.

## Held (one line each)

- Cross-user PATCH/DELETE of a fixed cost → 404 `NOT_FOUND`, owner's row unchanged (`anotherUsersFixedCostCannotBeEditedOrDeletedAndStaysIntact`).
- Random UUID → 404; `1 OR 1=1` as id → 400 (`randomAndMalformedFixedCostIdsAreNotFoundOrValidation`).
- Mass assignment of `id`, `userId`, `user_id`, `active` on fixed-cost create ignored; row owned by caller (`massAssignmentOnFixedCostIsIgnored`); `userId` on profile ignored (existing `IsolationApiTest`).
- Deleted fixed cost cannot be edited or revived → 404 (`deletedFixedCostCannotBeEditedOrRevived`).
- `GET /budget/today` never counts another user's spends (`todayIgnoresAnotherUsersSpends`).
- JWT signed with a foreign HS256 key → 401 (`tokenSignedWithAnotherKeyIsRejected`); `alg` switched to HS512 → 401 (`hs512AlgorithmSwitchIsRejected`); `alg: none`, tampered, wrong issuer, expired → 401 (existing `TokenApiTest`).
- Refresh token used as bearer → 401; access token used as refresh token → 401 (`refreshTokenIsNotAnAccessTokenAndViceVersa`).
- Access token in a cookie or Basic auth → 401 (`basicAuthAndCookieTokensAreIgnored`); in query string or form body → 401 (existing, SEC-13).
- Six parallel verifies with the right code → exactly one 200 and one refresh token (`parallelVerifyWithTheRightCodeSignsInOnce`).
- Twenty parallel wrong guesses → attempts stop at exactly 5, then the right code is `OTP_LOCKED` (`parallelWrongGuessesCannotExceedFiveAttempts`).
- Email case variants share one per-email request bucket; 6th → 429 (`emailCaseVariantsShareOneRateLimitBucket`).
- Requesting a new code kills the old one (`oldCodeDiesWhenANewOneIsRequested`).
- Known vs unknown email on OTP request: same 204 and empty body (`otpRequestAnswersTheSameForKnownAndUnknownEmails`, SEC-12).
- Code format strict: 5 or 7 digits, full-width digits, letters, SQL → 400 (`verifyCodeFormatIsStrict`).
- Path tricks through the public `/api/v1/auth/**` matcher (`..`, `..;`, `%2e%2e`, `..%2F`, `//`) → 4xx, nothing created (`pathTraversalThroughThePublicAuthMatcherDoesNotReachProtectedRoutes`).
- `/actuator/env|heapdump|beans|mappings` with a valid token → 404 (`actuatorPathsOtherThanHealthAreNotFoundForSignedInUsers`).
- SQL, script, `${jndi:…}`, right-to-left override, Devanagari and emoji names stored verbatim as text, nothing executed (`injectionAndUnicodeStringsAreStoredAsText`, API-X-07).
- Amounts `1.5`, `-100`, `0`, max+1, 20-digit overflow, `true`, `1e3`, `null` → 400; income over max and negative savings → 400 (`moneyFieldsRejectDecimalsNegativesZeroOverflowAndBooleans`).
- 10,000- and 61-char names, 260-char email, 61-char device → 400 (`longStringsAreRejected`).
- Payday 0/29, foreign or newline-suffixed timezone, unknown personality, `25:00` → 400; savings leaving nothing to spend → 422 `NOT_POSSIBLE` (`profileEnumsTimezoneAndPaydayAreValidated`).
- After setup a fixed cost that would leave nothing to spend → 422 and `/today` still 200 (`fixedCostsCannotPushSpendableToZeroAfterSetup`).
- Five parallel deletes of one fixed cost → only 204/404, one effect (`parallelDeletesOfOneFixedCostHaveOneEffect`).
- Five parallel refreshes with one token → at most one 200 and no live token left (`parallelRefreshesLeaveNoLiveToken`).
- API responses carry `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store` (`apiResponsesCarryNoSniffNoFrameAndNoStore`).
- Foreign `Origin` gets no `Access-Control-Allow-Origin` on preflight or GET (`foreignOriginGetsNoCorsHeaders`, SEC-05 negative half).
- A hostile `X-Request-Id` is replaced with a safe id (`injectedRequestIdIsReplaced`).
- Logs: no email, code, token or amount after a full session (existing `LogRedactionApiTest`, SEC-01); 500 bodies are generic with an `errorId` (seen in RT-03).

## Already known (confirmed or not re-tested, not new)

- Access token valid up to 15 min after logout (stateless by design).
- Refresh + logout race can leave one live token.
- Logout with an expired-but-used refresh token revokes all sessions.
- Fixed-cost budget guard is check-then-write without a lock.
- First `GET /today` racing a payday change can create overlapping cycles (permanent 500).
- `GULLAK_TRUSTED_PROXIES` must be set in production.

## Not built yet (out of scope for Plan 1)

- Uploads (size, magic bytes, PDF JS, zip bomb, password, upload rate): not built yet.
- Game cheating (XP, streaks, badges): not built yet.
- Web (CSP, frame-ancestors, HSTS, refresh cookie flags, custom refresh header, token storage): not built yet.
- Exports: not built yet.
- The app (careless-user flows, SecureStore, offline queue): not built yet.
- Deleted users and `merchant_raw_enc` encryption at rest: not built yet.
- Pagination cursors (API-X-10): no paginated endpoint yet.

## Report block

```
Task: plan-01 red team (server foundation: OTP, tokens, profile, fixed costs, /budget/today)
Result: done (findings open: 4 Medium, 2 Low; no Critical or High)
Tests: 27/36 passing in RedTeamPlan01Test; the 9 failing tests are the open Medium findings RT-01..RT-04
Changed: server/src/test/java/in/gullak/security/RedTeamPlan01Test.java, docs/reports/red-team/plan-01.md
Risks: unauthenticated 1 MB+ bodies parsed (RT-01); NUL in device burns a sign-in code with a 500 (RT-03)
Questions: founder: accept the 24 h targeted-lockout trade-off in the OTP rules (RT-05)?
```

## Status after fix round 1

| Finding | Status |
|---|---|
| RT-01 | Fixed (1eaeca4) |
| RT-02 | Fixed (1eaeca4) |
| RT-03 | Fixed (1eaeca4) |
| RT-04 | Fixed (1eaeca4); per-email verify limit is 30 per 15 minutes (see task-11 report for why not 10) |
| RT-05 | Accepted for V1 (founder decision pending) |
| RT-06 | Fixed (1eaeca4) |

RedTeamPlan01Test: 36/36 passing.
