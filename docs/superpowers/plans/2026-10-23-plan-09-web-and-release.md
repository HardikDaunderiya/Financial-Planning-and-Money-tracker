# Plan 9: Web and release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reduced web app (dashboard, upload, goals, budget settings) with a cookie session that survives a reload and resists CSRF, security headers and CORS on every response, a bounded rate limiter, a Playwright smoke test against the real build, a hardened CI (pinned actions, secret scan, dependency audit), a production container and DigitalOcean App Platform spec for Bangalore, EAS build profiles and workflows, and the release documents (`docs/release-checklist.md`, a complete `docs/api.md`).

**Architecture:** The server keeps Plan 1's `TokenService` untouched and adds a thin `WebSession` in `auth`: a request carrying `X-Requested-With: gullak-web` is a web request; its refresh token travels only in an `__Host-` cookie (httpOnly, Secure, SameSite=Strict) and cookie refresh or logout refuses to run without that header (403 `CSRF`). A servlet filter in `common/web` writes the security headers before anything else runs, so even Plan 1's 413 carries them, and a CORS filter inside the security chain allows only `GULLAK_WEB_ORIGIN` and answers anything else with 403 `CSRF` in the standard error shape. The app's one API client gains a cookie mode (credentials included, the header on every call, no refresh token in JavaScript, a `resume()` that trades the cookie for an access token after a reload, refreshes serialised across tabs with Web Locks). Phone-only routes are wrapped in `blockOnWeb`, and a test forces every route file to be classified. The web build is the Expo static export served by an unprivileged nginx container whose headers are tested in CI; in production it sits behind the same App Platform ingress as the API (`/api` → server, `/` → web), so the browser sees one origin.

**Tech Stack:** Server: Spring Boot 4.1.1, Java 21, Spring Security, Caffeine (managed by the Boot BOM), OWASP Dependency-Check Gradle plugin, JUnit 5, MockMvc, Testcontainers. App: Expo (Plan 2's SDK), Expo Router, TypeScript strict, TanStack Query v5, Jest + React Native Testing Library, Playwright (`@playwright/test`, Chromium). Delivery: Docker (nginx-unprivileged, eclipse-temurin 21 JRE), DigitalOcean App Platform (region `blr`) with Managed Postgres 17 and Container Registry, GitHub Actions, gitleaks, EAS Build and EAS Workflows.

**Spec:** `docs/superpowers/specs/2026-10-23-gullak-v1-design.md` (sections 1.1, 4.1, 4.2, 4.4, 4.7, 4.9, 4.10), with test cases in `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md` (API-AUTH-16; SEC-04 to 09, 12; APP-30; E2E-10; section 11), rules in `docs/engineering-standards.md`, copy rules in `.claude/design.md`, the prototype checklist in `docs/ux-test-findings.md`, and Plan 1's open items in `docs/reports/2026-10-23-plan-01.md`. Read all of them before starting any task. Before the app tasks read `.claude/skills/expo-router/SKILL.md`; before Task 6 read `.claude/skills/eas-hosting/SKILL.md` (only to understand the option this plan rejects); before Task 10 read `.claude/skills/eas-app-stores/SKILL.md` and `.claude/skills/eas-workflows/SKILL.md`; before every task load `anthropic-skills:secure-engineering`.

## Global Constraints

- Plan 1's token semantics do not change: access JWT 15 minutes, refresh token random 256-bit, 30 days, stored hashed, single use, rotated on every refresh; reuse of a spent token revokes every session; an expired or logged-out token is simply rejected (spec 4.7). `TokenService` is not edited by this plan.
- On the web the refresh token is an `httpOnly`, `Secure`, `SameSite=Strict` cookie and the access token stays in memory; refresh needs a custom header (spec 4.7). Nothing writes a token to `localStorage`, `sessionStorage`, `document.cookie` or the persisted query cache (SEC-07).
- Security headers on web responses (CSP, no framing, no sniffing) and HSTS on the web; CORS restricted to the app's web origin (spec 4.7).
- Dependencies scanned in CI (Gradle dependency check, npm audit); builds fail on known critical issues. Secrets only in environment variables; a pre-commit hook blocks accidental commits (spec 4.7).
- The web app is "dashboard, upload, goals and budget settings; no quick-add, mascot moments or notifications on web" (spec 1.1).
- Data hosted in India: DigitalOcean Bangalore (`blr`) for the server, the web container and Postgres (spec 4.1, 4.7).
- Server conventions (Plan 1): package by feature, constructor injection, records at the edges, `ErrorCode` append-only (add before `INTERNAL`), `{code, message}` error bodies, no amounts, emails, tokens, IPs or cookie values in logs, parameterised logging, no empty or broad catch outside `common/error`.
- App conventions (Plan 2): TypeScript strict with `exactOptionalPropertyTypes`, no `any`, features never call `fetch`, `console` only in `src/lib/log.ts`, `process.env.EXPO_OS` (through `src/lib/platform.ts`) instead of `Platform.OS`, tests next to the code (`*.web.test.ts(x)` run in the web Jest project), copy per `.claude/design.md` (sentence case; one sentence has no full stop; two or more sentences take one each).
- Migrations for this plan use V070–V079; if an earlier plan was executed with more migrations than planned, renumber to the next free number in this block. This plan needs none.
- Every GitHub Action is pinned to a full commit SHA, every Docker base image to a digest; workflows declare `permissions: contents: read`.
- Each task's owner is named; after the owner hands back, `qa-engineer` runs, then `red-team` where the task says so, then `manager` reviews (`docs/team.md`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Two browser tabs reload at the same moment: both stay signed in, and neither spends the cookie the other just rotated (which would trip reuse detection and sign the user out everywhere). Pinned in Task 4 (`twoTabsRefreshingAtOnceStayBothSignedIn`).
- A second `__Host-gullak_rt` cookie planted next to the real one: the server refuses the request and spends neither token, so an attacker cannot swap their own session into the victim's browser. Pinned in Task 1 (`duplicateRefreshCookiesAreRefused`).
- Look-alike origins (`http://localhost:8088.evil.test`, another port, `https://` instead of `http://`, the literal `null` a sandboxed frame or a `file:` page sends) are refused like any foreign origin. Pinned in Task 2 (`lookAlikeOriginsAreRefused`).
- A flood of new rate-limit keys cannot push out a key that is currently being limited, and the limiter's memory stays under its cap. Pinned in Task 3 (`floodingKeysDoesNotResetALimitedKey`).
- Opening the web dashboard never plays or acknowledges the Gullak's one-shot celebrations, so a level-up still plays on the phone. Pinned in Task 5 (`webLeavesCelebrationsForThePhone`).

## Decisions made in this plan

| Decision | Why | Cost if wrong |
|---|---|---|
| The server tells a web request from a phone by `X-Requested-With: gullak-web`, which the web client sends on every call; the same header is the CSRF proof for cookie refresh and logout | One signal, set only by our client; a cross-site form cannot add a custom header and a cross-site fetch that adds one needs a CORS preflight that only `GULLAK_WEB_ORIGIN` passes | a phone client that sent the header would get a cookie instead of a body token; our phone client never sends it |
| Cookie name `__Host-gullak_rt`, `Path=/`, `Max-Age` 30 days, `HttpOnly; Secure; SameSite=Strict`, no `Domain` | The `__Host-` prefix makes browsers refuse a copy set by a sibling subdomain or over HTTP, closing login-CSRF by cookie tossing; it requires `Path=/` | the refresh cookie also travels with every same-origin request (TLS-only, never logged) |
| Two refresh cookies in one request are refused (401, cookie cleared, neither spent) | A planted cookie next to the real one must not win by order | a user with a planted cookie stays signed out until the browser drops it |
| The web response to verify and refresh is `{accessToken, expiresIn}`; the refresh token never appears in a web body. A phone body token wins over a cookie | JavaScript cannot leak what it never sees; phones keep Plan 1's contract unchanged | none |
| A refresh or logout with neither a body token nor a cookie is 401 `UNAUTHENTICATED` (was 400 `VALIDATION` for an empty phone body) | The body became optional for the web; "no session" is the honest answer | a client relying on the 400 sees 401; ours does not |
| A request from an unlisted origin gets 403 `CSRF` in the standard error shape with no CORS headers, and is not processed | Spring's default answers 403 in plain text; API-X-02 needs `{code, message}`; refusing before the controller stops simple cross-site POSTs from having effects | SEC-05's wording changes (Task 11) |
| Security headers come from one servlet filter at the front of the chain; Spring Security's header writer is off | Plan 1 deferred: `BodyLimitFilter`'s 413 is written before Spring Security and had none; one writer means one copy of each header | none |
| Web hosting: **DigitalOcean App Platform**, an unprivileged nginx container serving `npx expo export --platform web`, behind the same ingress as the API (`/api` → server with the prefix kept, `/` → web). EAS Hosting is not used | One origin in production (no CORS preflights, the `SameSite=Strict` cookie is always first-party), CSP and HSTS under our control and tested in CI with the exact production config, everything in Bangalore on one platform. EAS Hosting would put the web app on another site unless given a custom domain, and its header control is not what we test | one more small container (about $5 a month) |
| Web CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' <api origin>; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` | React Native Web writes inline styles, so `style-src` needs `'unsafe-inline'`; scripts stay strict; Playwright fails on any violation | inline styles are an injection channel only for CSS, not script |
| On the web the query cache is not persisted | It would land in `localStorage` (AsyncStorage on web) with budget figures on a possibly shared computer; offline mode is a phone feature | a reload refetches instead of painting cached data |
| Refreshes are serialised across tabs with `navigator.locks` (`gullak.refresh`) | Two tabs spending one cookie at once is reuse by definition (spec 4.7) and would sign the user out everywhere | browsers without Web Locks (very old) refresh unserialised |
| Web routes are an allow-list (`WEB_ROUTES`) plus an explicit phone-only list; a test fails when a route file is in neither | A new screen must be classified before it ships; "default allowed" would leak future phone-only screens onto the web | one line per new route |
| Phone-only on web: quick-add, spend detail (Home is read-only), the report card, the stage-up moment, the notification step; the notification switches in Me are hidden; Home neither plays nor acknowledges celebrations | Spec 1.1: no quick-add, mascot moments or notifications on web | editing a spend needs the phone |
| The rate limiter is a Caffeine cache: at most 100,000 keys, each expiring when its window ends, maintenance on the caller's thread; the first rejection per window logs WARN `rate.limited kind=<key prefix>` | Plan 1 deferred an unbounded map; TinyLFU keeps hot (limited) keys over a flood of cold ones; the prefix (`otp-request-ip`) tells us whether mobile carrier NAT is tripping the per-IP limit without logging an IP | the limiter still lives in one instance: App Platform runs one `api` instance until limits move to Postgres |
| The per-IP OTP limit becomes `GULLAK_OTP_IP_LIMIT` (default 30 per 10 minutes, as before) | Indian mobile carriers put many users behind one IP (carrier-grade NAT); the number may need to rise once real traffic shows WARN `rate.limited kind=otp-request-ip` | none; the default is Plan 1's value |
| `GULLAK_DEV_CLOCK_START` shifts the server clock (still ticking) under the `local` profile only; any other profile refuses to start with it set | E2E-10 needs the spec's example day (Fri 23 Oct, ₹593) on any calendar date; the JWT validator uses the same clock, so tokens stay consistent | none in production (fails closed) |
| E2E-10 creates the example user through the API (phone-style, tokens in the body), then signs in on the web through the UI | The test is about the web build, not the setup screens (E2E-01 covers those on a phone); setting ₹5,340 as money left reproduces the spec's ₹593 exactly | setup on the web is covered by the route allow-list and manual checks, not by Playwright |
| Dependency scanning: `npm audit --audit-level=critical` and OWASP Dependency-Check (`failBuildOnCVSS = 9.0`, runtime classpath, `NVD_API_KEY` secret), each with a self-test that proves the gate fails on a known critical | Spec 4.7; a gate nobody has seen fail may not be wired | Dependency-Check's NVD download adds minutes (cached weekly) |
| Secret scanning with the gitleaks binary (version and SHA-256 pinned in `scripts/gitleaks.version`), not the gitleaks GitHub Action | The Action needs a paid licence for organisation accounts; the binary is free and checksummed | updating means editing one file |
| Server deploy: images built in GitHub Actions on a `v*` tag, pushed to DigitalOcean Container Registry, and the live app spec's image tags updated with `doctl`; secrets live only in App Platform | No GitHub link needed (the repo has no remote yet); the committed spec carries no secret values; a deploy is a tag | the first create is manual (release checklist) |
| EAS: profiles `development` (dev client, internal), `preview` (internal Android APK) and `production` (store builds, `autoIncrement`, `appVersionSource: remote`); `EXPO_PUBLIC_API_URL` comes from EAS environment variables, not `eas.json`. Preview builds run on every push to `main` (Android only); iOS goes through TestFlight from the `v*` release workflow | iOS internal builds need every tester's device registered; TestFlight does not. The domain is undecided (spec 6), so no URL is committed | iOS testers wait for a tag |
| Preview builds talk to the production API | One server in V1; a staging app would double hosting for a solo founder | test accounts live in production (deletable through account deletion) |
| No migration in this plan; V070–V079 stay free | Nothing new is stored | none |

## Cross-plan contracts

This plan consumes these; the first step of each task that uses one checks it against the real code and, if a name differs, uses the real name and notes it in the task report.

- **Plan 1 (implemented):** `AuthController`, `TokenService.issue/refresh/logout`, `TokenPair(accessToken, refreshToken, expiresIn)`, `AuthProperties`, `OtpService.request/verify`, `SecurityConfig.PUBLIC_AUTH`, `BodyLimitFilter` (order `HIGHEST_PRECEDENCE + 10`), `RequestLogFilter` (order `HIGHEST_PRECEDENCE`), `RateLimiter.check(String, int, Duration)`, `TrustedProxiesCheck`, `ClockConfig`, `JwtConfig.ExpiryValidator(Clock)`, `ErrorCode`, `GullakException`, `AuthException`, `ApiTest` (`requestCode`, `verifyCode`, `signIn`, `freshIp`, `uniqueEmail`, `mailer.lastCodeFor`, `jdbc`, `clock`), `MutableClock`.
- **Plan 2:** `createApi(deps)`, `ApiDeps`, `api`, `authEvents` (`src/lib/client.ts`), `TokenStore`, `Tokens`, `tokenStore` (`storage.ts`, `storage.web.ts`), `queryClient`, `shouldPersist`/`persistOptions` (`query.ts`, as changed by Plan 4), `messageFor` and the `messages` map (`errors.ts`), `scripts/gen-error-codes.mjs`, `SessionProvider` (props `store`, `logout`, `wipeCache`; state `status`, `email`), `authApi.verifyCode/logout`, `TabBar`, `(tabs)/_layout.tsx`, `onboarding/personality.tsx`, the login copy ("Email", "Send code", "Enter the code"), `POST /api/v1/auth/dev/otp` (local only), `PUT /api/v1/budget/first-cycle {moneyLeftPaise}`.
- **Plan 3:** `app/app/add.tsx`, `app/app/spend/[id].tsx`, `TodaySection` props (`onAdd`, `onOpen`), `SpendRow`, `home-screen.tsx`, `queue-store.web.ts` (in-memory on web).
- **Plan 4:** `Api#postMultipart`, `ApiDeps.multipartFetchFn/uploadTimeoutMs`, `ApiError#details`, `shouldPersist(query)`, the upload start screen ("Choose a PDF or CSV"), the column-map screen ("Match the columns", "One column and a Dr/Cr column", test IDs `date-0`, `amount-2`, "YYYY-MM-DD", "Looks right"), preview copy ("N transactions"), `GULLAK_ENC_KEY`.
- **Plan 5:** `/goals/new` ("Goal name", "Start this quest").
- **Plan 6:** `app/app/report-card.tsx`, `app/app/stage-up.tsx`, `useCelebrations(game, deps)` in `src/features/game/celebrations.ts`.
- **Plan 7:** any new routes (the route-classification test lists them if unclassified).
- **Plan 8:** `GET /api/v1/me/account` (`currentConsentVersion`), `POST /api/v1/me/consent {version}`, `NotificationSettings` (`src/features/notify/components/notification-settings.tsx`), `/consent`, `/privacy`, `/restore`, `/account-deleted`, `/me/*` routes, the restore page under `/api/v1/me/restore/{token}`, `/api/v1/exports/{token}`, and the prod settings `GULLAK_MAIL_FROM`, `GULLAK_PUBLIC_URL`, `GULLAK_SUPPORT_EMAIL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `GULLAK_EXPO_ACCESS_TOKEN`.

This plan produces:

- `ErrorCode.CSRF` (403); `ForbiddenException(ErrorCode, String)`; `WebSession` (cookie `__Host-gullak_rt`, header `X-Requested-With: gullak-web`); `WebTokens(accessToken, expiresIn)`.
- `SecurityHeadersFilter`, `WebOrigins.list()`, `Cors.filter(List<String>)`; settings `gullak.web.origins` (`GULLAK_WEB_ORIGIN`), `gullak.auth.ip-limit` (`GULLAK_OTP_IP_LIMIT`), `gullak.http.rate-limit-keys`, `gullak.dev.clock-start` (`GULLAK_DEV_CLOCK_START`, local only).
- App: `isWeb` (`src/lib/platform.ts`), `blockOnWeb(Screen)`, `WEB_ROUTES`, `PHONE_ONLY_ROUTES`, `webRouteAllowed(route)`, `Api#resume()`, `ApiDeps.cookieSession`, `ApiDeps.refreshLock`, `webRefreshLock`, `WEB_CLIENT_HEADER`. Any later screen must be added to `WEB_ROUTES` or `PHONE_ONLY_ROUTES`.
- Delivery: `server/Dockerfile`, `app/web/Dockerfile`, `.do/app.yaml`, `.github/workflows/release.yml`, `app/eas.json`, `app/.eas/workflows/preview.yml` and `release.yml`, `docs/release-checklist.md`, `docs/api.md` with its coverage test.

## File structure

```
server/
  build.gradle.kts (caffeine, dependency-check plugin)                                   Tasks 3, 8
  gradle/wrapper/gradle-wrapper.properties (distributionSha256Sum)                       Task 8
  Dockerfile, .dockerignore                                                              Task 9
  dependency-check-suppressions.xml                                                      Task 8
  src/main/resources/application.yml, application-local.yml                              Tasks 2, 3, 7
  src/main/java/in/gullak/
    common/error/ErrorCode.java (append CSRF), ForbiddenException.java                   Task 1
    auth/WebSession.java, WebTokens.java, AuthController.java                            Task 1
    common/web/SecurityHeadersFilter.java, WebOrigins.java, Cors.java,
      JsonRejectingCorsProcessor.java                                                    Task 2
    common/config/SecurityConfig.java                                                    Task 2
    common/web/RateLimiter.java; auth/AuthProperties.java, OtpService.java               Task 3
    common/config/ClockConfig.java                                                       Task 7
  src/test/resources/application-test.yml                                                Task 2
  src/test/java/in/gullak/
    auth/WebSessionApiTest.java                                                          Task 1
    security/SecurityHeadersApiTest.java, security/CorsApiTest.java,
      common/web/WebOriginsTest.java                                                     Task 2
    common/web/RateLimiterTest.java, auth/OtpIpLimitApiTest.java,
      security/AccountEnumerationApiTest.java                                            Task 3
    common/config/ClockConfigTest.java                                                   Task 7
    ApiDocsTest.java                                                                     Task 11
    security/RedTeamPlan09Test.java                                                      Task 12
app/
  package.json (@playwright/test, @types/node, expo-dev-client, scripts)                 Tasks 7, 10
  playwright.config.ts                                                                   Task 7
  e2e-web/support.ts, smoke.spec.ts, security.spec.ts                                    Tasks 7, 12
  web/Dockerfile, web/default.conf.template, web/check-headers.sh; .dockerignore         Task 6
  eas.json, .eas/workflows/preview.yml, .eas/workflows/release.yml; app.config.ts         Task 10
  src/lib/api.ts, api.test.ts, storage.ts, storage.web.ts, storage.web.test.ts,
    client.ts, refresh-lock.ts, refresh-lock.test.ts, query.ts, query.web.test.ts,
    errors.ts, error-codes.ts (generated)                                                Task 4
  src/features/auth/api.ts, session.tsx, session.test.tsx                                Task 4
  src/lib/platform.ts, block-on-web.tsx, block-on-web.test.tsx,
    block-on-web.web.test.tsx, web-routes.ts, web-routes.test.ts                         Task 5
  app/add.tsx, spend/[id].tsx, report-card.tsx, stage-up.tsx,
    onboarding/notifications.tsx, onboarding/personality.tsx, (tabs)/_layout.tsx         Task 5
  src/features/tabs/tab-bar.tsx, tab-bar.web.test.tsx; src/features/home/today-section.tsx,
    spend-row.tsx, home-screen.tsx, today-section.web.test.tsx;
    src/features/game/celebrations.ts, celebrations.web.test.tsx;
    src/features/notify/components/notification-settings.tsx                              Task 5
  src/release-config.test.ts                                                             Task 10
.do/app.yaml                                                                             Task 9
.github/workflows/ci.yml                                                                 Tasks 6, 7, 8, 9
.github/workflows/release.yml                                                            Task 9
.github/dependabot.yml                                                                   Task 8
.githooks/pre-commit; .gitleaks.toml; .gitleaksignore                                    Task 8
scripts/check-pins.sh, pin-actions.sh, install-gitleaks.sh, gitleaks.version,
  test-secret-scan.sh, test-dependency-audit.sh, install-hooks.sh                        Task 8
.gitignore (.do/*.local.yaml, app/playwright-report, app/test-results)                   Tasks 7, 9
docs/release-checklist.md                                                                Task 11 (env and deploy sections from Task 9)
docs/api.md                                                                              Task 11
docs/reports/red-team/plan-09.md, docs/reports/2026-10-24-plan-09.md                     Task 12
README.md, docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md,
  docs/superpowers/plans/README.md                                                       Task 11
```

## Tasks at a glance

| # | Task | Owner | Test IDs | Red team |
|---|---|---|---|---|
| 1 | Server: web cookie session and the CSRF header | backend-engineer | API-AUTH-16, SEC-06, new API-AUTH-23–25 | yes |
| 2 | Server: security headers on every response, CORS to the web origin | backend-engineer | SEC-04 (API), SEC-05 | yes |
| 3 | Server: bounded rate limiter, configurable per-IP limit, account enumeration | backend-engineer | SEC-12, new SEC-17 | yes |
| 4 | App: cookie session in the API client, reload resume, tab lock | web-engineer | SEC-07, APP-27 (web), new SEC-18 | yes |
| 5 | App: web route guards and hidden phone-only entry points | web-engineer | APP-30 | no |
| 6 | Web hosting: nginx container with CSP and HSTS, header check in CI | web-engineer | SEC-04 (web) | yes |
| 7 | E2E-10: Playwright smoke against the export and the local server | qa-engineer (web-engineer fixes) | E2E-10, APP-30 (browser), SEC-06/07 (browser) | no |
| 8 | CI hardening: pins, permissions, secret scan, dependency audit, wrapper checksum | backend-engineer | SEC-08, SEC-09 | yes |
| 9 | Production: server container, App Platform spec, release workflow | backend-engineer | new REL-01, REL-02 | yes |
| 10 | EAS: build profiles and workflows | app-engineer | new REL-03 | no |
| 11 | Docs: complete `docs/api.md` with a coverage test, release checklist, test-case edits | qa-engineer | new DOC-01; manual checklist (section 11) | no |
| 12 | Red-team pass on the web build and security sweep | red-team (engineers fix) | regression tests for every finding | yes |

---

### Task 1: Server: web cookie session and the CSRF header

**Owner:** backend-engineer. **Test IDs:** API-AUTH-16, SEC-06, new API-AUTH-23, API-AUTH-24, API-AUTH-25 (rows added in Task 11); Review Focus `duplicateRefreshCookiesAreRefused`. **Red team:** yes: refresh and logout by cookie with no header, a wrong header value (`XMLHttpRequest`, `GULLAK-WEB`), two cookies, an oversized cookie, a cookie on a phone request, a body token and a cookie together, replaying a spent cookie, and whether the cookie value ever reaches a log line.

**Files:**
- Modify: `server/src/main/java/in/gullak/common/error/ErrorCode.java`, `server/src/main/java/in/gullak/auth/AuthController.java`
- Create: `server/src/main/java/in/gullak/common/error/ForbiddenException.java`, `server/src/main/java/in/gullak/auth/WebSession.java`, `server/src/main/java/in/gullak/auth/WebTokens.java`
- Test: `server/src/test/java/in/gullak/auth/WebSessionApiTest.java`

**Interfaces:**
- Consumes: `TokenService.issue(UUID, String) : TokenPair`, `refresh(String) : TokenPair`, `logout(String)`; `AuthProperties.refreshTtl()`; `ApiTest.requestCode`, `verifyCode`, `freshIp`, `uniqueEmail`, `mailer.lastCodeFor`, `clock`.
- Produces: `ErrorCode.CSRF` (403, WARN); `ForbiddenException(ErrorCode code, String message)`; `WebSession.COOKIE = "__Host-gullak_rt"`, `WebSession.CLIENT_HEADER = "X-Requested-With"`, `WebSession.CLIENT_VALUE = "gullak-web"`; `WebTokens(String accessToken, long expiresIn)`. Endpoint contract: `POST /api/v1/auth/otp/verify` with the header → `{accessToken, expiresIn}` plus `Set-Cookie`; `POST /api/v1/auth/refresh` and `/logout` accept no body (cookie plus header) or `{refreshToken}` (phones, unchanged).

- [ ] **Step 1: Check the contracts**

Open `AuthController.java`, `TokenService.java`, `TokenPair.java` and `ErrorCode.java`. Confirm `TokenService` still has `issue`, `refresh` and `logout` with Plan 1's signatures and that `TokenPair` is `(accessToken, refreshToken, expiresIn)`. Later plans may have appended codes to `ErrorCode` and edited `AuthController` (Plan 8 handles locked accounts in `OtpService`, not here); keep everything they added.

- [ ] **Step 2: Write the failing test**

`server/src/test/java/in/gullak/auth/WebSessionApiTest.java`:

```java
package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** Spec 4.7: on the web the refresh token is an httpOnly cookie and refresh needs a custom header. */
class WebSessionApiTest extends ApiTest {
    private static final String COOKIE = "__Host-gullak_rt";
    private static final String HEADER = "X-Requested-With";
    private static final String WEB = "gullak-web";

    @Test
    void webSignInSetsTheRefreshCookieAndKeepsItOutOfTheBody() throws Exception { // API-AUTH-23, SEC-06
        MvcResult r = webVerify(uniqueEmail());
        assertThat(r.getResponse().getStatus()).isEqualTo(200);
        String body = r.getResponse().getContentAsString();
        assertThat(body).contains("\"accessToken\"").contains("\"expiresIn\":900").doesNotContain("refreshToken");
        String setCookie = r.getResponse().getHeader(HttpHeaders.SET_COOKIE);
        assertThat(setCookie)
            .startsWith(COOKIE + "=")
            .contains("Path=/;")
            .contains("Max-Age=2592000")
            .contains("Secure")
            .contains("HttpOnly")
            .contains("SameSite=Strict")
            .doesNotContainIgnoringCase("Domain=");
        assertThat(cookieValue(r)).hasSize(43); // 32 random bytes, base64url without padding
    }

    @Test
    void phoneSignInIsUnchanged() throws Exception {
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip);
        verifyCode(email, mailer.lastCodeFor(email), ip)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.refreshToken").isString())
            .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
    }

    @Test
    void webRefreshRotatesTheCookieAndKeepsReuseDetection() throws Exception { // API-AUTH-24
        String first = cookieValue(webVerify(uniqueEmail()));
        MvcResult refreshed = webRefresh(first)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.accessToken").isString())
            .andExpect(jsonPath("$.refreshToken").doesNotExist())
            .andReturn();
        String second = cookieValue(refreshed);
        assertThat(second).isNotEqualTo(first);
        webRefresh(first).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("TOKEN_REUSED"));
        webRefresh(second).andExpect(status().isUnauthorized());
    }

    @Test
    void refreshWithTheCookieButNoHeaderIsCsrf() throws Exception { // API-AUTH-16
        String cookie = cookieValue(webVerify(uniqueEmail()));
        mvc.perform(post("/api/v1/auth/refresh").cookie(new Cookie(COOKIE, cookie)))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("CSRF"))
            .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
        webRefresh(cookie).andExpect(status().isOk()); // the refused request did not spend it
    }

    @Test
    void aWrongHeaderValueIsCsrf() throws Exception { // API-AUTH-16
        String cookie = cookieValue(webVerify(uniqueEmail()));
        for (String value : new String[] {"XMLHttpRequest", "GULLAK-WEB", "gullak-web ", ""}) {
            mvc.perform(post("/api/v1/auth/refresh").header(HEADER, value).cookie(new Cookie(COOKIE, cookie)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF"));
        }
        webRefresh(cookie).andExpect(status().isOk());
    }

    @Test
    void webLogoutRevokesAndClearsTheCookie() throws Exception { // API-AUTH-24
        String cookie = cookieValue(webVerify(uniqueEmail()));
        webLogout(true, cookie)
            .andExpect(status().isNoContent())
            .andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString("Max-Age=0")));
        webRefresh(cookie).andExpect(status().isUnauthorized());
    }

    @Test
    void webLogoutWithoutTheHeaderIsCsrfAndSignsNothingOut() throws Exception { // API-AUTH-16
        String cookie = cookieValue(webVerify(uniqueEmail()));
        webLogout(false, cookie).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("CSRF"));
        webRefresh(cookie).andExpect(status().isOk());
    }

    @Test
    void aFailedRefreshClearsTheCookie() throws Exception {
        String cookie = cookieValue(webVerify(uniqueEmail()));
        clock.advance(Duration.ofDays(31));
        webRefresh(cookie)
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("TOKEN_EXPIRED"))
            .andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString("Max-Age=0")));
    }

    @Test
    void duplicateRefreshCookiesAreRefused() throws Exception { // API-AUTH-25, Review Focus
        String real = cookieValue(webVerify(uniqueEmail()));
        String planted = cookieValue(webVerify(uniqueEmail()));
        webRefresh(real, planted)
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
            .andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString("Max-Age=0")));
        webRefresh(real).andExpect(status().isOk());    // neither was spent
        webRefresh(planted).andExpect(status().isOk());
    }

    @Test
    void anOversizedCookieIsRefused() throws Exception {
        webRefresh("a".repeat(101)).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void noBodyAndNoCookieIsUnauthenticated() throws Exception {
        mvc.perform(post("/api/v1/auth/refresh"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
            .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
        mvc.perform(post("/api/v1/auth/logout")).andExpect(status().isNoContent());
    }

    @Test
    void aPhoneBodyTokenWinsOverACookie() throws Exception {
        String phoneRefresh = signIn().refreshToken();
        String webCookie = cookieValue(webVerify(uniqueEmail()));
        mvc.perform(post("/api/v1/auth/refresh").cookie(new Cookie(COOKIE, webCookie))
                .contentType(MediaType.APPLICATION_JSON).content("{\"refreshToken\":\"" + phoneRefresh + "\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.refreshToken").isString())
            .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
        webRefresh(webCookie).andExpect(status().isOk()); // the cookie was not touched
    }

    private MvcResult webVerify(String email) throws Exception {
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip).andExpect(status().isNoContent());
        return mvc.perform(post("/api/v1/auth/otp/verify").with(ip).header(HEADER, WEB)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"code\":\"" + mailer.lastCodeFor(email) + "\",\"device\":\"web\"}"))
            .andReturn();
    }

    private ResultActions webRefresh(String... cookies) throws Exception {
        return mvc.perform(withCookies(post("/api/v1/auth/refresh").header(HEADER, WEB), cookies));
    }

    private ResultActions webLogout(boolean withHeader, String... cookies) throws Exception {
        MockHttpServletRequestBuilder request = post("/api/v1/auth/logout");
        if (withHeader) {
            request.header(HEADER, WEB);
        }
        return mvc.perform(withCookies(request, cookies));
    }

    private static MockHttpServletRequestBuilder withCookies(MockHttpServletRequestBuilder request, String... values) {
        return request.cookie(Arrays.stream(values).map(v -> new Cookie(COOKIE, v)).toArray(Cookie[]::new));
    }

    private static String cookieValue(MvcResult r) {
        String setCookie = r.getResponse().getHeader(HttpHeaders.SET_COOKIE);
        assertThat(setCookie).startsWith(COOKIE + "=");
        return setCookie.substring(COOKIE.length() + 1, setCookie.indexOf(';'));
    }
}
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.auth.WebSessionApiTest'`
Expected: FAIL at runtime (the test only uses MockMvc, so it compiles): the verify body still carries `refreshToken`, there is no `Set-Cookie`, and refresh without a body is 400 `VALIDATION`.

- [ ] **Step 4: Add the error code and the exception**

In `ErrorCode.java`, add as the last constant before `INTERNAL(false);` (keep every code earlier plans appended):

```java
    /** A cookie-authenticated request without the web client's header, or from an origin that is not ours. */
    CSRF(true),
```

`server/src/main/java/in/gullak/common/error/ForbiddenException.java` (if a later plan already created a class with this name and constructor, keep theirs):

```java
package in.gullak.common.error;

import org.springframework.http.HttpStatus;

/** 403 with a specific code: we know who is asking, and this request is still refused. */
public class ForbiddenException extends GullakException {
    public ForbiddenException(ErrorCode code, String message) {
        super(code, HttpStatus.FORBIDDEN, message);
    }
}
```

- [ ] **Step 5: Write the web session**

`server/src/main/java/in/gullak/auth/WebTokens.java`:

```java
package in.gullak.auth;

/** What the web app receives: the refresh token travels only in the httpOnly cookie, never in a body. */
public record WebTokens(String accessToken, long expiresIn) {}
```

`server/src/main/java/in/gullak/auth/WebSession.java`:

```java
package in.gullak.auth;

import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.ForbiddenException;
import in.gullak.common.error.AuthException;
import in.gullak.common.error.ErrorBody;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

/**
 * The web app's session (spec 4.7). The refresh token lives in an httpOnly, Secure, SameSite=Strict cookie that
 * JavaScript never sees; the access token stays in the page's memory. Every web request carries
 * {@code X-Requested-With: gullak-web}. Refresh and logout by cookie refuse to run without it: a cross-site form
 * cannot add a header, and a cross-site fetch that adds one needs a CORS preflight only our origin passes.
 * Phones never send the header and keep sending the refresh token in the body (Plan 1, unchanged).
 */
@Component
class WebSession {
    /** The __Host- prefix: browsers accept it only Secure, host-only and on Path=/, so a sibling subdomain cannot plant one. */
    static final String COOKIE = "__Host-gullak_rt";
    static final String CLIENT_HEADER = "X-Requested-With";
    static final String CLIENT_VALUE = "gullak-web";
    private static final int MAX_TOKEN_LENGTH = 100;
    private static final String BLOCKED = "That request was blocked";

    private final Duration refreshTtl;

    WebSession(AuthProperties props) {
        this.refreshTtl = props.refreshTtl();
    }

    boolean isWeb(HttpServletRequest request) {
        return CLIENT_VALUE.equals(request.getHeader(CLIENT_HEADER));
    }

    void requireWebClient(HttpServletRequest request) {
        if (!isWeb(request)) {
            throw new ForbiddenException(ErrorCode.CSRF, BLOCKED);
        }
    }

    /** Every refresh cookie the browser sent; normally none or one. */
    List<String> refreshCookies(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return List.of();
        }
        return Arrays.stream(cookies).filter(c -> COOKIE.equals(c.getName())).map(Cookie::getValue).toList();
    }

    /** The one usable token, or null when several arrived (one was planted) or the value cannot be a token. */
    String singleToken(List<String> values) {
        if (values.size() != 1) {
            return null;
        }
        String value = values.get(0);
        return value != null && !value.isBlank() && value.length() <= MAX_TOKEN_LENGTH ? value : null;
    }

    /** 200 with the access token in the body and the refresh token only in the cookie. */
    ResponseEntity<WebTokens> issue(TokenPair pair) {
        return ResponseEntity.ok()
            .header(HttpHeaders.SET_COOKIE, cookie(pair.refreshToken(), refreshTtl).toString())
            .body(new WebTokens(pair.accessToken(), pair.expiresIn()));
    }

    /**
     * The refusal in the standard error shape, with the dead cookie cleared. Built here rather than thrown, so the
     * Set-Cookie header cannot be lost when the exception handler writes the response.
     */
    ResponseEntity<ErrorBody> refuse(AuthException e) {
        return ResponseEntity.status(e.status())
            .header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString())
            .body(ErrorBody.of(e.code(), e.getMessage()));
    }

    void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
    }

    private static ResponseCookie cookie(String value, Duration maxAge) {
        return ResponseCookie.from(COOKIE, value)
            .httpOnly(true)
            .secure(true)
            .sameSite("Strict")
            .path("/")
            .maxAge(maxAge)
            .build();
    }
}
```

- [ ] **Step 6: Wire it into the controller**

`server/src/main/java/in/gullak/auth/AuthController.java` (whole file; if a later plan added an endpoint here, keep it):

```java
package in.gullak.auth;

import in.gullak.common.error.AuthException;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.web.SingleLineText;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
class AuthController {
    private static final String SIGN_IN = "Sign in to continue";

    record OtpRequest(@NotBlank @Email @Size(max = 254) String email) {}

    record OtpVerify(
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Pattern(regexp = "\\d{6}") String code,
        @Size(max = 60) @SingleLineText String device) {}

    /** Phones send the token; the web sends no body and the cookie instead. */
    record RefreshRequest(@Size(max = 100) String refreshToken) {
        boolean hasToken() {
            return refreshToken != null && !refreshToken.isBlank();
        }
    }

    private final OtpService otp;
    private final TokenService tokens;
    private final WebSession web;

    AuthController(OtpService otp, TokenService tokens, WebSession web) {
        this.otp = otp;
        this.tokens = tokens;
        this.web = web;
    }

    @PostMapping("/otp/request")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void request(@Valid @RequestBody OtpRequest body, HttpServletRequest http) {
        otp.request(body.email(), http.getRemoteAddr());
    }

    /** Phones get {@link TokenPair}; the web gets {@link WebTokens} and the refresh cookie. */
    @PostMapping("/otp/verify")
    ResponseEntity<?> verify(@Valid @RequestBody OtpVerify body, HttpServletRequest http) {
        TokenPair pair = tokens.issue(otp.verify(body.email(), body.code(), http.getRemoteAddr()), body.device());
        return web.isWeb(http) ? web.issue(pair) : ResponseEntity.ok(pair);
    }

    @PostMapping("/refresh")
    ResponseEntity<?> refresh(@Valid @RequestBody(required = false) RefreshRequest body, HttpServletRequest http) {
        if (body != null && body.hasToken()) {
            return ResponseEntity.ok(tokens.refresh(body.refreshToken()));
        }
        List<String> cookies = web.refreshCookies(http);
        if (cookies.isEmpty()) {
            throw new AuthException(ErrorCode.UNAUTHENTICATED, SIGN_IN);
        }
        web.requireWebClient(http); // before the token is looked at, so a forged request spends nothing
        String token = web.singleToken(cookies);
        if (token == null) {
            return web.refuse(new AuthException(ErrorCode.UNAUTHENTICATED, SIGN_IN));
        }
        try {
            return web.issue(tokens.refresh(token));
        } catch (AuthException e) {
            // A dead cookie is useless; clear it so the next page load shows sign-in at once. TokenService has
            // already logged a reuse at WARN; expiry and revocation are ordinary.
            return web.refuse(e);
        }
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void logout(@Valid @RequestBody(required = false) RefreshRequest body, HttpServletRequest http,
                HttpServletResponse response) {
        if (body != null && body.hasToken()) {
            tokens.logout(body.refreshToken());
            return;
        }
        List<String> cookies = web.refreshCookies(http);
        if (cookies.isEmpty()) {
            return;
        }
        web.requireWebClient(http);
        String token = web.singleToken(cookies);
        if (token != null) {
            tokens.logout(token);
        }
        web.clear(response);
    }
}
```

- [ ] **Step 7: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.auth.*'`
Expected: PASS, including Plan 1's `TokenApiTest` (phone contract unchanged). If a Plan 1 test expected 400 for a refresh or logout with an empty token, change its expectation to 401 `UNAUTHENTICATED` (refresh) or 204 (logout) and say so in the task report: the body is optional now (decision table).

Then the whole suite: `cd server && ./gradlew test` → PASS. Then regenerate the app's codes: `cd app && npm run gen:errors` (the app's `messages` map gets `CSRF` in Task 4; until then `npm run typecheck` fails, so commit the generated file together with Task 4, not here).

- [ ] **Step 8: Red team**

Dispatch `red-team` with task id `plan-09-task-1` and the attack list in this task's header. Findings go to `docs/reports/red-team/plan-09-task-1.md`; a High or Critical finding is fixed in this task with a test in `WebSessionApiTest`.

- [ ] **Step 9: Commit**

```bash
git add server/src/main/java/in/gullak/common/error/ErrorCode.java server/src/main/java/in/gullak/common/error/ForbiddenException.java server/src/main/java/in/gullak/auth/WebSession.java server/src/main/java/in/gullak/auth/WebTokens.java server/src/main/java/in/gullak/auth/AuthController.java server/src/test/java/in/gullak/auth/WebSessionApiTest.java docs/reports/red-team/plan-09-task-1.md
git commit -m "feat(server): web session with an httpOnly refresh cookie and the CSRF header

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Server: security headers on every response, CORS to the web origin

**Owner:** backend-engineer. **Test IDs:** SEC-04 (API half), SEC-05; Review Focus `lookAlikeOriginsAreRefused`; Plan 1's deferred "headers on the 413". **Red team:** yes: origins `null`, look-alikes, mixed case, trailing slash, preflights asking for unlisted headers or methods, a simple cross-site `POST` with `text/plain`, framing any API response, and whether any response (401 from the security chain, 404, 405, 413, 500) misses a header.

**Files:**
- Create: `server/src/main/java/in/gullak/common/web/SecurityHeadersFilter.java`, `server/src/main/java/in/gullak/common/web/WebOrigins.java`, `server/src/main/java/in/gullak/common/web/Cors.java`, `server/src/main/java/in/gullak/common/web/JsonRejectingCorsProcessor.java`
- Modify: `server/src/main/java/in/gullak/common/config/SecurityConfig.java`, `server/src/main/resources/application.yml`, `server/src/main/resources/application-local.yml`, `server/src/test/resources/application-test.yml`
- Test: `server/src/test/java/in/gullak/security/SecurityHeadersApiTest.java`, `server/src/test/java/in/gullak/security/CorsApiTest.java`, `server/src/test/java/in/gullak/common/web/WebOriginsTest.java`

**Interfaces:**
- Consumes: `ErrorCode.CSRF` (Task 1); `SecurityConfig.api(...)`; `BodyLimitFilter` (order `HIGHEST_PRECEDENCE + 10`).
- Produces: `SecurityHeadersFilter.CSP`, `SecurityHeadersFilter.HSTS`; `WebOrigins.list() : List<String>`; `Cors.filter(List<String>) : CorsFilter`; setting `gullak.web.origins` from `GULLAK_WEB_ORIGIN` (comma-separated); `prod` refuses to start without an https origin.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/test/resources/application-test.yml` under the existing `gullak:` key:

```yaml
  web:
    origins: http://localhost:8088
```

`server/src/test/java/in/gullak/security/SecurityHeadersApiTest.java`:

```java
package in.gullak.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.ResultActions;

/** SEC-04, API half: every response carries the headers, including ones written before Spring Security runs. */
class SecurityHeadersApiTest extends ApiTest {

    private static void assertHeaders(MockHttpServletResponse r) {
        assertThat(r.getHeader("Content-Security-Policy")).contains("default-src 'none'").contains("frame-ancestors 'none'");
        assertThat(r.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(r.getHeader("X-Frame-Options")).isEqualTo("DENY");
        assertThat(r.getHeader("Referrer-Policy")).isEqualTo("no-referrer");
        assertThat(r.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(r.getHeaders("X-Content-Type-Options")).hasSize(1);
        assertThat(r.getHeaders("X-Frame-Options")).hasSize(1);
    }

    private MockHttpServletResponse run(ResultActions actions) throws Exception {
        return actions.andReturn().getResponse();
    }

    @Test
    void healthCarriesTheHeaders() throws Exception {
        assertHeaders(run(mvc.perform(get("/actuator/health")).andExpect(status().isOk())));
    }

    @Test
    void anUnauthenticatedCallCarriesTheHeaders() throws Exception {
        assertHeaders(run(mvc.perform(get("/api/v1/budget/today")).andExpect(status().isUnauthorized())));
    }

    @Test
    void notFoundAndWrongMethodCarryTheHeaders() throws Exception {
        TestUser u = signIn();
        assertHeaders(run(mvc.perform(get("/api/v1/nothing-here").with(auth(u))).andExpect(status().isNotFound())));
        assertHeaders(run(mvc.perform(post("/api/v1/budget/today").with(auth(u))).andExpect(status().isMethodNotAllowed())));
    }

    @Test
    void oversizedBodyStillCarriesTheHeaders() throws Exception { // deferred from Plan 1
        byte[] big = new byte[1024 * 1024];
        assertHeaders(run(mvc.perform(post("/api/v1/auth/otp/request").contentType(MediaType.APPLICATION_JSON).content(big))
            .andExpect(status().isPayloadTooLarge())
            .andExpect(jsonPath("$.code").value("TOO_LARGE"))));
    }

    @Test
    void hstsOnlyOverHttps() throws Exception {
        MockHttpServletResponse secure = run(mvc.perform(get("/actuator/health").secure(true)));
        assertThat(secure.getHeader("Strict-Transport-Security")).isEqualTo("max-age=31536000; includeSubDomains");
        MockHttpServletResponse plain = run(mvc.perform(get("/actuator/health")));
        assertThat(plain.getHeader("Strict-Transport-Security")).isNull();
    }
}
```

`server/src/test/java/in/gullak/security/CorsApiTest.java`:

```java
package in.gullak.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsStringIgnoringCase;

import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/** SEC-05: only the app's web origin gets CORS headers; anything else is refused before it runs. */
class CorsApiTest extends ApiTest {
    private static final String APP = "http://localhost:8088";

    @Test
    void preflightFromTheAppOriginIsAllowed() throws Exception {
        mvc.perform(options("/api/v1/budget/today")
                .header("Origin", APP)
                .header("Access-Control-Request-Method", "GET")
                .header("Access-Control-Request-Headers", "authorization,x-requested-with,x-request-id"))
            .andExpect(status().isOk())
            .andExpect(header().string("Access-Control-Allow-Origin", APP))
            .andExpect(header().string("Access-Control-Allow-Credentials", "true"))
            .andExpect(header().string("Access-Control-Allow-Headers", containsStringIgnoringCase("x-requested-with")));
    }

    @Test
    void theAppOriginCanReadAnErrorBody() throws Exception {
        mvc.perform(get("/api/v1/budget/today").header("Origin", APP))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("Access-Control-Allow-Origin", APP))
            .andExpect(header().string("Access-Control-Expose-Headers", containsStringIgnoringCase("x-request-id")));
    }

    @Test
    void preflightFromAnUnlistedOriginIsRefused() throws Exception {
        mvc.perform(options("/api/v1/auth/refresh")
                .header("Origin", "https://evil.example")
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "x-requested-with"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("CSRF"))
            .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void aSimpleCrossSitePostIsRefusedBeforeItRuns() throws Exception {
        String email = uniqueEmail();
        mvc.perform(post("/api/v1/auth/otp/request").with(freshIp())
                .header("Origin", "https://evil.example")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("CSRF"))
            .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        long codes = jdbc.sql("select count(*) from otp_codes where email = ?").param(email).query(Long.class).single();
        assertThat(codes).isZero();
    }

    @Test
    void lookAlikeOriginsAreRefused() throws Exception { // Review Focus
        // Browsers always send origins lower-case without a trailing slash, so those spellings are not attacks.
        for (String origin : new String[] {
                "http://localhost:8088.evil.test", "http://localhost:8089", "https://localhost:8088",
                "http://evil.localhost:8088", "null"}) {
            mvc.perform(get("/api/v1/budget/today").header("Origin", origin))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        }
    }

    @Test
    void aSameOriginRequestIsNotTreatedAsCrossOrigin() throws Exception {
        // MockMvc requests are http://localhost:80; an Origin equal to that is same-origin, as in production
        // where the web app and the API share one origin. It reaches the API (401), not the CORS refusal (403).
        mvc.perform(get("/api/v1/budget/today").header("Origin", "http://localhost"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void phonesSendNoOriginAndAreUnaffected() throws Exception {
        mvc.perform(post("/api/v1/auth/otp/request").with(freshIp())
                .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + uniqueEmail() + "\"}"))
            .andExpect(status().isNoContent())
            .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }
}
```

`server/src/test/java/in/gullak/common/web/WebOriginsTest.java`:

```java
package in.gullak.common.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class WebOriginsTest {
    private static MockEnvironment env(String... profiles) {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles(profiles);
        return env;
    }

    @Test
    void parsesACommaSeparatedList() {
        assertThat(new WebOrigins(" https://app.gullak.in , http://localhost:8081 ", env("local")).list())
            .containsExactly("https://app.gullak.in", "http://localhost:8081");
    }

    @Test
    void emptyIsAllowedOutsideProd() {
        assertThat(new WebOrigins("", env("local")).list()).isEmpty();
    }

    @Test
    void prodWithoutAnOriginRefusesToStart() {
        assertThatThrownBy(() -> new WebOrigins("", env("prod")))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("GULLAK_WEB_ORIGIN");
    }

    @Test
    void prodRefusesPlainHttp() {
        assertThatThrownBy(() -> new WebOrigins("http://app.gullak.in", env("prod")))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("https");
    }

    @Test
    void anythingThatIsNotAnOriginRefusesToStart() {
        for (String bad : new String[] {"*", "https://app.gullak.in/", "https://App.Gullak.in", "app.gullak.in",
                "https://app.gullak.in/path", "null"}) {
            assertThatThrownBy(() -> new WebOrigins(bad, env("local")))
                .as(bad).isInstanceOf(IllegalStateException.class);
        }
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.security.SecurityHeadersApiTest' --tests 'in.gullak.security.CorsApiTest' --tests 'in.gullak.common.web.WebOriginsTest'`
Expected: FAIL (compile error: `WebOrigins` does not exist).

- [ ] **Step 3: The headers filter**

`server/src/main/java/in/gullak/common/web/SecurityHeadersFilter.java`:

```java
package in.gullak.common.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Security headers on every response (spec 4.7, SEC-04). Written before anything else runs, so responses produced
 * outside Spring Security, such as BodyLimitFilter's 413, carry them too. Spring Security's header writer is off
 * (SecurityConfig), so each header appears once. The API serves JSON plus Plan 8's one-button restore page, so the
 * policy allows inline styles and same-origin form posts and nothing else.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class SecurityHeadersFilter extends OncePerRequestFilter {
    static final String CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; "
        + "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
    static final String HSTS = "max-age=31536000; includeSubDomains";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("Content-Security-Policy", CSP);
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
        response.setHeader("Cache-Control", "no-store");
        // Behind the load balancer isSecure() follows X-Forwarded-Proto from a trusted proxy (GULLAK_TRUSTED_PROXIES).
        if (request.isSecure()) {
            response.setHeader("Strict-Transport-Security", HSTS);
        }
        chain.doFilter(request, response);
    }

    /** Error dispatches write their own body; they still need the headers. */
    @Override
    protected boolean shouldNotFilterErrorDispatch() {
        return false;
    }
}
```

- [ ] **Step 4: Origins and the CORS filter**

`server/src/main/java/in/gullak/common/web/WebOrigins.java`:

```java
package in.gullak.common.web;

import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * The browser origins allowed to call the API with credentials (spec 4.7: CORS restricted to the app's web origin).
 * Each entry must be exactly scheme://host[:port] in lower case, because CORS compares origins as strings: a typo
 * would silently lock the web app out, so it fails startup instead. Production needs at least one https origin.
 */
@Component
public class WebOrigins {
    private static final Pattern ORIGIN = Pattern.compile("https?://[a-z0-9.-]+(:[0-9]{1,5})?");

    private final List<String> origins;

    public WebOrigins(@Value("${gullak.web.origins:}") String raw, Environment env) {
        this.origins = Arrays.stream(raw == null ? new String[0] : raw.split(","))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .toList();
        boolean prod = env.acceptsProfiles(Profiles.of("prod"));
        if (prod && origins.isEmpty()) {
            throw new IllegalStateException("GULLAK_WEB_ORIGIN must be set in prod to the web app's origin, "
                + "for example https://app.gullak.in. Without it the web app cannot call the API.");
        }
        for (String origin : origins) {
            if (!ORIGIN.matcher(origin).matches()) {
                throw new IllegalStateException("GULLAK_WEB_ORIGIN entries must look like https://host or "
                    + "https://host:port, in lower case, with no path or trailing slash: " + origin);
            }
            if (prod && !origin.startsWith("https://")) {
                throw new IllegalStateException("GULLAK_WEB_ORIGIN must use https in prod: " + origin);
            }
        }
    }

    public List<String> list() {
        return origins;
    }
}
```

`server/src/main/java/in/gullak/common/web/JsonRejectingCorsProcessor.java`:

```java
package in.gullak.common.web;

import in.gullak.common.error.ErrorCode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.cors.DefaultCorsProcessor;

/** A refused cross-origin request answers 403 CSRF in the standard error shape (API-X-02), not Spring's plain text. */
final class JsonRejectingCorsProcessor extends DefaultCorsProcessor {
    private static final Logger log = LoggerFactory.getLogger(JsonRejectingCorsProcessor.class);
    private static final byte[] BODY = ("{\"code\":\"" + ErrorCode.CSRF.name()
        + "\",\"message\":\"That request was blocked\"}").getBytes(StandardCharsets.UTF_8);

    @Override
    protected void rejectRequest(ServerHttpResponse response) throws IOException {
        log.warn("cors.rejected"); // the Origin value is attacker-controlled text: never logged
        response.setStatusCode(HttpStatus.FORBIDDEN);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        response.getBody().write(BODY);
        response.flush();
    }
}
```

`server/src/main/java/in/gullak/common/web/Cors.java`:

```java
package in.gullak.common.web;

import java.time.Duration;
import java.util.List;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

/** CORS for /api/** only: exact origins, credentials allowed (the refresh cookie), no wildcard anywhere. */
public final class Cors {
    private Cors() {}

    public static CorsFilter filter(List<String> origins) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(origins);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "X-Request-Id", "X-Requested-With"));
        config.setExposedHeaders(List.of("X-Request-Id"));
        config.setAllowCredentials(true);
        config.setMaxAge(Duration.ofMinutes(10));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        CorsFilter filter = new CorsFilter(source);
        filter.setCorsProcessor(new JsonRejectingCorsProcessor());
        return filter;
    }
}
```

- [ ] **Step 5: Wire them into the security chain**

In `SecurityConfig.java`, change the `api` bean's signature to take `WebOrigins origins` and add the three marked lines to the chain (add the imports `in.gullak.common.web.Cors` and `in.gullak.common.web.WebOrigins`; keep every filter or rule a later plan added, such as Plan 8's `AccountStateFilter`):

```java
    @Bean
    SecurityFilterChain api(HttpSecurity http, JsonAuthHandlers handlers, WebOrigins origins) throws Exception {
        // CSRF: no endpoint authenticates by cookie except refresh and logout, which demand the web client's
        // header (WebSession, API-AUTH-16). Everything else is bearer-only, which a browser never attaches by itself.
        http.csrf(c -> c.disable())
            .cors(c -> c.disable())                 // our own CorsFilter below answers refusals in the JSON shape
            .headers(h -> h.disable())              // SecurityHeadersFilter writes them for every response
            .httpBasic(b -> b.disable())
            .formLogin(f -> f.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers(HttpMethod.GET, "/actuator/health").permitAll()
                .requestMatchers("/actuator/**").permitAll()
                .requestMatchers(PUBLIC_AUTH).permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o
                .bearerTokenResolver(bearerTokens())
                .jwt(Customizer.withDefaults())
                .authenticationEntryPoint(handlers))
            .exceptionHandling(e -> e.authenticationEntryPoint(handlers).accessDeniedHandler(handlers))
            .addFilterBefore(Cors.filter(origins.list()), BearerTokenAuthenticationFilter.class)
            .addFilterAfter(new UserMdcFilter(), BearerTokenAuthenticationFilter.class);
        return http.build();
    }
```

(If later plans changed the `authorizeHttpRequests` rules, keep theirs; only the `.cors`, `.headers` and `addFilterBefore(Cors.filter...)` lines and the new parameter are this task's change.)

In `server/src/main/resources/application.yml`, add under `gullak:`:

```yaml
  web:
    # Browser origins allowed to call the API with credentials, comma-separated, exactly scheme://host[:port].
    origins: ${GULLAK_WEB_ORIGIN:}
```

In `server/src/main/resources/application-local.yml`, add:

```yaml
gullak:
  web:
    # Expo's web dev server; the Playwright run sets GULLAK_WEB_ORIGIN=http://localhost:8088.
    origins: ${GULLAK_WEB_ORIGIN:http://localhost:8081}
```

- [ ] **Step 6: Run the tests**

Run: `cd server && ./gradlew test`
Expected: PASS. `TrustedProxiesCheckTest` and any other `ApplicationContextRunner` test that loads `SecurityConfig` without `WebOrigins` must add `WebOrigins.class` to its user configuration; none does today.

- [ ] **Step 7: Red team**

Dispatch `red-team` with task id `plan-09-task-2` on the attack list in this task's header, using `curl` against the server started with `--spring.profiles.active=local` and `GULLAK_WEB_ORIGIN=http://localhost:8088`. Findings to `docs/reports/red-team/plan-09-task-2.md`.

- [ ] **Step 8: Commit**

```bash
git add server/src/main/java/in/gullak/common/web server/src/main/java/in/gullak/common/config/SecurityConfig.java server/src/main/resources/application.yml server/src/main/resources/application-local.yml server/src/test/resources/application-test.yml server/src/test/java/in/gullak/security/SecurityHeadersApiTest.java server/src/test/java/in/gullak/security/CorsApiTest.java server/src/test/java/in/gullak/common/web/WebOriginsTest.java docs/reports/red-team/plan-09-task-2.md
git commit -m "feat(server): security headers on every response, CORS limited to the web origin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server: bounded rate limiter, configurable per-IP limit, account enumeration

**Owner:** backend-engineer. **Test IDs:** SEC-12, new SEC-17 (row added in Task 11); Review Focus `floodingKeysDoesNotResetALimitedKey`. **Red team:** yes: flood the OTP routes with random emails from many spoofed and real addresses and watch the heap; time known against unknown emails; check the new WARN line carries no IP or email.

**Files:**
- Modify: `server/build.gradle.kts`, `server/src/main/java/in/gullak/common/web/RateLimiter.java`, `server/src/main/java/in/gullak/auth/AuthProperties.java`, `server/src/main/java/in/gullak/auth/OtpService.java`, `server/src/main/resources/application.yml`
- Test: `server/src/test/java/in/gullak/common/web/RateLimiterTest.java`, `server/src/test/java/in/gullak/auth/OtpIpLimitApiTest.java`, `server/src/test/java/in/gullak/security/AccountEnumerationApiTest.java`

**Interfaces:**
- Consumes: `RateLimiter.check(String key, int limit, Duration window)` callers in every plan (unchanged signature); `RateLimitedException` (Plan 8 may have added a message constructor; the no-argument one is used here).
- Produces: `RateLimiter(Clock)`, `RateLimiter(Clock, long maxKeys)`, `RateLimiter.trackedKeys() : long` (package-private, for tests); `AuthProperties.ipLimit()`; settings `gullak.auth.ip-limit` (`GULLAK_OTP_IP_LIMIT`, default 30) and `gullak.http.rate-limit-keys` (default 100000); WARN line `rate.limited kind=<prefix>`.

- [ ] **Step 1: Write the failing tests**

`server/src/test/java/in/gullak/common/web/RateLimiterTest.java`:

```java
package in.gullak.common.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import in.gullak.common.error.RateLimitedException;
import in.gullak.support.MutableClock;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class RateLimiterTest {
    private static final Duration TEN_MINUTES = Duration.ofMinutes(10);
    private final MutableClock clock = new MutableClock();

    @Test
    void theLimitHoldsInsideTheWindow() {
        RateLimiter limiter = new RateLimiter(clock);
        for (int i = 0; i < 3; i++) {
            limiter.check("otp-request-email:a@example.test", 3, TEN_MINUTES);
        }
        assertThatThrownBy(() -> limiter.check("otp-request-email:a@example.test", 3, TEN_MINUTES))
            .isInstanceOf(RateLimitedException.class);
    }

    @Test
    void aNewWindowStartsWhenTheOldOneEnds() {
        RateLimiter limiter = new RateLimiter(clock);
        for (int i = 0; i < 3; i++) {
            limiter.check("k:a", 3, TEN_MINUTES);
        }
        clock.advance(TEN_MINUTES);
        limiter.check("k:a", 3, TEN_MINUTES);
    }

    @Test
    void memoryStaysBoundedUnderAKeyFlood() { // SEC-17
        RateLimiter limiter = new RateLimiter(clock, 1_000);
        for (int i = 0; i < 50_000; i++) {
            limiter.check("otp-request-email:flood-" + i + "@example.test", 5, TEN_MINUTES);
        }
        assertThat(limiter.trackedKeys()).isLessThanOrEqualTo(1_000);
    }

    @Test
    void finishedWindowsAreDropped() {
        RateLimiter limiter = new RateLimiter(clock, 1_000);
        for (int i = 0; i < 100; i++) {
            limiter.check("k:" + i, 5, Duration.ofMinutes(1));
        }
        clock.advance(Duration.ofMinutes(2));
        assertThat(limiter.trackedKeys()).isZero();
    }

    @Test
    void floodingKeysDoesNotResetALimitedKey() { // Review Focus, SEC-17
        RateLimiter limiter = new RateLimiter(clock, 1_000);
        String victim = "otp-verify-email:victim@example.test";
        for (int i = 0; i < 5; i++) {
            limiter.check(victim, 5, Duration.ofMinutes(15));
        }
        for (int i = 0; i < 20_000; i++) {
            limiter.check("otp-request-email:flood-" + i + "@example.test", 5, Duration.ofMinutes(15));
        }
        assertThatThrownBy(() -> limiter.check(victim, 5, Duration.ofMinutes(15))).isInstanceOf(RateLimitedException.class);
    }
}
```

`server/src/test/java/in/gullak/auth/OtpIpLimitApiTest.java`:

```java
package in.gullak.auth;

import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** Carrier-grade NAT puts many people behind one IP; the per-IP limit is a setting, not a constant. */
@TestPropertySource(properties = "gullak.auth.ip-limit=3")
class OtpIpLimitApiTest extends ApiTest {

    @Test
    void thePerIpLimitIsConfigurable() throws Exception {
        RequestPostProcessor ip = freshIp();
        for (int i = 0; i < 3; i++) {
            requestCode(uniqueEmail(), ip).andExpect(status().isNoContent());
        }
        requestCode(uniqueEmail(), ip)
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.code").value("RATE_LIMITED"));
    }
}
```

`server/src/test/java/in/gullak/security/AccountEnumerationApiTest.java`:

```java
package in.gullak.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import in.gullak.support.ApiTest;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;

/** SEC-12: an OTP request for a known and an unknown email has the same status, body and response-time class. */
class AccountEnumerationApiTest extends ApiTest {

    private record Sample(int status, String body, String contentType, long nanos) {}

    private Sample request(String email) throws Exception {
        long start = System.nanoTime();
        MockHttpServletResponse r = mvc.perform(post("/api/v1/auth/otp/request").with(freshIp())
                .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\"}"))
            .andReturn().getResponse();
        return new Sample(r.getStatus(), r.getContentAsString(), r.getContentType(), System.nanoTime() - start);
    }

    private static long median(List<Sample> samples) {
        return samples.stream().mapToLong(Sample::nanos).sorted().toArray()[samples.size() / 2];
    }

    @Test
    void knownAndUnknownEmailsLookTheSame() throws Exception {
        List<String> known = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            known.add(signIn().email()); // signIn spends one of the five requests per email
        }
        for (int i = 0; i < 5; i++) {
            request(uniqueEmail()); // warm-up: JIT and connection pool
        }
        List<Sample> knownSamples = new ArrayList<>();
        List<Sample> unknownSamples = new ArrayList<>();
        for (int round = 0; round < 3; round++) {
            for (String email : known) {
                knownSamples.add(request(email));
                unknownSamples.add(request(uniqueEmail()));
            }
        }
        Sample k = knownSamples.get(0);
        for (Sample s : knownSamples) {
            assertThat(s.status()).isEqualTo(204);
        }
        for (Sample s : unknownSamples) {
            assertThat(s.status()).isEqualTo(k.status());
            assertThat(s.body()).isEqualTo(k.body());
            assertThat(s.contentType()).isEqualTo(k.contentType());
        }
        long a = median(knownSamples);
        long b = median(unknownSamples);
        long allowed = Math.max(20_000_000L, Math.min(a, b) / 2); // 20 ms or half the faster median
        assertThat(Math.abs(a - b)).as("median ns known=%d unknown=%d", a, b).isLessThanOrEqualTo(allowed);
    }

    @Test
    void aWrongCodeLooksTheSameForKnownAndUnknownEmails() throws Exception {
        String known = signIn().email();
        requestCode(known, freshIp());
        String knownBody = verifyCode(known, "000000", freshIp()).andReturn().getResponse().getContentAsString();
        String unknownBody = verifyCode(uniqueEmail(), "000000", freshIp()).andReturn().getResponse().getContentAsString();
        assertThat(unknownBody).isEqualTo(knownBody).contains("OTP_INVALID");
    }
}
```

Note for the executor: `aWrongCodeLooksTheSameForKnownAndUnknownEmails` assumes the live code for `known` is not `000000`; the chance is one in a million per run. If it ever fails on that, the failure message shows `200` and the run is simply repeated.

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.web.RateLimiterTest' --tests 'in.gullak.auth.OtpIpLimitApiTest' --tests 'in.gullak.security.AccountEnumerationApiTest'`
Expected: FAIL: `RateLimiter(Clock, long)` and `trackedKeys()` do not exist; the IP limit ignores the property. `AccountEnumerationApiTest` may already pass (the request path never looks up users): that is the point of SEC-12 and it now guards it.

- [ ] **Step 3: Add Caffeine**

In `server/build.gradle.kts` `dependencies { }` add (version managed by the Spring Boot BOM):

```kotlin
	implementation("com.github.ben-manes.caffeine:caffeine")
```

- [ ] **Step 4: Bound the limiter**

`server/src/main/java/in/gullak/common/web/RateLimiter.java` (whole file; if a later plan added a method, keep it and adapt it to the cache):

```java
package in.gullak.common.web;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Expiry;
import in.gullak.common.error.RateLimitedException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Fixed-window limiter in memory, bounded: at most {@code maxKeys} windows are kept (W-TinyLFU eviction keeps the
 * keys that are hit often, so a flood of new keys cannot push out one that is being limited) and each window is
 * dropped when it ends. Correct for one server instance; production runs one (release checklist).
 */
@Component
public class RateLimiter {
    static final long DEFAULT_MAX_KEYS = 100_000;
    private static final Logger log = LoggerFactory.getLogger(RateLimiter.class);

    private record Window(Instant start, Duration length, int count) {
        Instant end() {
            return start.plus(length);
        }
    }

    private final Clock clock;
    private final Cache<String, Window> windows;

    public RateLimiter(Clock clock) {
        this(clock, DEFAULT_MAX_KEYS);
    }

    @Autowired
    public RateLimiter(Clock clock, @Value("${gullak.http.rate-limit-keys:100000}") long maxKeys) {
        this.clock = clock;
        this.windows = Caffeine.newBuilder()
            .maximumSize(maxKeys)
            .executor(Runnable::run) // maintenance on the caller's thread: bounded and deterministic
            .ticker(() -> TimeUnit.MILLISECONDS.toNanos(clock.millis()))
            .expireAfter(new Expiry<String, Window>() {
                @Override
                public long expireAfterCreate(String key, Window w, long now) {
                    return remaining(w);
                }

                @Override
                public long expireAfterUpdate(String key, Window w, long now, long currentDuration) {
                    return remaining(w);
                }

                @Override
                public long expireAfterRead(String key, Window w, long now, long currentDuration) {
                    return currentDuration;
                }
            })
            .build();
    }

    private long remaining(Window w) {
        return Math.max(1, Duration.between(clock.instant(), w.end()).toNanos());
    }

    public void check(String key, int limit, Duration window) {
        Instant now = clock.instant();
        Window w = windows.asMap().compute(key, (k, old) ->
            old == null || !now.isBefore(old.end())
                ? new Window(now, window, 1)
                : new Window(old.start(), old.length(), old.count() + 1));
        if (w.count() > limit) {
            if (w.count() == limit + 1) {
                // Once per window. The kind (e.g. otp-request-ip) shows whether shared mobile IPs trip the limit;
                // the rest of the key is an IP or an email and is never logged.
                log.warn("rate.limited kind={}", kindOf(key));
            }
            throw new RateLimitedException();
        }
    }

    long trackedKeys() {
        windows.cleanUp();
        return windows.estimatedSize();
    }

    private static String kindOf(String key) {
        int colon = key.indexOf(':');
        return colon > 0 ? key.substring(0, colon) : "other";
    }
}
```

- [ ] **Step 5: Make the per-IP limit a setting**

`server/src/main/java/in/gullak/auth/AuthProperties.java` (whole file):

```java
package in.gullak.auth;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * @param ipLimit OTP requests and checks allowed per client IP per 10 minutes. Mobile carriers share one IP across
 *                many users (carrier-grade NAT); raise it when WARN rate.limited kind=otp-request-ip shows up.
 */
@Validated
@ConfigurationProperties("gullak.auth")
public record AuthProperties(
    @NotNull @Size(min = 32) String jwtSecret,
    @NotNull @Size(min = 32) String otpPepper,
    @NotNull Duration accessTtl,
    @NotNull Duration refreshTtl,
    @NotNull Duration otpTtl,
    @Positive int verifyEmailLimit,
    @NotNull Duration verifyEmailWindow,
    @Positive int ipLimit) {}
```

In `OtpService.java`, replace the two per-IP checks (one in `request`, one in `verify`; everything else in both methods, including later plans' changes, stays):

```java
        limiter.check("otp-request-ip:" + ip, props.ipLimit(), WINDOW);
```

```java
        limiter.check("otp-verify-ip:" + ip, props.ipLimit(), WINDOW);
```

In `server/src/main/resources/application.yml`, under `gullak.auth` add `ip-limit: ${GULLAK_OTP_IP_LIMIT:30}`, and under `gullak.http` add `rate-limit-keys: 100000`.

- [ ] **Step 6: Run the tests**

Run: `cd server && ./gradlew test`
Expected: PASS, including Plan 1's `API-AUTH-05` (31st request from one IP is 429 at the default of 30).

- [ ] **Step 7: Red team**

Dispatch `red-team` with task id `plan-09-task-3` on the attack list in this task's header (heap before and after 200,000 random-email requests from 1,000 `freshIp`-style addresses in a test, or `jcmd <pid> GC.heap_info` against the local server). Findings to `docs/reports/red-team/plan-09-task-3.md`.

- [ ] **Step 8: Commit**

```bash
git add server/build.gradle.kts server/src/main/java/in/gullak/common/web/RateLimiter.java server/src/main/java/in/gullak/auth/AuthProperties.java server/src/main/java/in/gullak/auth/OtpService.java server/src/main/resources/application.yml server/src/test/java/in/gullak/common/web/RateLimiterTest.java server/src/test/java/in/gullak/auth/OtpIpLimitApiTest.java server/src/test/java/in/gullak/security/AccountEnumerationApiTest.java docs/reports/red-team/plan-09-task-3.md
git commit -m "feat(server): bounded rate limiter, configurable per-IP OTP limit, enumeration test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: App: cookie session in the API client, reload resume, tab lock

**Owner:** web-engineer. **Test IDs:** SEC-07, APP-27 (web half), new SEC-18 (row added in Task 11); Review Focus `twoTabsRefreshingAtOnceStayBothSignedIn`. **Red team:** yes: search the web build for any path that writes a token to `localStorage`, `sessionStorage`, `document.cookie`, IndexedDB or the query cache; reload with and without the cookie; sign out in one tab and keep using another; open two tabs and reload both at once.

**Files:**
- Create: `app/src/lib/platform.ts`, `app/src/lib/refresh-lock.ts`, `app/src/lib/refresh-lock.test.ts`, `app/src/lib/query.web.test.ts`
- Modify: `app/src/lib/api.ts` (whole file below), `app/src/lib/api.test.ts` (import line and appended blocks), `app/src/lib/storage.ts` (the `Tokens` type), `app/src/lib/storage.web.ts` (whole file), `app/src/lib/storage.web.test.ts` (whole file), `app/src/lib/client.ts` (the `api` export), `app/src/lib/query.ts` (`shouldPersist`), `app/src/lib/errors.ts` (one line), `app/src/lib/error-codes.ts` (regenerated), `app/src/features/auth/api.ts` (`logout`), `app/src/features/auth/session.tsx` (props and the hydration effect), `app/src/features/auth/session.test.tsx` (appended cases)

**Interfaces:**
- Consumes: Task 1's endpoint contract (header `X-Requested-With: gullak-web`, web bodies without `refreshToken`, cookie refresh and logout with no body); Plan 4's `api.ts` (`postMultipart`, `multipartFetchFn`, `uploadTimeoutMs`, `ApiError#details`), `shouldPersist`.
- Produces: `isWeb` (`@/lib/platform`); `Api#resume(): Promise<boolean>`; `ApiDeps.cookieSession?: boolean`, `ApiDeps.refreshLock?: RefreshLock`; `RefreshLock = <T>(run: () => Promise<T>) => Promise<T>`; `WEB_CLIENT_HEADER`; `makeRefreshLock(locks)`, `webRefreshLock`; `Tokens = { accessToken: string; refreshToken?: string | undefined }`; `SessionProvider` prop `resume?: (() => Promise<boolean>) | undefined`; `authApi.logout(refreshToken?: string)`.

- [ ] **Step 1: Check the contracts**

Open `app/src/lib/api.ts`, `client.ts`, `query.ts`, `storage.ts`, `storage.web.ts` and `features/auth/session.tsx`. The `api.ts` below is Plan 4's version plus this task's changes; if a plan after Plan 4 changed `api.ts`, carry that change into the file below and say so in the task report. In `session.tsx`, find the hydration `useEffect` (the one that calls `store.load()`), the `email` state Plan 2 Task 10 added and any outbox or cache wiping Plans 3 and 8 added to `signOut`; keep all of it.

- [ ] **Step 2: Write the failing tests**

In `app/src/lib/api.test.ts`, change the import of `./api` to:

```ts
import { createApi, type Api, type ApiDeps } from "./api";
```

and append:

```ts
describe("cookie session on the web (spec 4.7)", () => {
  function setupWeb(script: (call: Call, n: number) => FakeResponse | Promise<FakeResponse>, store = memoryStore({ accessToken: "A1" }), extra: Partial<ApiDeps> = {}) {
    const calls: Call[] = [];
    const onSignedOut = jest.fn();
    const fetchFn = jest.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(script({ url, init }, calls.length));
    });
    const api = createApi({ baseUrl: "http://test.local/api/v1", tokens: store, onSignedOut, fetchFn: fetchFn as unknown as typeof fetch, cookieSession: true, ...extra });
    return { api, calls, store, onSignedOut };
  }

  it("sends credentials and the web client header on every call", async () => {
    const { api, calls } = setupWeb(() => json(200, { ok: true }));
    await api.get("/budget/today");
    await api.post("/auth/otp/request", { email: "a@b.c" }, { auth: false });
    for (const c of calls) {
      expect(c.init.credentials).toBe("include");
      expect(header(c, "X-Requested-With")).toBe("gullak-web");
    }
  });

  it("phones send neither", async () => {
    const { api, calls } = setup(() => json(200, { ok: true }));
    await api.get("/budget/today");
    expect(calls[0]?.init.credentials).toBeUndefined();
    expect(header(calls[0]!, "X-Requested-With")).toBeUndefined();
  });

  it("refreshes with no body and keeps only the access token", async () => {
    const { api, calls, store } = setupWeb((call, n) => {
      if (call.url.endsWith("/auth/refresh")) return json(200, { accessToken: "A2", expiresIn: 900 });
      return n === 1 ? json(401, { code: "TOKEN_EXPIRED", message: "x" }) : json(200, { budgetPaise: 1 });
    });
    await expect(api.get("/budget/today")).resolves.toEqual({ budgetPaise: 1 });
    expect(calls[1]?.init.body).toBeUndefined();
    expect(header(calls[2]!, "Authorization")).toBe("Bearer A2");
    expect(store.tokens).toEqual({ accessToken: "A2" });
  });

  it("never keeps a refresh token in JavaScript, even if a server sent one", async () => {
    const { api, store } = setupWeb((call, n) => {
      if (call.url.endsWith("/auth/refresh")) return json(200, { accessToken: "A2", refreshToken: "LEAKED", expiresIn: 900 });
      return n === 1 ? json(401, { code: "TOKEN_EXPIRED", message: "x" }) : json(200, {});
    });
    await api.get("/budget/today");
    expect(JSON.stringify(store.tokens)).not.toContain("LEAKED");
  });

  it("resume trades the cookie for an access token after a reload", async () => {
    const { api, calls, store } = setupWeb(() => json(200, { accessToken: "A9", expiresIn: 900 }), memoryStore(null));
    await expect(api.resume()).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://test.local/api/v1/auth/refresh");
    expect(store.tokens).toEqual({ accessToken: "A9" });
  });

  it("resume without a cookie is simply signed out, with no signed-out event", async () => {
    const { api, onSignedOut } = setupWeb(() => json(401, { code: "UNAUTHENTICATED", message: "x" }), memoryStore(null));
    await expect(api.resume()).resolves.toBe(false);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("resume offline throws NetworkError so the caller can tell offline from signed out", async () => {
    const { api } = setupWeb(() => {
      throw new TypeError("offline");
    }, memoryStore(null));
    await expect(api.resume()).rejects.toBeInstanceOf(NetworkError);
  });

  it("resume with a token in memory makes no call", async () => {
    const { api, calls } = setupWeb(() => json(500, {}));
    await expect(api.resume()).resolves.toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("two tabs (SEC-18)", () => {
  function mutex() {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(run: () => Promise<T>): Promise<T> => {
      const result = tail.then(run);
      tail = result.catch(() => undefined);
      return result;
    };
  }

  /** One cookie jar shared by both tabs, like a browser; the server rotates on refresh and kills the family on reuse. */
  function cookieServer() {
    const jar = { cookie: "C1" };
    let live = "C1";
    let issued = 0;
    let reused = 0;
    const fetchFn = async (url: string): Promise<FakeResponse> => {
      if (!url.endsWith("/auth/refresh")) return json(200, { ok: true });
      const sent = jar.cookie; // the browser attaches the jar's cookie as the request leaves
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (sent !== live) {
        reused += 1;
        live = "revoked";
        return json(401, { code: "TOKEN_REUSED", message: "x" });
      }
      issued += 1;
      live = `C${issued + 1}`;
      jar.cookie = live;
      return json(200, { accessToken: `A-${issued}`, expiresIn: 900 });
    };
    return { fetchFn, reused: () => reused };
  }

  function tab(fetchFn: (url: string) => Promise<FakeResponse>, refreshLock?: ApiDeps["refreshLock"]): Api {
    return createApi({
      baseUrl: "http://test.local/api/v1",
      tokens: memoryStore(null),
      onSignedOut: jest.fn(),
      fetchFn: fetchFn as unknown as typeof fetch,
      cookieSession: true,
      ...(refreshLock ? { refreshLock } : {}),
    });
  }

  it("twoTabsRefreshingAtOnceStayBothSignedIn", async () => {
    const server = cookieServer();
    const lock = mutex();
    const results = await Promise.all([tab(server.fetchFn, lock).resume(), tab(server.fetchFn, lock).resume()]);
    expect(results).toEqual([true, true]);
    expect(server.reused()).toBe(0);
  });

  it("without the lock the second tab spends a dead cookie (why the lock exists)", async () => {
    const server = cookieServer();
    const results = await Promise.all([tab(server.fetchFn).resume(), tab(server.fetchFn).resume()]);
    expect(results).toContain(false);
    expect(server.reused()).toBe(1);
  });
});
```

`app/src/lib/refresh-lock.test.ts`:

```ts
import { makeRefreshLock } from "./refresh-lock";

describe("refresh lock across tabs", () => {
  it("uses Web Locks under one name when the browser has them", async () => {
    const names: string[] = [];
    const locks = {
      request<T>(name: string, callback: () => Promise<T>): Promise<T> {
        names.push(name);
        return callback();
      },
    };
    await expect(makeRefreshLock(locks)(() => Promise.resolve(7))).resolves.toBe(7);
    expect(names).toEqual(["gullak.refresh"]);
  });

  it("runs the refresh directly without Web Locks", async () => {
    await expect(makeRefreshLock(undefined)(() => Promise.resolve("ran"))).resolves.toBe("ran");
  });
});
```

`app/src/lib/storage.web.test.ts` (whole file):

```ts
import { tokenStore } from "./storage";

describe("token storage on the web (APP-27, SEC-07)", () => {
  afterEach(() => tokenStore.clear());

  it("keeps only the access token, and only in memory", async () => {
    await tokenStore.save({ accessToken: "ACCESS-abc", refreshToken: "REFRESH-xyz" });
    await expect(tokenStore.load()).resolves.toEqual({ accessToken: "ACCESS-abc" });
    const everything = [...Object.values(localStorage), ...Object.values(sessionStorage), document.cookie].join(" ");
    expect(everything).not.toContain("ACCESS-abc");
    expect(everything).not.toContain("REFRESH-xyz");
  });

  it("clear forgets it", async () => {
    await tokenStore.save({ accessToken: "A" });
    await tokenStore.clear();
    await expect(tokenStore.load()).resolves.toBeNull();
  });
});
```

`app/src/lib/query.web.test.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";
import { shouldPersist } from "./query";

describe("query cache on the web", () => {
  it("is never persisted, so budget figures never land in localStorage", () => {
    const qc = new QueryClient();
    qc.setQueryData(["budget", "today"], { budgetPaise: 59300 });
    const query = qc.getQueryCache().find({ queryKey: ["budget", "today"] });
    expect(query).toBeDefined();
    expect(shouldPersist(query!)).toBe(false);
  });
});
```

Append to `app/src/features/auth/session.test.tsx` inside the existing `describe("session", …)`:

```tsx
  it("resumes a cookie session when nothing is stored (a web reload)", async () => {
    const resume = jest.fn(() => Promise.resolve(true));
    render(
      <SessionProvider store={store(null)} logout={() => Promise.resolve()} resume={resume}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("does not resume when a pair is stored", async () => {
    const resume = jest.fn(() => Promise.resolve(false));
    render(
      <SessionProvider store={store({ accessToken: "A", refreshToken: "R" })} logout={() => Promise.resolve()} resume={resume}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    expect(resume).not.toHaveBeenCalled();
  });

  it("a resume that fails offline leaves the visitor signed out", async () => {
    render(
      <SessionProvider store={store(null)} logout={() => Promise.resolve()} resume={() => Promise.reject(new NetworkError("offline"))}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedOut"));
  });
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd app && npx jest src/lib src/features/auth`
Expected: FAIL: `cookieSession` and `resume` do not exist, `refresh-lock` is missing, web storage keeps the refresh token, `shouldPersist` is true on the web, `SessionProvider` has no `resume` prop.

- [ ] **Step 4: Platform flag, token type and web storage**

`app/src/lib/platform.ts`:

```ts
/** True in the web build. Babel inlines EXPO_OS per platform, so phone-only code is dropped from the web bundle. */
export const isWeb = process.env.EXPO_OS === "web";
```

In `app/src/lib/storage.ts`, replace the `Tokens` type:

```ts
/** Phones hold both tokens. The web holds only the access token: its refresh token is an httpOnly cookie (spec 4.7). */
export type Tokens = { accessToken: string; refreshToken?: string | undefined };
```

`app/src/lib/storage.web.ts` (whole file):

```ts
import type { TokenStore, Tokens } from "./storage";
export type { TokenStore, Tokens } from "./storage";

let current: Tokens | null = null;

/**
 * Web (spec 4.7, SEC-07): the access token only, in memory only. The refresh token is an httpOnly cookie the
 * browser keeps and JavaScript never sees; after a reload `api.resume()` trades it for a new access token.
 * Nothing is written to localStorage, sessionStorage or document.cookie, and a refresh token handed to save() is dropped.
 */
export const tokenStore: TokenStore = {
  load: () => Promise.resolve(current),
  save: (tokens) => {
    current = { accessToken: tokens.accessToken };
    return Promise.resolve();
  },
  clear: () => {
    current = null;
    return Promise.resolve();
  },
};
```

- [ ] **Step 5: The API client**

`app/src/lib/api.ts` (whole file):

```ts
import { randomUUID } from "expo-crypto";
import { ApiError, NetworkError, UnknownError, type FieldError } from "./api-errors";
import { log } from "./log";
import type { TokenStore, Tokens } from "./storage";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestOptions = {
  /** Default true: send the bearer token and refresh it once on TOKEN_EXPIRED. */
  auth?: boolean;
  signal?: AbortSignal;
};

export type Api = {
  request<T>(method: HttpMethod, path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  del<T>(path: string, options?: RequestOptions): Promise<T>;
  /** POST a multipart form (statement uploads). Never sets Content-Type: the runtime adds the boundary. */
  postMultipart<T>(path: string, form: FormData, options?: RequestOptions): Promise<T>;
  /**
   * At start-up: true when a session exists. On the web it trades the httpOnly refresh cookie for an access token
   * (memory is empty after a reload); on phones it only checks the stored pair. Throws NetworkError when offline.
   */
  resume(): Promise<boolean>;
};

/** Sent on every web request. The server refuses cookie refresh and logout without it (API-AUTH-16). */
export const WEB_CLIENT_HEADER = { name: "X-Requested-With", value: "gullak-web" } as const;

/** Runs one refresh at a time; on the web across every tab (Web Locks), so no two tabs spend one cookie. */
export type RefreshLock = <T>(run: () => Promise<T>) => Promise<T>;

export type ApiDeps = {
  baseUrl: string;
  tokens: TokenStore;
  /** Called once when a refresh is rejected: the session is gone. */
  onSignedOut: () => void;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Used for multipart only. The app passes expo/fetch on native, whose FormData accepts expo-file-system Files. */
  multipartFetchFn?: typeof fetch;
  /** A 10 MB upload on a slow network needs longer than a JSON call. */
  uploadTimeoutMs?: number;
  /** Web: the refresh token is an httpOnly cookie set by the server; requests include credentials and the client header. */
  cookieSession?: boolean;
  refreshLock?: RefreshLock;
};

type ErrorBody = { code?: unknown; message?: unknown; fields?: unknown; errorId?: unknown; details?: unknown };

type Payload = { kind: "none" } | { kind: "json"; body: unknown } | { kind: "form"; form: FormData };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/me/fixed-costs/3f2…" → "/me/fixed-costs/{id}" so logs never carry ids from URLs. */
function routeOf(path: string): string {
  return path.split("?")[0]?.replace(UUID, "{id}") ?? path;
}

function isFieldError(f: unknown): f is FieldError {
  return typeof f === "object" && f !== null && typeof (f as { field?: unknown }).field === "string" && typeof (f as { message?: unknown }).message === "string";
}

function fieldsOf(raw: unknown): FieldError[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(isFieldError).map((f) => ({ field: f.field, message: f.message }));
}

function detailsOf(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function createApi(deps: ApiDeps): Api {
  const fetchFn = deps.fetchFn ?? fetch;
  const multipartFetch = deps.multipartFetchFn ?? fetchFn;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const uploadTimeoutMs = deps.uploadTimeoutMs ?? 120_000;
  const cookieSession = deps.cookieSession ?? false;
  const lock: RefreshLock = deps.refreshLock ?? ((run) => run());
  let refreshing: Promise<Tokens> | null = null;

  async function send(method: HttpMethod, path: string, payload: Payload, accessToken: string | null, signal?: AbortSignal): Promise<{ status: number; data: unknown }> {
    const multipart = payload.kind === "form";
    const headers: Record<string, string> = { Accept: "application/json", "X-Request-Id": randomUUID() };
    if (!multipart) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (cookieSession) headers[WEB_CLIENT_HEADER.name] = WEB_CLIENT_HEADER.value;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), multipart ? uploadTimeoutMs : timeoutMs);
    signal?.addEventListener("abort", () => controller.abort());
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (payload.kind === "json") init.body = JSON.stringify(payload.body);
    if (payload.kind === "form") init.body = payload.form;
    if (cookieSession) init.credentials = "include";
    const started = Date.now();
    let res: { status: number; headers: { get(name: string): string | null }; text(): Promise<string> };
    try {
      res = await (multipart ? multipartFetch : fetchFn)(`${deps.baseUrl}${path}`, init);
    } catch (e) {
      clearTimeout(timer);
      if (signal?.aborted) throw e;
      throw new NetworkError(e instanceof Error && e.name === "AbortError" ? "timeout" : "network");
    }
    clearTimeout(timer);
    const text = await res.text();
    log.info("api.call", { route: routeOf(path), method, status: res.status, ms: Date.now() - started });
    if (res.status === 204 || text === "") return { status: res.status, data: undefined };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) throw new UnknownError(`Unexpected ${contentType || "response"}`, res.status);
    try {
      return { status: res.status, data: JSON.parse(text) as unknown };
    } catch {
      throw new UnknownError("Response was not JSON", res.status);
    }
  }

  function toError(status: number, data: unknown): Error {
    const b = (data ?? {}) as ErrorBody;
    if (typeof b.code === "string") {
      return new ApiError(
        b.code,
        status,
        typeof b.message === "string" ? b.message : "",
        fieldsOf(b.fields),
        typeof b.errorId === "string" ? b.errorId : undefined,
        detailsOf(b.details),
      );
    }
    return new UnknownError(`HTTP ${status}`, status);
  }

  /** One refresh. On the web the browser attaches the cookie; no refresh token ever passes through JavaScript. */
  async function refreshOnce(current: Tokens | null, announceSignOut: boolean): Promise<Tokens> {
    const payload: Payload = cookieSession ? { kind: "none" } : { kind: "json", body: { refreshToken: current?.refreshToken } };
    const { status, data } = await send("POST", "/auth/refresh", payload, null);
    if (status >= 400) {
      const err = toError(status, data);
      if (err instanceof ApiError) {
        await deps.tokens.clear();
        if (announceSignOut) deps.onSignedOut();
      }
      throw err;
    }
    const pair = (data ?? {}) as { accessToken?: unknown; refreshToken?: unknown };
    if (typeof pair.accessToken !== "string") throw new UnknownError("Refresh gave no tokens", status);
    let next: Tokens;
    if (cookieSession) {
      next = { accessToken: pair.accessToken };
    } else {
      if (typeof pair.refreshToken !== "string") throw new UnknownError("Refresh gave no tokens", status);
      next = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    }
    await deps.tokens.save(next);
    return next;
  }

  /** Single flight inside this tab, and the lock across tabs. */
  function refresh(current: Tokens | null, announceSignOut: boolean): Promise<Tokens> {
    refreshing ??= lock(() => refreshOnce(current, announceSignOut)).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function core<T>(method: HttpMethod, path: string, payload: Payload, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? true;
    const stored = auth ? await deps.tokens.load() : null;
    let { status, data } = await send(method, path, payload, stored?.accessToken ?? null, options.signal);
    if (status === 401 && auth && stored && (data as ErrorBody)?.code === "TOKEN_EXPIRED") {
      const fresh = await refresh(stored, true);
      ({ status, data } = await send(method, path, payload, fresh.accessToken, options.signal));
    }
    if (status >= 400) throw toError(status, data);
    return data as T;
  }

  function request<T>(method: HttpMethod, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return core<T>(method, path, body === undefined ? { kind: "none" } : { kind: "json", body }, options);
  }

  async function resume(): Promise<boolean> {
    if (await deps.tokens.load()) return true;
    if (!cookieSession) return false;
    try {
      await refresh(null, false); // nobody was signed in on this page yet, so no signed-out event
      return true;
    } catch (e) {
      if (e instanceof ApiError) return false; // no cookie, or a dead one
      throw e;
    }
  }

  return {
    request,
    get: (path, options) => request("GET", path, undefined, options),
    post: (path, body, options) => request("POST", path, body, options),
    put: (path, body, options) => request("PUT", path, body, options),
    patch: (path, body, options) => request("PATCH", path, body, options),
    del: (path, options) => request("DELETE", path, undefined, options),
    postMultipart: (path, form, options) => core("POST", path, { kind: "form", form }, options),
    resume,
  };
}
```

`app/src/lib/refresh-lock.ts`:

```ts
import type { RefreshLock } from "./api";

type LockManagerLike = { request<T>(name: string, callback: () => Promise<T>): Promise<T> };

/** Web Locks: one refresh at a time across every tab of this origin, so no two tabs spend the same cookie (SEC-18). */
export function makeRefreshLock(locks: LockManagerLike | undefined): RefreshLock {
  return (run) => (locks ? locks.request("gullak.refresh", run) : run());
}

export const webRefreshLock: RefreshLock = (run) => makeRefreshLock((globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks)(run);
```

In `app/src/lib/client.ts`, add the imports `import { isWeb } from "./platform";` and `import { webRefreshLock } from "./refresh-lock";`, and replace the `api` export with:

```ts
export const api = createApi({
  baseUrl,
  tokens: tokenStore,
  onSignedOut: () => signedOutListeners.forEach((l) => l()),
  // Web: the cookie session (spec 4.7). Phones: expo/fetch sends expo-file-system Files inside FormData.
  ...(isWeb ? { cookieSession: true, refreshLock: webRefreshLock } : { multipartFetchFn: expoFetch as unknown as typeof fetch }),
});
```

In `app/src/lib/query.ts`, replace `shouldPersist` (add `import { isWeb } from "./platform";`):

```ts
/**
 * Never on the web: AsyncStorage is localStorage there and the computer may be shared. On phones, import queries
 * (statement text and raw lines) are never written to disk either.
 */
export function shouldPersist(query: Query): boolean {
  return !isWeb && query.queryKey[0] !== "imports" && defaultShouldDehydrateQuery(query);
}
```

In `app/src/lib/errors.ts`, add to `messages` (after the last code an earlier plan added):

```ts
  CSRF: "That request was blocked. Reload the page and try again.",
```

Run `cd app && npm run gen:errors` so `error-codes.ts` contains `CSRF` (added to `ErrorCode.java` in Task 1).

- [ ] **Step 6: Logout and the session**

In `app/src/features/auth/api.ts`, replace `logout`:

```ts
  /** Phones send their refresh token; the web sends none and the server reads (and clears) the cookie. */
  logout: (refreshToken?: string) => api.post<void>("/auth/logout", refreshToken ? { refreshToken } : undefined, { auth: false }),
```

In `app/src/features/auth/session.tsx`:

1. Add the imports `import { api } from "@/lib/client";` (next to the existing `authEvents` import; merge them into one import line) and `import { isWeb } from "@/lib/platform";`.
2. Above the provider add:

```tsx
/** Web only: after a reload memory is empty but the httpOnly cookie may still hold a session. */
const defaultResume = isWeb ? () => api.resume() : undefined;
```

3. In the `Props` type, change `logout` to `logout?: (refreshToken: string | undefined) => Promise<void>` and add `resume?: (() => Promise<boolean>) | undefined;`. In the signature, add `resume = defaultResume` to the destructured props.
4. Replace the hydration `useEffect` (the one that calls `store.load()`) with this block; it keeps Plan 2 Task 10's email read:

```tsx
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const stored = await store.load();
        const signedIn = stored !== null || (resume ? await resume() : false);
        const savedEmail = signedIn ? await kv.get("me.email") : null;
        if (!alive) return;
        setEmail(savedEmail);
        setStatus(signedIn ? "signedIn" : "signedOut");
      } catch (e) {
        log.warn("session.load_failed", { reason: e instanceof Error ? e.name : "unknown" });
        if (alive) setStatus("signedOut");
      }
    })();
    return () => {
      alive = false;
    };
  }, [store, resume]);
```

If the email state in the file has another setter name than `setEmail`, use that name. `signOut` already calls `logout(t.refreshToken)`; on the web that is `undefined`, which `authApi.logout` sends as a body-less, cookie-carrying request.

- [ ] **Step 7: Run the tests**

Run: `cd app && npm test && npm run lint && npm run typecheck && npx expo export --platform web && rm -rf dist`
Expected: PASS. Plan 2's phone token-refresh tests still pass unchanged.

- [ ] **Step 8: Red team**

Dispatch `red-team` with task id `plan-09-task-4` on the attack list in this task's header, against `npx expo start --web` on port 8081 and the local server (`GULLAK_WEB_ORIGIN` unset, so the local default `http://localhost:8081` applies). Findings to `docs/reports/red-team/plan-09-task-4.md`.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib app/src/features/auth docs/reports/red-team/plan-09-task-4.md
git commit -m "feat(web): cookie session in the API client, resume after reload, refresh lock across tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: App: web route guards and hidden phone-only entry points

**Owner:** web-engineer. **Test IDs:** APP-30; Review Focus `webLeavesCelebrationsForThePhone`. **Red team:** no (Task 12 attacks the finished web build).

**Files:**
- Create: `app/src/lib/block-on-web.tsx`, `app/src/lib/block-on-web.test.tsx`, `app/src/lib/block-on-web.web.test.tsx`, `app/src/lib/web-routes.ts`, `app/src/lib/web-routes.test.ts`, `app/src/features/tabs/tab-bar.web.test.tsx`, `app/src/features/home/today-section.web.test.tsx`, `app/src/features/game/celebrations.web.test.tsx`
- Modify: `app/app/add.tsx`, `app/app/spend/[id].tsx`, `app/app/report-card.tsx`, `app/app/stage-up.tsx`, `app/app/onboarding/notifications.tsx`, `app/app/onboarding/personality.tsx`, `app/app/(tabs)/_layout.tsx`, `app/src/features/tabs/tab-bar.tsx`, `app/src/features/home/today-section.tsx`, `app/src/features/home/spend-row.tsx`, `app/src/features/home/home-screen.tsx`, `app/src/features/game/celebrations.ts`, `app/src/features/notify/components/notification-settings.tsx`

**Interfaces:**
- Consumes: `isWeb` (Task 4); Plan 3's `TodaySection`, `SpendRow`, `TabBar` (`onAdd?`); Plan 6's `useCelebrations`; Plan 8's `NotificationSettings`.
- Produces: `blockOnWeb<P>(Screen, web?)`; `WEB_ROUTES`, `PHONE_ONLY_ROUTES`, `webRouteAllowed(route)`; `TodaySectionProps.onAdd` and `onOpen` become optional (absent = read-only). A later screen must be added to one of the two lists or `web-routes.test.ts` fails.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/web-routes.test.ts` (native project; reads the route files from disk):

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PHONE_ONLY_ROUTES, webRouteAllowed } from "./web-routes";

const ROOT = path.resolve(__dirname, "../../app");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

/** app/app/(tabs)/index.tsx → "/", app/app/goals/[id]/index.tsx → "/goals/[id]"; layouts and +files are not routes. */
function toRoute(file: string): string | null {
  const rel = path.relative(ROOT, file).split(path.sep).join("/").replace(/\.tsx$/, "");
  const name = rel.split("/").pop() ?? "";
  if (name === "_layout" || name.startsWith("+")) return null;
  const parts = rel.split("/").filter((p) => !/^\(.*\)$/.test(p));
  if (parts[parts.length - 1] === "index") parts.pop();
  return "/" + parts.join("/");
}

const routes = routeFiles(ROOT)
  .map((file) => ({ file, route: toRoute(file) }))
  .filter((r): r is { file: string; route: string } => r.route !== null);

describe("web routes (APP-30, spec 1.1)", () => {
  it("every route file is classified as web or phone-only, never both", () => {
    const unclassified = routes.filter((r) => webRouteAllowed(r.route) === PHONE_ONLY_ROUTES.includes(r.route as (typeof PHONE_ONLY_ROUTES)[number]));
    expect(unclassified.map((r) => r.route)).toEqual([]);
  });

  it("phone-only route files are wrapped in blockOnWeb, web route files are not", () => {
    for (const r of routes) {
      const wrapped = readFileSync(r.file, "utf8").includes("blockOnWeb(");
      expect({ route: r.route, wrapped }).toEqual({ route: r.route, wrapped: !webRouteAllowed(r.route) });
    }
  });

  it("the spec's web screens are allowed and the phone-only ones are not", () => {
    for (const r of ["/", "/insights", "/goals", "/goals/new", "/goals/[id]", "/upload", "/upload/columns", "/me", "/me/savings", "/login"]) {
      expect({ r, allowed: webRouteAllowed(r) }).toEqual({ r, allowed: true });
    }
    for (const r of ["/add", "/spend/[id]", "/report-card", "/stage-up", "/onboarding/notifications"]) {
      expect({ r, allowed: webRouteAllowed(r) }).toEqual({ r, allowed: false });
    }
  });
});
```

`app/src/lib/block-on-web.web.test.tsx` (web project):

```tsx
import { renderRouter, screen } from "expo-router/testing-library";
import React from "react";
import { Text } from "react-native";
import { blockOnWeb } from "./block-on-web";
import { isWeb } from "./platform";

describe("phone-only routes on the web (APP-30)", () => {
  it("the web build knows it is the web", () => {
    expect(isWeb).toBe(true);
  });

  it("a phone-only route sends the visitor Home", async () => {
    renderRouter(
      { index: () => <Text>Home</Text>, add: blockOnWeb(() => <Text>Quick add</Text>), "goals/new": () => <Text>New goal</Text> },
      { initialUrl: "/add" },
    );
    expect(await screen.findByText("Home")).toBeTruthy();
    expect(screen.queryByText("Quick add")).toBeNull();
    expect(screen).toHavePathname("/");
  });

  it("a web route renders", async () => {
    renderRouter(
      { index: () => <Text>Home</Text>, add: blockOnWeb(() => <Text>Quick add</Text>), "goals/new": () => <Text>New goal</Text> },
      { initialUrl: "/goals/new" },
    );
    expect(await screen.findByText("New goal")).toBeTruthy();
  });
});
```

`app/src/lib/block-on-web.test.tsx` (native project):

```tsx
import { render, screen } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { blockOnWeb } from "./block-on-web";

describe("phone-only routes on a phone", () => {
  it("render as usual and receive their props", () => {
    const Screen = blockOnWeb(({ label }: { label: string }) => <Text>{label}</Text>, false);
    render(<Screen label="Quick add" />);
    expect(screen.getByText("Quick add")).toBeTruthy();
  });
});
```

`app/src/features/tabs/tab-bar.web.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import React from "react";
import { TabBar } from "./tab-bar";

const props = {
  state: { index: 0, routes: [{ key: "index", name: "index" }, { key: "insights", name: "insights" }, { key: "goals", name: "goals" }, { key: "me", name: "me" }] },
  navigation: { navigate: jest.fn(), emit: jest.fn(() => ({ defaultPrevented: false })) },
} as unknown as React.ComponentProps<typeof TabBar>;

describe("tab bar on the web (APP-30)", () => {
  it("has no add button, even if someone passes onAdd", () => {
    render(<TabBar {...props} onAdd={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Add a spend" })).toBeNull();
  });
});
```

If Plan 2's `TabBar` needs more of `state`/`navigation` than this fixture has, copy the fixture from `tab-bar.test.tsx` instead; the assertion stays.

`app/src/features/home/today-section.web.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import React from "react";
import { TodaySection } from "./today-section";
import type { SpendRowModel } from "./spend-rows";

const saved = {
  key: "s1",
  id: "6f1c2a3b-0000-4000-8000-000000000001",
  clientId: "c1",
  status: "saved",
  title: "Eating out",
  amountText: "−₹250",
  label: "Eating out, ₹250",
} as unknown as SpendRowModel;

describe("Home's today list on the web is read-only (APP-30)", () => {
  it("shows spends without opening them", () => {
    render(<TodaySection rows={[saved]} firstRun={false} loading={false} failed={false} onRetry={jest.fn()} onRemove={jest.fn()} />);
    expect(screen.getByLabelText("Eating out, ₹250")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers no add button when empty and says where spends come from", () => {
    render(<TodaySection rows={[]} firstRun loading={false} failed={false} onRetry={jest.fn()} onRemove={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Add first spend" })).toBeNull();
    expect(screen.getByText("Your spends show up here. Log them in the Gullak app or upload a statement.")).toBeTruthy();
  });
});
```

If `SpendRowModel` has fields this fixture lacks, build the row with Plan 3's `buildRows` helper as `today-section.test.tsx` does; the assertions stay.

`app/src/features/game/celebrations.web.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react-native";
import React from "react";
import { useCelebrations } from "./celebrations";
import type { TodayGame } from "./api";

describe("celebrations on the web", () => {
  it("webLeavesCelebrationsForThePhone", () => {
    const ack = jest.fn(() => Promise.resolve());
    const openStageUp = jest.fn();
    const game = { celebrate: [{ id: "c1", kind: "LEVEL_UP", value: "5" }, { id: "c2", kind: "STAGE_UP", value: "PAINTED" }] } as unknown as TodayGame;
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useCelebrations(game, { ack, openStageUp }), { wrapper });
    expect(result.current).toBeUndefined();
    expect(ack).not.toHaveBeenCalled();
    expect(openStageUp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx jest src/lib/web-routes src/lib/block-on-web src/features/tabs src/features/home src/features/game`
Expected: FAIL: `web-routes` and `block-on-web` do not exist; the web tab bar has the + button; `TodaySection` requires `onAdd`; celebrations are acknowledged on the web.

- [ ] **Step 3: The guard and the route lists**

`app/src/lib/block-on-web.tsx`:

```tsx
import { Redirect } from "expo-router";
import React from "react";
import { isWeb } from "./platform";

/** Spec 1.1: wraps a phone-only route. On the web it sends the visitor Home and never renders the screen. */
export function blockOnWeb<P extends object>(Screen: React.ComponentType<P>, web: boolean = isWeb): React.ComponentType<P> {
  function PhoneOnly(props: P) {
    if (web) return <Redirect href="/" />;
    return <Screen {...props} />;
  }
  PhoneOnly.displayName = `PhoneOnly(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return PhoneOnly;
}
```

`app/src/lib/web-routes.ts`:

```ts
/**
 * Spec 1.1: the web app is the dashboard, upload, goals and budget settings; no quick-add, mascot moments or
 * notifications. Every route file must appear in exactly one list (web-routes.test.ts). Entries ending in "/*"
 * cover the route itself and everything under it.
 */
export const WEB_ROUTES = [
  "/",
  "/login",
  "/login-code",
  "/consent",
  "/privacy",
  "/restore",
  "/account-deleted",
  "/onboarding/income",
  "/onboarding/fixed-costs",
  "/onboarding/savings",
  "/onboarding/personality",
  "/insights/*",
  "/upload/*",
  "/goals/*",
  "/me/*",
  "/badges",
] as const;

export const PHONE_ONLY_ROUTES = ["/add", "/spend/[id]", "/report-card", "/stage-up", "/onboarding/notifications"] as const;

export function webRouteAllowed(route: string): boolean {
  return WEB_ROUTES.some((entry) =>
    entry.endsWith("/*") ? route === entry.slice(0, -2) || route.startsWith(entry.slice(0, -1)) : route === entry,
  );
}
```

Run `npx jest src/lib/web-routes` now. The first test lists every unclassified route by path. Routes from Plan 7 (insights drill-down, cycle summary) and any other new screen must be placed in one list: insights and cycle summary screens are web (read-only planning screens); anything that logs a spend, plays a Gullak moment or deals with notifications is phone-only. Add each new entry to the right list here, never by widening a prefix.

- [ ] **Step 4: Wrap the phone-only routes**

In each of `app/app/add.tsx`, `app/app/spend/[id].tsx`, `app/app/report-card.tsx`, `app/app/stage-up.tsx` and `app/app/onboarding/notifications.tsx`: turn `export default function XRoute() {` into `function XRoute() {` (keep the name the file uses), add `import { blockOnWeb } from "@/lib/block-on-web";`, and end the file with:

```tsx
export default blockOnWeb(XRoute);
```

For example `app/app/add.tsx` ends with `export default blockOnWeb(QuickAddRoute);`.

- [ ] **Step 5: Hide the entry points**

`app/app/onboarding/personality.tsx`: in `onDone`, replace `router.replace("/onboarding/notifications");` with

```tsx
        router.replace(isWeb ? "/" : "/onboarding/notifications"); // no notifications on the web (spec 1.1)
```

and add `import { isWeb } from "@/lib/platform";`.

`app/app/(tabs)/_layout.tsx`: replace the `tabBar` prop with

```tsx
      tabBar={(props) => (
        <TabBar
          {...(props as unknown as React.ComponentProps<typeof TabBar>)}
          {...(isWeb ? {} : { onAdd: () => router.push("/add") })}
        />
      )}
```

and add `import { isWeb } from "@/lib/platform";`.

`app/src/features/tabs/tab-bar.tsx`: add `import { isWeb } from "@/lib/platform";` and replace the `t === null` branch with

```tsx
        t === null ? (
          isWeb ? null : (
            <View key="add" style={{ flex: 1, alignItems: "center" }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a spend"
                accessibilityState={{ disabled: !onAdd }}
                disabled={!onAdd}
                onPress={onAdd}
                style={({ pressed }) => ({
                  marginTop: -spacing.lg,
                  width: 56,
                  height: 56,
                  borderRadius: radius.full,
                  backgroundColor: colors.accent,
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: shadows.addButton,
                  opacity: onAdd ? 1 : 0.5,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                })}
              >
                <Icon name="plus" size={28} color={colors.onAccent} strokeWidth={2.5} />
              </Pressable>
            </View>
          )
        ) : (
```

(If a later plan restyled the button, keep its styling and only add the `isWeb ? null : ( … )` wrapper.)

`app/src/features/home/today-section.tsx`: in `TodaySectionProps` replace the two lines with

```tsx
  /** Absent on the web: Home is read-only there (spec 1.1). */
  onAdd?: (() => void) | undefined;
  onOpen?: ((id: string) => void) | undefined;
```

and replace the `EmptyState` element with

```tsx
        <EmptyState
          title={
            firstRun
              ? onAdd
                ? "Your spends show up here. Log one as soon as you pay."
                : "Your spends show up here. Log them in the Gullak app or upload a statement."
              : "Nothing logged today"
          }
          action={
            onAdd ? (
              <View style={{ gap: spacing.sm }}>
                <Button title={firstRun ? "Add first spend" : "Add a spend"} onPress={onAdd} />
                {firstRun ? (
                  <Text variant="caption" align="center">
                    Or upload last month's statement
                  </Text>
                ) : null}
              </View>
            ) : null
          }
        />
```

(If Plan 4 Task 15 turned the caption into a link, keep its version of the caption inside the `onAdd ?` branch.)

`app/src/features/home/spend-row.tsx`: change the signature and the saved-row branch:

```tsx
export function SpendRow({ row, last, onOpen, onRemove }: { row: SpendRowModel; last: boolean; onOpen?: ((id: string) => void) | undefined; onRemove: (clientId: string) => void }) {
```

```tsx
  if (row.status === "saved" && id && onOpen) {
```

(the rest of the function is unchanged: without `onOpen`, a saved row falls through to the plain, labelled `View`).

`app/src/features/home/home-screen.tsx`: add `import { isWeb } from "@/lib/platform";` and pass

```tsx
            onAdd={isWeb ? undefined : () => router.push("/add")}
            onOpen={isWeb ? undefined : (id) => router.push({ pathname: "/spend/[id]", params: { id } })}
```

to `TodaySection` in place of the two existing props.

`app/src/features/game/celebrations.ts`: add `import { isWeb } from "@/lib/platform";` and replace `const celebrate = game?.celebrate;` with

```ts
  // The web shows no mascot moments (spec 1.1) and must not acknowledge them, or the phone would never play them.
  const celebrate = isWeb ? undefined : game?.celebrate;
```

`app/src/features/notify/components/notification-settings.tsx`: rename the exported component function to `NotificationSettingsPanel` (no longer exported) and add at the end of the file:

```tsx
/** No notifications on the web (spec 1.1): the switches only exist on phones. */
export function NotificationSettings(props: React.ComponentProps<typeof NotificationSettingsPanel>) {
  return isWeb ? null : <NotificationSettingsPanel {...props} />;
}
```

with `import { isWeb } from "@/lib/platform";` (and `import React from "react";` if the file lacks it).

- [ ] **Step 6: Run the tests**

Run: `cd app && npm test && npm run lint && npm run typecheck && npx expo export --platform web && rm -rf dist`
Expected: PASS.

- [ ] **Step 7: Use it**

`cd app && npx expo start --web` with the local server running. Sign in, open `http://localhost:8081/add`, `/report-card`, `/stage-up` and `/onboarding/notifications` from the address bar: each lands on Home. The tab bar has no + button; spend rows do not open; Me shows no notification switches; Goals, Insights and Add a statement open.

- [ ] **Step 8: Commit**

```bash
git add app/app app/src/lib app/src/features
git commit -m "feat(web): phone-only routes redirect Home, entry points hidden, every route classified

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Web hosting: nginx container with CSP and HSTS, header check in CI

**Owner:** web-engineer. **Test IDs:** SEC-04 (web half). **Red team:** yes: frame the page from another origin, inject a script through any query string, request dotfiles and source maps, check every path (page, deep link, static asset, 404) for the headers.

**Files:**
- Create: `app/web/Dockerfile`, `app/web/default.conf.template`, `app/web/check-headers.sh`, `app/.dockerignore`
- Modify: `.github/workflows/ci.yml` (new `web` job)

**Interfaces:**
- Consumes: `npx expo export --platform web` (Plan 2: `web.output: "single"`), `EXPO_PUBLIC_API_URL` at build time.
- Produces: image built from `app/` with `-f app/web/Dockerfile`, build argument `EXPO_PUBLIC_API_URL`, runtime variable `GULLAK_API_ORIGIN` (added to `connect-src`), listening on 8080 as an unprivileged user; `app/web/check-headers.sh <base-url>`; CI job `web`.

- [ ] **Step 1: Write the failing check**

`app/web/check-headers.sh`:

```bash
#!/usr/bin/env bash
# SEC-04, web half: the page, a deep link, a static asset and a missing asset carry the security headers,
# and the cache rules hold. Usage: app/web/check-headers.sh http://localhost:8088
set -euo pipefail
url="${1:?base url}"
fail=0

check() { # path header expected-substring
  local got
  got=$(curl -sS -D - -o /dev/null "$url$1" | tr -d '\r' | grep -i "^$2:" || true)
  if [[ "$got" == *"$3"* ]]; then
    echo "ok    $1  $2"
  else
    echo "FAIL  $1  $2: wanted '$3', got '${got:-nothing}'"
    fail=1
  fi
}

for path in / /goals /add /_expo/static/js/web/missing.js; do
  check "$path" content-security-policy "frame-ancestors 'none'"
  check "$path" content-security-policy "script-src 'self'"
  check "$path" content-security-policy "object-src 'none'"
  check "$path" x-content-type-options nosniff
  check "$path" x-frame-options DENY
  check "$path" strict-transport-security "max-age=31536000"
  check "$path" referrer-policy no-referrer
done
check / cache-control no-cache
check /goals cache-control no-cache

js=$(curl -fsS "$url/" | grep -oE '/_expo/static/js/web/[^"]+\.js' | head -1)
if [[ -z "$js" ]]; then
  echo "FAIL  no bundle script found in index.html"
  fail=1
else
  check "$js" cache-control "max-age=31536000"
  check "$js" content-security-policy "frame-ancestors 'none'"
fi

status=$(curl -s -o /dev/null -w '%{http_code}' "$url/_expo/static/js/web/missing.js")
if [[ "$status" != 404 ]]; then echo "FAIL  a missing asset answered $status, not 404"; fail=1; fi
status=$(curl -s -o /dev/null -w '%{http_code}' "$url/.env")
if [[ "$status" != 404 && "$status" != 403 ]]; then echo "FAIL  /.env answered $status"; fail=1; fi
exit $fail
```

Make it executable (`chmod +x app/web/check-headers.sh`). Prove it bites: `cd app && npx expo export --platform web && npx serve dist -l 8088 &` then `web/check-headers.sh http://localhost:8088` → FAIL lines and exit 1 (a plain static server sends none of the headers). Stop the server and `rm -rf dist`.

- [ ] **Step 2: The nginx config**

`app/web/default.conf.template` (the image's entrypoint substitutes `${GULLAK_API_ORIGIN}`; nginx's own `$uri` variables are left alone because only defined environment variables are substituted):

```nginx
# The Gullak web app: Expo's single-page export. Security headers on every response (spec 4.7, SEC-04).
# No location below uses add_header, so these server-level headers apply everywhere.
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    server_tokens off;
    charset utf-8;

    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${GULLAK_API_ORIGIN}; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;

    # Hidden files (.env, .git) never exist here; refuse them anyway.
    location ~ /\. {
        return 404;
    }

    # Hashed bundles: cache for a year. A missing bundle is a 404, never the app shell.
    location /_expo/static/ {
        expires 1y;
        try_files $uri =404;
    }

    # Everything else is the single-page app: deep links (/goals/new) get index.html, revalidated every time.
    location / {
        expires -1;
        try_files $uri $uri/ /index.html;
    }
}
```

`app/web/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
# Build from app/:  docker build -f web/Dockerfile --build-arg EXPO_PUBLIC_API_URL=https://<host>/api/v1 -t gullak-web .
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG EXPO_PUBLIC_API_URL
RUN test -n "$EXPO_PUBLIC_API_URL" && npx expo export --platform web --output-dir dist

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html
# Extra origin the page may call; empty in production, where the API is the same origin (/api).
ENV GULLAK_API_ORIGIN=""
EXPOSE 8080
```

Then pin both base images to digests (Task 8's `check-pins.sh` enforces it):

```bash
docker buildx imagetools inspect node:22-bookworm-slim --format '{{json .Manifest.Digest}}'
docker buildx imagetools inspect nginxinc/nginx-unprivileged:1.27-alpine --format '{{json .Manifest.Digest}}'
```

and write each as `FROM node:22-bookworm-slim@sha256:<digest> AS build` and `FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:<digest>` with the printed values.

`app/.dockerignore`:

```
node_modules
dist
.expo
ios
android
.env
.env.*
playwright-report
test-results
coverage
```

- [ ] **Step 3: Build, run and check**

```bash
cd app
docker build -f web/Dockerfile --build-arg EXPO_PUBLIC_API_URL=http://localhost:8080/api/v1 -t gullak-web:dev .
docker run -d --rm --name gullak-web -p 8088:8080 -e GULLAK_API_ORIGIN=http://localhost:8080 gullak-web:dev
web/check-headers.sh http://localhost:8088
docker stop gullak-web
```

Expected: every line `ok`, exit 0.

- [ ] **Step 4: CI job**

Append to `.github/workflows/ci.yml` (Task 8 pins the action versions):

```yaml
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build the web image
        run: docker build -f app/web/Dockerfile --build-arg EXPO_PUBLIC_API_URL=http://localhost:8080/api/v1 -t gullak-web:ci app
      - name: Run it
        run: |
          docker run -d --name web -p 8088:8080 -e GULLAK_API_ORIGIN=http://localhost:8080 gullak-web:ci
          for i in $(seq 1 30); do curl -fs http://localhost:8088/ > /dev/null && break; sleep 1; done
      - name: Security headers (SEC-04, web)
        run: app/web/check-headers.sh http://localhost:8088
```

- [ ] **Step 5: Red team**

Dispatch `red-team` with task id `plan-09-task-6` on the attack list in this task's header against the running container. Findings to `docs/reports/red-team/plan-09-task-6.md`.

- [ ] **Step 6: Commit**

```bash
git add app/web app/.dockerignore .github/workflows/ci.yml docs/reports/red-team/plan-09-task-6.md
git commit -m "feat(web): nginx container for the web export with CSP, HSTS and a header check in CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: E2E-10: Playwright smoke against the export and the local server

**Owner:** qa-engineer writes the specs and the server clock; web-engineer fixes what they find. **Test IDs:** E2E-10, APP-30 (in a real browser), SEC-06 and SEC-07 (in a real browser), API-AUTH-16 (from a page). **Red team:** no (Task 12 extends `security.spec.ts`).

**Files:**
- Modify: `server/src/main/java/in/gullak/common/config/ClockConfig.java`, `server/src/main/resources/application.yml`, `app/package.json`, `.github/workflows/ci.yml` (the `web` job), `.gitignore`
- Create: `server/src/test/java/in/gullak/common/config/ClockConfigTest.java`, `app/playwright.config.ts`, `app/e2e-web/support.ts`, `app/e2e-web/smoke.spec.ts`, `app/e2e-web/security.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–6; `POST /api/v1/auth/dev/otp` (local), `PUT /api/v1/budget/first-cycle`, `GET /api/v1/me/account`, `POST /api/v1/me/consent`, the copy and test IDs listed under Cross-plan contracts.
- Produces: `ClockConfig.create(String start, boolean local, Clock system) : Clock`; setting `gullak.dev.clock-start` (`GULLAK_DEV_CLOCK_START`); `npm run e2e:web`; helpers `exampleUser(request)`, `signInOnWeb(page, request, email)`, `devCode(request, email)`, `watchCsp(page)`.

- [ ] **Step 1: Write the failing server test**

`server/src/test/java/in/gullak/common/config/ClockConfigTest.java`:

```java
package in.gullak.common.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** E2E-10 needs the spec's example day on any calendar date; only the local profile may move the clock. */
class ClockConfigTest {
    private static final Clock SYSTEM = Clock.fixed(Instant.parse("2026-11-02T10:00:00Z"), ZoneOffset.UTC);

    @Test
    void withoutAStartTheSystemClockIsUsed() {
        assertThat(ClockConfig.create("", false, SYSTEM)).isSameAs(SYSTEM);
        assertThat(ClockConfig.create(null, true, SYSTEM)).isSameAs(SYSTEM);
    }

    @Test
    void theLocalProfileCanStartTheClockOnTheExampleDay() {
        Clock clock = ClockConfig.create("2026-10-23T08:00:00Z", true, SYSTEM);
        assertThat(clock.instant()).isEqualTo(Instant.parse("2026-10-23T08:00:00Z"));
    }

    @Test
    void anyOtherProfileRefusesToStart() {
        assertThatThrownBy(() -> ClockConfig.create("2026-10-23T08:00:00Z", false, SYSTEM))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("GULLAK_DEV_CLOCK_START");
    }

    @Test
    void aMalformedStartRefusesToStart() {
        assertThatThrownBy(() -> ClockConfig.create("23 Oct", true, SYSTEM))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("ISO");
    }
}
```

Run: `cd server && ./gradlew test --tests 'in.gullak.common.config.ClockConfigTest'` → FAIL (no `create`).

- [ ] **Step 2: The dev clock**

`server/src/main/java/in/gullak/common/config/ClockConfig.java` (whole file):

```java
package in.gullak.common.config;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

@Configuration
public class ClockConfig {
    @Bean
    @Profile("!test")
    Clock clock(@Value("${gullak.dev.clock-start:}") String start, Environment env) {
        return create(start, env.acceptsProfiles(Profiles.of("local")), Clock.systemUTC());
    }

    /**
     * The system clock, or under the local profile one shifted so that it starts at {@code start} and keeps ticking
     * (E2E-10 runs on the spec's example day). Token expiry uses the same clock, so sessions stay consistent.
     * Any other profile with a start set refuses to boot: production must never run on a moved clock.
     */
    static Clock create(String start, boolean local, Clock system) {
        if (start == null || start.isBlank()) {
            return system;
        }
        if (!local) {
            throw new IllegalStateException("GULLAK_DEV_CLOCK_START is for the local profile only; unset it.");
        }
        Instant target;
        try {
            target = Instant.parse(start.trim());
        } catch (DateTimeParseException e) {
            throw new IllegalStateException("GULLAK_DEV_CLOCK_START must be an ISO instant such as 2026-10-23T08:00:00Z", e);
        }
        return Clock.offset(system, Duration.between(system.instant(), target));
    }
}
```

In `server/src/main/resources/application.yml`, under `gullak:` add:

```yaml
  dev:
    # Local profile only: start the clock at this instant (E2E-10 uses 2026-10-23T08:00:00Z). Prod refuses it.
    clock-start: ${GULLAK_DEV_CLOCK_START:}
```

Run: `cd server && ./gradlew test` → PASS.

- [ ] **Step 3: Playwright**

```bash
cd app
npm install --save-dev @playwright/test @types/node
npx playwright install chromium
```

Add to `app/package.json` scripts: `"e2e:web": "playwright test"`. Add to `.gitignore`: `app/playwright-report/` and `app/test-results/`.

`app/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E-10 runs against the real web export served by the nginx image (Task 6) and the server under the local
 * profile with GULLAK_DEV_CLOCK_START=2026-10-23T08:00:00Z. See README "Web end-to-end".
 */
export default defineConfig({
  testDir: "./e2e-web",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.WEB_URL ?? "http://localhost:8088",
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
    trace: "retain-on-failure",
  },
});
```

`app/e2e-web/support.ts`:

```ts
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const API = process.env.API_URL ?? "http://localhost:8080/api/v1";
export const EXAMPLE_DAY = new Date("2026-10-23T08:00:00Z");

export function freshEmail(): string {
  return `web-e2e-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.test`;
}

/** The code the local server "mailed" (POST /auth/dev/otp exists only under the local profile). */
export async function devCode(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API}/auth/dev/otp`, { data: { email } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { code: string }).code;
}

/**
 * The spec's example user, set up through the API as a phone would (tokens in the body, no cookie): ₹50,000 income,
 * ₹15,000 fixed, ₹20,000 savings, payday the 1st. Money left until payday ₹5,340 over 9 days gives the spec's ₹593.
 */
export async function exampleUser(request: APIRequestContext): Promise<string> {
  const email = freshEmail();
  expect((await request.post(`${API}/auth/otp/request`, { data: { email } })).status()).toBe(204);
  const verify = await request.post(`${API}/auth/otp/verify`, { data: { email, code: await devCode(request, email), device: "e2e" } });
  expect(verify.status()).toBe(200);
  const { accessToken } = (await verify.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };

  const account = await request.get(`${API}/me/account`, { headers });
  expect(account.status()).toBe(200);
  const { currentConsentVersion } = (await account.json()) as { currentConsentVersion: string };
  expect((await request.post(`${API}/me/consent`, { headers, data: { version: currentConsentVersion } })).ok()).toBe(true);

  const costs: [string, number][] = [["Rent", 1_000_000], ["Cook", 200_000], ["Maid", 150_000], ["Monthly groceries", 150_000]];
  for (const [name, amountPaise] of costs) {
    expect((await request.post(`${API}/me/fixed-costs`, { headers, data: { name, amountPaise } })).status()).toBe(201);
  }
  const profile = {
    incomePaise: 5_000_000, savingsPaise: 2_000_000, paydayRule: "FIXED_DAY", paydayDay: 1,
    personality: "CHILL", morningTime: "08:00", nightTime: "22:00", timezone: "Asia/Kolkata",
  };
  expect((await request.put(`${API}/me/profile`, { headers, data: profile })).status()).toBe(200);
  expect((await request.get(`${API}/budget/today`, { headers })).status()).toBe(200);
  expect((await request.put(`${API}/budget/first-cycle`, { headers, data: { moneyLeftPaise: 534_000 } })).status()).toBe(200);
  return email;
}

/** Signs in through the web UI. Returns the access token the page received, to prove it is stored nowhere. */
export async function signInOnWeb(page: Page, request: APIRequestContext, email: string): Promise<string> {
  await page.clock.setSystemTime(EXAMPLE_DAY);
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("Enter the code")).toBeVisible();
  const verified = page.waitForResponse((r) => r.url().endsWith("/auth/otp/verify"));
  await page.keyboard.type(await devCode(request, email)); // the code field has focus (Plan 2) and submits at six digits
  const response = await verified;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { accessToken: string; refreshToken?: string };
  expect(body.refreshToken).toBeUndefined();
  await expect(page.getByText("Fri, 23 Oct")).toBeVisible();
  return body.accessToken;
}

/** Collects Content-Security-Policy violations reported by the browser. */
export function watchCsp(page: Page): () => string[] {
  const seen: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) seen.push(m.text());
  });
  return () => seen;
}
```

If the code screen's field does not take focus on its own, click it first with the label Plan 2's `CodeForm` gives it (read `code-form.tsx`); keep the rest.

`app/e2e-web/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { exampleUser, signInOnWeb, watchCsp } from "./support";

// Unknown headers force the column map (Plan 4's sample shape): date, description, amount, Dr/Cr.
const CSV = [
  "Posted On,Remarks,Amt,Type",
  "2026-10-05,UPI/KAKA DHABA,150.00,DR",
  "2026-10-06,UPI/THIRDWAVECOFFEE/okhdfc,250.00,DR",
  "2026-10-07,CASHBACK,25.00,CR",
].join("\n");

test("E2E-10: sign in, the example day, a CSV with a column map, a new goal", async ({ page, request }) => {
  const violations = watchCsp(page);
  const accessToken = await signInOnWeb(page, request, await exampleUser(request));

  // Dashboard: the spec's worked example (2.1): ₹593 today on Fri 23 Oct.
  await expect(page.getByText(/₹593/).first()).toBeVisible();

  // SEC-07 in the browser: the access token is in memory only; the refresh token is invisible to the page.
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
  expect(stored).not.toContain(accessToken);
  expect(stored).not.toContain("gullak_rt");
  // SEC-06 in the browser.
  const cookie = (await page.context().cookies()).find((c) => c.name === "__Host-gullak_rt");
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });

  // A reload keeps the session (spec 4.7: the cookie survives, memory does not).
  await page.reload();
  await expect(page.getByText("Fri, 23 Oct")).toBeVisible();
  await expect(page.getByText(/₹593/).first()).toBeVisible();

  // CSV upload with the column map.
  await page.goto("/upload");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a PDF or CSV" }).click();
  await (await chooser).setFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "utf8") });
  await expect(page.getByText("Match the columns")).toBeVisible();
  await page.getByRole("button", { name: "One column and a Dr/Cr column" }).click();
  await page.getByTestId("date-0").click();
  await page.getByTestId("amount-2").click();
  await page.getByRole("button", { name: "YYYY-MM-DD" }).click();
  await expect(page.getByText("Mon, 5 Oct · UPI/KAKA DHABA · ₹150 out")).toBeVisible();
  await page.getByRole("button", { name: "Looks right" }).click();
  await expect(page.getByText("3 transactions")).toBeVisible();

  // A goal.
  await page.goto("/goals/new");
  await page.getByLabel("Goal name").fill("Goa trip");
  const start = page.getByRole("button", { name: "Start this quest" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).not.toHaveURL(/\/goals\/new/);
  await expect(page.getByText("Goa trip").first()).toBeVisible();

  expect(violations()).toEqual([]);
});

test("APP-30: phone-only screens send a web visitor Home", async ({ page, request }) => {
  await signInOnWeb(page, request, await exampleUser(request));
  for (const path of ["/add", "/report-card", "/stage-up", "/onboarding/notifications"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Fri, 23 Oct")).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Add a spend" })).toHaveCount(0);
  for (const path of ["/insights", "/goals", "/upload", "/me"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
});
```

`app/e2e-web/security.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { API, exampleUser, signInOnWeb } from "./support";

const FOREIGN = "http://127.0.0.1:8099"; // a different site from localhost

test("refresh without the web header is refused from the app's own page (API-AUTH-16)", async ({ page, request }) => {
  await signInOnWeb(page, request, await exampleUser(request));
  const status = await page.evaluate(async (api) => (await fetch(`${api}/auth/refresh`, { method: "POST", credentials: "include" })).status, API);
  expect(status).toBe(403);
  await page.reload(); // the refused request spent nothing
  await expect(page.getByText("Fri, 23 Oct")).toBeVisible();
});

test("a foreign site cannot use or spend the session", async ({ page, request }) => {
  await signInOnWeb(page, request, await exampleUser(request));
  await page.route(`${FOREIGN}/**`, (route) => route.fulfill({ contentType: "text/html", body: "<html><body>elsewhere</body></html>" }));
  await page.goto(`${FOREIGN}/attack`);
  const outcomes = await page.evaluate(async (api) => {
    const attempt = async (init: RequestInit) => {
      try {
        const r = await fetch(`${api}/auth/refresh`, { method: "POST", credentials: "include", ...init });
        return `status ${r.status}`;
      } catch {
        return "blocked";
      }
    };
    return [await attempt({ headers: { "X-Requested-With": "gullak-web" } }), await attempt({})];
  }, API);
  expect(outcomes).toEqual(["blocked", "blocked"]);
  await page.goto("/");
  await expect(page.getByText("Fri, 23 Oct")).toBeVisible(); // still signed in: nothing was spent
});

test("the app cannot be framed", async ({ page, baseURL }) => {
  const messages: string[] = [];
  page.on("console", (m) => messages.push(m.text()));
  await page.route(`${FOREIGN}/**`, (route) => route.fulfill({ contentType: "text/html", body: `<iframe src="${baseURL}/"></iframe>` }));
  await page.goto(`${FOREIGN}/frame`);
  await expect.poll(() => messages.some((m) => m.includes("frame-ancestors"))).toBe(true);
});

test("signing out clears the cookie and a reload shows sign-in", async ({ page, request }) => {
  await signInOnWeb(page, request, await exampleUser(request));
  await page.goto("/me");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  expect((await page.context().cookies()).find((c) => c.name === "__Host-gullak_rt")).toBeUndefined();
  await page.reload();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("no open redirect through a query string", async ({ page, baseURL }) => {
  for (const q of ["?next=https://evil.example", "?redirect=https://evil.example", "?returnTo=//evil.example"]) {
    await page.goto(`/login${q}`);
    expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? "http://localhost:8088").origin);
  }
});
```

If Me's sign-out control has a different accessible name, use the one in `me-screen.tsx`; if signing out asks for confirmation, confirm it.

- [ ] **Step 4: Run it locally**

```bash
# Terminal 1: Postgres as in README, then the server on the example day
cd server
export GULLAK_JWT_SECRET=$(openssl rand -base64 48) GULLAK_OTP_PEPPER=$(openssl rand -base64 48) GULLAK_ENC_KEY=$(openssl rand -base64 32)
GULLAK_WEB_ORIGIN=http://localhost:8088 GULLAK_DEV_CLOCK_START=2026-10-23T08:00:00Z ./gradlew bootRun --args='--spring.profiles.active=local'
# Terminal 2: the web image (Task 6) on 8088, then the tests
cd app
docker build -f web/Dockerfile --build-arg EXPO_PUBLIC_API_URL=http://localhost:8080/api/v1 -t gullak-web:dev .
docker run -d --rm --name gullak-web -p 8088:8080 -e GULLAK_API_ORIGIN=http://localhost:8080 gullak-web:dev
npm run e2e:web
```

Expected: all tests PASS and `watchCsp` reports nothing. If Chromium reports a CSP violation for an inline script in Expo's `index.html`, the message names the directive and the script's `sha256-…` hash: add exactly that `'sha256-…'` source to `script-src` in `app/web/default.conf.template`, rebuild and rerun; never add `'unsafe-inline'` to `script-src`. If Home redirects to setup after `exampleUser`, the app marks setup complete with a field `exampleUser` does not set: read Plan 2's `index.tsx` redirect and add that call to `exampleUser`.

- [ ] **Step 5: CI**

Extend the `web` job in `.github/workflows/ci.yml` (from Task 6) to:

```yaml
  web:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: gullak
          POSTGRES_PASSWORD: ci-only-db-password
          POSTGRES_DB: gullak
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U gullak" --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      GULLAK_DB_PASSWORD: ci-only-db-password
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "21"
          cache: gradle
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: app/package-lock.json
      - name: Start the server on the example day (local profile)
        run: |
          cd server && ./gradlew bootJar --no-daemon
          export GULLAK_JWT_SECRET=$(openssl rand -base64 48) GULLAK_OTP_PEPPER=$(openssl rand -base64 48) GULLAK_ENC_KEY=$(openssl rand -base64 32)
          GULLAK_WEB_ORIGIN=http://localhost:8088 GULLAK_DEV_CLOCK_START=2026-10-23T08:00:00Z \
            nohup java -jar build/libs/*-SNAPSHOT.jar --spring.profiles.active=local > ../server.log 2>&1 &
          for i in $(seq 1 90); do curl -fs http://localhost:8080/actuator/health > /dev/null && break; sleep 2; done
          curl -fs http://localhost:8080/actuator/health
      - name: Build the web image
        run: docker build -f app/web/Dockerfile --build-arg EXPO_PUBLIC_API_URL=http://localhost:8080/api/v1 -t gullak-web:ci app
      - name: Run it
        run: |
          docker run -d --name web -p 8088:8080 -e GULLAK_API_ORIGIN=http://localhost:8080 gullak-web:ci
          for i in $(seq 1 30); do curl -fs http://localhost:8088/ > /dev/null && break; sleep 1; done
      - name: Security headers (SEC-04, web)
        run: app/web/check-headers.sh http://localhost:8088
      - name: Playwright (E2E-10)
        working-directory: app
        run: |
          npm ci
          npx playwright install --with-deps chromium
          npx playwright test
      - name: Keep the evidence
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: web-e2e
          path: |
            app/playwright-report
            app/test-results
            server.log
          retention-days: 7
```

`server.log` is safe to upload: logs carry no amounts, emails or tokens (LOG-05), and every secret above is generated per run.

- [ ] **Step 6: Commit**

```bash
git add server/src/main/java/in/gullak/common/config/ClockConfig.java server/src/main/resources/application.yml server/src/test/java/in/gullak/common/config/ClockConfigTest.java app/package.json app/package-lock.json app/playwright.config.ts app/e2e-web .github/workflows/ci.yml .gitignore
git commit -m "test(web): E2E-10 Playwright smoke and browser security checks against the export and local server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: CI hardening: pins, permissions, secret scan, dependency audit, wrapper checksum

**Owner:** backend-engineer (CI is shared; app-engineer reviews the app job). **Test IDs:** SEC-08, SEC-09. **Red team:** yes: try to commit a key past the hook (`--no-verify` is expected to work locally, so the CI scan must catch it), change a pinned action to a tag, add a dependency with a known critical advisory, and swap the Gradle distribution URL.

**Files:**
- Create: `scripts/check-pins.sh`, `scripts/pin-actions.sh`, `scripts/install-gitleaks.sh`, `scripts/gitleaks.version`, `scripts/test-secret-scan.sh`, `scripts/test-dependency-audit.sh`, `scripts/install-hooks.sh`, `.githooks/pre-commit`, `.gitleaks.toml`, `.gitleaksignore`, `.github/dependabot.yml`, `server/dependency-check-suppressions.xml`
- Modify: `.github/workflows/ci.yml` (whole file below), `server/build.gradle.kts`, `server/gradle/wrapper/gradle-wrapper.properties`, `README.md` (one paragraph)

**Interfaces:**
- Consumes: the `web` job (Tasks 6, 7), Plan 1's server job, Plan 2's app job.
- Produces: CI jobs `hygiene`, `server`, `server-deps`, `app`, `web`; repository secret `NVD_API_KEY`; `scripts/install-hooks.sh` (developers run it once); `./gradlew dependencyCheckAnalyze`.

- [ ] **Step 1: Write the failing self-tests**

`scripts/test-secret-scan.sh`:

```bash
#!/usr/bin/env bash
# SEC-08: proves the scanner and the pre-commit hook both stop a committed key. The key is generated here,
# in a throwaway repository, so no secret-shaped string is ever committed to Gullak.
set -euo pipefail
repo_root=$(git rev-parse --show-toplevel)
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
git -C "$dir" init -q
key="AKIA$(LC_ALL=C tr -dc 'A-Z2-7' < /dev/urandom | head -c 16)"
secret=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 40)
printf 'aws_access_key_id = %s\naws_secret_access_key = %s\n' "$key" "$secret" > "$dir/creds.txt"
git -C "$dir" add creds.txt

# 1. The pre-commit hook refuses the commit.
if git -C "$dir" -c core.hooksPath="$repo_root/.githooks" -c user.email=probe@example.test -c user.name=probe \
    commit -qm probe > /dev/null 2>&1; then
  echo "FAIL: the pre-commit hook let a key through"
  exit 1
fi
echo "ok: the pre-commit hook blocks a key"

# 2. The history scan CI runs finds it once it is committed anyway (git commit --no-verify).
git -C "$dir" -c user.email=probe@example.test -c user.name=probe commit -qm probe --no-verify
if gitleaks git "$dir" --no-banner --redact > /dev/null 2>&1; then
  echo "FAIL: gitleaks passed a committed key"
  exit 1
fi
echo "ok: the history scan finds a committed key"
```

`scripts/test-dependency-audit.sh`:

```bash
#!/usr/bin/env bash
# SEC-09: proves `npm audit --audit-level=critical` fails on a known critical advisory
# (minimist 0.0.8: prototype pollution, GHSA-xvch-5gv4-984h, rated critical).
set -euo pipefail
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cd "$dir"
printf '{"name":"audit-probe","version":"1.0.0","private":true,"dependencies":{"minimist":"0.0.8"}}\n' > package.json
npm install --package-lock-only --ignore-scripts --no-audit --no-fund --silent
if npm audit --audit-level=critical > /dev/null 2>&1; then
  echo "FAIL: npm audit passed a critical advisory"
  exit 1
fi
echo "ok: npm audit fails on a critical advisory"
```

`scripts/check-pins.sh`:

```bash
#!/usr/bin/env bash
# Supply chain: every GitHub Action is pinned to a full commit SHA, every service and base image to a digest.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0
while IFS= read -r line; do
  ref=$(sed -E 's/.*uses:[[:space:]]*([^[:space:]#]+).*/\1/' <<< "$line")
  [[ "$ref" == ./* ]] && continue
  if ! [[ "$ref" =~ @[0-9a-f]{40}$ ]]; then echo "action not pinned to a commit SHA: $ref"; fail=1; fi
done < <(grep -RhE '^[[:space:]-]*uses:' .github/workflows)
while IFS= read -r line; do
  if ! [[ "$line" =~ @sha256:[0-9a-f]{64} ]]; then echo "service image not pinned to a digest: $line"; fail=1; fi
done < <(grep -RhE '^[[:space:]]+image:[[:space:]]' .github/workflows || true)
while IFS= read -r line; do
  if ! [[ "$line" =~ @sha256:[0-9a-f]{64} ]]; then echo "base image not pinned to a digest: $line"; fail=1; fi
done < <(find . -name Dockerfile -not -path '*/node_modules/*' -exec grep -hE '^FROM[[:space:]]' {} + || true)
[[ $fail == 0 ]] && echo "ok: actions and images are pinned"
exit $fail
```

Make all three executable and run them now:

Run: `scripts/check-pins.sh; scripts/test-dependency-audit.sh; scripts/test-secret-scan.sh`
Expected: `check-pins.sh` FAILS (tags such as `actions/checkout@v4`, `postgres:17`), `test-dependency-audit.sh` prints ok (npm audit already works; this is the gate's proof), `test-secret-scan.sh` FAILS (no hook yet; gitleaks may not be installed: `brew install gitleaks`).

- [ ] **Step 2: The hook, the scanner config and the installer**

`.githooks/pre-commit`:

```bash
#!/usr/bin/env bash
# Blocks commits that add a secret (spec 4.7, SEC-08). Install once with scripts/install-hooks.sh.
set -euo pipefail
if ! command -v gitleaks > /dev/null 2>&1; then
  echo "gitleaks is not installed, so this commit cannot be checked for secrets. Install it (brew install gitleaks) and commit again." >&2
  exit 1
fi
exec gitleaks git --pre-commit --staged --redact --no-banner
```

`scripts/install-hooks.sh`:

```bash
#!/usr/bin/env bash
# Points git at the repository's hooks (the secret scan). Run once per clone.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
chmod +x .githooks/*
git config core.hooksPath .githooks
echo "hooks installed: commits are scanned for secrets"
```

`.gitleaks.toml`:

```toml
title = "Gullak"

[extend]
useDefault = true

[allowlist]
description = "Values that only exist for tests and examples; none is used outside tests"
paths = [
  '''server/src/test/resources/application-test\.yml''',
  '''app/\.env\.example''',
]
```

`.gitleaksignore`: create it empty. Then scan the whole history:

```bash
scripts/install-hooks.sh
gitleaks git . --no-banner --redact -v
```

For each finding, decide: a real secret means stop and tell the founder (rotate it, then rewrite history only with their consent); a test value means add its fingerprint (the `Fingerprint:` line gitleaks prints) to `.gitleaksignore` with a comment line above it saying which test value it is. Rerun until the scan is clean. Then run `scripts/test-secret-scan.sh` → both lines ok.

`scripts/gitleaks.version` pins the CI binary. Create it with:

```bash
v=$(gh release view --repo gitleaks/gitleaks --json tagName -q .tagName | sed 's/^v//')
sha=$(gh release download "v$v" --repo gitleaks/gitleaks -p "gitleaks_${v}_checksums.txt" -O - | awk '/_linux_x64\.tar\.gz$/ {print $1}')
echo "$v $sha" > scripts/gitleaks.version
cat scripts/gitleaks.version
```

The file holds one line: the version and the SHA-256 of `gitleaks_<version>_linux_x64.tar.gz`.

`scripts/install-gitleaks.sh`:

```bash
#!/usr/bin/env bash
# CI: installs the gitleaks release named in scripts/gitleaks.version after checking its SHA-256.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
read -r version sha < "$here/gitleaks.version"
tarball="gitleaks_${version}_linux_x64.tar.gz"
bin="${RUNNER_TEMP:-/tmp}/gitleaks-bin"
mkdir -p "$bin"
curl -fsSL -o "$bin/$tarball" "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${tarball}"
echo "${sha}  ${bin}/${tarball}" | sha256sum --check --strict
tar -xzf "$bin/$tarball" -C "$bin" gitleaks
echo "$bin" >> "${GITHUB_PATH:-/dev/null}"
"$bin/gitleaks" version
```

- [ ] **Step 3: Gradle: wrapper checksum and dependency check**

```bash
cd server
v=$(sed -nE 's/.*gradle-([0-9.]+)-bin\.zip/\1/p' gradle/wrapper/gradle-wrapper.properties)
./gradlew wrapper --gradle-version "$v" --gradle-distribution-sha256-sum "$(curl -fsSL "https://services.gradle.org/distributions/gradle-${v}-bin.zip.sha256")"
grep distributionSha256Sum gradle/wrapper/gradle-wrapper.properties
```

Expected: the properties file now has `distributionSha256Sum=<64 hex>` (deferred from Plan 1); the wrapper refuses a distribution that does not match.

In `server/build.gradle.kts`, add to `plugins { }`:

```kotlin
	id("org.owasp.dependencycheck") version "12.1.0"
```

(use the newest 12.x release on the Gradle Plugin Portal if 12.1.0 has been superseded, and record the version in the task report) and at the end of the file:

```kotlin
// SEC-09: fail the build on a known critical vulnerability (CVSS 9.0 or more) in anything that ships.
dependencyCheck {
	failBuildOnCVSS = 9.0f
	formats = listOf("HTML", "JSON")
	scanConfigurations = listOf("runtimeClasspath")
	suppressionFile = "dependency-check-suppressions.xml"
	nvd {
		apiKey = providers.environmentVariable("NVD_API_KEY").getOrElse("")
	}
	analyzers {
		assemblyEnabled = false
		nodeAudit { enabled = false }
		retirejs { enabled = false }
		ossIndex { enabled = false }
	}
}
```

`server/dependency-check-suppressions.xml` (empty list; every future suppression needs a `<notes>` line saying why it does not apply and a review date):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd">
</suppressions>
```

Request a free NVD API key at https://nvd.nist.gov/developers/request-an-api-key and store it as the repository secret `NVD_API_KEY` (`gh secret set NVD_API_KEY`). Run `NVD_API_KEY=<key> ./gradlew dependencyCheckAnalyze` once locally (the first run downloads the NVD data, several minutes): expected BUILD SUCCESSFUL, or a list of critical findings to fix by upgrading the dependency (through the Spring Boot BOM where it manages it). Prove the gate: add `implementation("commons-collections:commons-collections:3.2.1")` temporarily, rerun → BUILD FAILED naming CVE-2015-7501; remove the line.

- [ ] **Step 4: The workflow**

`.github/workflows/ci.yml` (whole file; the `app` job keeps every step Plan 2 gave it, plus the audit; the `web` job is Task 7's):

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  hygiene:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Actions and images are pinned
        run: scripts/check-pins.sh
      - name: Install gitleaks (pinned, checksummed)
        run: scripts/install-gitleaks.sh
      - name: Secret scan of the whole history (SEC-08)
        run: gitleaks git . --no-banner --redact -v
      - name: The scan and the hook bite (SEC-08)
        run: scripts/test-secret-scan.sh

  server:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: server
    steps:
      - uses: actions/checkout@v4
      - uses: gradle/actions/wrapper-validation@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "21"
          cache: gradle
      - run: ./gradlew test --no-daemon

  server-deps:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: server
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "21"
          cache: gradle
      - name: Cache the NVD data
        uses: actions/cache@v4
        with:
          path: ~/.gradle/dependency-check-data
          key: nvd-${{ github.run_id }}
          restore-keys: nvd-
      - name: Dependency check, fails at CVSS 9 (SEC-09)
        env:
          NVD_API_KEY: ${{ secrets.NVD_API_KEY }}
        run: ./gradlew dependencyCheckAnalyze --no-daemon

  app:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: app
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: npm ci
      - name: Dependency audit, fails on critical (SEC-09)
        run: npm audit --audit-level=critical
      - name: The audit gate bites (SEC-09)
        run: ../scripts/test-dependency-audit.sh
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run format
      - run: npm test -- --ci
      - run: npx expo export --platform web

  web:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: gullak
          POSTGRES_PASSWORD: ci-only-db-password
          POSTGRES_DB: gullak
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U gullak" --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      GULLAK_DB_PASSWORD: ci-only-db-password
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "21"
          cache: gradle
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: app/package-lock.json
      - name: Start the server on the example day (local profile)
        run: |
          cd server && ./gradlew bootJar --no-daemon
          export GULLAK_JWT_SECRET=$(openssl rand -base64 48) GULLAK_OTP_PEPPER=$(openssl rand -base64 48) GULLAK_ENC_KEY=$(openssl rand -base64 32)
          GULLAK_WEB_ORIGIN=http://localhost:8088 GULLAK_DEV_CLOCK_START=2026-10-23T08:00:00Z \
            nohup java -jar build/libs/*-SNAPSHOT.jar --spring.profiles.active=local > ../server.log 2>&1 &
          for i in $(seq 1 90); do curl -fs http://localhost:8080/actuator/health > /dev/null && break; sleep 2; done
          curl -fs http://localhost:8080/actuator/health
      - name: Build the web image
        run: docker build -f app/web/Dockerfile --build-arg EXPO_PUBLIC_API_URL=http://localhost:8080/api/v1 -t gullak-web:ci app
      - name: Run it
        run: |
          docker run -d --name web -p 8088:8080 -e GULLAK_API_ORIGIN=http://localhost:8080 gullak-web:ci
          for i in $(seq 1 30); do curl -fs http://localhost:8088/ > /dev/null && break; sleep 1; done
      - name: Security headers (SEC-04, web)
        run: app/web/check-headers.sh http://localhost:8088
      - name: Playwright (E2E-10)
        working-directory: app
        run: |
          npm ci
          npx playwright install --with-deps chromium
          npx playwright test
      - name: Keep the evidence
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: web-e2e
          path: |
            app/playwright-report
            app/test-results
            server.log
          retention-days: 7
```

Then pin everything:

`scripts/pin-actions.sh`:

```bash
#!/usr/bin/env bash
# Rewrites every `uses: owner/repo[/path]@vN` in .github/workflows to the commit SHA that tag points at now,
# keeping the tag as a comment. Dependabot keeps the SHAs current afterwards. Needs the gh CLI, signed in.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
for f in .github/workflows/*.yml; do
  grep -oE 'uses: [A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@v[0-9][0-9.]*' "$f" | sort -u | while read -r _ ref; do
    action=${ref%@*}
    tag=${ref#*@}
    repo=$(cut -d/ -f1,2 <<< "$action")
    sha=$(gh api "repos/$repo/commits/$tag" --jq .sha)
    sed -i.bak -E "s#uses: ${ref}([[:space:]]|\$)#uses: ${action}@${sha} \# ${tag}\1#" "$f"
    rm -f "$f.bak"
  done
done
echo "pinned:"
grep -RhE 'uses:' .github/workflows | sort -u
```

```bash
chmod +x scripts/*.sh
scripts/pin-actions.sh
docker buildx imagetools inspect postgres:17 --format '{{json .Manifest.Digest}}'
```

Write the printed digest into the `web` job as `image: postgres:17@sha256:<digest>`. Then run `scripts/check-pins.sh` → `ok: actions and images are pinned`.

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
  - package-ecosystem: npm
    directory: /app
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
  - package-ecosystem: gradle
    directory: /server
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
  - package-ecosystem: docker
    directory: /server
    schedule: { interval: weekly }
  - package-ecosystem: docker
    directory: /app/web
    schedule: { interval: weekly }
```

In `README.md`, under the first heading, add: "After cloning, run `scripts/install-hooks.sh` once (needs `gitleaks`, `brew install gitleaks`): every commit is scanned for secrets."

- [ ] **Step 5: Run everything**

Run: `scripts/check-pins.sh && scripts/test-secret-scan.sh && scripts/test-dependency-audit.sh && (cd server && ./gradlew test) && (cd app && npm audit --audit-level=critical && npm test)`
Expected: PASS. Push the branch and confirm all five CI jobs pass; paste the run URL into the task report.

- [ ] **Step 6: Red team**

Dispatch `red-team` with task id `plan-09-task-8` on the attack list in this task's header, on a throwaway branch. Findings to `docs/reports/red-team/plan-09-task-8.md`.

- [ ] **Step 7: Commit**

```bash
git add scripts .githooks .gitleaks.toml .gitleaksignore .github server/build.gradle.kts server/gradle/wrapper/gradle-wrapper.properties server/dependency-check-suppressions.xml README.md docs/reports/red-team/plan-09-task-8.md
git commit -m "ci: pinned actions and images, secret scan with a pre-commit hook, dependency gates, wrapper checksum

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Production: server container, App Platform spec, release workflow

**Owner:** backend-engineer. **Test IDs:** new REL-01 (the image runs as a non-root user), new REL-02 (the image refuses to start in prod without its settings) (rows added in Task 11). **Red team:** yes: the image's user, files and open ports; whether any secret is baked into an image layer (`docker history --no-trunc`, `dive`); whether the release workflow can be triggered from a fork or a branch.

**Files:**
- Create: `server/Dockerfile`, `server/.dockerignore`, `.do/app.yaml`, `.github/workflows/release.yml`
- Modify: `.github/workflows/ci.yml` (new `server-image` job), `.gitignore`

**Interfaces:**
- Consumes: every prod setting from Plans 1, 4, 8 and this plan (listed in `.do/app.yaml`); `app/web/Dockerfile` (Task 6).
- Produces: images `registry.digitalocean.com/gullak/api:<sha>` and `registry.digitalocean.com/gullak/web:<sha>`; App Platform app `gullak` in `blr`; repository variables `DO_APP_ID`, `GULLAK_PUBLIC_URL`; secret `DIGITALOCEAN_ACCESS_TOKEN`; environment `production`. A deploy is `git tag vX.Y.Z && git push --tags`.

- [ ] **Step 1: Write the failing check**

Append to `.github/workflows/ci.yml`:

```yaml
  server-image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: docker build -t gullak-server:ci server
      - name: Runs as a non-root user (REL-01)
        run: |
          uid=$(docker run --rm --entrypoint id gullak-server:ci -u)
          echo "uid=$uid"
          test "$uid" != "0"
      - name: Refuses to start in prod without its settings (REL-02)
        run: |
          set +e
          timeout 120 docker run --rm -e SPRING_PROFILES_ACTIVE=prod gullak-server:ci > boot.log 2>&1
          code=$?
          set -e
          echo "exit code $code"
          test "$code" -ne 0 && test "$code" -ne 124
          grep -q "GULLAK_" boot.log
```

Run the same commands locally after Step 2: `docker build -t gullak-server:dev server` fails now (no Dockerfile).

- [ ] **Step 2: The image**

`server/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
# Build from server/:  docker build -t gullak-server .
FROM eclipse-temurin:21-jdk-noble AS build
WORKDIR /src
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle gradle
RUN ./gradlew --no-daemon --quiet dependencies > /dev/null
COPY src src
# Tests ran in CI before a release tag exists; the image only packages.
RUN ./gradlew --no-daemon bootJar -x test && cp build/libs/*-SNAPSHOT.jar /src/app.jar

FROM eclipse-temurin:21-jre-noble
RUN groupadd --system gullak && useradd --system --gid gullak --no-create-home --shell /usr/sbin/nologin gullak
WORKDIR /app
COPY --from=build /src/app.jar /app/app.jar
USER gullak
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Pin both bases (`docker buildx imagetools inspect eclipse-temurin:21-jdk-noble --format '{{json .Manifest.Digest}}'`, the same for `eclipse-temurin:21-jre-noble`) and write them as `FROM eclipse-temurin:21-jdk-noble@sha256:<digest> AS build` and `FROM eclipse-temurin:21-jre-noble@sha256:<digest>`.

`server/.dockerignore`:

```
build
.gradle
*.log
.env
```

Run: `docker build -t gullak-server:dev server`, then the two checks from Step 1 by hand (`docker run --rm --entrypoint id gullak-server:dev -u` prints a non-zero uid; `docker run --rm -e SPRING_PROFILES_ACTIVE=prod gullak-server:dev` exits non-zero within a minute and its log names a `GULLAK_` setting). Then `scripts/check-pins.sh` → ok.

- [ ] **Step 3: The App Platform spec**

`.do/app.yaml` (used once for `doctl apps create`; later deploys only change image tags, Step 4). Values marked `SECRET` are typed into App Platform, never into this file:

```yaml
# Gullak on DigitalOcean App Platform, Bangalore (spec 4.1: data hosted in India).
# One origin: /api goes to the server with the prefix kept, everything else to the web container.
name: gullak
region: blr
alerts:
  - rule: DEPLOYMENT_FAILED
  - rule: DOMAIN_FAILED
ingress:
  rules:
    - match:
        path:
          prefix: /api
      component:
        name: api
        preserve_path_prefix: true
    - match:
        path:
          prefix: /
      component:
        name: web
services:
  - name: api
    image:
      registry_type: DOCR
      repository: api
      tag: initial
    instance_count: 1 # the in-memory rate limiter is per instance; stay at one until limits move to Postgres
    instance_size_slug: apps-s-1vcpu-1gb
    http_port: 8080
    health_check:
      http_path: /actuator/health
      initial_delay_seconds: 40
    alerts:
      - rule: CPU_UTILIZATION
        operator: GREATER_THAN
        value: 80
        window: TEN_MINUTES
      - rule: MEM_UTILIZATION
        operator: GREATER_THAN
        value: 85
        window: TEN_MINUTES
    envs:
      - { key: SPRING_PROFILES_ACTIVE, value: prod, scope: RUN_TIME }
      - { key: SPRING_DATASOURCE_URL, value: "jdbc:postgresql://${gullak-db.HOSTNAME}:${gullak-db.PORT}/${gullak-db.DATABASE}?sslmode=require", scope: RUN_TIME }
      - { key: SPRING_DATASOURCE_USERNAME, value: "${gullak-db.USERNAME}", scope: RUN_TIME }
      - { key: SPRING_DATASOURCE_PASSWORD, value: "${gullak-db.PASSWORD}", scope: RUN_TIME, type: SECRET }
      - { key: GULLAK_WEB_ORIGIN, value: "${APP_URL}", scope: RUN_TIME }
      - { key: GULLAK_PUBLIC_URL, value: "${APP_URL}", scope: RUN_TIME }
      - { key: GULLAK_TRUSTED_PROXIES, scope: RUN_TIME, type: SECRET }
      - { key: GULLAK_JWT_SECRET, scope: RUN_TIME, type: SECRET }
      - { key: GULLAK_OTP_PEPPER, scope: RUN_TIME, type: SECRET }
      - { key: GULLAK_ENC_KEY, scope: RUN_TIME, type: SECRET }
      - { key: GULLAK_MAIL_FROM, scope: RUN_TIME }
      - { key: GULLAK_SUPPORT_EMAIL, scope: RUN_TIME }
      - { key: AWS_REGION, value: ap-south-1, scope: RUN_TIME }
      - { key: AWS_ACCESS_KEY_ID, scope: RUN_TIME, type: SECRET }
      - { key: AWS_SECRET_ACCESS_KEY, scope: RUN_TIME, type: SECRET }
      - { key: GULLAK_EXPO_ACCESS_TOKEN, scope: RUN_TIME, type: SECRET }
  - name: web
    image:
      registry_type: DOCR
      repository: web
      tag: initial
    instance_count: 1
    instance_size_slug: apps-s-1vcpu-0.5gb
    http_port: 8080
    health_check:
      http_path: /
    envs:
      - { key: GULLAK_API_ORIGIN, value: "", scope: RUN_TIME }
databases:
  - name: gullak-db
    engine: PG
    version: "17"
    production: true
    cluster_name: gullak-db
    db_name: gullak
    db_user: gullak
```

Add `.do/*.local.yaml` to `.gitignore` (the release checklist fills secrets into a local copy for the first create). If `doctl` is installed, run `doctl apps spec validate .do/app.yaml --schema-only` → valid.

- [ ] **Step 4: The release workflow**

`.github/workflows/release.yml`:

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
concurrency:
  group: release
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    env:
      TAG: ${{ github.sha }}
      REGISTRY: registry.digitalocean.com/gullak
    steps:
      - uses: actions/checkout@v4
      - uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
      - name: Sign in to the registry
        run: doctl registry login --expiry-seconds 1800
      - name: Build and push the server
        run: |
          docker build -t "$REGISTRY/api:$TAG" server
          docker push "$REGISTRY/api:$TAG"
      - name: Build and push the web app
        env:
          API_URL: ${{ vars.GULLAK_PUBLIC_URL }}/api/v1
        run: |
          test -n "${{ vars.GULLAK_PUBLIC_URL }}"
          docker build -f app/web/Dockerfile --build-arg EXPO_PUBLIC_API_URL="$API_URL" -t "$REGISTRY/web:$TAG" app
          docker push "$REGISTRY/web:$TAG"
      - name: Point the live app at the new images
        env:
          APP_ID: ${{ vars.DO_APP_ID }}
        run: |
          doctl apps spec get "$APP_ID" > spec.yaml
          yq -i '(.services[] | select(.name == "api" or .name == "web") | .image.tag) = strenv(TAG)' spec.yaml
          doctl apps update "$APP_ID" --spec spec.yaml --wait
          rm spec.yaml
      - name: Smoke the deploy
        env:
          URL: ${{ vars.GULLAK_PUBLIC_URL }}
        run: |
          # The API answers through the shared origin (401 without a token) and the web app carries its headers.
          test "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/v1/budget/today")" = 401
          curl -fsS -D - -o /dev/null "$URL/" | grep -qi "frame-ancestors 'none'"
          curl -fsS -D - -o /dev/null "$URL/" | grep -qi "strict-transport-security"
```

The live spec fetched by `doctl apps spec get` carries the encrypted secret values, so updating only the tags keeps them. The `production` environment in GitHub should require the founder's approval (release checklist), so a tag alone cannot ship without a click. Run `scripts/pin-actions.sh` again to pin the new workflow's actions, then `scripts/check-pins.sh` → ok.

- [ ] **Step 5: Red team**

Dispatch `red-team` with task id `plan-09-task-9` on the attack list in this task's header. Findings to `docs/reports/red-team/plan-09-task-9.md`.

- [ ] **Step 6: Commit**

```bash
git add server/Dockerfile server/.dockerignore .do/app.yaml .github/workflows/release.yml .github/workflows/ci.yml .gitignore docs/reports/red-team/plan-09-task-9.md
git commit -m "build: server image, App Platform spec for Bangalore, tag-driven release workflow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: EAS: build profiles and workflows

**Owner:** app-engineer. **Test IDs:** new REL-03 (row added in Task 11). **Red team:** no (no secret is committed: the API URL lives in EAS environments; store credentials are added by the founder).

**Files:**
- Create: `app/eas.json`, `app/.eas/workflows/preview.yml`, `app/.eas/workflows/release.yml`, `app/src/release-config.test.ts`
- Modify: `app/app.config.ts`, `app/package.json` (`expo-dev-client`)

**Interfaces:**
- Consumes: Plan 2's `app.config.ts` (`ios.bundleIdentifier` and `android.package` `in.gullak.app`), `EXPO_PUBLIC_API_URL`.
- Produces: EAS profiles `development`, `preview`, `production`; EAS environments of the same names each holding `EXPO_PUBLIC_API_URL`; workflows "Preview builds" (push to `main`) and "Store release" (tags `v*`).

- [ ] **Step 1: Write the failing test**

`app/src/release-config.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import config from "../app.config";

type Profile = {
  developmentClient?: boolean;
  distribution?: string;
  environment?: string;
  autoIncrement?: boolean;
  env?: Record<string, string>;
  android?: { buildType?: string };
};
const eas = JSON.parse(readFileSync(path.resolve(__dirname, "../eas.json"), "utf8")) as {
  cli: { appVersionSource?: string };
  build: Record<string, Profile>;
};

describe("release configuration (REL-03)", () => {
  it("has exactly the three build profiles", () => {
    expect(Object.keys(eas.build).sort()).toEqual(["development", "preview", "production"]);
  });

  it("development is a dev client installed internally", () => {
    expect(eas.build.development).toMatchObject({ developmentClient: true, distribution: "internal" });
  });

  it("preview is an internal Android APK", () => {
    expect(eas.build.preview).toMatchObject({ distribution: "internal", android: { buildType: "apk" } });
  });

  it("production takes its build number from EAS and increments it", () => {
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(eas.build.production?.autoIncrement).toBe(true);
  });

  it("every profile reads its settings from the EAS environment of the same name, never from eas.json", () => {
    for (const [name, profile] of Object.entries(eas.build)) {
      expect({ name, environment: profile.environment, env: profile.env }).toEqual({ name, environment: name, env: undefined });
    }
  });

  it("the app is linked to its EAS project and declares exempt encryption (TLS only)", () => {
    const extra = config.extra as { eas?: { projectId?: string } } | undefined;
    expect(extra?.eas?.projectId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
  });
});
```

Run: `cd app && npx jest src/release-config` → FAIL (`eas.json` missing).

- [ ] **Step 2: Link the project and write the profiles**

```bash
cd app
npx expo install expo-dev-client
npx eas-cli@latest login
npx eas-cli@latest init
```

`eas init` prints the project ID (a UUID) and the owner. Because `app.config.ts` is code, it cannot write them itself: add them by hand. In `app/app.config.ts` add to the config object (with the printed values):

```ts
  owner: "<the Expo account name eas init printed>",
  extra: { eas: { projectId: "<the project ID eas init printed>" } },
```

and inside `ios`:

```ts
    // Only standard TLS is used, which is exempt from US export rules; skips the App Store compliance question.
    config: { usesNonExemptEncryption: false },
```

Both values are identifiers, not secrets.

`app/eas.json`:

```json
{
  "cli": {
    "version": ">= 16.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development"
    },
    "preview": {
      "distribution": "internal",
      "environment": "preview",
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true,
      "environment": "production"
    }
  },
  "submit": {
    "production": {
      "android": { "track": "internal" }
    }
  }
}
```

Set the API URL per environment (plain text: it ships inside the app anyway; `GULLAK_PUBLIC_URL` is the App Platform URL from the release checklist until a domain exists):

```bash
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_API_URL --value "http://10.0.2.2:8080/api/v1" --visibility plaintext
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_API_URL --value "$GULLAK_PUBLIC_URL/api/v1" --visibility plaintext
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_API_URL --value "$GULLAK_PUBLIC_URL/api/v1" --visibility plaintext
```

- [ ] **Step 3: The workflows**

`app/.eas/workflows/preview.yml`:

```yaml
name: Preview builds

on:
  push:
    branches: ["main"]

jobs:
  android_preview:
    name: Android preview (internal APK)
    type: build
    params:
      platform: android
      profile: preview
```

`app/.eas/workflows/release.yml`:

```yaml
name: Store release

on:
  push:
    tags: ["v*"]

jobs:
  build_android:
    name: Android production build
    type: build
    params:
      platform: android
      profile: production

  build_ios:
    name: iOS production build
    type: build
    params:
      platform: ios
      profile: production

  # Submissions need the store accounts (spec 6, open). Until they exist these two jobs fail and the builds
  # are submitted by hand (release checklist).
  submit_android:
    name: Submit to Google Play (internal track)
    type: submit
    needs: [build_android]
    params:
      platform: android
      profile: production

  submit_ios:
    name: Submit to TestFlight
    type: submit
    needs: [build_ios]
    params:
      platform: ios
      profile: production
```

Validate each file with the live schema (needs the signed-in CLI and the linked project):

```bash
npx -y eas-cli@latest workflow:validate .eas/workflows/preview.yml --non-interactive
npx -y eas-cli@latest workflow:validate .eas/workflows/release.yml --non-interactive
```

Expected: `Workflow configuration YAML is valid.` for both. If the validator rejects a parameter (for example submit wanting `build_id: ${{ needs.build_ios.outputs.build_id }}`), change it as the validator says and rerun until valid. EAS Workflows run on GitHub pushes only once the GitHub repository is linked to the EAS project (expo.dev → project → GitHub); the release checklist covers it.

- [ ] **Step 4: Run the tests and one build**

Run: `cd app && npm test && npm run lint && npm run typecheck`
Expected: PASS.

Run one preview build by hand: `npx eas-cli@latest build --platform android --profile preview --non-interactive`. Expected: an install link; install the APK on an Android phone and sign in against the deployed server (or note in the task report that the server is not deployed yet and the build was installed and opened to the login screen).

- [ ] **Step 5: Commit**

```bash
git add app/eas.json app/.eas app/app.config.ts app/package.json app/package-lock.json app/src/release-config.test.ts
git commit -m "build(app): EAS profiles and workflows for preview and store builds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs: complete `docs/api.md` with a coverage test, release checklist, test-case edits

**Owner:** qa-engineer. **Test IDs:** new DOC-01 (every endpoint is documented); the manual checklist (test-cases section 11) becomes `docs/release-checklist.md`. **Red team:** no.

**Files:**
- Create: `server/src/test/java/in/gullak/ApiDocsTest.java`, `docs/release-checklist.md`
- Modify: `docs/api.md` (create it if no earlier plan did), `README.md`, `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`, `docs/superpowers/plans/README.md`

**Interfaces:**
- Consumes: every controller in `server/` (Plans 1–9), the env vars of every plan, `docs/ux-test-findings.md`.
- Produces: `docs/api.md` rows in the form `| METHOD | /api/v1/path/{id} | … |`, kept complete by `ApiDocsTest`; `docs/release-checklist.md`.

- [ ] **Step 1: Write the failing test**

`server/src/test/java/in/gullak/ApiDocsTest.java`:

```java
package in.gullak;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.support.ApiTest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/** DOC-01: every endpoint the server maps appears in docs/api.md as "| METHOD | path |". */
class ApiDocsTest extends ApiTest {
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping mappings;

    @Test
    void everyEndpointIsDocumented() throws Exception {
        String doc = Files.readString(Path.of("../docs/api.md"));
        List<String> missing = new ArrayList<>();
        mappings.getHandlerMethods().forEach((info, method) -> {
            String type = method.getBeanType().getName();
            if (!type.startsWith("in.gullak.") || type.startsWith("in.gullak.support.")) {
                return; // Spring's own error controller and the test-only probes
            }
            assertThat(info.getMethodsCondition().getMethods()).as("%s maps no HTTP method", method).isNotEmpty();
            for (String path : info.getPatternValues()) {
                for (RequestMethod m : info.getMethodsCondition().getMethods()) {
                    if (!doc.contains("| " + m.name() + " | " + path + " |")) {
                        missing.add(m.name() + " " + path);
                    }
                }
            }
        });
        assertThat(missing).as("endpoints missing from docs/api.md").isEmpty();
    }
}
```

Run: `cd server && ./gradlew test --tests 'in.gullak.ApiDocsTest'`
Expected: FAIL, listing every endpoint the document does not have yet (local-only endpoints such as `/auth/dev/otp` are not mapped under the `test` profile and are documented by hand below).

- [ ] **Step 2: Write `docs/api.md`**

Keep whatever earlier plans wrote (Plan 8 documented the Me and data endpoints and the export columns) and bring the whole file to this structure: an introduction, then these sections in order. The first two sections are written out here in full; the endpoint tables list every endpoint the failing test printed, one row each, with the request and response taken from the controller's records (field names and types exactly as in the Java record, money in paise) and every error code the endpoint can return.

````markdown
# Gullak API

REST under `/api/v1`, JSON, money in paise (integers), dates as ISO strings (`2026-10-23`), instants in UTC (`2026-10-23T08:00:00Z`). Every endpoint except `/api/v1/auth/*` and `GET /actuator/health` needs `Authorization: Bearer <access token>`. Another user's object answers 404, never 403. Error bodies are `{code, message}`, plus `fields` for `VALIDATION`, `details` where a code says so, and `errorId` for `INTERNAL`. Codes: `server/src/main/java/in/gullak/common/error/ErrorCode.java`.

## Sessions

| Client | Sign in | Refresh | Sign out |
|---|---|---|---|
| Phone | `POST /auth/otp/verify` → `{accessToken, refreshToken, expiresIn}`; tokens in SecureStore | `POST /auth/refresh {refreshToken}` → a new pair | `POST /auth/logout {refreshToken}` |
| Web | the same request with `X-Requested-With: gullak-web` → `{accessToken, expiresIn}` and `Set-Cookie: __Host-gullak_rt=…; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Strict` | `POST /auth/refresh` with no body, the cookie and the header → `{accessToken, expiresIn}` and a rotated cookie | `POST /auth/logout` with the cookie and the header → 204 and the cookie cleared |

- Access tokens last 15 minutes. Refresh tokens last 30 days, are single use and rotate on every refresh. Reusing a spent one revokes every session of that user (`TOKEN_REUSED`); an expired or signed-out one is just refused.
- Cookie refresh or logout without `X-Requested-With: gullak-web` is 403 `CSRF` and spends nothing. Two refresh cookies in one request are 401 `UNAUTHENTICATED`. The web client sends the header and `credentials: "include"` on every call.
- A phone body token wins over a cookie. With neither, refresh is 401 `UNAUTHENTICATED` and logout is 204.

## Cross-cutting

- **Origins.** Browsers may call the API only from `GULLAK_WEB_ORIGIN`. Any other `Origin` (including `null`) gets 403 `CSRF` with no CORS headers and the request does not run. Same-origin requests and phones (no `Origin`) are unaffected. Allowed headers: `Authorization`, `Content-Type`, `Accept`, `X-Request-Id`, `X-Requested-With`; exposed: `X-Request-Id`.
- **Headers on every response.** `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and over HTTPS `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- **Limits.** JSON bodies up to 64 KB (413 `TOO_LARGE`); statement uploads up to 10 MB. OTP request: 5 per email and `GULLAK_OTP_IP_LIMIT` (30) per IP per 10 minutes; OTP check: 30 per email per 15 minutes and the same per-IP limit; at most 10 wrong codes per email per day. Over a limit: 429 `RATE_LIMITED`.
- **Request IDs.** `X-Request-Id` is echoed when it is safe, otherwise generated; it is in every log line for the request.

## Auth
## Profile and fixed costs
## Today and cycles
## Spends
## Imports
## Goals
## Insights and subscriptions
## Game and content
## Me, data and notifications
## Local profile only

| Method | Path | Request → response |
|---|---|---|
| POST | /api/v1/auth/dev/otp | `{email}` → `{code}`: the last code the in-memory mailer "sent" |
| POST | /api/v1/dev/goals/{id}/fall-behind | → 204: moves the goal two paydays behind (E2E-06) |
````

Under each area heading, a table with the columns `| Method | Path | Request → response | Errors |`, one row per endpoint, the path written exactly as Spring maps it (`/api/v1/me/fixed-costs/{id}`). Rerun the test until it passes.

- [ ] **Step 3: Write `docs/release-checklist.md`**

````markdown
# Release checklist

Run top to bottom for every release. Record the date, the tag, who ran it and every result in `docs/reports/<date>-release-<tag>.md`. A failed step stops the release.

## 1. Before the first deploy (once)

1. DigitalOcean, region Bangalore: create the container registry `gullak`, then the Managed Postgres 17 cluster `gullak-db` in `blr1` (daily backups and 7-day point-in-time recovery are on by default; confirm both in the console).
2. Copy `.do/app.yaml` to `.do/app.local.yaml` (git-ignored), type every secret below into it, run `doctl apps create --spec .do/app.local.yaml`, then delete the local copy. Record the app ID as the repository variable `DO_APP_ID` and the app URL as `GULLAK_PUBLIC_URL` (`gh variable set`). Store a DigitalOcean token limited to this app and registry as the secret `DIGITALOCEAN_ACCESS_TOKEN`.
3. In GitHub, create the environment `production` with the founder as required reviewer; protect `main` so CI must pass before merge; only tag commits on `main`.
4. Link the GitHub repository to the EAS project (expo.dev → project → GitHub) so EAS Workflows run; create the three EAS environments (Task 10).
5. SES (Plan 8): verify the sending domain (DKIM) and request production access in `ap-south-1`.
6. When the domain is chosen (spec 6): add it to the app in App Platform as the primary domain; `${APP_URL}` then follows it, so `GULLAK_WEB_ORIGIN` and `GULLAK_PUBLIC_URL` update on the next deploy. Update the `GULLAK_PUBLIC_URL` variable and the EAS environments, and ship a new app build.

## 2. Settings

Server (`api` component). Every value is per environment; never commit one.

| Setting | Value |
|---|---|
| `SPRING_PROFILES_ACTIVE` | `prod` |
| `SPRING_DATASOURCE_URL`, `_USERNAME`, `_PASSWORD` | bound from `gullak-db` in the spec (`sslmode=require`) |
| `GULLAK_JWT_SECRET` | `openssl rand -base64 48`; changing it signs everyone out within 15 minutes |
| `GULLAK_OTP_PEPPER` | `openssl rand -base64 48`; changing it voids codes in flight |
| `GULLAK_ENC_KEY` | `openssl rand -base64 32`; losing it makes stored statement text unreadable: keep a copy in the founder's password manager |
| `GULLAK_TRUSTED_PROXIES` | regex of the App Platform load balancer addresses; start with `10\.\d{1,3}\.\d{1,3}\.\d{1,3}` and verify in section 4 |
| `GULLAK_WEB_ORIGIN`, `GULLAK_PUBLIC_URL` | `${APP_URL}` (the spec binds them) |
| `GULLAK_MAIL_FROM`, `GULLAK_SUPPORT_EMAIL` | addresses on the verified SES domain |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `ap-south-1`; an IAM user allowed only `ses:SendEmail` |
| `GULLAK_EXPO_ACCESS_TOKEN` | Expo access token with push permission (enhanced push security on) |
| `GULLAK_OTP_IP_LIMIT` | unset (30) unless section 4 says to raise it |
| `GULLAK_DEV_CLOCK_START` | **never set**: prod refuses to start with it |

Web (`web` component): `GULLAK_API_ORIGIN` empty (same origin). Build argument `EXPO_PUBLIC_API_URL` = `GULLAK_PUBLIC_URL/api/v1` (the release workflow passes it).

Phone apps: `EXPO_PUBLIC_API_URL` in the EAS environments `preview` and `production`.

## 3. Ship

1. CI is green on the commit (all jobs: hygiene, server, server-deps, app, web, server-image).
2. Migrations: list the new files under `server/src/main/resources/db/migration` since the last tag. Each must be additive (App Platform starts the new instance before stopping the old one, so old code runs briefly against the new schema). A destructive change ships in two releases. Take a manual backup: `doctl databases backups list gullak-db` shows today's; if a migration rewrites data, also fork the cluster first.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`. Approve the `production` environment in GitHub. The release workflow pushes both images, updates the app and smoke-tests it. Flyway applies the migrations on start-up; check `flyway_schema_history` has the new rows.
4. The same tag starts the EAS "Store release" workflow. Until the store accounts exist, submit by hand: `npx eas-cli@latest submit -p ios --latest` (TestFlight) and `-p android --latest` (internal track).
5. Rollback: `doctl apps list-deployments $DO_APP_ID`, then `doctl apps create-deployment` from the previous deployment's spec (its image tags). Migrations are never rolled back; that is why they are additive.

## 4. After deploy, on production

1. `curl -sI $GULLAK_PUBLIC_URL/` shows `content-security-policy` with `frame-ancestors 'none'`, `strict-transport-security`, `x-content-type-options: nosniff`; `curl -s -o /dev/null -w '%{http_code}' $GULLAK_PUBLIC_URL/api/v1/budget/today` is 401.
2. Client IPs: from one phone on mobile data, request sign-in codes for 31 different made-up addresses within 10 minutes: the 31st is refused ("Too many requests"). Straight after, from a laptop on another network, request a code: it works. If the laptop is refused too, the server sees the proxy's address: add the proxy's ranges to `GULLAK_TRUSTED_PROXIES` and repeat.
3. Shared mobile IPs: search the logs (App Platform → Runtime logs) for `rate.limited kind=otp-request-ip` weekly for the first month. Indian carriers put many users behind one IP; if real users hit it, raise `GULLAK_OTP_IP_LIMIT` (for example to 60) and redeploy.
4. Web on Safari (Playwright covers Chromium only): sign in on an iPhone and on a Mac, reload, close and reopen the tab: still signed in. Safari's developer tools show the `__Host-gullak_rt` cookie as HttpOnly and Secure, and Local Storage holds no token.
5. Web: `/add`, `/report-card` and `/onboarding/notifications` typed into the address bar land on Home; upload a CSV, create a goal, sign out.

## 5. Manual checklist on a real Android phone and an iPhone

Built from the prototype test in `docs/ux-test-findings.md` (main flows B1–B8, edge flows C1–C16, consistency D1–D3), against a production or preview build. Tick each; any miss is a bug with a screenshot.

1. Sign in with an email code; a wrong code shows the error; "Send a new code" works.
2. Setup 1: each payday option (1st, last working day, another date with the day picker) updates the cycle line.
3. Setup 2: add Rent and Cook; edit an amount; add a custom cost; remove one and undo within 5 seconds; the list scrolls; "Add another" hides when the list is empty.
4. Setup 3: the savings stepper shows Doable, Tight and Not possible at the thresholds; on Not possible, Continue is disabled and reads "Lower your savings to continue"; tapping the number lets you type an amount.
5. Setup 3: savings ₹0 shows "No savings this month. Set a target later from Me".
6. Setup 3: "How much money do you have left until payday?" is pre-filled with the pro-rated amount; changing it changes the per-day figure.
7. Setup 4: each personality previews its own line.
8. The notification step explains the four messages before the system prompt; "Not now" continues.
9. First-run Home shows "Day one", the Gullak's hello and the pro-rated budget.
10. Quick-add opens at ₹0 with an empty merchant; the button reads "Enter an amount" and is disabled.
11. Quick-add: "00" at zero stays ₹0; an eighth digit is ignored.
12. Quick-add: category chips scroll in one row and the screen never scrolls sideways; the button reads "Add ₹250" with no stray space.
13. Quick-add: ₹12,000 asks "Sure?" once; the second tap saves.
14. Quick-add: closing with an amount asks; Keep editing keeps it; Discard closes; closing at ₹0 closes without asking.
15. Adding a spend: the coin drops, Home updates, +5 XP.
16. Spend detail: change to ₹180 and save; Save is disabled at ₹0; delete asks first and says what changes; Home goes back.
17. Add a statement shows the supported banks, the last upload and the duplicate-statement note.
18. HDFC sample with its password: show and hide the password; a wrong password keeps the file and explains what to try; the right one reads it.
19. Preview shows the counts; Import and sort.
20. Swipe-to-sort, 14 cards: right, left, up and the three buttons all tag; a chip change before tagging sticks; Undo restores the last card; the hint labels do not collide; plurals read right ("1 regret", "2 regrets"); "All sorted".
21. Unsupported bank: "Yes Bank not supported" on one line; Ask for Yes Bank support; Upload a CSV.
22. CSV with unknown columns: map them, "Looks right"; a second upload from the same bank needs no mapping.
23. A scanned PDF shows the scanned-PDF screen.
24. The same statement twice: "Nothing new".
25. Insights: totals match Home; a category opens its spends; "Still using?" offers "Using it" and "Cancelled".
26. New goal opens empty; Start reads "Name your goal to start" until named; a month that has passed shows "That month has passed".
27. New goal: the verdict changes with target and date; Start this quest.
28. Goal detail: edit, pause, resume, delete, add money by hand; the catch-up plan opens from the goal.
29. Over budget: the catch-up card; picking a plan changes the title to "<goal>: catching up" and tomorrow's budget; Undo restores both.
30. The Gullak: nervous brows slope up (worried, not angry); it faints when over budget; with Reduce Motion on it shows still images.
31. Night report card: Next, Back, Skip, Share and Done; card 4 speaks in the chosen personality; tapping the grade explains it.
32. Badges: Goal crusher shows the furthest goal; Back works.
33. Me: Download my data shows its status; the email arrives and its link works for 24 hours.
34. Me: Delete account asks first and locks the account; the restore link in the email restores it.
35. Me: sign out clears the session and the offline queue; signing in again shows the right account.
36. Me: each notification switch turns its message off.
37. Tab bar: every tab opens; + opens quick-add.
38. TalkBack and VoiceOver read a label on every icon-only button.
39. Offline: airplane mode, add a spend, back online: it appears once.

Plus (test-cases section 11):

40. The morning and night messages arrive at the times set in setup; change a time in Me and the next message follows it.
41. Quiet hours: a server push due between 23:00 and 07:00 (force one with an off-track goal after the 00:20 job) arrives at 07:00, and no more than four server pushes arrive in a day.
42. Share the night report card to Instagram stories: the 1080×1920 image fills the story without cropping the grade or the Gullak.
43. Restart the phone mid-sync: add three spends offline, turn the network on and restart the phone while they send; after restart each spend exists once on the server and on Home.
````

- [ ] **Step 4: README, test cases, roadmap**

`README.md`: add a "Configuration" row for each of `GULLAK_WEB_ORIGIN` (all profiles; required in prod; comma-separated exact origins), `GULLAK_OTP_IP_LIMIT` (default 30), `GULLAK_DEV_CLOCK_START` (local only), and `gullak.http.rate-limit-keys` (default 100000); a "Web end-to-end" section with the commands of Task 7 Step 4; a "Release" line pointing at `docs/release-checklist.md`; and replace the "API so far" tables with a pointer to `docs/api.md`.

`docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md` (edit exactly these rows):

- API-AUTH-16 Expected: `403 CSRF; the cookie is not spent and still refreshes with the header`.
- After API-AUTH-16 add:
  - `| API-AUTH-23 | Web sign-in | POST /auth/otp/verify with X-Requested-With: gullak-web | 200 {accessToken, expiresIn}, no refreshToken in the body; Set-Cookie __Host-gullak_rt with HttpOnly, Secure, SameSite=Strict, Path=/, 30 days |`
  - `| API-AUTH-24 | Web refresh and logout | cookie and header | refresh rotates the cookie and a spent cookie is TOKEN_REUSED; logout is 204, clears the cookie, and the old cookie is then 401 |`
  - `| API-AUTH-25 | Planted cookie | two __Host-gullak_rt cookies | 401 UNAUTHENTICATED, cookie cleared, neither token spent |`
- SEC-04 Expected: `API and web responses carry CSP with frame-ancestors 'none', nosniff, X-Frame-Options DENY and, over HTTPS, HSTS; including 401, 404, 405 and the 413 body-limit response`.
- SEC-05 Expected: `a request from an unlisted origin (including null and look-alikes) gets 403 CSRF with no CORS headers and does not run; the app origin gets exact-origin CORS headers with credentials`.
- After SEC-16 (Plan 8 adds SEC-15 and SEC-16) add:
  - `| SEC-17 | Rate limiter memory | 50,000 distinct keys: at most the configured number kept; a key being limited stays limited |`
  - `| SEC-18 | Two tabs refresh at once | both stay signed in; no TOKEN_REUSED |`
- APP-30 Expected: `quick-add, spend detail, report card, stage-up and the notification step redirect Home on web and their entry points are hidden; Home (read-only), Insights, upload, goals, Me and budget settings are reachable; every route file is classified`.
- E2E-10 Checks: `local server with GULLAK_DEV_CLOCK_START=2026-10-23T08:00:00Z: sign in on the web, Home shows Fri, 23 Oct and ₹593, a reload keeps the session, a CSV with unknown headers is mapped and previewed, a goal is created, no CSP violation`.
- Section 11 text: `The release checklist in docs/release-checklist.md (built from docs/ux-test-findings.md), run on a real Android phone and an iPhone before each release, including notification times, quiet hours, the Instagram share image and a restart mid-sync.`
- Add a section `## 13. Release` with:
  - `| REL-01 | Server image user | the image runs as a non-root user |`
  - `| REL-02 | Prod settings | the image started with SPRING_PROFILES_ACTIVE=prod and no settings exits non-zero naming a GULLAK_ setting |`
  - `| REL-03 | Build profiles | eas.json has development, preview and production; each reads its EAS environment; production auto-increments; the app is linked to its EAS project |`
  - `| DOC-01 | API reference | every endpoint the server maps is a row in docs/api.md |`

`docs/superpowers/plans/README.md` already lists this plan's file, task count, migration block and test IDs (set in the cross-plan consistency pass). Check the Plan 9 row against what this plan actually shipped and change it only where a test ID or migration was added or renamed during execution.

- [ ] **Step 5: Run everything**

Run: `cd server && ./gradlew test` and `cd app && npm test`
Expected: PASS, `ApiDocsTest` included.

- [ ] **Step 6: Commit**

```bash
git add server/src/test/java/in/gullak/ApiDocsTest.java docs/api.md docs/release-checklist.md README.md docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/superpowers/plans/README.md
git commit -m "docs: complete API reference with a coverage test, release checklist, test-case updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Red-team pass on the web build and security sweep

**Owner:** red-team attacks; backend-engineer and web-engineer fix; manager accepts. **Test IDs:** the regression tests below, plus one test per finding. **Red team:** yes (this task is the pass).

**Files:**
- Create: `server/src/test/java/in/gullak/security/RedTeamPlan09Test.java`, `app/e2e-web/red-team.spec.ts`, `docs/reports/red-team/plan-09.md`, `docs/reports/2026-10-24-plan-09.md`
- Modify: whatever a finding requires (each fix with its test)

**Interfaces:**
- Consumes: everything above, running as in Task 7 Step 4 (server on the example day with `GULLAK_WEB_ORIGIN=http://localhost:8088`, the web image on 8088).
- Produces: the red-team report and the plan report.

- [ ] **Step 1: The known attacks as tests**

`server/src/test/java/in/gullak/security/RedTeamPlan09Test.java`:

```java
package in.gullak.security;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/** Attacks on the web session and CORS, kept as regression tests (Plan 9 red team). */
class RedTeamPlan09Test extends ApiTest {
    private static final String APP = "http://localhost:8088";
    private static final String COOKIE = "__Host-gullak_rt";

    private String webCookie() throws Exception {
        String email = uniqueEmail();
        var ip = freshIp();
        requestCode(email, ip);
        String setCookie = mvc.perform(post("/api/v1/auth/otp/verify").with(ip).header("X-Requested-With", "gullak-web")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"code\":\"" + mailer.lastCodeFor(email) + "\"}"))
            .andReturn().getResponse().getHeader(HttpHeaders.SET_COOKIE);
        return setCookie.substring(COOKIE.length() + 1, setCookie.indexOf(';'));
    }

    @Test
    void theRefreshCookieIsNotAnAccessCredential() throws Exception {
        mvc.perform(get("/api/v1/budget/today").cookie(new Cookie(COOKIE, webCookie())).header("X-Requested-With", "gullak-web"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void aRefreshTokenInTheQueryStringIsIgnored() throws Exception {
        String token = signIn().refreshToken();
        mvc.perform(post("/api/v1/auth/refresh").param("refreshToken", token).header("X-Requested-With", "gullak-web"))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON).content("{\"refreshToken\":\"" + token + "\"}"))
            .andExpect(status().isOk()); // the ignored attempt spent nothing
    }

    @Test
    void aPreflightForAnUnlistedHeaderOrMethodIsRefused() throws Exception {
        mvc.perform(options("/api/v1/auth/refresh").header("Origin", APP)
                .header("Access-Control-Request-Method", "POST").header("Access-Control-Request-Headers", "x-evil"))
            .andExpect(status().isForbidden()).andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        mvc.perform(options("/api/v1/auth/refresh").header("Origin", APP).header("Access-Control-Request-Method", "TRACE"))
            .andExpect(status().isForbidden()).andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void corsAnswersTheExactOriginAndVariesOnIt() throws Exception {
        mvc.perform(get("/api/v1/budget/today").header("Origin", APP))
            .andExpect(header().string("Access-Control-Allow-Origin", APP))
            .andExpect(header().string(HttpHeaders.VARY, containsString("Origin")));
    }

    @Test
    void aForeignOriginCannotSignInToTheWeb() throws Exception {
        String email = uniqueEmail();
        var ip = freshIp();
        requestCode(email, ip);
        mvc.perform(post("/api/v1/auth/otp/verify").with(ip).header("Origin", "https://evil.example")
                .header("X-Requested-With", "gullak-web").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"code\":\"" + mailer.lastCodeFor(email) + "\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("CSRF"))
            .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
    }
}
```

`app/e2e-web/red-team.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { exampleUser, signInOnWeb } from "./support";

test("no web storage holds anything that looks like a session", async ({ page, request }) => {
  await signInOnWeb(page, request, await exampleUser(request));
  await page.goto("/goals");
  await page.goto("/insights");
  const found = await page.evaluate(async () => {
    const keys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
    const values = [...Object.values(localStorage), ...Object.values(sessionStorage)].join(" ");
    const dbs = "databases" in indexedDB ? (await indexedDB.databases()).map((d) => d.name ?? "") : [];
    return { keys, jwtLike: /eyJ[A-Za-z0-9_-]{10,}\./.test(values), dbs };
  });
  expect(found.jwtLike).toBe(false);
  expect(found.keys.filter((k) => /token|session|auth/i.test(k))).toEqual([]);
  expect(found.dbs.filter((n) => /token|session|auth/i.test(n))).toEqual([]);
});

test("a script injected through the URL does not run", async ({ page, request }) => {
  await signInOnWeb(page, request, await exampleUser(request));
  let dialog = false;
  page.on("dialog", (d) => {
    dialog = true;
    void d.dismiss();
  });
  await page.goto("/goals?name=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
  await page.goto("/upload#%3Cscript%3Ealert(1)%3C%2Fscript%3E");
  expect(dialog).toBe(false);
});
```

Run both: `cd server && ./gradlew test --tests 'in.gullak.security.RedTeamPlan09Test'` and `cd app && npx playwright test e2e-web/red-team.spec.ts` (with the stack from Task 7 Step 4 running). Expected: PASS. Any failure here is a finding: fix it in this task.

- [ ] **Step 2: The full pass**

Dispatch `red-team` with task id `plan-09` against the running stack (localhost and test containers only) with this list, and ask for one finding per attack with severity and reproduction steps:

1. CSRF: refresh and logout from a page on another origin, with and without the header, as `fetch`, as a form `POST` (`text/plain` and `application/x-www-form-urlencoded`), and through a top-level navigation.
2. Cookies: set `__Host-gullak_rt` from another origin or over HTTP; send two; send it to a non-auth route; read it from page JavaScript; check its flags in Chromium and Safari.
3. CORS: `null`, look-alike hosts, other ports and schemes, wildcard-looking values, credentialed requests from an unlisted origin, preflights asking for unlisted headers and methods.
4. CSP: inject markup through every text field that is shown on the web (goal name, fixed-cost name, merchant names from a CSV with `<script>` and `javascript:` values), the URL, and the upload file name; watch for violations and dialogs; try `<base>` and form-action tricks.
5. Tokens in storage: `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, the query cache, and the service worker list after sign-in, a reload and sign-out.
6. Open redirects: every query parameter the router reads, the restore page (Plan 8), deep links with absolute URLs.
7. Clickjacking: frame the web app and the API's restore page from another origin.
8. Phone-only routes: reach quick-add, spend detail, the report card, stage-up or notification settings on the web by URL, history navigation or a stale link.
9. The rate limiter: flood keys and watch the server's heap; check `rate.limited` lines carry no IP or email.
10. Release: secrets in image layers, the release workflow's triggers and permissions, Dependabot's ability to change pinned SHAs without review.

Findings go to `docs/reports/red-team/plan-09.md` (one heading per finding: severity, steps, expected, actual, fix, test). Every High or Critical is fixed in this task with a regression test in `RedTeamPlan09Test` or `red-team.spec.ts` before the manager reviews; Medium and Low are fixed or listed as accepted with a reason.

- [ ] **Step 3: The plan report**

`docs/reports/2026-10-24-plan-09.md`, in the shape of `docs/reports/2026-10-23-plan-01.md`: what exists now (web app, cookie session, headers, CORS, CI gates, release path), decisions waiting for the founder (the domain; whether preview builds keep using production; moving rate limits to Postgres before running a second instance), the decision table from this plan with any changes made during execution, the red-team summary, and "Before the first production deploy" pointing at `docs/release-checklist.md` section 1.

- [ ] **Step 4: Run everything**

Run: `scripts/check-pins.sh && (cd server && ./gradlew test) && (cd app && npm test && npm run lint && npm run typecheck && npm run e2e:web)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/test/java/in/gullak/security/RedTeamPlan09Test.java app/e2e-web/red-team.spec.ts docs/reports
git commit -m "test(security): Plan 9 red-team regressions, findings and plan report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the last task

The orchestrating session dispatches the `manager` for a whole-branch review of Plan 9 against spec sections 1.1 and 4.7, `docs/engineering-standards.md`, the test-cases rows this plan owns (API-AUTH-16, 23–25; SEC-04–09, 12, 17, 18; APP-30; E2E-10; REL-01–03; DOC-01) and `docs/reports/red-team/plan-09.md`. The manager confirms in CI: all six jobs green, `scripts/check-pins.sh` clean, the Playwright report attached to the last run. The release checklist is then run once end to end on a first production deploy, and its record is the last item of V1.
