# Plan 8: Me, data and notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real email provider (Amazon SES, sent after the transaction commits, with timeouts, retries and a queued retry), DPDP consent with a recorded version, data export as an emailed 24-hour link, account deletion that locks at once with a 30-day restore link and a deletion job that leaves no row behind, Expo push tokens, server pushes (off-track after the daily close, milestones, level-ups, badges) behind quiet hours, a daily cap and per-type switches, and the app's consent screen, privacy policy, full Me screen with profile editing, notification switches, download, delete and restore.

**Architecture:** Mail is a `common/mail` service: `MailDelivery` sends through a `MailSender` (SES in `prod`, in-memory in `local` and `test`) after the surrounding transaction commits, tries three times with backoff, and on giving up writes a `mail_outbox` row that a leased job retries; the outbox stores a reference, never an address or a token, and the owning feature rebuilds the mail with a fresh link. Consent, account state, deletion and restore live in `auth` (which owns `users`); a filter in `common/web` asks `auth` (through the `AccountGate` interface) for the caller's state on every bearer request, so a locked account or a missing consent is refused even with a valid access token. Export is a new `data` package that zips one CSV per section; each feature contributes its own section through `common/data.UserDataSection`. Pushes are a `notify` package: `PushPlanner` (Plan 6's `Notifier`) writes `push_outbox` rows with quiet hours applied, and `PushDispatcher` (every minute, under a lease) applies switches and the daily cap and sends through Expo with three tries. The app adds a `features/account` folder (consent, privacy policy, export, delete, restore), a `features/notify` folder (switches, permission, push token) and rebuilds Me from the mockup.

**Tech Stack:** Server: Spring Boot 4.1.1, Java 21, Spring Data JPA, `JdbcClient` for queues and aggregates, Flyway (V060–V066), AWS SDK for Java v2 (`sesv2` with the URL-connection HTTP client), Spring `RestClient` with the JDK HTTP client for Expo Push, JUnit 5, Testcontainers, MockMvc, the JDK `HttpServer` as a provider stub. App: Expo Router, TypeScript strict, TanStack Query v5, expo-notifications, expo-constants, Jest + React Native Testing Library, Maestro.

**Spec:** `docs/superpowers/specs/2026-10-23-gullak-v1-design.md` (sections 2.7, 3.2 items 8–10, 4.5, 4.6 Data and Profile rows, 4.7, 4.8, 4.10, 4.11), with test cases in `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`, rules in `docs/engineering-standards.md`, visual and copy rules in `.claude/design.md`, prototype findings in `docs/ux-test-findings.md` (finding 12: Me). The mockup copy quoted here comes from `Me.dc.html` and is verbatim unless a decision below changes it. Read all of them before starting any task, and read the installed skills `.claude/skills/expo-native-ui/SKILL.md` (with `references/storage.md`), `.claude/skills/expo-data-fetching/SKILL.md`, `.claude/skills/expo-router/SKILL.md` before the app tasks and `anthropic-skills:secure-engineering` before every server task.

## Global Constraints

- Money is `long` paise on the server and whole-number paise in the app. Export files show rupees as `250.00` strings made from paise by integer arithmetic; no floating point near money.
- Day boundaries are `Asia/Kolkata` (`Ist.ZONE`, `Ist.today`, `Ist.startOf`). Quiet hours are 23:00 to 07:00 IST for every V1 user.
- Every query on user data filters by the user ID from the JWT subject or by a user ID a job enumerated. No endpoint accepts a user ID from the client. Another user's object returns 404. A link token (export, restore) is the only credential its public route accepts.
- Link tokens are 256-bit random values, base64url, stored only as SHA-256 hex. They are never logged, never stored in an outbox row, and never accepted as query parameters (they travel in the path or the body).
- Never log amounts, merchant text, goal names, emails, tokens, OTP codes, push tokens, push text or mail text. Business events use `Events` constants with ids, kinds and counts only.
- External calls (SES, Expo) have a 5-second timeout, three tries with backoff, then a WARN and a queued retry; they never fail the user's request.
- No empty catch blocks. Broad catches (`Exception`, `RuntimeException`, `Throwable`) only in `common/error` and `common/jobs`. Catch the provider's own exception types (`SdkException`, `RestClientException`, `DataAccessException`).
- Constructor injection only. Records at service boundaries. Entities and repositories are package-private to their feature. Controllers never touch `JdbcClient`, repositories or entities.
- `ErrorCode` is append-only (add before `INTERNAL`); this plan adds `ACCOUNT_LOCKED`, `CONSENT_REQUIRED`, `LINK_EXPIRED`. `Events` is append-only. The app regenerates `app/src/lib/error-codes.ts` with `node scripts/gen-error-codes.mjs` and adds a message for each new code in `app/src/lib/errors.ts`.
- Migrations for this plan use V060–V069; if an earlier plan was executed with more migrations than planned, renumber to the next free number in this block. This plan uses V060–V066. `ddl-auto: validate`.
- API base path `/api/v1`. JSON enums are Java constant names (`IOS`, `OFF_TRACK`).
- App: features never call `fetch` (only `api` from `@/lib/client`); money only through `lib/money.ts`, dates only through `lib/dates.ts`; design tokens only in `src/theme/`; `console` only in `lib/log.ts`; no `any`; every control at least 44×44 with a label; every screen renders loading, error (with Retry) and empty states; no `&&` with a possibly falsy value in JSX (use a ternary); `process.env.EXPO_OS`, not `Platform.OS`.
- Copy follows `.claude/design.md`: sentence case; a single sentence has no full stop; two or more sentences take a full stop after each; ₹ with Indian grouping; dates as "Fri, 23 Oct"; locale en-IN.
- Each task's owner is named; after the owner hands back, `qa-engineer` runs, then `red-team` where the task says so, then `manager` reviews (`docs/team.md`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A restore link opened by a mail scanner or a link preview (a plain GET) never restores the account; only the button on the page (a POST) does. Pinned in Task 5 (`openingTheRestoreLinkDoesNotRestoreUntilTheButtonIsPressed`).
- At the 30-day boundary restore and deletion never both apply: one second before, restore works and the job leaves the account; at the boundary, restore says the account is gone and the job deletes it. Pinned in Task 6 (`restoreAndDeletionNeverOverlapAtTheBoundary`).
- Consent sent by an old app build for last year's policy version does not count as consent to the current policy. Pinned in Task 4 (`consentToAnOldVersionIsRefused`).
- A merchant typed as `=HYPERLINK("http://evil")` or `+91 98…` is exported as text a spreadsheet will not run as a formula. Pinned in Task 7 (`formulaLikeCellsAreDefused`).
- Six pushes held back by quiet hours are released at 07:00 as no more than the day's server cap (four for a user with the phone's local messages switched off), not six: the daily cap applies to the backlog too. Pinned in Task 9 (`quietHoursBacklogStillRespectsTheCap`).

## Decisions made in this plan

| Decision | Why | Cost if wrong |
|---|---|---|
| Email provider: **Amazon SES in `ap-south-1` (Mumbai)**, plain-text mails, through the AWS SDK v2 `sesv2` client with the URL-connection HTTP client (no Apache or Netty), SDK retries off (we retry ourselves) | Spec 4.7 promises data hosted in India; SES Mumbai keeps every address and code in India, sits next to DigitalOcean Bangalore and costs about $0.10 per 1,000 mails. Resend needs no SDK but processes mail in the US | one dependency tree to keep patched; SES needs domain verification (DKIM) and production access before launch (README) |
| Mail is sent after commit (`AfterCommit.run`); OTP mail is asynchronous and never queued; export and restore mails fall back to `mail_outbox` after three failed tries | A code must not be mailed for a rolled-back row (deferred from Plan 1); a sign-in code expires in 10 minutes and the user can ask again, so storing it for a retry would only keep a secret at rest | a user whose OTP mail failed three times taps "Send a new code" |
| Outbox rows store `(user_id, kind, ref_id)`, never an address, a subject or a token; the retry job asks the owning feature to rebuild the mail, which issues a fresh link token | No secret or personal text at rest in a queue; a rebuilt link is always valid | if the first mail was in fact delivered (a timeout after the provider accepted it), its link stops working once the retry rotates it; the user has the newer mail |
| Before consent, every bearer request returns 403 `CONSENT_REQUIRED` except `GET /me/account`, `POST /me/consent`, `POST /me/export` and `DELETE /me`. Consent is to one policy version (`gullak.account.consent-version`, `2026-10`); a newer version asks again. Posting another version is 400; posting the current one twice returns 200 with the first time | DPDP: nothing is processed for budgeting without consent; a user can always take their data and leave; an old app build cannot consent to a policy it never showed | one extra primary-key read per request |
| Account state is checked on every bearer request by `AccountStateFilter` (one primary-key read): locked → 403 `ACCOUNT_LOCKED`, row gone → 401 | Access tokens are stateless for 15 minutes (spec 4.7); without the check a deleted user keeps working for up to 15 minutes (API-AUTH-22) | the same read as above |
| `DELETE /me` returns 202 `{deletionDate}`; the account locks, refresh tokens are revoked, push tokens, queued pushes and export links are removed at once; deletion runs at 01:30 IST for accounts locked 30 days or more | Spec 4.7 and 2.7; nothing should reach a locked account | none |
| Restore: the email carries `https://<api>/api/v1/me/restore/<token>`; the GET shows a page with one button that POSTs; the app also accepts `gullak://restore?token=` and calls `POST /me/restore {token}`. A correct OTP for a locked account answers 403 `ACCOUNT_LOCKED` and mails a fresh restore link, at most once an hour | Mail scanners open links; a GET must not change anything. A user who lost the mail proves the address with a code and gets a new link | the restore page is server-rendered HTML outside the app's design system |
| API-DT-08: restore after the grace period is 404 while the account still exists (job not yet run); after the job, the token is unknown and the answer is 401 like any bad token | Keeping a tombstone of a deleted user would break SEC-14 | Task 5 rewords API-DT-08 |
| Export is generated when the link is opened (`GET /api/v1/exports/<token>`), from live data, as a ZIP of CSV files (account, profile, fixed costs, spends, goals, XP, badges); the link works for 24 hours and any number of times; one export request an hour, counted in the database | Spec 4.1: no files stored; a link opened by a mail scanner must not burn a one-time link; the spec says "CSV" and one CSV per table keeps every file readable | the export reflects data at download time, not at request time |
| Raw statement text (`merchant_raw_enc`) is not exported; the cleaned merchant name is | The raw line can carry other people's UPI handles; the user's own data is the cleaned record | a user asking for raw lines gets them by email support |
| CSV cells that start with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'` | Spreadsheet formula injection from merchant names and notes | a merchant genuinely starting with "-" shows a leading quote in Excel |
| Each feature contributes its export file through `common/data.UserDataSection`, read with `JdbcClient` inside its own package; queues (`mail_outbox`, `push_outbox`) and the jsonb switches also use `JdbcClient` | An export is a report over the user's rows (like an aggregate) and must not load other features' entities; queues need `on conflict` inserts and lease-guarded updates; the switches need an atomic jsonb merge | a reviewer who reads Plan 1's rule strictly sees more `JdbcClient` than elsewhere; each use is commented |
| `InMemoryOtpMailer` stays the OTP mailer in `local` and `test`; `MailOtpMailer` (SES) is used everywhere else | Plan 2's dev OTP route and every `ApiTest` read codes from it | none |
| Deletion: one Flyway migration rewrites every foreign key to `users` without `on delete cascade` to cascade; the job deletes `otp_codes` by email and the `users` row, then counts every uuid column and every `email` column in the schema for the user and rolls back if any remain | SEC-14 must hold for tables later plans add; the count is a guard, not the mechanism | the count runs one query per uuid column (about 60) per deleted user, at night |
| Push tokens: Expo format only (`ExponentPushToken[…]` or `ExpoPushToken[…]`), at most 10 per user (oldest dropped); a token registered by another account moves to the newest one (the phone belongs to whoever signed in last); sign-out in the app unregisters the token | A shared or resold phone must stop getting the previous person's pushes | someone who learns a stranger's push token can take that phone's pushes away from the stranger's account (pushes never carry amounts or names) |
| Push copy never carries an amount or a goal name; each kind has one line per personality (spec 2.6) | Pushes show on the lock screen and pass through Expo, Apple and Google | a less specific message |
| Server pushes are `OFF_TRACK` (priority 50), `GOAL_MILESTONE` (40), `LEVEL_UP` (30), `STREAK_MILESTONE` (25), `BADGE` (20) and `OTHER` (10, Plan 6's generic `Notifier.send`); `STAGE_UP` and `STREAK_DAY` celebrations do not push | Off track needs action; a stage-up always comes with its level-up | a founder who wants stage pushes adds one mapping |
| Spec 2.7's cap of 4 messages a day is a total. The server's daily push cap is 4 − (the number of local message types the user has switched on among morning, night and the 80% alert), at least 1. The profile's `notifications` switches (`morning`, `night`, `nearLimit`) tell the server which local types are on | The server cannot see whether a local message fired, but it knows which are switched on; reserving their slots keeps the total at 4 or less (all three local types on leaves 1 server push) | a day with the 80% alert switched on but never triggered loses a push slot it could have used; if the minimum of 1 applies with a lower configured cap, the total can exceed 4 |
| Quiet hours move a push's due time to 07:00 IST at enqueue and again at dispatch (a retry that falls into the night waits too); the cap ranks everything due at dispatch by priority and drops the rest for that day | One choke point; the 07:00 backlog cannot exceed the cap | a dropped push is not re-sent the next day |
| Per-type switches live in `profiles.notifications` jsonb (`morning`, `night`, `nearLimit`, `offTrack`, `wins`), all on by default, read and merged with `JdbcClient` (`notifications || patch`) and not mapped by JPA; the phone obeys `morning`, `night` and `nearLimit`; the server obeys `offTrack` and `wins` | Spec 4.5 column; an atomic merge avoids lost updates from two phones; Hibernate's JSON mapper is not needed | none |
| Off-track pushes run at 00:20 IST for users whose day was closed, use Plan 7's spending forecast (`InsightsService.offTrack`) OR Plan 5's goal-behind signal (any active deadline goal in `GoalService.list` with `behindPaise > 0`) through a job-local `OffTrackCheck` adapter, and are skipped when an off-track push was queued or sent in the last 72 hours | Spec 2.7: after the close, at most once per 3 days; the adapter keeps this job's tests independent of Plan 7's internals | a close that ran after 00:20 waits for the next night |
| Win pushes come from one event, `common/game/WinEarned`, published by Plan 6's `CelebrationService.record` and Plan 5's milestone code, and handled after commit in a new transaction | `gamification` and `goals` must not depend on `notify`; a rolled-back celebration must not push | a failure while planning the push is logged as WARN `push.plan_failed` and the push is lost |
| Expo receipts are not polled in V1; ticket errors are handled (`DeviceNotRegistered` deletes the token) | Receipts need a second job and a 15-minute delay; tickets catch the common case | a push Apple or Google rejects later is counted as sent |
| `prod` refuses to start without `GULLAK_MAIL_FROM`, `GULLAK_PUBLIC_URL` (https), `GULLAK_SUPPORT_EMAIL`, AWS credentials and `GULLAK_EXPO_ACCESS_TOKEN` | Same pattern as `TrustedProxiesCheck`; Expo's enhanced push security means a leaked push token alone cannot send | five settings to set before deploy |
| The privacy policy's canonical text is `docs/privacy-policy.md`; `app/scripts/gen-privacy.mjs` turns it into `app/src/features/account/privacy-policy.ts` and the app shows it in-app; a server test checks the server's consent version equals the policy's | The app's only configuration is the API URL (spec 4.4) and the domain is undecided (spec 6), so the policy cannot be a web link yet | the generator must be re-run when the policy changes (a test fails if not) |
| Help and contact shows three short answers and an "Email us" button to `supportEmail` from `GET /me/account` | No domain or address hard-coded in the app | none |
| Me's delete dialog keeps the mockup's title and "Keep my account" but replaces "This removes your spends, goals, XP and badges for good. Download your data first if you want a copy." with the grace-period copy, and "Delete for good" with "Delete my account" | The mockup predates the 30-day grace in spec 3.2 item 10; "for good" would be untrue | none |
| Payday changes from Me take effect from the next cycle (spec 2.1) and the screen says so under the picker | Spec | none |
| Migrations V060–V066, in the order of the tasks below | Plans 7–9 share V050+ by block; this plan's block is V060–V069 | the executor renumbers if another plan reached V060 |

## Cross-plan contracts

This plan consumes these. The first step of the task that uses each one checks it against the real code before building on it; if a name differs, use the real name and note it in the task report.

- **Plan 1 (implemented):** `OtpService`, `OtpMailer`, `InMemoryOtpMailer.lastCodeFor`, `TokenService`, `RefreshTokenRepository.revokeAllForUser`, `revokeFamily`, `UserEntity`, `UserRepository`, `ProfileService`, `Personality { CHILL, SAVAGE, MOM, HYPE }`, `JsonAuthHandlers`, `SecurityConfig`, `RateLimiter.check(String, int, Duration)`, `Events`, `Ist`, `Db.ts`, `ApiTest` (`signIn`, `exampleUser`, `seedSpend`, `freshIp`, `auth`, `bearer`, `mailer`, `jdbc`, `clock`), `TrustedProxiesCheck`.
- **Plan 2 (app):** `api`, `kv`, `log`, `Screen`, `Text`, `Button`, `Field`, `Icon`, `Skeleton`, `EmptyState`, `ErrorState`, `StepHeader`, `PaydayPicker`, `SavingsStepper`, `RealityCheck`, `PersonalityPicker`, `personalities`, `TimePicker`, `morningOptions`, `nightOptions`, `FixedCostsScreen`, `useProfile`, `usePutProfile`, `useFixedCosts`, `profileKeys`, `Profile`, `Personality`, `realityCheck`, `perDayPreview`, `wholeRupees`, `formatRupees`, `parseRupeesToPaise`, `formatDay`, `formatDayLong`, `todayIst`, `messageFor`, `describeError`, `isApiError`, `ApiError`, `useSession` (`status`, `email`, `signIn`, `signOut`), `queryClient`, `scheduleDaily`, `askPermission`, `notificationsSupported`, `NotificationsApi`, `NotificationsScreen`, `MeScreen`, the root `_layout.tsx`, `index.tsx`, `routing.test.tsx`, `e2e/setup.yaml`, `e2e/scripts/otp.js`, and `POST /api/v1/auth/dev/otp`.
- **Plan 3 (spends):** package `in.gullak.ingestion` owns `transactions` (columns `id`, `user_id`, `amount_paise`, `direction`, `occurred_at`, `merchant_name`, `category_code`, `tag`, `payment_method`, `source`, `status`, `note`, `spread_over_cycle`, `deleted_at`); `ArchitectureTest.ALLOWED_FEATURE_DEPENDENCIES`; app `Toggle`, `notifyEightyPercent` with `EIGHTY_KEY`, the offline outbox cleared on sign-out (`signOutClearsTheQueue`).
- **Plan 5 (goals):** table `goals (id, user_id, name, type, target_paise, deadline, mode, status, created_at)`; the method that logs `Events.GOAL_MILESTONE` when a goal reaches 25, 50, 75 or 100%.
- **Plan 6 (game and jobs):** `Notifier`, `PushMessage`, `InMemoryNotifier` (removed here), `JobRunner.run`, `JobLock.tryAcquire/release`, `JobAlerts`, the `jobs` package, `SchedulingConfig` (`gullak.jobs.enabled`), `CelebrationService.record(UUID, CelebrationKind, String)`, `CelebrationKind`, `DailyCloseService.find(UUID, LocalDate)`, `ClosedDay`, `ProfileService.userIdsSetUpBefore(Instant)`, `gameUser()`, the `updated_at` trigger from `afterMigrate.sql`, tables `xp_events (user_id, kind, xp, created_at, reversed_at)` and `user_badges (user_id, badge_code, earned_at)`; app `useProgress`, `Progress`, `fromServerStage`, `stageLabels`, `REPORT_CARD_URL`, `notification-routes.ts` (`ROUTES`, `Route`), route `/badges`.
- **Plan 7 (insights):** `in.gullak.insights.InsightsService.offTrack(UUID userId) : boolean`, decided as of yesterday (the day the 00:05 close just closed). It covers only the spending half of spec 2.7 (forecast cycle spend above spendable).
- **Plan 5 (goals), the goal half of spec 2.7:** `in.gullak.goals.GoalService.list(UUID userId) : GoalsResponse`, whose `goals()` are `GoalView`s with `status()` and `behindPaise()`; an `ACTIVE` deadline goal with `behindPaise() > 0` is behind (the same rule as Plan 5's `CatchUp` situation `BEHIND`).

This plan produces for later plans:

- `MailDelivery.deliverAfterCommit(Mail, Runnable)`, `MailDelivery.queueOnGiveUp(UUID, String, UUID)`, `MailResender` (Plan 9's alert mail can use them).
- `AccountGate`, `AccountState`, `AccountLocked` event; `GET /api/v1/me/account`, `POST /api/v1/me/consent`, `DELETE /api/v1/me`, `POST /api/v1/me/restore`, `GET|POST /api/v1/me/restore/{token}`, `POST /api/v1/me/export`, `GET /api/v1/exports/{token}`, `POST|DELETE /api/v1/me/push-tokens`, `GET|PATCH /api/v1/me/notifications` (Plan 9's web build uses the account and data routes and must add `/api/v1/exports/*` and `/api/v1/me/restore/*` to its CSP and CORS review).
- `UserDataSection` (any later feature with user data adds a section, and SEC-14's sweep covers its table automatically).
- `PushPlanner.plan(UUID, PushKind, String, String)`, `WinEarned`.

## File structure

```
server/
  build.gradle.kts (AWS SDK BOM, sesv2, url-connection-client)                             Task 2
  src/main/resources/
    application.yml (gullak.mail, gullak.account, gullak.push)                             Tasks 1, 4, 9
    application-prod.yml                                                                   Tasks 2, 4, 9
    db/migration/V060__mail_outbox.sql                                                     Task 3
    db/migration/V061__consent.sql                                                         Task 4
    db/migration/V062__restore_tokens.sql                                                  Task 5
    db/migration/V063__cascade_user_references.sql                                         Task 6
    db/migration/V064__export_links.sql                                                    Task 7
    db/migration/V065__push_tokens_and_switches.sql                                        Task 8
    db/migration/V066__push_outbox.sql                                                     Task 9
  src/main/java/in/gullak/
    common/db/AfterCommit.java                                                             Task 1
    common/db/UserReferences.java                                                          Task 6
    common/mail/Mail.java, MailSender.java, MailSendException.java, MailProperties.java,
      InMemoryMailSender.java, MailDelivery.java                                           Task 1
    common/mail/SesMailSender.java, MailConfig.java, MailConfigCheck.java                  Task 2
    common/mail/MailOutbox.java, MailResender.java, MailRetryJob.java                      Task 3
    common/error/ErrorCode.java (append), AccountLockedException.java, GoneException.java,
      RateLimitedException.java (message constructor), JsonAuthHandlers.java (public write) Tasks 4, 5, 7
    common/web/AccountGate.java, AccountState.java, AccountStateFilter.java                Task 4
    common/config/SecurityConfig.java                                                      Tasks 4, 5
    common/account/AccountLocked.java                                                      Task 5
    common/token/OpaqueTokens.java                                                         Task 5
    common/data/UserDataSection.java, Csv.java                                             Task 7
    common/game/WinEarned.java                                                             Task 10
    common/log/Events.java (append)                                                        Tasks 1, 3, 4, 5, 6, 7, 8, 9, 10
    auth/OtpService.java                                                                   Tasks 1, 5
    auth/MailOtpMailer.java                                                                Task 1
    auth/AccountProperties.java, Account.java, ConsentResult.java, ConsentEntity.java,
      ConsentRepository.java, AccountService.java, AccountController.java;
      UserEntity.java, UserRepository.java (edit)                                          Task 4
    auth/RestoreTokenEntity.java, RestoreTokenRepository.java, DeletionScheduled.java,
      RestorePageController.java, RestoreMailResender.java, DevRestoreController.java;
      AccountService, AccountController, TokenService.logout, RefreshTokenRepository (edit) Task 5
    auth/AccountDeletionService.java; OtpCodeRepository (edit)                             Task 6
    auth/AccountExportSection.java                                                         Task 7
    jobs/AccountDeletionJob.java                                                           Task 6
    data/ExportLinkEntity.java, ExportLinkRepository.java, ExportRequested.java,
      ExportFile.java, ExportService.java, ExportController.java, ExportMailResender.java,
      DataAccountListener.java                                                             Task 7
    profile/ProfileExportSection.java, FixedCostExportSection.java                         Task 7
    ingestion/TransactionExportSection.java                                                Task 7
    goals/GoalExportSection.java                                                           Task 7
    gamification/XpExportSection.java, BadgeExportSection.java                             Task 7
    profile/NotificationSwitches.java, NotificationSwitchesPatch.java,
      NotificationSwitchesStore.java, NotificationsController.java; ProfileService (edit)  Task 8
    notify/Platform.java, PushTokenEntity.java, PushTokenRepository.java,
      PushTokenService.java, PushTokenController.java, NotifyAccountListener.java          Task 8
    notify/PushKind.java, PushCopy.java, QuietHours.java, PushProperties.java, PushOutbox.java,
      PushPlanner.java, PushEnvelope.java, PushTicket.java, PushSendException.java,
      PushTransport.java, InMemoryPushTransport.java, ExpoPushTransport.java, NotifyConfig.java,
      PushConfigCheck.java, PushDispatcher.java, PushDispatchJob.java;
      NotifyAccountListener (edit); InMemoryNotifier.java (deleted)                        Task 9
    notify/WinPushListener.java; gamification/CelebrationService (edit); goals milestone (edit) Task 10
    jobs/OffTrackCheck.java, InsightsOffTrackCheck.java, OffTrackPushJob.java              Task 10
    (test) jobs/InsightsOffTrackCheckApiTest.java                                         Task 10
  src/test/java/in/gullak/
    common/db/AfterCommitApiTest.java; common/mail/MailDeliveryTest.java;
      auth/OtpAfterCommitApiTest.java, MailOtpMailerTest.java                              Task 1
    common/mail/SesMailSenderTest.java, MailConfigCheckTest.java, support/StubHttpServer.java Task 2
    common/mail/MailRetryJobApiTest.java                                                   Task 3
    auth/ConsentApiTest.java, auth/ConsentVersionTest.java; support/ApiTest.java (consent);
      security/LogRedactionApiTest.java (consent line)                                     Task 4
    auth/AccountDeletionApiTest.java, auth/RestorePageApiTest.java, auth/DevRestoreApiTest.java;
      auth/TokenApiTest.java (logout race)                                                 Task 5
    jobs/AccountDeletionJobApiTest.java                                                    Task 6
    common/data/CsvTest.java; data/ExportApiTest.java; security/DataLogRedactionApiTest.java Task 7
    notify/PushTokenApiTest.java; profile/NotificationSwitchesApiTest.java                 Task 8
    notify/QuietHoursTest.java, PushCopyTest.java, PushDispatchApiTest.java,
      ExpoPushTransportTest.java                                                           Task 9
    notify/WinPushApiTest.java; jobs/OffTrackPushJobApiTest.java                           Task 10
    rules/ArchitectureTest.java (allow-list entries)                                       Tasks 7, 8
app/
  scripts/gen-privacy.mjs                                                                  Task 11
  src/lib/error-codes.ts (generated), errors.ts, account-events.ts, query.ts               Task 11
  src/features/account/api.ts, hooks.ts, entry.ts, privacy-policy.ts (generated)           Task 11
  src/features/account/screens/consent-screen.tsx, privacy-screen.tsx, account.test.tsx    Task 11
  app/consent.tsx, app/privacy.tsx; app/index.tsx, app/_layout.tsx, src/routing.test.tsx   Task 11
  src/features/profile/me-format.ts, me-format.test.ts                                     Task 12
  src/features/profile/components/me-row.tsx, level-card.tsx                               Task 12
  src/features/profile/screens/me-screen.tsx (rebuilt), edit-income-screen.tsx,
    edit-savings-screen.tsx, edit-gullak-screen.tsx, help-screen.tsx, me.test.tsx,
    edit-profile.test.tsx                                                                  Task 12
  app/(tabs)/me.tsx, app/me/_layout.tsx, income.tsx, fixed-costs.tsx, savings.tsx,
    gullak.tsx, help.tsx                                                                   Task 12
  src/features/notify/api.ts, hooks.ts, components/notification-settings.tsx,
    notify.test.tsx                                                                        Task 13
  src/lib/push.ts, push.test.ts; src/lib/notifications.ts, notification-routes.ts (edit)   Task 13
  src/features/account/components/data-section.tsx; screens/delete-account-screen.tsx,
    account-deleted-screen.tsx, restore-screen.tsx, data.test.tsx                          Task 14
  app/me/delete.tsx, app/account-deleted.tsx, app/restore.tsx                              Task 14
  e2e/delete-account.yaml, e2e/scripts/restore.js, e2e/setup.yaml (consent step)           Tasks 11, 14
docs/
  privacy-policy.md, breach-response.md                                                    Task 4
  api.md (Me and data endpoints, export columns)                                           Task 7
  superpowers/specs/2026-10-23-gullak-v1-test-cases.md (rows added and reworded)           Tasks 4, 5, 8, 9, 14
  engineering-standards.md (event vocabulary)                                              Task 10
README.md (configuration, provider setup)                                                  Tasks 2, 9
```

---
### Task 1: Mail after commit: `AfterCommit`, `MailDelivery` with retries, and the OTP mail moved out of the transaction

**Owner:** backend-engineer. **Test IDs:** ERR-08 (mail half: a hanging provider never holds up the request), ERR-09 (mail half: three WARNs, then the give-up hook), API-AUTH-01 (code mailed only once its row has committed). **Red team:** yes (a rolled-back request must mail nothing; no address, code or mail text in any log line; a provider that hangs must not tie up request threads).

**Files:**
- Create: `server/src/main/java/in/gullak/common/db/AfterCommit.java`
- Create: `server/src/main/java/in/gullak/common/mail/Mail.java`, `MailSender.java`, `MailSendException.java`, `MailProperties.java`, `InMemoryMailSender.java`, `MailDelivery.java`
- Create: `server/src/main/java/in/gullak/auth/MailOtpMailer.java`
- Modify: `server/src/main/java/in/gullak/auth/OtpService.java` (`request`), `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/main/resources/application.yml`, `server/src/test/resources/application-test.yml`
- Test: `server/src/test/java/in/gullak/common/db/AfterCommitApiTest.java`, `server/src/test/java/in/gullak/common/mail/MailDeliveryTest.java`, `server/src/test/java/in/gullak/auth/OtpAfterCommitApiTest.java`, `server/src/test/java/in/gullak/auth/MailOtpMailerTest.java`

**Interfaces:**
- Consumes: `OtpService.request`, `OtpMailer.sendOtp(String, String)`, `InMemoryOtpMailer.lastCodeFor(String)`, `ApiTest` (Plan 1).
- Produces: `AfterCommit.run(Runnable)`; `Mail(String kind, String to, String subject, String text)`; `MailSender.send(Mail)` (one attempt, throws `MailSendException`); `MailSendException(String reason)`, `(String reason, Throwable cause)`; `MailProperties(String from, String sesRegion, String linksBaseUrl, Duration timeout, int attempts, Duration backoff, boolean async)` at `gullak.mail`; `MailDelivery.deliver(Mail, Runnable onGiveUp)`, `deliverAfterCommit(Mail, Runnable onGiveUp)`, `sendNow(Mail) : boolean`; `InMemoryMailSender.sent()`, `lastTo(String email)`, `lastTo(String email, String kind)`, `failNext(int)`, `failAlways(boolean)`, `reset()`; events `mail.sent`, `mail.retry`, `mail.gave_up`.

- [ ] **Step 1: Write the failing tests**

`server/src/test/java/in/gullak/common/db/AfterCommitApiTest.java`:

```java
package in.gullak.common.db;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.support.ApiTest;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class AfterCommitApiTest extends ApiTest {
    @Autowired PlatformTransactionManager transactions;

    @Test
    void runsOnlyOnceTheTransactionCommits() {
        AtomicBoolean ran = new AtomicBoolean();
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            AfterCommit.run(() -> ran.set(true));
            assertThat(ran).isFalse();
        });
        assertThat(ran).isTrue();
    }

    @Test
    void neverRunsWhenTheTransactionRollsBack() {
        AtomicBoolean ran = new AtomicBoolean();
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            AfterCommit.run(() -> ran.set(true));
            status.setRollbackOnly();
        });
        assertThat(ran).isFalse();
    }

    @Test
    void runsAtOnceOutsideATransaction() {
        AtomicBoolean ran = new AtomicBoolean();
        AfterCommit.run(() -> ran.set(true));
        assertThat(ran).isTrue();
    }
}
```

`server/src/test/java/in/gullak/common/mail/MailDeliveryTest.java`:

```java
package in.gullak.common.mail;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
class MailDeliveryTest {
    private static final Mail MAIL = new Mail("otp", "priya@example.test", "Your Gullak sign-in code", "Your code is 482913.");

    private static MailProperties props(boolean async) {
        return new MailProperties("Gullak <no-reply@example.test>", "ap-south-1", "https://api.example.test",
            Duration.ofSeconds(5), 3, Duration.ZERO, async);
    }

    /** Fails the first {@code failures} calls, then succeeds. */
    private static MailSender flaky(int failures, AtomicInteger calls) {
        return mail -> {
            if (calls.incrementAndGet() <= failures) {
                throw new MailSendException("timeout");
            }
        };
    }

    @Test
    void sendsOnTheFirstTry(CapturedOutput out) {
        AtomicInteger calls = new AtomicInteger();
        assertThat(new MailDelivery(flaky(0, calls), props(false)).sendNow(MAIL)).isTrue();
        assertThat(calls).hasValue(1);
        assertThat(out.getOut()).contains("mail.sent kind=otp");
    }

    @Test
    void retriesWithAWarnEachTimeThenSucceeds(CapturedOutput out) {
        AtomicInteger calls = new AtomicInteger();
        assertThat(new MailDelivery(flaky(2, calls), props(false)).sendNow(MAIL)).isTrue();
        assertThat(calls).hasValue(3);
        assertThat(out.getOut().split("mail.retry", -1)).hasSize(3); // two WARN lines
    }

    @Test
    void givesUpAfterThreeTriesAndRunsTheFallbackOnce(CapturedOutput out) { // ERR-09 (mail)
        AtomicInteger calls = new AtomicInteger();
        AtomicInteger fallback = new AtomicInteger();
        new MailDelivery(flaky(99, calls), props(false)).deliver(MAIL, fallback::incrementAndGet);
        assertThat(calls).hasValue(3);
        assertThat(fallback).hasValue(1);
        assertThat(out.getOut().split("mail.retry", -1)).hasSize(4);
        assertThat(out.getOut()).contains("mail.gave_up kind=otp");
    }

    @Test
    void aHangingProviderNeverBlocksTheCaller() { // ERR-08 (mail)
        MailSender hanging = mail -> {
            try {
                Thread.sleep(Duration.ofSeconds(3));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };
        long started = System.nanoTime();
        new MailDelivery(hanging, props(true)).deliver(MAIL, null);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(500));
    }

    @Test
    void logsNeverCarryTheAddressTheSubjectOrTheText(CapturedOutput out) {
        new MailDelivery(flaky(99, new AtomicInteger()), props(false)).deliver(MAIL, null);
        assertThat(out.getAll()).doesNotContain("priya@example.test", "sign-in code", "482913");
        assertThat(MAIL.toString()).isEqualTo("Mail[kind=otp]");
    }
}
```

`server/src/test/java/in/gullak/auth/OtpAfterCommitApiTest.java`:

```java
package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Deferred from Plan 1: the code is mailed after its row commits, never for a rolled-back request. */
class OtpAfterCommitApiTest extends ApiTest {
    @Autowired OtpService otp;
    @Autowired PlatformTransactionManager transactions;

    @Test
    void theCodeIsMailedOnlyAfterItsRowCommits() { // API-AUTH-01
        String email = uniqueEmail();
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            otp.request(email, "10.250.0.1");
            assertThat(mailer.lastCodeFor(email)).isNull();
        });
        assertThat(mailer.lastCodeFor(email)).matches("\\d{6}");
    }

    @Test
    void aRolledBackRequestMailsNothing() {
        String email = uniqueEmail();
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            otp.request(email, "10.250.0.2");
            status.setRollbackOnly();
        });
        assertThat(mailer.lastCodeFor(email)).isNull();
        assertThat(jdbc.sql("select count(*) from otp_codes where email = ?").param(email).query(Long.class).single())
            .isZero();
    }
}
```

`server/src/test/java/in/gullak/auth/MailOtpMailerTest.java`:

```java
package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.common.mail.Mail;
import in.gullak.common.mail.MailDelivery;
import in.gullak.common.mail.MailProperties;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Profile;

class MailOtpMailerTest {
    @Test
    void mailsTheCodeAsPlainText() {
        List<Mail> sent = new ArrayList<>();
        MailProperties props = new MailProperties("Gullak <no-reply@example.test>", "ap-south-1",
            "https://api.example.test", Duration.ofSeconds(5), 3, Duration.ZERO, false);
        new MailOtpMailer(new MailDelivery(sent::add, props)).sendOtp("priya@example.test", "482913");
        assertThat(sent).singleElement().satisfies(m -> {
            assertThat(m.kind()).isEqualTo("otp");
            assertThat(m.to()).isEqualTo("priya@example.test");
            assertThat(m.subject()).isEqualTo("Your Gullak sign-in code");
            assertThat(m.text()).startsWith("Your code is 482913. It works for 10 minutes.");
        });
    }

    @Test
    void isTheMailerOutsideLocalAndTest() {
        assertThat(MailOtpMailer.class.getAnnotation(Profile.class).value()).containsExactly("!local & !test");
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.db.AfterCommitApiTest' --tests 'in.gullak.common.mail.*' --tests 'in.gullak.auth.OtpAfterCommitApiTest' --tests 'in.gullak.auth.MailOtpMailerTest'`
Expected: compilation fails (`AfterCommit`, `Mail`, `MailDelivery`, `MailOtpMailer` do not exist).

- [ ] **Step 3: Write the code**

`server/src/main/java/in/gullak/common/db/AfterCommit.java`:

```java
package in.gullak.common.db;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Side effects that must only happen once the data they describe has committed (a mail, a push). */
public final class AfterCommit {
    private AfterCommit() {}

    /** Runs {@code action} after the current transaction commits, never if it rolls back; outside one, runs now. */
    public static void run(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }
}
```

`server/src/main/java/in/gullak/common/mail/Mail.java`:

```java
package in.gullak.common.mail;

/**
 * One plain-text mail. {@code kind} (otp, export, restore) is the only part that may be logged.
 * toString hides everything else so a stray log of the record leaks nothing.
 */
public record Mail(String kind, String to, String subject, String text) {
    @Override
    public String toString() {
        return "Mail[kind=" + kind + "]";
    }
}
```

`server/src/main/java/in/gullak/common/mail/MailSender.java`:

```java
package in.gullak.common.mail;

/** One attempt at handing a mail to the provider. Throws {@link MailSendException}; never retries. */
@FunctionalInterface
public interface MailSender {
    void send(Mail mail);
}
```

`server/src/main/java/in/gullak/common/mail/MailSendException.java`:

```java
package in.gullak.common.mail;

/** A provider call that failed or timed out. The message is a short reason we wrote, never provider text. */
public class MailSendException extends RuntimeException {
    public MailSendException(String reason) {
        super(reason);
    }

    public MailSendException(String reason, Throwable cause) {
        super(reason, cause);
    }
}
```

`server/src/main/java/in/gullak/common/mail/MailProperties.java`:

```java
package in.gullak.common.mail;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param from         the verified sender, such as {@code Gullak <no-reply@gullak.in>}
 * @param sesRegion    the SES region; ap-south-1 keeps mail processing in India (spec 4.7)
 * @param linksBaseUrl the server's public https address; export and restore links start with it
 * @param timeout      per provider call (spec 4.11: external calls have timeouts)
 * @param attempts     tries before giving up
 * @param backoff      wait before the second try; the third waits twice as long
 * @param async        true sends on a virtual thread so a slow provider never holds a request; tests send inline
 */
@ConfigurationProperties("gullak.mail")
public record MailProperties(String from, String sesRegion, String linksBaseUrl, Duration timeout, int attempts,
                             Duration backoff, boolean async) {}
```

`server/src/main/java/in/gullak/common/mail/InMemoryMailSender.java`:

```java
package in.gullak.common.mail;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Local and test only: keeps sent mail in memory and fails on demand. Never logs anything. */
@Component
@Profile({"local", "test"})
public class InMemoryMailSender implements MailSender {
    private final List<Mail> sent = new CopyOnWriteArrayList<>();
    private final AtomicInteger failNext = new AtomicInteger();
    private volatile boolean failAlways;

    @Override
    public void send(Mail mail) {
        if (failAlways || failNext.getAndUpdate(n -> Math.max(0, n - 1)) > 0) {
            throw new MailSendException("stub-failure");
        }
        sent.add(mail);
    }

    public List<Mail> sent() {
        return List.copyOf(sent);
    }

    public Optional<Mail> lastTo(String email) {
        List<Mail> all = sent();
        for (int i = all.size() - 1; i >= 0; i--) {
            if (all.get(i).to().equalsIgnoreCase(email)) {
                return Optional.of(all.get(i));
            }
        }
        return Optional.empty();
    }

    public Optional<Mail> lastTo(String email, String kind) {
        List<Mail> all = sent();
        for (int i = all.size() - 1; i >= 0; i--) {
            if (all.get(i).to().equalsIgnoreCase(email) && all.get(i).kind().equals(kind)) {
                return Optional.of(all.get(i));
            }
        }
        return Optional.empty();
    }

    /** The next {@code n} sends throw. */
    public void failNext(int n) {
        failNext.set(n);
    }

    public void failAlways(boolean on) {
        failAlways = on;
    }

    /** Clears the failure switches (not the sent list, which tests read by address). */
    public void reset() {
        failNext.set(0);
        failAlways = false;
    }
}
```

`server/src/main/java/in/gullak/common/mail/MailDelivery.java`:

```java
package in.gullak.common.mail;

import in.gullak.common.db.AfterCommit;
import in.gullak.common.log.Events;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Sends mail with bounded retries (spec 4.11). A send never fails the caller: after the last try it logs
 * mail.gave_up and runs the caller's give-up hook (usually MailOutbox.queueOnGiveUp, which queues a retry).
 * Logs carry the mail's kind only.
 */
@Component
public class MailDelivery {
    private static final Logger log = LoggerFactory.getLogger(MailDelivery.class);

    private final MailSender sender;
    private final MailProperties props;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public MailDelivery(MailSender sender, MailProperties props) {
        this.sender = sender;
        this.props = props;
    }

    /** Sends once the surrounding transaction commits, so a rolled-back request mails nothing. */
    public void deliverAfterCommit(Mail mail, Runnable onGiveUp) {
        AfterCommit.run(() -> deliver(mail, onGiveUp));
    }

    /** Sends now: on a virtual thread when async, else inline. {@code onGiveUp} may be null. */
    public void deliver(Mail mail, Runnable onGiveUp) {
        Runnable job = () -> {
            if (!sendNow(mail) && onGiveUp != null) {
                onGiveUp.run();
            }
        };
        if (props.async()) {
            executor.execute(job);
        } else {
            job.run();
        }
    }

    /** Tries {@code attempts} times with backoff on the calling thread; true when the provider accepted it. */
    public boolean sendNow(Mail mail) {
        for (int i = 1; i <= props.attempts(); i++) {
            try {
                sender.send(mail);
                log.info("{} kind={}", Events.MAIL_SENT, mail.kind());
                return true;
            } catch (MailSendException e) {
                log.warn("{} kind={} attempt={} reason={}", Events.MAIL_RETRY, mail.kind(), i, e.getMessage());
                if (i < props.attempts() && !pause(props.backoff().multipliedBy(i))) {
                    break;
                }
            }
        }
        log.warn("{} kind={}", Events.MAIL_GAVE_UP, mail.kind());
        return false;
    }

    private static boolean pause(Duration wait) {
        if (wait.isZero()) {
            return true;
        }
        try {
            Thread.sleep(wait);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("{} reason=interrupted", Events.MAIL_RETRY);
            return false;
        }
    }

    @PreDestroy
    void stop() {
        executor.shutdown();
    }
}
```

`server/src/main/java/in/gullak/auth/MailOtpMailer.java`:

```java
package in.gullak.auth;

import in.gullak.common.mail.Mail;
import in.gullak.common.mail.MailDelivery;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * The real sign-in mailer (prod). OtpService calls it after the code's row commits. Never queued: the code
 * expires in 10 minutes and storing it for a retry would keep a secret at rest; the user can ask again.
 */
@Component
@Profile("!local & !test")
class MailOtpMailer implements OtpMailer {
    private final MailDelivery delivery;

    MailOtpMailer(MailDelivery delivery) {
        this.delivery = delivery;
    }

    @Override
    public void sendOtp(String email, String code) {
        delivery.deliver(new Mail("otp", email, "Your Gullak sign-in code",
            "Your code is " + code + ". It works for 10 minutes.\n\n"
                + "If you didn't ask for it, you can ignore this email. Someone may have typed your address by mistake.\n"),
            null);
    }
}
```

In `server/src/main/java/in/gullak/auth/OtpService.java`, replace the body of `request` with (the only change is the mail line, which now waits for the commit):

```java
    @Transactional
    public void request(String rawEmail, String ip) {
        String email = Emails.normalize(rawEmail);
        limiter.check("otp-request-ip:" + ip, 30, WINDOW);
        limiter.check("otp-request-email:" + email, 5, WINDOW);
        String code = String.format("%06d", random.nextInt(1_000_000));
        Instant now = clock.instant();
        codes.lockEmail(email);
        codes.retireLiveCodes(email, now);
        codes.save(new OtpCodeEntity(email, hasher.hash(email, code), now, now.plus(props.otpTtl())));
        // Deferred from Plan 1: a code is mailed only once its row has committed.
        AfterCommit.run(() -> mailer.sendOtp(email, code));
        log.info(Events.AUTH_OTP_REQUESTED);
    }
```

and add `import in.gullak.common.db.AfterCommit;`.

Append to `server/src/main/java/in/gullak/common/log/Events.java`, before `private Events() {}`:

```java
    public static final String MAIL_SENT = "mail.sent";
    public static final String MAIL_RETRY = "mail.retry";
    public static final String MAIL_GAVE_UP = "mail.gave_up";
```

Append under the existing `gullak:` key in `server/src/main/resources/application.yml`:

```yaml
  mail:
    from: ${GULLAK_MAIL_FROM:Gullak <no-reply@example.test>}
    ses-region: ${AWS_REGION:ap-south-1}
    links-base-url: ${GULLAK_PUBLIC_URL:http://localhost:8080}
    timeout: 5s
    attempts: 3
    backoff: 1s
    async: true
```

Add under `gullak:` in `server/src/test/resources/application-test.yml` (keep what earlier plans put there):

```yaml
  mail:
    async: false
    backoff: 0s
```

- [ ] **Step 4: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.db.AfterCommitApiTest' --tests 'in.gullak.common.mail.*' --tests 'in.gullak.auth.*'`
Expected: PASS (OtpApiTest still passes: the in-memory mailer receives the code before the HTTP response returns, because the commit happens when `request` returns).

Then the whole suite: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 5: Red team**

Dispatch `red-team` with task id `plan-08-task-1`: force a rollback after `codes.save` (a debugger breakpoint or a temporary throw in a scratch branch) and confirm no code arrives; flood `POST /auth/otp/request` with a provider stub that sleeps 30 s and confirm request latency stays flat and the server stays responsive; grep the captured logs for the email, the code and the subject. Findings go to `docs/reports/red-team/plan-08-task-1.md`.

- [ ] **Step 6: Commit**

```bash
git add server/src/main/java/in/gullak/common/db/AfterCommit.java server/src/main/java/in/gullak/common/mail server/src/main/java/in/gullak/auth/MailOtpMailer.java server/src/main/java/in/gullak/auth/OtpService.java server/src/main/java/in/gullak/common/log/Events.java server/src/main/resources/application.yml server/src/test/resources/application-test.yml server/src/test/java/in/gullak/common/db server/src/test/java/in/gullak/common/mail server/src/test/java/in/gullak/auth/OtpAfterCommitApiTest.java server/src/test/java/in/gullak/auth/MailOtpMailerTest.java docs/reports/red-team/plan-08-task-1.md
git commit -m "feat(server): mail after commit with bounded retries; OTP mail leaves the transaction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Amazon SES sender and the production configuration check

**Owner:** backend-engineer. **Test IDs:** ERR-08 (provider half: a hanging SES call ends at the timeout), new MAIL-01 (prod refuses to start without its mail settings). **Red team:** yes (credentials never logged; SDK retries really off so one try is one request; the timeout holds against a server that accepts and never answers).

**Files:**
- Modify: `server/build.gradle.kts`
- Create: `server/src/main/java/in/gullak/common/mail/SesMailSender.java`, `MailConfig.java`, `MailConfigCheck.java`
- Modify: `server/src/main/resources/application-prod.yml`, `README.md` (Configuration)
- Test: `server/src/test/java/in/gullak/support/StubHttpServer.java`, `server/src/test/java/in/gullak/common/mail/SesMailSenderTest.java`, `server/src/test/java/in/gullak/common/mail/MailConfigCheckTest.java`

**Interfaces:**
- Consumes: `Mail`, `MailSender`, `MailSendException`, `MailProperties` (Task 1).
- Produces: `SesMailSender(MailProperties, AwsCredentialsProvider, URI endpointOverride)` (package-private), the `prod` `MailSender` bean; `MailConfigCheck`; test support `StubHttpServer` (`uri()`, `respond(int, String)`, `delay(Duration)`, `received()`, `Received(method, path, headers, body)`, `header(Received, String)`), used again in Task 9.

- [ ] **Step 1: Add the SDK**

In `server/build.gradle.kts`, add after the `repositories` block:

```kotlin
dependencyManagement {
	imports {
		// AWS SDK for Java v2. Before committing, check https://central.sonatype.com/artifact/software.amazon.awssdk/bom
		// and use the newest 2.x release if it is newer than this one; the API used here is stable across 2.x.
		mavenBom("software.amazon.awssdk:bom:2.31.0")
	}
}
```

and inside `dependencies { … }`:

```kotlin
	// SES v2 only, over the JDK's URL connection: no Apache or Netty client on the classpath.
	implementation("software.amazon.awssdk:sesv2") {
		exclude(group = "software.amazon.awssdk", module = "apache-client")
		exclude(group = "software.amazon.awssdk", module = "netty-nio-client")
	}
	implementation("software.amazon.awssdk:url-connection-client")
```

Run: `cd server && ./gradlew dependencies --configuration runtimeClasspath | grep -E "sesv2|apache-client|netty-nio"`
Expected: `sesv2` listed; no `apache-client`, no `netty-nio-client`.

- [ ] **Step 2: Write the failing tests**

`server/src/test/java/in/gullak/support/StubHttpServer.java`:

```java
package in.gullak.support;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;

/** A local HTTP server that stands in for a provider (SES, Expo): records requests, answers or hangs on demand. */
public final class StubHttpServer implements AutoCloseable {
    public record Received(String method, String path, Map<String, List<String>> headers, String body) {}

    private final HttpServer server;
    private final List<Received> received = new CopyOnWriteArrayList<>();
    private volatile int status = 200;
    private volatile String body = "{}";
    private volatile Duration delay = Duration.ZERO;

    public StubHttpServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String requestBody = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            received.add(new Received(exchange.getRequestMethod(), exchange.getRequestURI().getPath(),
                Map.copyOf(exchange.getRequestHeaders()), requestBody));
            if (!delay.isZero()) {
                try {
                    Thread.sleep(delay);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, out.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(out);
            }
        });
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
    }

    public URI uri() {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort());
    }

    public void respond(int status, String body) {
        this.status = status;
        this.body = body;
    }

    public void delay(Duration delay) {
        this.delay = delay;
    }

    public List<Received> received() {
        return List.copyOf(received);
    }

    /** The first value of a request header, matched without regard to case. */
    public static String header(Received r, String name) {
        return r.headers().entrySet().stream()
            .filter(e -> e.getKey().equalsIgnoreCase(name))
            .map(e -> e.getValue().getFirst())
            .findFirst().orElse(null);
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
```

`server/src/test/java/in/gullak/common/mail/SesMailSenderTest.java`:

```java
package in.gullak.common.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import in.gullak.support.StubHttpServer;
import java.time.Duration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.exception.SdkClientException;

class SesMailSenderTest {
    private static final AwsCredentialsProvider CREDS =
        StaticCredentialsProvider.create(AwsBasicCredentials.create("AKIDEXAMPLE", "test-secret-key"));
    private static final Mail MAIL = new Mail("otp", "priya@example.test", "Your Gullak sign-in code", "Your code is 482913.");

    private StubHttpServer ses;

    @BeforeEach
    void start() throws Exception {
        ses = new StubHttpServer();
    }

    @AfterEach
    void stop() {
        ses.close();
    }

    private SesMailSender sender(Duration timeout) {
        MailProperties props = new MailProperties("Gullak <no-reply@example.test>", "ap-south-1",
            "https://api.example.test", timeout, 3, Duration.ZERO, false);
        return new SesMailSender(props, CREDS, ses.uri());
    }

    @Test
    void sendsOneSignedRequestToTheSesV2Api() {
        ses.respond(200, "{\"MessageId\":\"stub-1\"}");
        sender(Duration.ofSeconds(5)).send(MAIL);
        assertThat(ses.received()).singleElement().satisfies(r -> {
            assertThat(r.method()).isEqualTo("POST");
            assertThat(r.path()).isEqualTo("/v2/email/outbound-emails");
            assertThat(StubHttpServer.header(r, "Authorization")).startsWith("AWS4-HMAC-SHA256");
            assertThat(r.body()).contains("Your Gullak sign-in code", "priya@example.test", "no-reply@example.test");
        });
    }

    @Test
    void aServerErrorIsOneTryAndAMailSendException() {
        ses.respond(500, "{\"message\":\"boom\"}");
        assertThatThrownBy(() -> sender(Duration.ofSeconds(5)).send(MAIL))
            .isInstanceOf(MailSendException.class)
            .hasMessageStartingWith("ses-");
        assertThat(ses.received()).hasSize(1); // SDK retries are off; MailDelivery owns retries
    }

    @Test
    void aHangingProviderEndsAtTheTimeout() { // ERR-08 (provider)
        ses.delay(Duration.ofSeconds(5));
        long started = System.nanoTime();
        assertThatThrownBy(() -> sender(Duration.ofMillis(300)).send(MAIL)).isInstanceOf(MailSendException.class);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(3));
    }

    @Test
    void missingCredentialsStopTheServerFromStarting() {
        AwsCredentialsProvider none = () -> {
            throw SdkClientException.create("no credentials");
        };
        MailProperties props = new MailProperties("Gullak <no-reply@example.test>", "ap-south-1",
            "https://api.example.test", Duration.ofSeconds(5), 3, Duration.ZERO, false);
        assertThatThrownBy(() -> new SesMailSender(props, none, ses.uri()))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("AWS_ACCESS_KEY_ID");
    }
}
```

`server/src/test/java/in/gullak/common/mail/MailConfigCheckTest.java`:

```java
package in.gullak.common.mail;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

/** MAIL-01: prod refuses to start with a placeholder sender or a non-https link base. */
class MailConfigCheckTest {
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(MailProperties.class)
    static class Props {}

    private static ApplicationContextRunner runner(String... profiles) {
        return new ApplicationContextRunner()
            .withInitializer(c -> c.getEnvironment().setActiveProfiles(profiles))
            .withUserConfiguration(Props.class, MailConfigCheck.class)
            .withPropertyValues("gullak.mail.timeout=5s", "gullak.mail.attempts=3", "gullak.mail.backoff=1s");
    }

    @Test
    void prodWithAPlaceholderSenderFailsToStart() {
        runner("prod").withPropertyValues("gullak.mail.from=Gullak <no-reply@example.test>",
                "gullak.mail.links-base-url=https://api.gullak.in")
            .run(c -> assertThat(c.getStartupFailure()).rootCause().hasMessageContaining("GULLAK_MAIL_FROM"));
    }

    @Test
    void prodWithAnHttpLinkBaseFailsToStart() {
        runner("prod").withPropertyValues("gullak.mail.from=Gullak <no-reply@gullak.in>",
                "gullak.mail.links-base-url=http://api.gullak.in")
            .run(c -> assertThat(c.getStartupFailure()).rootCause().hasMessageContaining("GULLAK_PUBLIC_URL"));
    }

    @Test
    void prodWithRealSettingsStarts() {
        runner("prod").withPropertyValues("gullak.mail.from=Gullak <no-reply@gullak.in>",
                "gullak.mail.links-base-url=https://api.gullak.in")
            .run(c -> assertThat(c).hasNotFailed().hasSingleBean(MailConfigCheck.class));
    }

    @Test
    void localMayUseThePlaceholders() {
        runner("local").withPropertyValues("gullak.mail.from=Gullak <no-reply@example.test>",
                "gullak.mail.links-base-url=http://localhost:8080")
            .run(c -> assertThat(c).hasNotFailed().doesNotHaveBean(MailConfigCheck.class));
    }
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.mail.SesMailSenderTest' --tests 'in.gullak.common.mail.MailConfigCheckTest'`
Expected: compilation fails (`SesMailSender`, `MailConfigCheck` do not exist).

- [ ] **Step 4: Write the code**

`server/src/main/java/in/gullak/common/mail/SesMailSender.java`:

```java
package in.gullak.common.mail;

import java.net.URI;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.awscore.retry.AwsRetryStrategy;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sesv2.SesV2Client;
import software.amazon.awssdk.services.sesv2.SesV2ClientBuilder;
import software.amazon.awssdk.services.sesv2.model.Body;
import software.amazon.awssdk.services.sesv2.model.Content;
import software.amazon.awssdk.services.sesv2.model.Destination;
import software.amazon.awssdk.services.sesv2.model.EmailContent;
import software.amazon.awssdk.services.sesv2.model.Message;
import software.amazon.awssdk.services.sesv2.model.SendEmailRequest;

/**
 * Amazon SES v2 in the configured region (ap-south-1 by default). One attempt per call: the SDK's own retries
 * are off so MailDelivery's three tries are the only ones. Every timeout is the configured one (5 s).
 */
class SesMailSender implements MailSender, AutoCloseable {
    private final SesV2Client client;
    private final String from;

    SesMailSender(MailProperties props, AwsCredentialsProvider credentials, URI endpointOverride) {
        try {
            credentials.resolveCredentials();
        } catch (SdkClientException e) {
            throw new IllegalStateException("AWS credentials for SES are missing in prod. Set AWS_ACCESS_KEY_ID and "
                + "AWS_SECRET_ACCESS_KEY for an IAM user that may only call ses:SendEmail.", e);
        }
        SesV2ClientBuilder builder = SesV2Client.builder()
            .region(Region.of(props.sesRegion()))
            .credentialsProvider(credentials)
            .httpClientBuilder(UrlConnectionHttpClient.builder()
                .connectionTimeout(props.timeout())
                .socketTimeout(props.timeout()))
            .overrideConfiguration(c -> c
                .apiCallTimeout(props.timeout())
                .apiCallAttemptTimeout(props.timeout())
                .retryStrategy(AwsRetryStrategy.doNotRetry()));
        if (endpointOverride != null) {
            builder.endpointOverride(endpointOverride);
        }
        this.client = builder.build();
        this.from = props.from();
    }

    @Override
    public void send(Mail mail) {
        SendEmailRequest request = SendEmailRequest.builder()
            .fromEmailAddress(from)
            .destination(Destination.builder().toAddresses(mail.to()).build())
            .content(EmailContent.builder().simple(Message.builder()
                .subject(Content.builder().data(mail.subject()).charset("UTF-8").build())
                .body(Body.builder().text(Content.builder().data(mail.text()).charset("UTF-8").build()).build())
                .build()).build())
            .build();
        try {
            client.sendEmail(request);
        } catch (SdkException e) {
            throw new MailSendException("ses-" + e.getClass().getSimpleName(), e);
        }
    }

    @Override
    public void close() {
        client.close();
    }
}
```

`server/src/main/java/in/gullak/common/mail/MailConfig.java`:

```java
package in.gullak.common.mail;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;

/** The production mail sender. Credentials come from the standard AWS environment variables. */
@Configuration(proxyBeanMethods = false)
@Profile("prod")
class MailConfig {
    @Bean(destroyMethod = "close")
    SesMailSender sesMailSender(MailProperties props) {
        return new SesMailSender(props, DefaultCredentialsProvider.builder().build(), null);
    }
}
```

`server/src/main/java/in/gullak/common/mail/MailConfigCheck.java`:

```java
package in.gullak.common.mail;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Like TrustedProxiesCheck: prod refuses to start with a placeholder sender or links that are not https. */
@Component
@Profile("prod")
class MailConfigCheck {
    MailConfigCheck(MailProperties props) {
        if (props.from() == null || props.from().isBlank() || props.from().contains("example.test")) {
            throw new IllegalStateException("GULLAK_MAIL_FROM must be set in prod to the SES-verified sender, "
                + "such as 'Gullak <no-reply@your-domain>'.");
        }
        if (props.linksBaseUrl() == null || !props.linksBaseUrl().startsWith("https://")) {
            throw new IllegalStateException("GULLAK_PUBLIC_URL must be set in prod to the server's https address; "
                + "export and restore links are built from it.");
        }
    }
}
```

Append to `server/src/main/resources/application-prod.yml` (no defaults: a missing variable stops the start):

```yaml
gullak:
  mail:
    from: ${GULLAK_MAIL_FROM}
    links-base-url: ${GULLAK_PUBLIC_URL}
```

(If `application-prod.yml` already has a `gullak:` key, merge `mail:` under it.)

In `README.md`, add to the Configuration table:

```markdown
| `GULLAK_MAIL_FROM` | prod | The SES-verified sender, e.g. `Gullak <no-reply@gullak.in>`. Prod refuses to start without it. |
| `GULLAK_PUBLIC_URL` | prod | The server's public https address; export and restore links start with it. |
| `AWS_REGION` | prod | SES region; default `ap-south-1` (Mumbai) so mail is processed in India. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | prod | An IAM user whose only permission is `ses:SendEmail` on the sending identity. |
```

and a short section after the table:

```markdown
### Email (Amazon SES)

1. In SES (ap-south-1), verify the sending domain with DKIM and set a custom MAIL FROM domain.
2. Request production access (new accounts are in the sandbox and can only mail verified addresses).
3. Create an IAM user with one policy: `ses:SendEmail` on the domain identity. Put its keys in the environment.
4. Mail is plain text. Sign-in codes are never queued; export and restore mails that fail three times are retried
   every 15 minutes (doubling) up to five times from `mail_outbox`, which stores no address or link.
```

- [ ] **Step 5: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.mail.*'`
Expected: PASS.

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 6: Red team**

Dispatch `red-team` with task id `plan-08-task-2`: point `SesMailSender` at a stub that accepts the connection and never writes a byte and confirm the call ends near 5 s; confirm one HTTP request per `send` against a 503 stub; start the app with `--spring.profiles.active=prod` and each mail variable missing in turn and confirm it refuses to start; grep startup and failure logs for the secret key. Report to `docs/reports/red-team/plan-08-task-2.md`.

- [ ] **Step 7: Commit**

```bash
git add server/build.gradle.kts server/src/main/java/in/gullak/common/mail server/src/main/resources/application-prod.yml server/src/test/java/in/gullak/support/StubHttpServer.java server/src/test/java/in/gullak/common/mail README.md docs/reports/red-team/plan-08-task-2.md
git commit -m "feat(server): Amazon SES sender in Mumbai with 5 s timeouts; prod refuses to start without mail settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Mail outbox and the retry job

**Owner:** backend-engineer. **Test IDs:** ERR-08 (mail half: "retry queued"), ERR-09 (mail half: "queued for later, job records it"), JOB-10 (lease, for the retry job). **Red team:** yes (no address, subject, text or token in `mail_outbox`; two instances never send one row twice; a resender for a feature that no longer wants the mail cancels it).

**Files:**
- Create: `server/src/main/resources/db/migration/V060__mail_outbox.sql`
- Create: `server/src/main/java/in/gullak/common/mail/MailOutbox.java`, `MailResender.java`, `MailRetryJob.java`
- Modify: `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/test/java/in/gullak/support/ApiTest.java`
- Test: `server/src/test/java/in/gullak/common/mail/MailRetryJobApiTest.java`

**Interfaces:**
- Consumes: `MailDelivery.deliver`, `sendNow`, `InMemoryMailSender` (Task 1); `JobLock.tryAcquire(String) : boolean`, `JobLock.release(String)` (Plan 6); `Db.ts`.
- Produces: table `mail_outbox`; `MailOutbox.queueOnGiveUp(UUID userId, String kind, UUID refId) : Runnable`, `MailOutbox.enqueue(UUID, String, UUID)`; `MailResender { String kind(); Optional<Mail> rebuild(UUID userId, UUID refId); }` (Tasks 5 and 7 implement it for `restore` and `export`); `MailRetryJob.runOnce() : int` (-1 when another instance holds the lease); events `mail.queued`, `mail.failed`; `ApiTest.mailbox`, `ApiTest.lastMail(String email, String kind) : Mail`, `ApiTest.linkToken(Mail) : String`.

- [ ] **Step 1: Migration**

`server/src/main/resources/db/migration/V060__mail_outbox.sql`:

```sql
-- Mails that failed three tries (spec 4.11: bounded retries, then queued). Nothing personal is stored: no
-- address, subject, text or link token. The owning feature rebuilds the mail from (kind, ref_id) with a
-- fresh link when the retry job runs.
create table mail_outbox (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    kind varchar(20) not null,
    ref_id uuid not null,
    status varchar(10) not null default 'queued' check (status in ('queued', 'sent', 'cancelled', 'failed')),
    attempts int not null default 0,
    next_attempt_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index mail_outbox_due_idx on mail_outbox (next_attempt_at) where status = 'queued';
```

- [ ] **Step 2: Test helpers**

In `server/src/test/java/in/gullak/support/ApiTest.java`, add the field and helpers (imports `in.gullak.common.mail.InMemoryMailSender`, `in.gullak.common.mail.Mail`, `java.util.regex.Matcher`, `java.util.regex.Pattern`):

```java
    @Autowired protected InMemoryMailSender mailbox;

    private static final Pattern LINK_TOKEN = Pattern.compile("/([A-Za-z0-9_-]{43})(?=\\s|$)");

    /** The newest mail of this kind sent to the address; fails the test when there is none. */
    protected Mail lastMail(String email, String kind) {
        return mailbox.lastTo(email, kind).orElseThrow(() -> new AssertionError("no " + kind + " mail"));
    }

    /** The 43-character link token at the end of the first link in a mail. */
    protected static String linkToken(Mail mail) {
        Matcher m = LINK_TOKEN.matcher(mail.text());
        if (!m.find()) {
            throw new AssertionError("no link in the " + mail.kind() + " mail");
        }
        return m.group(1);
    }
```

and replace the `@BeforeEach` method so the shared stub never carries a failure switch from one test to the next:

```java
    @BeforeEach
    void resetClock() {
        clock.reset();
        mailbox.reset();
    }
```

- [ ] **Step 3: Write the failing tests**

`server/src/test/java/in/gullak/common/mail/MailRetryJobApiTest.java`:

```java
package in.gullak.common.mail;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.common.jobs.JobLock;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;

@ExtendWith(OutputCaptureExtension.class)
@Import(MailRetryJobApiTest.Probe.class)
class MailRetryJobApiTest extends ApiTest {

    /** A feature stand-in: rebuilds a "probe" mail for the address it is told, or says the mail is no longer needed. */
    static class ProbeResender implements MailResender {
        volatile String to;
        volatile boolean gone;

        @Override
        public String kind() {
            return "probe";
        }

        @Override
        public Optional<Mail> rebuild(UUID userId, UUID refId) {
            return gone ? Optional.empty() : Optional.of(new Mail("probe", to, "Probe", "Rebuilt for " + refId));
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Probe {
        @Bean
        ProbeResender probeResender() {
            return new ProbeResender();
        }
    }

    @Autowired MailDelivery delivery;
    @Autowired MailOutbox outbox;
    @Autowired MailRetryJob job;
    @Autowired ProbeResender probe;
    @Autowired JobLock lock;

    private TestUser queued(UUID ref) throws Exception {
        TestUser u = signIn();
        probe.to = u.email();
        probe.gone = false;
        mailbox.failNext(3);
        delivery.deliver(new Mail("probe", u.email(), "Probe", "First try"), outbox.queueOnGiveUp(u.id(), "probe", ref));
        return u;
    }

    private String status(TestUser u) {
        return jdbc.sql("select status from mail_outbox where user_id = ?").param(u.id()).query(String.class).single();
    }

    @Test
    void givingUpQueuesTheMailWithNothingPersonalInTheRow(CapturedOutput out) throws Exception { // ERR-09 (mail)
        UUID ref = UUID.randomUUID();
        TestUser u = queued(ref);
        assertThat(out.getOut().split("mail.retry", -1)).hasSize(4);
        assertThat(out.getOut()).contains("mail.gave_up kind=probe", "mail.queued kind=probe");
        String row = jdbc.sql("select row_to_json(m)::text from mail_outbox m where user_id = ?")
            .param(u.id()).query(String.class).single();
        assertThat(row).contains(ref.toString(), "\"status\":\"queued\"").doesNotContain(u.email(), "First try");
        OffsetDateTime next = jdbc.sql("select next_attempt_at from mail_outbox where user_id = ?")
            .param(u.id()).query(OffsetDateTime.class).single();
        assertThat(next.toInstant()).isEqualTo(clock.instant().plus(Duration.ofMinutes(15)));
        assertThat(out.getAll()).doesNotContain(u.email());
    }

    @Test
    void theRetryJobSendsOnceTheProviderRecovers() throws Exception { // ERR-08 (mail: retry queued, then sent)
        UUID ref = UUID.randomUUID();
        TestUser u = queued(ref);
        clock.advance(Duration.ofMinutes(16));
        assertThat(job.runOnce()).isGreaterThanOrEqualTo(1);
        assertThat(lastMail(u.email(), "probe").text()).isEqualTo("Rebuilt for " + ref);
        assertThat(status(u)).isEqualTo("sent");
    }

    @Test
    void aRowThatIsNotDueYetIsLeftAlone() throws Exception {
        TestUser u = queued(UUID.randomUUID());
        clock.advance(Duration.ofMinutes(5));
        job.runOnce();
        assertThat(status(u)).isEqualTo("queued");
    }

    @Test
    void aMailTheFeatureNoLongerWantsIsCancelled() throws Exception {
        TestUser u = queued(UUID.randomUUID());
        probe.gone = true;
        clock.advance(Duration.ofMinutes(16));
        job.runOnce();
        assertThat(status(u)).isEqualTo("cancelled");
    }

    @Test
    void failingRoundsBackOffThenStopAfterFive(CapturedOutput out) throws Exception {
        TestUser u = queued(UUID.randomUUID());
        mailbox.failAlways(true);
        for (int round = 1; round <= 5; round++) {
            clock.advance(Duration.ofDays(1));
            job.runOnce();
        }
        assertThat(status(u)).isEqualTo("failed");
        assertThat(jdbc.sql("select attempts from mail_outbox where user_id = ?").param(u.id()).query(Integer.class).single())
            .isEqualTo(5);
        assertThat(out.getOut()).contains("mail.failed kind=probe");
    }

    @Test
    void anotherInstanceHoldingTheLeaseSkipsTheRun() { // JOB-10 (mail retry)
        assertThat(lock.tryAcquire(MailRetryJob.NAME)).isTrue();
        try {
            assertThat(job.runOnce()).isEqualTo(-1);
        } finally {
            lock.release(MailRetryJob.NAME);
        }
    }

    @Test
    void aDeletedUsersQueuedMailGoesWithThem() throws Exception {
        TestUser u = queued(UUID.randomUUID());
        jdbc.sql("delete from users where id = ?").param(u.id()).update();
        assertThat(jdbc.sql("select count(*) from mail_outbox where user_id = ?").param(u.id()).query(Long.class).single())
            .isZero();
    }
}
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.mail.MailRetryJobApiTest'`
Expected: compilation fails (`MailOutbox`, `MailResender`, `MailRetryJob` do not exist).

- [ ] **Step 5: Write the code**

`server/src/main/java/in/gullak/common/mail/MailResender.java`:

```java
package in.gullak.common.mail;

import java.util.Optional;
import java.util.UUID;

/**
 * Implemented by the feature that owns a kind of mail (auth: restore; data: export). The retry job calls it
 * to rebuild a queued mail, with a fresh link token where the mail carries one. Empty means "no longer needed".
 */
public interface MailResender {
    String kind();

    Optional<Mail> rebuild(UUID userId, UUID refId);
}
```

`server/src/main/java/in/gullak/common/mail/MailOutbox.java`:

```java
package in.gullak.common.mail;

import in.gullak.common.db.Db;
import in.gullak.common.log.Events;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The mail retry queue. JdbcClient, not JPA: a queue read and updated under the retry job's lease, owned by
 * common (which has no repositories). Rows hold a reference, never personal text.
 */
@Component
public class MailOutbox {
    static final Duration FIRST_RETRY = Duration.ofMinutes(15);
    static final int MAX_ROUNDS = 5;
    private static final Logger log = LoggerFactory.getLogger(MailOutbox.class);

    record Row(UUID id, UUID userId, String kind, UUID refId, int attempts) {}

    private final JdbcClient jdbc;
    private final Clock clock;
    private final TransactionTemplate ownTransaction;

    MailOutbox(JdbcClient jdbc, Clock clock, PlatformTransactionManager transactions) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.ownTransaction = new TransactionTemplate(transactions);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** MailDelivery's give-up hook. Never throws: a failed insert is logged and that mail is lost. */
    public Runnable queueOnGiveUp(UUID userId, String kind, UUID refId) {
        return () -> {
            try {
                enqueue(userId, kind, refId);
            } catch (DataAccessException | TransactionException e) {
                log.error("{} kind={} user={} reason=outbox_insert", Events.MAIL_FAILED, kind, userId, e);
            }
        };
    }

    /**
     * Always in its own transaction: the give-up hook can run inside another transaction's afterCommit (inline
     * delivery), where a plain write would join a transaction that never commits again.
     */
    public void enqueue(UUID userId, String kind, UUID refId) {
        ownTransaction.executeWithoutResult(status ->
            jdbc.sql("insert into mail_outbox (id, user_id, kind, ref_id, next_attempt_at) values (?, ?, ?, ?, ?)")
                .params(UUID.randomUUID(), userId, kind, refId, Db.ts(clock.instant().plus(FIRST_RETRY)))
                .update());
        log.info("{} kind={} user={}", Events.MAIL_QUEUED, kind, userId);
    }

    List<Row> due(int limit) {
        return jdbc.sql("""
                select id, user_id, kind, ref_id, attempts from mail_outbox
                where status = 'queued' and next_attempt_at <= ? order by next_attempt_at, id limit ?
                """)
            .params(Db.ts(clock.instant()), limit)
            .query((rs, n) -> new Row(rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                rs.getString("kind"), rs.getObject("ref_id", UUID.class), rs.getInt("attempts")))
            .list();
    }

    void markSent(UUID id) {
        setStatus(id, "sent");
    }

    void markCancelled(UUID id) {
        setStatus(id, "cancelled");
    }

    void markFailed(UUID id) {
        setStatus(id, "failed");
    }

    /** One more failed round: back off 15 min × 2^rounds, or give up for good after five rounds. */
    void retryLater(Row row) {
        int attempts = row.attempts() + 1;
        if (attempts >= MAX_ROUNDS) {
            jdbc.sql("update mail_outbox set status = 'failed', attempts = ? where id = ?").params(attempts, row.id()).update();
            log.warn("{} kind={} user={} rounds={}", Events.MAIL_FAILED, row.kind(), row.userId(), attempts);
            return;
        }
        jdbc.sql("update mail_outbox set attempts = ?, next_attempt_at = ? where id = ?")
            .params(attempts, Db.ts(clock.instant().plus(FIRST_RETRY.multipliedBy(1L << attempts))), row.id())
            .update();
    }

    private void setStatus(UUID id, String status) {
        jdbc.sql("update mail_outbox set status = ? where id = ?").params(status, id).update();
    }
}
```

`server/src/main/java/in/gullak/common/mail/MailRetryJob.java`:

```java
package in.gullak.common.mail;

import in.gullak.common.jobs.JobLock;
import in.gullak.common.log.Events;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Every 10 minutes, under a lease (two instances never send one row twice), rebuilds and sends due mails.
 * It writes no job_runs row: the queue itself is the record (status, attempts).
 */
@Component
public class MailRetryJob {
    public static final String NAME = "mail-retry";
    private static final Logger log = LoggerFactory.getLogger(MailRetryJob.class);

    private final JobLock lock;
    private final MailOutbox outbox;
    private final MailDelivery delivery;
    private final Map<String, MailResender> resenders;

    MailRetryJob(JobLock lock, MailOutbox outbox, MailDelivery delivery, List<MailResender> resenders) {
        this.lock = lock;
        this.outbox = outbox;
        this.delivery = delivery;
        this.resenders = resenders.stream().collect(Collectors.toMap(MailResender::kind, Function.identity()));
    }

    @Scheduled(fixedDelay = 10, timeUnit = TimeUnit.MINUTES)
    public void scheduled() {
        runOnce();
    }

    /** The number of rows handled, or -1 when another instance holds the lease. */
    public int runOnce() {
        if (!lock.tryAcquire(NAME)) {
            log.info("{} job={}", Events.JOB_SKIPPED, NAME);
            return -1;
        }
        try {
            List<MailOutbox.Row> rows = outbox.due(50);
            rows.forEach(this::handle);
            return rows.size();
        } finally {
            lock.release(NAME);
        }
    }

    private void handle(MailOutbox.Row row) {
        MailResender resender = resenders.get(row.kind());
        if (resender == null) {
            outbox.markFailed(row.id());
            log.warn("{} kind={} reason=no_resender", Events.MAIL_FAILED, row.kind());
            return;
        }
        Optional<Mail> mail;
        try {
            mail = resender.rebuild(row.userId(), row.refId());
        } catch (DataAccessException e) {
            log.warn("{} kind={} reason=rebuild_failed", Events.MAIL_RETRY, row.kind());
            outbox.retryLater(row);
            return;
        }
        if (mail.isEmpty()) {
            outbox.markCancelled(row.id());
        } else if (delivery.sendNow(mail.get())) {
            outbox.markSent(row.id());
        } else {
            outbox.retryLater(row);
        }
    }
}
```

Append to `Events.java`:

```java
    public static final String MAIL_QUEUED = "mail.queued";
    public static final String MAIL_FAILED = "mail.failed";
```

- [ ] **Step 6: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.mail.*'`
Expected: PASS.

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 7: Update the test-cases doc**

In `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`, section 6 (jobs), add after JOB-16 (Plan 6's last row; Tasks 9 and 10 later insert JOB-17 to JOB-19 before this one):

`| JOB-20 | Mail retry | an export or restore mail that failed 3 tries is queued with no address or token; the retry job rebuilds it with a fresh link 15 min later, backs off by doubling, and stops after 5 rounds with a WARN |`

and in the error-handling section add after ERR-09:

`| MAIL-01 | Prod mail settings | prod refuses to start without GULLAK_MAIL_FROM, an https GULLAK_PUBLIC_URL, or AWS credentials |`

- [ ] **Step 8: Red team and commit**

Dispatch `red-team` with task id `plan-08-task-3`: dump `mail_outbox` after forcing failures and look for any address, subject, token or text; run `runOnce` from two threads at once and count mails sent per row; queue a row with an unknown kind. Report to `docs/reports/red-team/plan-08-task-3.md`.

```bash
git add server/src/main/resources/db/migration/V060__mail_outbox.sql server/src/main/java/in/gullak/common/mail server/src/main/java/in/gullak/common/log/Events.java server/src/test/java/in/gullak/support/ApiTest.java server/src/test/java/in/gullak/common/mail/MailRetryJobApiTest.java docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/reports/red-team/plan-08-task-3.md
git commit -m "feat(server): mail outbox with no personal data and a leased retry job

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Consent (DPDP), the account gate, the privacy policy and the breach-response note

**Owner:** backend-engineer. **Test IDs:** API-CON-01, API-CON-02, new API-CON-03 to API-CON-06, spec 3.2 item 9 (consent record), spec 4.7 DPDP (consent screen's server half, privacy policy, breach note). **Red team:** yes (consent replay; consenting to another version; every bearer route before consent; a token for a deleted row; nothing personal in the consent log line).

**Files:**
- Create: `server/src/main/resources/db/migration/V061__consent.sql`
- Modify: `server/src/main/java/in/gullak/common/error/ErrorCode.java`, `JsonAuthHandlers.java` (`write` becomes public)
- Create: `server/src/main/java/in/gullak/common/error/AccountLockedException.java`
- Create: `server/src/main/java/in/gullak/common/web/AccountGate.java`, `AccountState.java`, `AccountStateFilter.java`
- Modify: `server/src/main/java/in/gullak/common/config/SecurityConfig.java`
- Modify: `server/src/main/java/in/gullak/auth/UserEntity.java`, `UserRepository.java`
- Create: `server/src/main/java/in/gullak/auth/AccountProperties.java`, `Account.java`, `ConsentResult.java`, `ConsentEntity.java`, `ConsentRepository.java`, `AccountService.java`, `AccountController.java`
- Modify: `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/main/resources/application.yml`, `application-prod.yml`
- Modify: `server/src/test/java/in/gullak/support/ApiTest.java`, `server/src/test/java/in/gullak/security/LogRedactionApiTest.java`
- Create: `docs/privacy-policy.md`, `docs/breach-response.md`
- Test: `server/src/test/java/in/gullak/auth/ConsentApiTest.java`, `server/src/test/java/in/gullak/auth/ConsentVersionTest.java`

**Interfaces:**
- Consumes: `UserRepository`, `ValidationException(String field, String message)`, `NotFoundException`, `JsonAuthHandlers`, `UserMdcFilter`, `CurrentUser.id(Jwt)` (Plan 1).
- Produces: `ErrorCode.ACCOUNT_LOCKED` (403), `CONSENT_REQUIRED` (403), `LINK_EXPIRED` (410); `AccountLockedException` with `MESSAGE`; `AccountGate.stateOf(UUID) : AccountState`; `AccountState { ACTIVE, NEEDS_CONSENT, LOCKED, MISSING }`; `AccountStateFilter`; `JsonAuthHandlers.write(HttpServletResponse, int, ErrorCode, String)` (public); `AccountProperties(String consentVersion, Duration grace, String supportEmail)` at `gullak.account`; `Account(String email, String status, String consentVersion, Instant consentedAt, String currentConsentVersion, Instant deletionRequestedAt, String supportEmail)`; `ConsentResult(String version, Instant consentedAt, boolean created)`; `AccountService.account(UUID)`, `consent(UUID, String)`, `stateOf(UUID)`; `UserEntity.recordConsent`, `lock`, `restore`, `isLocked`, getters; `UserRepository.findForUpdate(UUID)`; `GET /api/v1/me/account`, `POST /api/v1/me/consent` (201 first time, 200 on replay); event `consent.recorded`; test helpers `ApiTest.CONSENT_VERSION`, `consent(TestUser)`, `signInWithoutConsent()`, `signInWithoutConsent(String)`.

- [ ] **Step 1: Migration and configuration**

`server/src/main/resources/db/migration/V061__consent.sql`:

```sql
-- Spec 4.5: users.status is active or locked (locked = deletion requested, spec 4.7).
alter table users add constraint users_status_check check (status in ('active', 'locked'));

-- DPDP: a record of each policy version a user agreed to, kept with the account and deleted with it.
-- users.consent_version and consented_at hold the latest; this table holds the history.
create table consents (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    version varchar(16) not null,
    consented_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, version)
);
```

Append under `gullak:` in `application.yml`:

```yaml
  account:
    # Must equal the "Version:" line of docs/privacy-policy.md (ConsentVersionTest). A new version asks every user again.
    consent-version: "2026-10"
    grace: 30d
    support-email: ${GULLAK_SUPPORT_EMAIL:help@example.test}
```

Append to `application-prod.yml` under `gullak:`:

```yaml
  account:
    support-email: ${GULLAK_SUPPORT_EMAIL}
```

and to the README Configuration table:

```markdown
| `GULLAK_SUPPORT_EMAIL` | prod | Shown in Me → Help and contact and in the privacy policy screen. Prod refuses to start without it. |
```

- [ ] **Step 2: Write the failing tests**

`server/src/test/java/in/gullak/auth/ConsentApiTest.java`:

```java
package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@ExtendWith(OutputCaptureExtension.class)
class ConsentApiTest extends ApiTest {

    private ResultActions postConsent(TestUser u, String json) throws Exception {
        return mvc.perform(post("/api/v1/me/consent").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private long consentRows(TestUser u) {
        return jdbc.sql("select count(*) from consents where user_id = ?").param(u.id()).query(Long.class).single();
    }

    @Test
    void recordsConsentWithItsTime(CapturedOutput out) throws Exception { // API-CON-01
        TestUser u = signInWithoutConsent();
        postConsent(u, "{\"version\":\"2026-10\"}")
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.version").value("2026-10"))
            .andExpect(jsonPath("$.consentedAt").value("2026-10-23T08:00:00Z"));
        assertThat(jdbc.sql("select consent_version from users where id = ?").param(u.id()).query(String.class).single())
            .isEqualTo("2026-10");
        assertThat(consentRows(u)).isEqualTo(1);
        assertThat(out.getOut()).contains("consent.recorded user=" + u.id()).doesNotContain(u.email());
    }

    @Test
    void missingVersionIs400() throws Exception { // API-CON-02
        postConsent(signInWithoutConsent(), "{}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"))
            .andExpect(jsonPath("$.fields[0].field").value("version"));
    }

    @Test
    void consentToAnOldVersionIsRefused() throws Exception { // API-CON-03, Review Focus
        TestUser u = signInWithoutConsent();
        postConsent(u, "{\"version\":\"2025-01\"}")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.fields[0].field").value("version"))
            .andExpect(jsonPath("$.fields[0].message").value("Update the app to see the current privacy policy"));
        assertThat(consentRows(u)).isZero();
        mvc.perform(get("/api/v1/me/profile").with(auth(u)))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"));
    }

    @Test
    void aReplayKeepsTheFirstTime() throws Exception { // API-CON-04
        TestUser u = signInWithoutConsent();
        postConsent(u, "{\"version\":\"2026-10\"}").andExpect(status().isCreated());
        clock.advance(Duration.ofHours(5));
        postConsent(u, "{\"version\":\"2026-10\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.consentedAt").value("2026-10-23T08:00:00Z"));
        assertThat(consentRows(u)).isEqualTo(1);
    }

    @Test
    void nothingButTheAllowedRoutesWorksBeforeConsent() throws Exception { // API-CON-05
        TestUser u = signInWithoutConsent();
        mvc.perform(get("/api/v1/budget/today").with(auth(u)))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"))
            .andExpect(jsonPath("$.message").value("Agree to the privacy policy to carry on"));
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(u))).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/me/account").with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value(u.email()))
            .andExpect(jsonPath("$.status").value("ACTIVE"))
            .andExpect(jsonPath("$.consentVersion").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.currentConsentVersion").value("2026-10"))
            .andExpect(jsonPath("$.supportEmail").value("help@example.test"));
    }

    @Test
    void aNewPolicyVersionAsksAgain() throws Exception { // API-CON-06
        TestUser u = signIn();
        jdbc.sql("update users set consent_version = '2025-01' where id = ?").param(u.id()).update();
        mvc.perform(get("/api/v1/me/profile").with(auth(u)))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"));
        consent(u);
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(u))).andExpect(status().isOk());
        assertThat(consentRows(u)).isEqualTo(1); // the old version was set by hand; only 2026-10 was recorded here
    }

    @Test
    void aValidTokenForARowThatIsGoneIsUnauthenticated() throws Exception {
        TestUser u = signIn();
        jdbc.sql("delete from users where id = ?").param(u.id()).update();
        mvc.perform(get("/api/v1/me/account").with(auth(u)))
            .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void consentChangesOnlyTheCallersAccount() throws Exception {
        TestUser a = signInWithoutConsent();
        TestUser b = signInWithoutConsent();
        postConsent(a, "{\"version\":\"2026-10\"}").andExpect(status().isCreated());
        mvc.perform(get("/api/v1/me/account").with(auth(b))).andExpect(jsonPath("$.consentVersion").value(org.hamcrest.Matchers.nullValue()));
    }
}
```

`server/src/test/java/in/gullak/auth/ConsentVersionTest.java`:

```java
package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** The version users consent to must be the version of the policy text they were shown. */
class ConsentVersionTest {
    @Test
    void serverConsentVersionEqualsThePolicyVersion() throws Exception {
        String policy = Files.readString(Path.of("..", "docs", "privacy-policy.md"));
        String yml = Files.readString(Path.of("src", "main", "resources", "application.yml"));
        Matcher p = Pattern.compile("(?m)^Version: (\\S+)$").matcher(policy);
        Matcher y = Pattern.compile("consent-version: \"([^\"]+)\"").matcher(yml);
        assertThat(p.find()).as("docs/privacy-policy.md has a Version: line").isTrue();
        assertThat(y.find()).as("application.yml has gullak.account.consent-version").isTrue();
        assertThat(y.group(1)).isEqualTo(p.group(1));
    }
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.auth.ConsentApiTest' --tests 'in.gullak.auth.ConsentVersionTest'`
Expected: compilation fails (`signInWithoutConsent` missing); `ConsentVersionTest` fails (no policy file).

- [ ] **Step 4: Error codes and the gate**

In `server/src/main/java/in/gullak/common/error/ErrorCode.java`, add before `INTERNAL(false);`:

```java
    ACCOUNT_LOCKED(true),
    CONSENT_REQUIRED(false),
    LINK_EXPIRED(false),
```

In `JsonAuthHandlers.java`, change `private static void write(` to `public static void write(` and add the Javadoc line `/** Writes {code, message}; message must be a constant (it is not escaped). */` above it.

`server/src/main/java/in/gullak/common/error/AccountLockedException.java`:

```java
package in.gullak.common.error;

import org.springframework.http.HttpStatus;

/** 403 for a locked account (deletion requested), from sign-in or from any bearer request (API-DT-06, API-AUTH-22). */
public class AccountLockedException extends GullakException {
    public static final String MESSAGE = "This account is being deleted. Use the link we emailed you to restore it.";

    public AccountLockedException() {
        super(ErrorCode.ACCOUNT_LOCKED, HttpStatus.FORBIDDEN, MESSAGE);
    }
}
```

`server/src/main/java/in/gullak/common/web/AccountState.java`:

```java
package in.gullak.common.web;

/** What the account gate knows about the caller. MISSING: the token is valid but the row was deleted. */
public enum AccountState { ACTIVE, NEEDS_CONSENT, LOCKED, MISSING }
```

`server/src/main/java/in/gullak/common/web/AccountGate.java`:

```java
package in.gullak.common.web;

import java.util.UUID;

/** Implemented by auth (which owns users), read by AccountStateFilter on every bearer request. */
public interface AccountGate {
    AccountState stateOf(UUID userId);
}
```

`server/src/main/java/in/gullak/common/web/AccountStateFilter.java`:

```java
package in.gullak.common.web;

import in.gullak.common.error.AccountLockedException;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.JsonAuthHandlers;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Access tokens are stateless for 15 minutes (spec 4.7), so the account's state is read on every bearer request:
 * a locked account gets 403 ACCOUNT_LOCKED, a deleted row 401, and before consent only the routes a person needs
 * to consent, take their data or leave are open (DPDP). Registered inside the security chain, not as a bean.
 */
public class AccountStateFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(AccountStateFilter.class);
    private static final PathPatternRequestMatcher.Builder PATHS = PathPatternRequestMatcher.withDefaults();
    static final RequestMatcher BEFORE_CONSENT = new OrRequestMatcher(
        PATHS.matcher(HttpMethod.GET, "/api/v1/me/account"),
        PATHS.matcher(HttpMethod.POST, "/api/v1/me/consent"),
        PATHS.matcher(HttpMethod.POST, "/api/v1/me/export"),
        PATHS.matcher(HttpMethod.DELETE, "/api/v1/me"));

    private final AccountGate gate;

    public AccountStateFilter(AccountGate gate) {
        this.gate = gate;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof JwtAuthenticationToken jwt) {
            switch (gate.stateOf(UUID.fromString(jwt.getToken().getSubject()))) {
                case MISSING -> {
                    JsonAuthHandlers.write(response, 401, ErrorCode.UNAUTHENTICATED, "Sign in to continue");
                    return;
                }
                case LOCKED -> {
                    log.warn("error.expected code={}", ErrorCode.ACCOUNT_LOCKED);
                    JsonAuthHandlers.write(response, 403, ErrorCode.ACCOUNT_LOCKED, AccountLockedException.MESSAGE);
                    return;
                }
                case NEEDS_CONSENT -> {
                    if (!BEFORE_CONSENT.matches(request)) {
                        JsonAuthHandlers.write(response, 403, ErrorCode.CONSENT_REQUIRED, "Agree to the privacy policy to carry on");
                        return;
                    }
                }
                case ACTIVE -> {
                    // carry on
                }
            }
        }
        chain.doFilter(request, response);
    }
}
```

`server/src/main/java/in/gullak/common/config/SecurityConfig.java` — replace the `api` bean method with (the bearer resolver and `PUBLIC_AUTH` stay as they are; add `import in.gullak.common.web.AccountGate;` and `import in.gullak.common.web.AccountStateFilter;`):

```java
    @Bean
    SecurityFilterChain api(HttpSecurity http, JsonAuthHandlers handlers, AccountGate accounts) throws Exception {
        http.csrf(c -> c.disable())
            .httpBasic(b -> b.disable())
            .formLogin(f -> f.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers(HttpMethod.GET, "/actuator/health").permitAll()
                // Anything else under /actuator is not exposed: let it fall through to a 404, not a 401.
                .requestMatchers("/actuator/**").permitAll()
                .requestMatchers(PUBLIC_AUTH).permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o
                .bearerTokenResolver(bearerTokens())
                .jwt(Customizer.withDefaults())
                .authenticationEntryPoint(handlers))
            .exceptionHandling(e -> e.authenticationEntryPoint(handlers).accessDeniedHandler(handlers))
            .addFilterAfter(new UserMdcFilter(), BearerTokenAuthenticationFilter.class)
            // After the user is known: refuse locked accounts and, before consent, everything but the consent routes.
            .addFilterAfter(new AccountStateFilter(accounts), UserMdcFilter.class);
        return http.build();
    }
```

- [ ] **Step 5: Users, consents and the account service**

`server/src/main/java/in/gullak/auth/UserEntity.java` (whole file):

```java
package in.gullak.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Rows are created by {@link UserRepository#insertIfAbsent} so concurrent sign-ins never clash. From Plan 8 the
 * entity is writable for consent and the deletion lock; callers lock the row first with findForUpdate.
 */
@Entity
@Table(name = "users")
class UserEntity {
    static final String ACTIVE = "active";
    static final String LOCKED = "locked";

    @Id
    private UUID id;

    @Column(nullable = false, unique = true, length = 254, updatable = false)
    private String email;

    @Column(nullable = false, length = 16)
    private String status;

    @Column(name = "consent_version", length = 16)
    private String consentVersion;

    @Column(name = "consented_at")
    private Instant consentedAt;

    @Column(name = "deletion_requested_at")
    private Instant deletionRequestedAt;

    protected UserEntity() {}

    UUID getId() { return id; }
    String getEmail() { return email; }
    String getStatus() { return status; }
    String getConsentVersion() { return consentVersion; }
    Instant getConsentedAt() { return consentedAt; }
    Instant getDeletionRequestedAt() { return deletionRequestedAt; }

    boolean isLocked() {
        return LOCKED.equals(status);
    }

    void recordConsent(String version, Instant at) {
        this.consentVersion = version;
        this.consentedAt = at;
    }

    /** Spec 4.7: locked at once, deleted by the job after the grace period. */
    void lock(Instant at) {
        this.status = LOCKED;
        this.deletionRequestedAt = at;
    }

    void restore() {
        this.status = ACTIVE;
        this.deletionRequestedAt = null;
    }
}
```

In `server/src/main/java/in/gullak/auth/UserRepository.java`, add (imports `jakarta.persistence.LockModeType`, `org.springframework.data.jpa.repository.Lock`):

```java
    /** Row lock for consent, deletion and restore, so two of them never interleave on one account. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from UserEntity u where u.id = :id")
    Optional<UserEntity> findForUpdate(@Param("id") UUID id);
```

`server/src/main/java/in/gullak/auth/AccountProperties.java`:

```java
package in.gullak.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * @param consentVersion the privacy policy version users must have agreed to (docs/privacy-policy.md)
 * @param grace          time between a deletion request and the deletion (spec 4.7: 30 days)
 * @param supportEmail   shown in Me → Help and contact
 */
@Validated
@ConfigurationProperties("gullak.account")
public record AccountProperties(
    @NotBlank @Pattern(regexp = "[0-9A-Za-z.-]{1,16}") String consentVersion,
    @NotNull Duration grace,
    @NotBlank @Email String supportEmail) {}
```

`server/src/main/java/in/gullak/auth/Account.java`:

```java
package in.gullak.auth;

import java.time.Instant;

/** GET /me/account: what Me and the consent screen need. Status is ACTIVE or LOCKED. */
public record Account(String email, String status, String consentVersion, Instant consentedAt,
                      String currentConsentVersion, Instant deletionRequestedAt, String supportEmail) {}
```

`server/src/main/java/in/gullak/auth/ConsentResult.java`:

```java
package in.gullak.auth;

import java.time.Instant;

/** {@code created} is false for a replay of the same version; consentedAt is then the first time. */
public record ConsentResult(String version, Instant consentedAt, boolean created) {}
```

`server/src/main/java/in/gullak/auth/ConsentEntity.java`:

```java
package in.gullak.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Consent history; rows are written by {@link ConsentRepository#insertIfAbsent}. */
@Entity
@Table(name = "consents")
class ConsentEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 16)
    private String version;

    @Column(name = "consented_at", nullable = false)
    private Instant consentedAt;

    protected ConsentEntity() {}
}
```

`server/src/main/java/in/gullak/auth/ConsentRepository.java`:

```java
package in.gullak.auth;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface ConsentRepository extends JpaRepository<ConsentEntity, UUID> {
    @Modifying
    @Query(value = """
            insert into consents (id, user_id, version, consented_at) values (:id, :userId, :version, :at)
            on conflict (user_id, version) do nothing
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("userId") UUID userId, @Param("version") String version,
                       @Param("at") Instant at);
}
```

`server/src/main/java/in/gullak/auth/AccountService.java` (Task 5 extends it):

```java
package in.gullak.auth;

import in.gullak.common.error.NotFoundException;
import in.gullak.common.error.ValidationException;
import in.gullak.common.log.Events;
import in.gullak.common.web.AccountGate;
import in.gullak.common.web.AccountState;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The account itself: consent (DPDP) and, from Task 5, the deletion lock and restore. */
@Service
public class AccountService implements AccountGate {
    private static final Logger log = LoggerFactory.getLogger(AccountService.class);

    private final UserRepository users;
    private final ConsentRepository consents;
    private final AccountProperties props;
    private final Clock clock;

    AccountService(UserRepository users, ConsentRepository consents, AccountProperties props, Clock clock) {
        this.users = users;
        this.consents = consents;
        this.props = props;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Account account(UUID userId) {
        UserEntity u = users.findById(userId).orElseThrow(() -> new NotFoundException("Account"));
        return new Account(u.getEmail(), u.getStatus().toUpperCase(Locale.ROOT), u.getConsentVersion(), u.getConsentedAt(),
            props.consentVersion(), u.getDeletionRequestedAt(), props.supportEmail());
    }

    /** Only the current policy version counts; a replay keeps the first time (API-CON-04). */
    @Transactional
    public ConsentResult consent(UUID userId, String version) {
        if (!props.consentVersion().equals(version)) {
            throw new ValidationException("version", "Update the app to see the current privacy policy");
        }
        UserEntity u = users.findForUpdate(userId).orElseThrow(() -> new NotFoundException("Account"));
        if (version.equals(u.getConsentVersion())) {
            return new ConsentResult(version, u.getConsentedAt(), false);
        }
        Instant now = clock.instant();
        u.recordConsent(version, now);
        consents.insertIfAbsent(UUID.randomUUID(), userId, version, now);
        log.info("{} user={} version={}", Events.CONSENT_RECORDED, userId, version);
        return new ConsentResult(version, now, true);
    }

    @Override
    @Transactional(readOnly = true)
    public AccountState stateOf(UUID userId) {
        return users.findById(userId)
            .map(u -> u.isLocked() ? AccountState.LOCKED
                : props.consentVersion().equals(u.getConsentVersion()) ? AccountState.ACTIVE : AccountState.NEEDS_CONSENT)
            .orElse(AccountState.MISSING);
    }
}
```

`server/src/main/java/in/gullak/auth/AccountController.java` (Task 5 extends it):

```java
package in.gullak.auth;

import in.gullak.common.web.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/me")
class AccountController {
    record ConsentRequest(@NotBlank @Size(max = 16) String version) {}

    record ConsentResponse(String version, Instant consentedAt) {}

    private final AccountService accounts;

    AccountController(AccountService accounts) {
        this.accounts = accounts;
    }

    @GetMapping("/account")
    Account account(@AuthenticationPrincipal Jwt jwt) {
        return accounts.account(CurrentUser.id(jwt));
    }

    @PostMapping("/consent")
    ResponseEntity<ConsentResponse> consent(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ConsentRequest body) {
        ConsentResult r = accounts.consent(CurrentUser.id(jwt), body.version());
        return ResponseEntity.status(r.created() ? HttpStatus.CREATED : HttpStatus.OK)
            .body(new ConsentResponse(r.version(), r.consentedAt()));
    }
}
```

Append to `Events.java`:

```java
    public static final String CONSENT_RECORDED = "consent.recorded";
```

- [ ] **Step 6: Test helpers: every signed-in test user consents**

In `server/src/test/java/in/gullak/support/ApiTest.java`, replace `signIn(String email)` and add the helpers below it:

```java
    /** The policy version in application.yml (gullak.account.consent-version). */
    protected static final String CONSENT_VERSION = "2026-10";

    /** A signed-in user who has agreed to the privacy policy, like every real user past the consent screen. */
    protected TestUser signIn(String email) throws Exception {
        TestUser user = signInWithoutConsent(email);
        consent(user);
        return user;
    }

    protected TestUser signInWithoutConsent() throws Exception {
        return signInWithoutConsent(uniqueEmail());
    }

    protected TestUser signInWithoutConsent(String email) throws Exception {
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip).andExpect(status().isNoContent());
        String body = verifyCode(email, mailer.lastCodeFor(email), ip)
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        UUID id = jdbc.sql("select id from users where email = ?").param(email).query(UUID.class).single();
        return new TestUser(id, email, JsonPath.read(body, "$.accessToken"), JsonPath.read(body, "$.refreshToken"));
    }

    protected void consent(TestUser user) throws Exception {
        mvc.perform(post("/api/v1/me/consent").with(auth(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"version\":\"" + CONSENT_VERSION + "\"}"))
            .andExpect(status().is2xxSuccessful());
    }
```

In `server/src/test/java/in/gullak/security/LogRedactionApiTest.java`, right after the `TestUser u = new TestUser(…);` statement, add:

```java
        consent(u); // Plan 8: every bearer route but the consent ones needs consent first
```

Search the test tree for any other place that builds a `TestUser` by hand (`grep -rn "new TestUser(" server/src/test`) and add the same line after each.

- [ ] **Step 7: The privacy policy and the breach-response note**

`docs/privacy-policy.md`:

```markdown
# Gullak privacy policy

Version: 2026-10
In force from: Fri, 23 Oct 2026

Gullak is a budgeting app. This policy says what we collect, why, where it is kept, how long, and what you can do about it. It is written for India's Digital Personal Data Protection Act, 2023.

## What we collect

- Your email address, to sign you in.
- What you tell us for your budget: take-home pay, payday, fixed costs, monthly savings, goals, the Gullak's personality and your message times.
- The spends you log and the lines of any bank statement you upload. We keep the lines, not the file or its password.
- Game records that come from those: XP, levels, streaks and badges.
- If you turn on notifications, a push token that lets us reach your phone.
- Technical logs (time, the screen or API route, an error code). They never contain amounts, merchant names, your email or tokens.

## Why we use it

- One purpose: working out your daily budget and showing how your money is going. That includes the morning and night messages, goals, insights and the game.
- We never sell your data, show you ads, or use it to decide on credit.
- We don't read your bank account. Gullak only sees what you type or upload.

## Your consent

- You agree to this policy on the first screen after you sign in. We record the version and the time.
- If we change this policy in a way that matters, we give it a new version and ask you again.
- You can withdraw consent at any time by deleting your account (Me → Delete account).
- Gullak is for people aged 18 or older. By agreeing you confirm you are.

## Where it is kept

- On servers in India: the database is in DigitalOcean's Bangalore region and email is sent through Amazon SES in Mumbai.
- Statement merchant text is encrypted before it reaches the database. Everything is encrypted in transit.
- Notifications pass through Expo's push service and then Apple or Google. Their text never contains an amount or a goal name.

## How long we keep it

- While your account is open.
- When you delete your account, it locks at once and everything is deleted for good 30 days later, unless you restore it with the link we email you.
- Database backups roll off within 7 days of that. Technical logs are kept for 30 days.

## Your rights

- See and take your data: Me → Download my data emails you a link to a file of everything we hold. The link works for 24 hours.
- Correct it: change any of it in Me, or edit a spend.
- Erase it: Me → Delete account.
- Nominate someone to act for you if you die or cannot act: write to us.
- Complain: write to us first. If we don't settle it, you can go to the Data Protection Board of India.

## Breaches

If your data is exposed, we tell you and the Data Protection Board of India without delay, say what happened and what to do, and send the Board a full report within 72 hours.

## Contact

Write to the address in the app under Me → Help and contact. The founder reads and answers every privacy question.
```

`docs/breach-response.md`:

```markdown
# Breach response

Who: the founder runs this, with Claude's help for the technical steps. Spec 4.7 (DPDP) asks for this note.
When: any sign that someone saw, copied, changed or deleted user data without permission. A lost laptop with a
database dump counts. A leaked secret counts even if nothing was taken yet.

## 1. Contain (first hour)

- Rotate every secret that might be exposed, in the hosting environment, then redeploy:
  - `GULLAK_JWT_SECRET`: every access token stops working at once.
  - Revoke every session: `update refresh_tokens set revoked_at = now() where revoked_at is null;`
  - `GULLAK_OTP_PEPPER`: live sign-in codes stop working; people request new ones.
  - The SES IAM keys, `GULLAK_EXPO_ACCESS_TOKEN`, the database password, the statement encryption key (re-encrypt with the migration job).
- Close the hole: block the route, revert the release, or take the app down if data is still leaking.
- Keep evidence: export the logs for the window (they hold request ids and user ids, no personal text).

## 2. Assess (first day)

- Which tables and how many users. Logs carry user ids, so the list of affected accounts can be built from them.
- What kind of data: email only, budget figures, statement lines, push tokens.
- Whether it was read, copied, changed or deleted, and from when to when.

## 3. Tell people (without delay)

- Users affected: an email from the SES sender with what happened, what data, what we did and what they should do
  (for example, watch for phishing that uses their email). Plain words, no jargon.
- The Data Protection Board of India: a short intimation without delay, then a full report within 72 hours with the
  facts, the cause, the people affected, what was done and what will stop it happening again.

## 4. Record and fix

- Write `docs/reports/breach-YYYY-MM-DD.md`: timeline, cause, data, people, notices sent, fixes.
- Add a test that would have caught it; run the red team against the fix before it ships.
- Review this note: anything that slowed the response goes in here.
```

- [ ] **Step 8: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.auth.*' --tests 'in.gullak.security.*'`
Expected: PASS.

Then the whole suite: `cd server && ./gradlew test`
Expected: PASS. A failure with `403 CONSENT_REQUIRED` in another test means that test builds its user without `signIn()`; give it `consent(user)`.

- [ ] **Step 9: Update the test-cases doc**

In `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`, after API-CON-02 add:

`| API-CON-03 | Old policy version | POST {version:"2025-01"} | 400 VALIDATION on version; nothing recorded |`
`| API-CON-04 | Consent replay | the current version twice | second is 200 with the first consented_at; one consent row |`
`| API-CON-05 | Before consent | GET /budget/today before consenting | 403 CONSENT_REQUIRED; GET /me/account, POST /me/consent, POST /me/export and DELETE /me still work |`
`| API-CON-06 | New policy version | the user agreed to an older version | 403 CONSENT_REQUIRED until they agree again |`

- [ ] **Step 10: Red team**

Dispatch `red-team` with task id `plan-08-task-4`: replay consent with other versions, long strings, unicode and JSON arrays; walk every route in the README's endpoint list with a not-yet-consented token and confirm only the four allowed answer; delete a user row under a live token; check the consent log line and response for anything personal. Report to `docs/reports/red-team/plan-08-task-4.md`.

- [ ] **Step 11: Commit**

```bash
git add server/src/main/resources/db/migration/V061__consent.sql server/src/main/java/in/gullak/common server/src/main/java/in/gullak/auth server/src/main/resources/application.yml server/src/main/resources/application-prod.yml server/src/test/java/in/gullak/support/ApiTest.java server/src/test/java/in/gullak/security/LogRedactionApiTest.java server/src/test/java/in/gullak/auth/ConsentApiTest.java server/src/test/java/in/gullak/auth/ConsentVersionTest.java docs/privacy-policy.md docs/breach-response.md docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md README.md docs/reports/red-team/plan-08-task-4.md
git commit -m "feat(server): DPDP consent with a recorded version, an account gate on every request, privacy policy and breach note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Delete the account (lock at once), restore with the emailed link, locked sign-in, and the logout race

**Owner:** backend-engineer. **Test IDs:** API-DT-05, API-DT-06, API-DT-07, API-DT-08 (reworded), API-DT-09, API-AUTH-22, new API-DT-10, API-DT-11, SEC-15 (logout racing refresh), spec 3.2 item 10 (server half). **Red team:** yes (restore tokens guessed, reused, or used after the grace; API calls after deletion with a still-valid access token; a mail scanner opening the link; the dev endpoint outside `local`; refresh and logout racing).

**Files:**
- Create: `server/src/main/resources/db/migration/V062__restore_tokens.sql`
- Create: `server/src/main/java/in/gullak/common/token/OpaqueTokens.java`, `server/src/main/java/in/gullak/common/account/AccountLocked.java`
- Create: `server/src/main/java/in/gullak/auth/RestoreTokenEntity.java`, `RestoreTokenRepository.java`, `DeletionScheduled.java`, `RestorePageController.java`, `RestoreMailResender.java`, `DevRestoreController.java`
- Modify: `server/src/main/java/in/gullak/auth/AccountService.java` (whole file), `AccountController.java` (whole file), `OtpService.java` (`verify` and constructor), `TokenService.java` (`logout`), `RefreshTokenRepository.java`
- Modify: `server/src/main/java/in/gullak/common/config/SecurityConfig.java`, `server/src/main/java/in/gullak/common/log/Events.java`
- Test: `server/src/test/java/in/gullak/auth/AccountDeletionApiTest.java`, `RestorePageApiTest.java`, `DevRestoreApiTest.java`; `TokenApiTest.java` (one test added)

**Interfaces:**
- Consumes: `AccountService`, `UserEntity.lock/restore`, `UserRepository.findForUpdate`, `AccountLockedException`, `AccountProperties.grace` (Task 4); `MailDelivery.deliverAfterCommit`, `MailOutbox.queueOnGiveUp`, `MailResender`, `MailProperties.linksBaseUrl`, `InMemoryMailSender.lastTo` (Tasks 1–3); `RefreshTokenRepository.revokeAllForUser`, `RateLimiter.check`, `Emails.normalize` (Plan 1).
- Produces: `OpaqueTokens.generate() : String`, `OpaqueTokens.hash(String) : String`, `OpaqueTokens.PATTERN`; event record `AccountLocked(UUID userId)` (published inside the deletion transaction; Tasks 7 and 8 listen); `DeletionScheduled(LocalDate deletionDate)`; `AccountService.requestDeletion(UUID)`, `restore(String token, String ip)`, `isLocked(UUID)`, `onLockedSignIn(UUID)`, `rebuildRestoreMail(UUID) : Optional<Mail>`, `emailOf(UUID) : String`; `DELETE /api/v1/me` → 202 `{deletionDate}`; `POST /api/v1/me/restore {token}` → 200 `{status:"ACTIVE"}`, 401 bad or used token, 404 after the grace; `GET|POST /api/v1/me/restore/{token}` (HTML); local-only `POST /api/v1/auth/dev/restore-link {email}` → `{token}`; `SecurityConfig.PUBLIC_LINKS` (also covers `GET /api/v1/exports/*` for Task 7); events `account.locked_sign_in`.

- [ ] **Step 1: Migration**

`server/src/main/resources/db/migration/V062__restore_tokens.sql`:

```sql
-- The emailed restore link (spec 4.7). Only the SHA-256 of the token is stored. A new link retires the old ones.
-- created_at is written by the app (its clock) because the hourly resend limit is counted on it.
create table restore_tokens (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    token_hash varchar(64) not null unique,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null default now()
);
create index restore_tokens_user_idx on restore_tokens (user_id, created_at desc);
```

- [ ] **Step 2: Write the failing tests**

`server/src/test/java/in/gullak/auth/AccountDeletionApiTest.java`:

```java
package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.common.mail.Mail;
import in.gullak.common.token.OpaqueTokens;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class AccountDeletionApiTest extends ApiTest {

    private ResultActions deleteAccount(TestUser u) throws Exception {
        return mvc.perform(delete("/api/v1/me").with(auth(u)));
    }

    private ResultActions restore(String token) throws Exception {
        return mvc.perform(post("/api/v1/me/restore").with(freshIp())
            .contentType(MediaType.APPLICATION_JSON).content("{\"token\":\"" + token + "\"}"));
    }

    private ResultActions refresh(String refreshToken) throws Exception {
        return mvc.perform(post("/api/v1/auth/refresh").with(freshIp())
            .contentType(MediaType.APPLICATION_JSON).content("{\"refreshToken\":\"" + refreshToken + "\"}"));
    }

    private String status(TestUser u) {
        return jdbc.sql("select status from users where id = ?").param(u.id()).query(String.class).single();
    }

    private long restoreMails(TestUser u) {
        return mailbox.sent().stream().filter(m -> m.to().equals(u.email()) && m.kind().equals("restore")).count();
    }

    @Test
    void deleteLocksAtOnceAndRevokesEverySession() throws Exception { // API-DT-05
        TestUser phone = signIn();
        TestUser laptop = signIn(phone.email());
        deleteAccount(phone)
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.deletionDate").value("2026-11-22"));
        assertThat(status(phone)).isEqualTo("locked");
        assertThat(jdbc.sql("select deletion_requested_at from users where id = ?").param(phone.id())
            .query(OffsetDateTime.class).single().toInstant()).isEqualTo(clock.instant());
        assertThat(jdbc.sql("select count(*) from refresh_tokens where user_id = ? and revoked_at is null")
            .param(phone.id()).query(Long.class).single()).isZero();
        refresh(phone.refreshToken()).andExpect(status().isUnauthorized());
        refresh(laptop.refreshToken()).andExpect(status().isUnauthorized());
    }

    @Test
    void aStillValidAccessTokenIsRefusedOnceLocked() throws Exception { // API-AUTH-22
        TestUser u = signIn();
        deleteAccount(u).andExpect(status().isAccepted());
        mvc.perform(get("/api/v1/budget/today").with(auth(u)))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("ACCOUNT_LOCKED"));
        mvc.perform(delete("/api/v1/me").with(auth(u))).andExpect(status().isForbidden());
    }

    @Test
    void theRestoreMailCarriesALinkWhoseTokenIsStoredOnlyAsAHash() throws Exception {
        TestUser u = signIn();
        deleteAccount(u);
        Mail mail = lastMail(u.email(), "restore");
        assertThat(mail.subject()).isEqualTo("Your Gullak account will be deleted on Sun, 22 Nov 2026");
        assertThat(mail.text()).contains("http://localhost:8080/api/v1/me/restore/");
        String token = linkToken(mail);
        assertThat(jdbc.sql("select count(*) from restore_tokens where token_hash = ?").param(token).query(Long.class).single()).isZero();
        assertThat(jdbc.sql("select count(*) from restore_tokens where token_hash = ?").param(OpaqueTokens.hash(token))
            .query(Long.class).single()).isEqualTo(1);
    }

    @Test
    void signingInWhileLockedSaysHowToRestoreAndResendsAtMostHourly() throws Exception { // API-DT-06, API-DT-11
        TestUser u = signIn();
        deleteAccount(u);
        requestCode(u.email(), freshIp());
        verifyCode(u.email(), mailer.lastCodeFor(u.email()), freshIp())
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("ACCOUNT_LOCKED"))
            .andExpect(jsonPath("$.message").value("This account is being deleted. Use the link we emailed you to restore it."));
        assertThat(restoreMails(u)).isEqualTo(1); // the deletion mail is under an hour old
        String first = linkToken(lastMail(u.email(), "restore"));

        clock.advance(Duration.ofMinutes(61));
        requestCode(u.email(), freshIp());
        verifyCode(u.email(), mailer.lastCodeFor(u.email()), freshIp()).andExpect(status().isForbidden());
        assertThat(restoreMails(u)).isEqualTo(2);
        String second = linkToken(lastMail(u.email(), "restore"));
        assertThat(second).isNotEqualTo(first);
        restore(first).andExpect(status().isUnauthorized()); // a new link retires the old one
    }

    @Test
    void restoreWithinTheGraceBringsTheAccountBack() throws Exception { // API-DT-07
        TestUser u = signIn();
        deleteAccount(u);
        String token = linkToken(lastMail(u.email(), "restore"));
        clock.advance(Duration.ofDays(10));
        restore(token).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ACTIVE"));
        assertThat(status(u)).isEqualTo("active");
        assertThat(jdbc.sql("select deletion_requested_at is null from users where id = ?").param(u.id())
            .query(Boolean.class).single()).isTrue();
        TestUser again = signIn(u.email());
        mvc.perform(get("/api/v1/me/account").with(auth(again))).andExpect(status().isOk());
    }

    @Test
    void restoreAfterTheGraceIsNotFound() throws Exception { // API-DT-08
        TestUser u = signIn();
        deleteAccount(u);
        String token = linkToken(lastMail(u.email(), "restore"));
        clock.advance(Duration.ofDays(30));
        restore(token).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        assertThat(status(u)).isEqualTo("locked");
    }

    @Test
    void aBadOrReusedTokenIsUnauthenticated() throws Exception { // API-DT-09
        restore(OpaqueTokens.generate()).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        restore("x").andExpect(status().isUnauthorized());
        TestUser u = signIn();
        deleteAccount(u);
        String token = linkToken(lastMail(u.email(), "restore"));
        restore(token).andExpect(status().isOk());
        restore(token).andExpect(status().isUnauthorized());
    }

    @Test
    void anotherUsersBearerTokenDoesNotHelpARestore() throws Exception {
        TestUser stranger = signIn();
        mvc.perform(post("/api/v1/me/restore").with(freshIp()).with(auth(stranger))
                .contentType(MediaType.APPLICATION_JSON).content("{\"token\":\"" + OpaqueTokens.generate() + "\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void restoreIsRateLimitedPerAddress() throws Exception {
        var ip = freshIp();
        for (int i = 0; i < 20; i++) {
            mvc.perform(post("/api/v1/me/restore").with(ip).contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + OpaqueTokens.generate() + "\"}")).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/v1/me/restore").with(ip).contentType(MediaType.APPLICATION_JSON)
            .content("{\"token\":\"" + OpaqueTokens.generate() + "\"}")).andExpect(status().isTooManyRequests());
    }

    @Test
    void aDeletionRequestIsAnsweredFromTheRequestTime() throws Exception {
        clock.set(Instant.parse("2026-10-31T20:00:00Z")); // 1 Nov, 01:30 IST
        TestUser u = signIn();
        deleteAccount(u).andExpect(jsonPath("$.deletionDate").value("2026-12-01"));
    }
}
```

`server/src/test/java/in/gullak/auth/RestorePageApiTest.java`:

```java
package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.containsString;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/** The emailed link opens a page; only its button (a POST) restores. Mail scanners and previews only GET. */
class RestorePageApiTest extends ApiTest {

    private String lockedUserToken(TestUser u) throws Exception {
        mvc.perform(delete("/api/v1/me").with(auth(u))).andExpect(status().isAccepted());
        return linkToken(lastMail(u.email(), "restore"));
    }

    private String status(TestUser u) {
        return jdbc.sql("select status from users where id = ?").param(u.id()).query(String.class).single();
    }

    @Test
    void openingTheRestoreLinkDoesNotRestoreUntilTheButtonIsPressed() throws Exception { // API-DT-10, Review Focus
        TestUser u = signIn();
        String token = lockedUserToken(u);
        mvc.perform(get("/api/v1/me/restore/" + token).with(freshIp()))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith("text/html"))
            .andExpect(content().string(containsString("<form method=\"post\">")))
            .andExpect(content().string(containsString("Keep my account")))
            .andExpect(header().string("Content-Security-Policy", containsString("frame-ancestors 'none'")))
            .andExpect(header().string("Referrer-Policy", "no-referrer"));
        assertThat(status(u)).isEqualTo("locked");

        mvc.perform(post("/api/v1/me/restore/" + token).with(freshIp()))
            .andExpect(status().isOk())
            .andExpect(content().string(containsString("Your account is back")));
        assertThat(status(u)).isEqualTo("active");
    }

    @Test
    void theTokenNeverAppearsInThePage() throws Exception {
        TestUser u = signIn();
        String token = lockedUserToken(u);
        mvc.perform(get("/api/v1/me/restore/" + token).with(freshIp()))
            .andExpect(content().string(org.hamcrest.Matchers.not(containsString(token))));
    }

    @Test
    void afterTheGraceThePageSaysTheAccountIsGone() throws Exception {
        TestUser u = signIn();
        String token = lockedUserToken(u);
        clock.advance(Duration.ofDays(30));
        mvc.perform(post("/api/v1/me/restore/" + token).with(freshIp()))
            .andExpect(status().isNotFound())
            .andExpect(content().string(containsString("That account is gone")));
    }

    @Test
    void aMalformedTokenGetsTheBadLinkPage() throws Exception {
        mvc.perform(get("/api/v1/me/restore/not-a-token").with(freshIp()))
            .andExpect(status().isNotFound())
            .andExpect(content().string(containsString("That link doesn't work")));
    }

    @Test
    void aGarbageBearerHeaderIsIgnoredOnTheLinkRoutes() throws Exception {
        TestUser u = signIn();
        String token = lockedUserToken(u);
        mvc.perform(get("/api/v1/me/restore/" + token).with(freshIp()).with(bearer("garbage")))
            .andExpect(status().isOk());
    }
}
```

`server/src/test/java/in/gullak/auth/DevRestoreApiTest.java`:

```java
package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Profile;
import org.springframework.http.MediaType;

class DevRestoreApiTest extends ApiTest {
    @Test
    void theDevRouteDoesNotExistOutsideTheLocalProfile() throws Exception {
        mvc.perform(post("/api/v1/auth/dev/restore-link").with(freshIp()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + uniqueEmail() + "\"}"))
            .andExpect(status().isNotFound());
    }

    @Test
    void theControllerIsBoundToTheLocalProfileOnly() {
        assertThat(DevRestoreController.class.getAnnotation(Profile.class).value()).containsExactly("local");
    }
}
```

Add to `server/src/test/java/in/gullak/auth/TokenApiTest.java` (imports `java.util.concurrent.*`, `org.junit.jupiter.api.RepeatedTest`, `org.springframework.http.MediaType`, and the static `post`):

```java
    @RepeatedTest(10)
    void logoutRacingRefreshLeavesNoLiveToken() throws Exception { // SEC-15 (deferred from Plan 1)
        TestUser u = signIn();
        String body = "{\"refreshToken\":\"" + u.refreshToken() + "\"}";
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Integer> refresh = pool.submit(() -> {
                start.await();
                return mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andReturn().getResponse().getStatus();
            });
            Future<Integer> logout = pool.submit(() -> {
                start.await();
                return mvc.perform(post("/api/v1/auth/logout").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andReturn().getResponse().getStatus();
            });
            start.countDown();
            refresh.get(10, TimeUnit.SECONDS);
            assertThat(logout.get(10, TimeUnit.SECONDS)).isEqualTo(204);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.sql("select count(*) from refresh_tokens where user_id = ? and revoked_at is null and used_at is null")
            .param(u.id()).query(Long.class).single()).isZero();
    }
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.auth.AccountDeletionApiTest' --tests 'in.gullak.auth.RestorePageApiTest' --tests 'in.gullak.auth.DevRestoreApiTest' --tests 'in.gullak.auth.TokenApiTest'`
Expected: compilation fails (`OpaqueTokens`, `DevRestoreController` missing); `logoutRacingRefreshLeavesNoLiveToken` fails on some repetitions.

- [ ] **Step 4: Shared pieces**

`server/src/main/java/in/gullak/common/token/OpaqueTokens.java`:

```java
package in.gullak.common.token;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/** Link tokens (restore, export): 256 random bits, base64url (43 characters), stored only as SHA-256 hex. */
public final class OpaqueTokens {
    public static final String PATTERN = "[A-Za-z0-9_-]{43}";
    private static final SecureRandom RANDOM = new SecureRandom();

    private OpaqueTokens() {}

    public static String generate() {
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }

    public static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
```

`server/src/main/java/in/gullak/common/account/AccountLocked.java`:

```java
package in.gullak.common.account;

import java.util.UUID;

/**
 * Published inside the deletion request's transaction. Listeners (push tokens, queued pushes, export links)
 * remove what must stop at once, in the same transaction.
 */
public record AccountLocked(UUID userId) {}
```

Append to `Events.java`:

```java
    public static final String ACCOUNT_LOCKED_SIGN_IN = "account.locked_sign_in";
```

- [ ] **Step 5: Restore tokens and the account service**

`server/src/main/java/in/gullak/auth/RestoreTokenEntity.java`:

```java
package in.gullak.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "restore_tokens")
class RestoreTokenEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "used_at")
    private Instant usedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected RestoreTokenEntity() {}

    RestoreTokenEntity(UUID userId, String tokenHash, Instant expiresAt, Instant createdAt) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    UUID getUserId() { return userId; }
    Instant getExpiresAt() { return expiresAt; }
    boolean isUsed() { return usedAt != null; }

    void markUsed(Instant at) {
        this.usedAt = at;
    }
}
```

`server/src/main/java/in/gullak/auth/RestoreTokenRepository.java`:

```java
package in.gullak.auth;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface RestoreTokenRepository extends JpaRepository<RestoreTokenEntity, UUID> {
    Optional<RestoreTokenEntity> findByTokenHash(String tokenHash);

    boolean existsByUserIdAndCreatedAtAfter(UUID userId, Instant after);

    /** A new link retires every older one, so only the newest mail works. */
    @Modifying(flushAutomatically = true)
    @Query("update RestoreTokenEntity t set t.usedAt = :now where t.userId = :userId and t.usedAt is null")
    int retireAll(@Param("userId") UUID userId, @Param("now") Instant now);
}
```

`server/src/main/java/in/gullak/auth/DeletionScheduled.java`:

```java
package in.gullak.auth;

import java.time.LocalDate;

/** DELETE /me: the IST date the account and its data are deleted unless restored. */
public record DeletionScheduled(LocalDate deletionDate) {}
```

`server/src/main/java/in/gullak/auth/AccountService.java` (whole file, replacing Task 4's):

```java
package in.gullak.auth;

import in.gullak.common.account.AccountLocked;
import in.gullak.common.error.AuthException;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.GullakException;
import in.gullak.common.error.NotFoundException;
import in.gullak.common.error.ValidationException;
import in.gullak.common.log.Events;
import in.gullak.common.mail.Mail;
import in.gullak.common.mail.MailDelivery;
import in.gullak.common.mail.MailOutbox;
import in.gullak.common.mail.MailProperties;
import in.gullak.common.time.Ist;
import in.gullak.common.token.OpaqueTokens;
import in.gullak.common.web.AccountGate;
import in.gullak.common.web.AccountState;
import in.gullak.common.web.RateLimiter;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The account itself: consent (DPDP), the deletion lock, the restore link and restore. */
@Service
public class AccountService implements AccountGate {
    static final String RESTORE_KIND = "restore";
    static final String BAD_LINK = "That restore link doesn't work. Sign in to get a new one.";
    private static final Duration RESEND_GAP = Duration.ofHours(1);
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("EEE, d MMM yyyy", Locale.ENGLISH);
    private static final Logger log = LoggerFactory.getLogger(AccountService.class);

    private final UserRepository users;
    private final ConsentRepository consents;
    private final RefreshTokenRepository refreshTokens;
    private final RestoreTokenRepository restoreTokens;
    private final MailDelivery delivery;
    private final MailOutbox outbox;
    private final MailProperties mail;
    private final RateLimiter limiter;
    private final ApplicationEventPublisher events;
    private final AccountProperties props;
    private final Clock clock;

    AccountService(UserRepository users, ConsentRepository consents, RefreshTokenRepository refreshTokens,
                   RestoreTokenRepository restoreTokens, MailDelivery delivery, MailOutbox outbox, MailProperties mail,
                   RateLimiter limiter, ApplicationEventPublisher events, AccountProperties props, Clock clock) {
        this.users = users;
        this.consents = consents;
        this.refreshTokens = refreshTokens;
        this.restoreTokens = restoreTokens;
        this.delivery = delivery;
        this.outbox = outbox;
        this.mail = mail;
        this.limiter = limiter;
        this.events = events;
        this.props = props;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Account account(UUID userId) {
        UserEntity u = users.findById(userId).orElseThrow(() -> new NotFoundException("Account"));
        return new Account(u.getEmail(), u.getStatus().toUpperCase(Locale.ROOT), u.getConsentVersion(), u.getConsentedAt(),
            props.consentVersion(), u.getDeletionRequestedAt(), props.supportEmail());
    }

    @Transactional(readOnly = true)
    public String emailOf(UUID userId) {
        return users.findById(userId).map(UserEntity::getEmail).orElseThrow(() -> new NotFoundException("Account"));
    }

    /** Only the current policy version counts; a replay keeps the first time (API-CON-04). */
    @Transactional
    public ConsentResult consent(UUID userId, String version) {
        if (!props.consentVersion().equals(version)) {
            throw new ValidationException("version", "Update the app to see the current privacy policy");
        }
        UserEntity u = users.findForUpdate(userId).orElseThrow(() -> new NotFoundException("Account"));
        if (version.equals(u.getConsentVersion())) {
            return new ConsentResult(version, u.getConsentedAt(), false);
        }
        Instant now = clock.instant();
        u.recordConsent(version, now);
        consents.insertIfAbsent(UUID.randomUUID(), userId, version, now);
        log.info("{} user={} version={}", Events.CONSENT_RECORDED, userId, version);
        return new ConsentResult(version, now, true);
    }

    @Override
    @Transactional(readOnly = true)
    public AccountState stateOf(UUID userId) {
        return users.findById(userId)
            .map(u -> u.isLocked() ? AccountState.LOCKED
                : props.consentVersion().equals(u.getConsentVersion()) ? AccountState.ACTIVE : AccountState.NEEDS_CONSENT)
            .orElse(AccountState.MISSING);
    }

    @Transactional(readOnly = true)
    public boolean isLocked(UUID userId) {
        return users.findById(userId).map(UserEntity::isLocked).orElse(false);
    }

    /**
     * Spec 4.7: lock at once, revoke every session, tell listeners to drop push tokens, queued pushes and export
     * links, and mail a restore link after commit. Idempotent on an account that is already locked.
     */
    @Transactional
    public DeletionScheduled requestDeletion(UUID userId) {
        UserEntity u = users.findForUpdate(userId).orElseThrow(() -> new NotFoundException("Account"));
        Instant now = clock.instant();
        if (!u.isLocked()) {
            u.lock(now);
            refreshTokens.revokeAllForUser(userId, now); // flushes the lock first, then clears the context
            events.publishEvent(new AccountLocked(userId));
            log.info("{} user={}", Events.ACCOUNT_DELETION_REQUESTED, userId);
        }
        sendRestoreLink(u, now);
        return new DeletionScheduled(deletionDate(u));
    }

    /** A correct sign-in code for a locked account: say how to restore, and mail a fresh link at most hourly. */
    @Transactional
    public void onLockedSignIn(UUID userId) {
        UserEntity u = users.findForUpdate(userId).orElseThrow(() -> new NotFoundException("Account"));
        if (!u.isLocked()) {
            return;
        }
        log.warn("{} user={}", Events.ACCOUNT_LOCKED_SIGN_IN, userId);
        Instant now = clock.instant();
        if (!restoreTokens.existsByUserIdAndCreatedAtAfter(userId, now.minus(RESEND_GAP))) {
            sendRestoreLink(u, now);
        }
    }

    /** API-DT-07 to 09: unknown or used token → 401; past the grace → 404; otherwise the account is active again. */
    @Transactional(noRollbackFor = GullakException.class)
    public void restore(String token, String ip) {
        limiter.check("restore-ip:" + ip, 20, Duration.ofMinutes(10));
        RestoreTokenEntity t = restoreTokens.findByTokenHash(OpaqueTokens.hash(token))
            .filter(x -> !x.isUsed())
            .orElseThrow(() -> new AuthException(ErrorCode.UNAUTHENTICATED, BAD_LINK));
        Instant now = clock.instant();
        if (!now.isBefore(t.getExpiresAt())) {
            throw new GullakException(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, "That account is gone. Its 30 days ran out.");
        }
        UserEntity u = users.findForUpdate(t.getUserId())
            .orElseThrow(() -> new AuthException(ErrorCode.UNAUTHENTICATED, BAD_LINK));
        t.markUsed(now);
        if (u.isLocked()) {
            u.restore();
            log.info("{} user={}", Events.ACCOUNT_RESTORED, u.getId());
        }
    }

    /** For the mail retry job: a fresh link while the account is still locked and inside the grace. */
    @Transactional
    public Optional<Mail> rebuildRestoreMail(UUID userId) {
        Instant now = clock.instant();
        return users.findForUpdate(userId)
            .filter(UserEntity::isLocked)
            .filter(u -> now.isBefore(u.getDeletionRequestedAt().plus(props.grace())))
            .map(u -> restoreMail(u, issueRestoreToken(u, now)));
    }

    private void sendRestoreLink(UserEntity u, Instant now) {
        String token = issueRestoreToken(u, now);
        delivery.deliverAfterCommit(restoreMail(u, token), outbox.queueOnGiveUp(u.getId(), RESTORE_KIND, u.getId()));
    }

    private String issueRestoreToken(UserEntity u, Instant now) {
        restoreTokens.retireAll(u.getId(), now);
        String token = OpaqueTokens.generate();
        restoreTokens.save(new RestoreTokenEntity(u.getId(), OpaqueTokens.hash(token),
            u.getDeletionRequestedAt().plus(props.grace()), now));
        return token;
    }

    private LocalDate deletionDate(UserEntity u) {
        return LocalDate.ofInstant(u.getDeletionRequestedAt().plus(props.grace()), Ist.ZONE);
    }

    private Mail restoreMail(UserEntity u, String token) {
        String day = DAY.format(deletionDate(u));
        return new Mail(RESTORE_KIND, u.getEmail(), "Your Gullak account will be deleted on " + day,
            "You asked us to delete your Gullak account. It is locked now, and everything in it will be deleted for good on "
                + day + ".\n\nChanged your mind? Open this link before then and press the button to keep your account:\n"
                + mail.linksBaseUrl() + "/api/v1/me/restore/" + token
                + "\n\nIf you meant to delete it, you don't need to do anything.\n");
    }
}
```

`server/src/main/java/in/gullak/auth/RestoreMailResender.java`:

```java
package in.gullak.auth;

import in.gullak.common.mail.Mail;
import in.gullak.common.mail.MailResender;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Rebuilds a queued restore mail with a fresh link; nothing once the account is active or past its grace. */
@Component
class RestoreMailResender implements MailResender {
    private final AccountService accounts;

    RestoreMailResender(AccountService accounts) {
        this.accounts = accounts;
    }

    @Override
    public String kind() {
        return AccountService.RESTORE_KIND;
    }

    @Override
    public Optional<Mail> rebuild(UUID userId, UUID refId) {
        return accounts.rebuildRestoreMail(userId);
    }
}
```

`server/src/main/java/in/gullak/auth/AccountController.java` (whole file):

```java
package in.gullak.auth;

import in.gullak.common.web.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/me")
class AccountController {
    record ConsentRequest(@NotBlank @Size(max = 16) String version) {}

    record ConsentResponse(String version, Instant consentedAt) {}

    record RestoreRequest(@NotBlank @Size(max = 100) String token) {}

    record RestoreResponse(String status) {}

    private final AccountService accounts;

    AccountController(AccountService accounts) {
        this.accounts = accounts;
    }

    @GetMapping("/account")
    Account account(@AuthenticationPrincipal Jwt jwt) {
        return accounts.account(CurrentUser.id(jwt));
    }

    @PostMapping("/consent")
    ResponseEntity<ConsentResponse> consent(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ConsentRequest body) {
        ConsentResult r = accounts.consent(CurrentUser.id(jwt), body.version());
        return ResponseEntity.status(r.created() ? HttpStatus.CREATED : HttpStatus.OK)
            .body(new ConsentResponse(r.version(), r.consentedAt()));
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    DeletionScheduled delete(@AuthenticationPrincipal Jwt jwt) {
        return accounts.requestDeletion(CurrentUser.id(jwt));
    }

    /** Public (SecurityConfig.PUBLIC_LINKS): the emailed token is the only credential; any bearer header is ignored. */
    @PostMapping("/restore")
    RestoreResponse restore(@Valid @RequestBody RestoreRequest body, HttpServletRequest http) {
        accounts.restore(body.token(), http.getRemoteAddr());
        return new RestoreResponse("ACTIVE");
    }
}
```

`server/src/main/java/in/gullak/auth/RestorePageController.java`:

```java
package in.gullak.auth;

import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.GullakException;
import in.gullak.common.token.OpaqueTokens;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * The page behind the emailed restore link. GET only shows a button (mail scanners and link previews GET links);
 * the button POSTs to the same address, which restores. No script, no external resources, the token never in
 * the markup, no referrer, no framing.
 */
@Controller
@RequestMapping("/api/v1/me/restore")
class RestorePageController {
    private static final String CSP =
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

    private final AccountService accounts;

    RestorePageController(AccountService accounts) {
        this.accounts = accounts;
    }

    @GetMapping(value = "/{token}", produces = MediaType.TEXT_HTML_VALUE)
    ResponseEntity<String> page(@PathVariable String token) {
        if (!token.matches(OpaqueTokens.PATTERN)) {
            return html(404, "That link doesn't work", "Open Gullak and sign in to get a new one.", false);
        }
        return html(200, "Keep your Gullak account?",
            "Your account is locked and will be deleted. Press the button to keep it and everything in it.", true);
    }

    @PostMapping(value = "/{token}", produces = MediaType.TEXT_HTML_VALUE)
    ResponseEntity<String> restore(@PathVariable String token, HttpServletRequest http) {
        try {
            accounts.restore(token, http.getRemoteAddr());
            return html(200, "Your account is back", "Open Gullak and sign in with your email to carry on.", false);
        } catch (GullakException e) {
            if (e.code() == ErrorCode.NOT_FOUND) {
                return html(404, "That account is gone", "Its 30 days ran out, so everything was deleted.", false);
            }
            if (e.code() == ErrorCode.RATE_LIMITED) {
                return html(429, "Too many tries", "Wait a few minutes and try again.", false);
            }
            return html(401, "That link doesn't work", "Open Gullak and sign in to get a new one.", false);
        }
    }

    private static ResponseEntity<String> html(int status, String title, String text, boolean button) {
        String form = button ? "<form method=\"post\"><button type=\"submit\">Keep my account</button></form>" : "";
        String body = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Gullak</title>"
            + "<style>body{margin:0;background:#FBF6EF;color:#2A1F1A;font-family:system-ui,sans-serif}"
            + "main{max-width:420px;margin:0 auto;padding:48px 16px}h1{font-size:28px}p{font-size:16px;line-height:1.5}"
            + "button{width:100%;min-height:52px;border:0;border-radius:16px;background:#B94A22;color:#fff;font-size:16px;font-weight:700}"
            + "</style></head><body><main><h1>" + title + "</h1><p>" + text + "</p>" + form + "</main></body></html>";
        return ResponseEntity.status(status)
            .contentType(MediaType.TEXT_HTML)
            .header("Content-Security-Policy", CSP)
            .header("X-Content-Type-Options", "nosniff")
            .header("Referrer-Policy", "no-referrer")
            .header("Cache-Control", "no-store")
            .body(body);
    }
}
```

`server/src/main/java/in/gullak/auth/DevRestoreController.java`:

```java
package in.gullak.auth;

import in.gullak.common.error.NotFoundException;
import in.gullak.common.mail.InMemoryMailSender;
import in.gullak.common.token.OpaqueTokens;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Local development only, like Plan 2's dev OTP route: returns the token from the last restore mail the in-memory
 * sender "sent" to an address, so E2E-09 can open the restore link without a mailbox.
 */
@RestController
@RequestMapping("/api/v1/auth/dev")
@Profile("local")
class DevRestoreController {
    record Body(@NotBlank @Email String email) {}

    record Token(String token) {}

    private static final Pattern LINK = Pattern.compile("/api/v1/me/restore/(" + OpaqueTokens.PATTERN + ")");

    private final InMemoryMailSender mailbox;

    DevRestoreController(InMemoryMailSender mailbox) {
        this.mailbox = mailbox;
    }

    @PostMapping("/restore-link")
    Token last(@Valid @RequestBody Body body) {
        return mailbox.lastTo(Emails.normalize(body.email()), AccountService.RESTORE_KIND)
            .map(m -> LINK.matcher(m.text()))
            .filter(Matcher::find)
            .map(m -> new Token(m.group(1)))
            .orElseThrow(() -> new NotFoundException("Restore link"));
    }
}
```

- [ ] **Step 6: Sign-in checks the account, and logout locks the token row**

In `server/src/main/java/in/gullak/auth/OtpService.java`, add the field and constructor parameter `AccountService accounts` (constructor injection; it is the last parameter), add `import in.gullak.common.error.AccountLockedException;`, and replace the tail of `verify` from `otp.consume(now);` to the end of the method with:

```java
        otp.consume(now);
        users.insertIfAbsent(UUID.randomUUID(), email);
        UUID userId = users.findIdByEmail(email)
            .orElseThrow(() -> new IllegalStateException("user row missing right after insert"));
        if (accounts.isLocked(userId)) {
            // Deferred from Plan 1: a locked account gets no tokens. The code is spent; a restore link goes out
            // after this transaction commits (noRollbackFor keeps the commit), at most once an hour.
            accounts.onLockedSignIn(userId);
            throw new AccountLockedException();
        }
        log.info("{} user={}", Events.AUTH_OTP_VERIFIED, userId);
        return userId;
    }
```

In `server/src/main/java/in/gullak/auth/RefreshTokenRepository.java`, add (imports `jakarta.persistence.LockModeType`, `org.springframework.data.jpa.repository.Lock`):

```java
    /** Logout locks the presented row so a racing refresh either finishes first or sees the revocation. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from RefreshTokenEntity t where t.tokenHash = :tokenHash")
    Optional<RefreshTokenEntity> findForUpdateByTokenHash(@Param("tokenHash") String tokenHash);
```

In `server/src/main/java/in/gullak/auth/TokenService.java`, replace `logout` with:

```java
    @Transactional
    public void logout(String refreshToken) {
        // Deferred from Plan 1: lock the presented row before revoking. A refresh that claimed it first has committed
        // its new token by the time the lock is granted, so the row reads as used and every session is revoked; a
        // refresh that comes second finds the row revoked and issues nothing. Either way no session survives.
        refreshTokens.findForUpdateByTokenHash(sha256(refreshToken)).ifPresent(row -> {
            UUID userId = row.getUserId();
            if (!clock.instant().isBefore(row.getExpiresAt())) {
                return; // An expired token signs nothing out, so an old one can never revoke every session.
            }
            if (row.isUsed()) {
                revokeAllFor(userId, "reuse");
                return;
            }
            refreshTokens.revokeFamily(row.getFamilyId(), clock.instant());
            log.info("{} user={} reason=logout", Events.AUTH_SESSION_REVOKED, userId);
        });
    }
```

- [ ] **Step 7: The public link routes**

In `server/src/main/java/in/gullak/common/config/SecurityConfig.java`, add below `PUBLIC_AUTH` (import `org.springframework.security.web.util.matcher.OrRequestMatcher`):

```java
    /**
     * Routes opened from an email: the link token in the path or body is the only credential, so no access token is
     * read or required. GET /api/v1/exports/* is Task 7's download.
     */
    static final RequestMatcher PUBLIC_LINKS = new OrRequestMatcher(
        PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.POST, "/api/v1/me/restore"),
        PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.GET, "/api/v1/me/restore/*"),
        PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.POST, "/api/v1/me/restore/*"),
        PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.GET, "/api/v1/exports/*"));
```

change `.requestMatchers(PUBLIC_AUTH).permitAll()` to `.requestMatchers(PUBLIC_AUTH, PUBLIC_LINKS).permitAll()`, and replace `bearerTokens()` with:

```java
    /** Header-only bearer tokens (query and form tokens stay off), ignored on the public auth and link routes. */
    static BearerTokenResolver bearerTokens() {
        DefaultBearerTokenResolver header = new DefaultBearerTokenResolver();
        return request -> PUBLIC_AUTH.matches(request) || PUBLIC_LINKS.matches(request) ? null : header.resolve(request);
    }
```

- [ ] **Step 8: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.auth.*'`
Expected: PASS (all 10 repetitions of `logoutRacingRefreshLeavesNoLiveToken`).

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 9: Update the test-cases doc**

In `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`:

Replace the API-DT-08 row with:
`| API-DT-08 | Restore after grace | day 30 or later, before the deletion job has run | 404 NOT_FOUND "That account is gone"; after the job the token is unknown and the answer is 401 like any bad token |`

Add after API-DT-09:
`| API-DT-10 | Restore link opened | GET the emailed link (a mail scanner or preview) | an HTML page with one button; the account stays locked until the button POSTs |`
`| API-DT-11 | Locked sign-in resends | correct OTP for a locked account, twice an hour apart | 403 ACCOUNT_LOCKED both times; a fresh restore link only the second time; the older link stops working |`

In the security section add after SEC-14:
`| SEC-15 | Logout racing refresh | refresh and logout with the same refresh token at the same moment, 10 times | no unrevoked, unused refresh token remains for the user |`

- [ ] **Step 10: Red team**

Dispatch `red-team` with task id `plan-08-task-5`: guess restore tokens (rate limit, timing of 401 vs 404), reuse a used token, use a token after the grace, use the old token after a resend, call every API with the access token issued just before `DELETE /me`, open the restore page in an iframe from another origin, send the restore POST with a bearer token of another user, hit `/api/v1/auth/dev/restore-link` on a server started with `test` and `prod` profiles, and race refresh against logout in a loop of 1,000. Report to `docs/reports/red-team/plan-08-task-5.md`.

- [ ] **Step 11: Commit**

```bash
git add server/src/main/resources/db/migration/V062__restore_tokens.sql server/src/main/java/in/gullak/common server/src/main/java/in/gullak/auth server/src/test/java/in/gullak/auth docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/reports/red-team/plan-08-task-5.md
git commit -m "feat(server): account deletion locks at once with a 30-day restore link; locked sign-in; logout locks before revoking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The deletion job: every row gone after 30 days

**Owner:** backend-engineer. **Test IDs:** JOB-09, SEC-14, plus restore-versus-deletion at the boundary (Review Focus). **Red team:** yes (a row left behind in any table, including tables later plans add; a restored account deleted anyway; the boundary second; a failing deletion that half-deletes).

**Files:**
- Create: `server/src/main/resources/db/migration/V063__cascade_user_references.sql`
- Create: `server/src/main/java/in/gullak/common/db/UserReferences.java`
- Create: `server/src/main/java/in/gullak/auth/AccountDeletionService.java`
- Modify: `server/src/main/java/in/gullak/auth/UserRepository.java`, `OtpCodeRepository.java`, `server/src/main/java/in/gullak/common/log/Events.java`
- Create: `server/src/main/java/in/gullak/jobs/AccountDeletionJob.java`
- Modify: `server/src/test/java/in/gullak/rules/ArchitectureTest.java` (`jobs` may depend on `auth`)
- Test: `server/src/test/java/in/gullak/jobs/AccountDeletionJobApiTest.java`

**Interfaces:**
- Consumes: `UserEntity`, `UserRepository.findForUpdate`, `AccountProperties.grace` (Task 4); `AccountService.requestDeletion`, `restore` (Task 5); `JobRunner.run`, `JobResult`, `JobStatus` (Plan 6); `ApiTest.exampleUser`, `seedSpend` (Plan 1).
- Produces: `UserReferences.count(UUID userId, String email) : long`; `AccountDeletionService.dueForDeletion() : List<UUID>`, `deleteIfDue(UUID) : boolean`; job `account-deletion` at 01:30 IST (`AccountDeletionJob.run() : JobResult`); event `account.deleted`.

- [ ] **Step 1: Migration**

`server/src/main/resources/db/migration/V063__cascade_user_references.sql`:

```sql
-- SEC-14: deleting a users row must take every row that references it. Tables from Plans 1-7 were written in
-- parallel; this rewrites any foreign key to users that does not cascade, whatever its name. Later tables must
-- declare "references users (id) on delete cascade" themselves (AccountDeletionJobApiTest checks every one).
do $$
declare
    fk record;
begin
    for fk in
        select c.conname, c.conrelid::regclass as tbl, pg_get_constraintdef(c.oid) as def
        from pg_constraint c
        where c.contype = 'f' and c.confrelid = 'users'::regclass and c.confdeltype <> 'c'
    loop
        execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
        execute format('alter table %s add constraint %I %s on delete cascade', fk.tbl, fk.conname,
            regexp_replace(fk.def, '\s+ON DELETE\s+(SET NULL|SET DEFAULT|RESTRICT|NO ACTION)', '', 'i'));
    end loop;
end $$;
```

- [ ] **Step 2: Write the failing tests**

`server/src/test/java/in/gullak/jobs/AccountDeletionJobApiTest.java`:

```java
package in.gullak.jobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.common.db.Db;
import in.gullak.common.db.UserReferences;
import in.gullak.common.jobs.JobResult;
import in.gullak.common.jobs.JobStatus;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class AccountDeletionJobApiTest extends ApiTest {
    @Autowired AccountDeletionJob job;
    @Autowired UserReferences references;

    private String requestDeletion(TestUser u) throws Exception {
        mvc.perform(delete("/api/v1/me").with(auth(u))).andExpect(status().isAccepted());
        return linkToken(lastMail(u.email(), "restore"));
    }

    private void requestedAgo(TestUser u, Duration ago) {
        jdbc.sql("update users set deletion_requested_at = ? where id = ?")
            .params(Db.ts(clock.instant().minus(ago)), u.id()).update();
    }

    private boolean exists(TestUser u) {
        return jdbc.sql("select count(*) from users where id = ?").param(u.id()).query(Long.class).single() == 1;
    }

    private ResultActions restore(String token) throws Exception {
        return mvc.perform(post("/api/v1/me/restore").with(freshIp())
            .contentType(MediaType.APPLICATION_JSON).content("{\"token\":\"" + token + "\"}"));
    }

    @Test
    void deletesAfterTheGraceAndKeepsWithinIt() throws Exception { // JOB-09
        TestUser old = exampleUser();
        TestUser recent = exampleUser();
        requestDeletion(old);
        requestDeletion(recent);
        requestedAgo(old, Duration.ofDays(31));
        requestedAgo(recent, Duration.ofDays(29));
        JobResult result = job.run();
        assertThat(result.status()).isEqualTo(JobStatus.SUCCEEDED);
        assertThat(exists(old)).isFalse();
        assertThat(exists(recent)).isTrue();
    }

    @Test
    void noRowAnywhereReferencesTheDeletedUser() throws Exception { // SEC-14
        TestUser u = exampleUser();
        seedSpend(u, 25_000, Instant.parse("2026-10-22T06:00:00Z"));
        requestCode(u.email(), freshIp()); // an otp_codes row keyed by email
        requestDeletion(u);
        assertThat(references.count(u.id(), u.email())).isPositive();

        clock.advance(Duration.ofDays(31));
        job.run();

        assertThat(references.count(u.id(), u.email())).isZero();
        assertThat(jdbc.sql("select count(*) from otp_codes where email = ?").param(u.email()).query(Long.class).single()).isZero();
    }

    @Test
    void everyForeignKeyToUsersCascades() { // SEC-14 (tables added later are covered too)
        assertThat(jdbc.sql("""
                select count(*) from pg_constraint
                where contype = 'f' and confrelid = 'users'::regclass and confdeltype <> 'c'
                """).query(Long.class).single()).isZero();
    }

    @Test
    void aRestoredAccountIsNeverDeleted() throws Exception {
        TestUser u = exampleUser();
        String token = requestDeletion(u);
        restore(token).andExpect(status().isOk());
        clock.advance(Duration.ofDays(31));
        job.run();
        assertThat(exists(u)).isTrue();
    }

    @Test
    void restoreAndDeletionNeverOverlapAtTheBoundary() throws Exception { // Review Focus
        Instant requested = clock.instant();
        TestUser early = exampleUser();
        TestUser onTime = exampleUser();
        String earlyToken = requestDeletion(early);
        String onTimeToken = requestDeletion(onTime);

        clock.set(requested.plus(Duration.ofDays(30)).minusSeconds(1));
        restore(earlyToken).andExpect(status().isOk());
        job.run();
        assertThat(exists(early)).isTrue();
        assertThat(exists(onTime)).isTrue(); // one second short of the grace

        clock.set(requested.plus(Duration.ofDays(30)));
        restore(onTimeToken).andExpect(status().isNotFound());
        job.run();
        assertThat(exists(onTime)).isFalse();
        restore(onTimeToken).andExpect(status().isUnauthorized()); // the token went with the account
    }

    @Test
    void aSecondRunTheSameNightIsHarmless() throws Exception {
        TestUser u = exampleUser();
        requestDeletion(u);
        clock.advance(Duration.ofDays(31));
        job.run();
        assertThat(job.run().status()).isEqualTo(JobStatus.SUCCEEDED);
    }
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.jobs.AccountDeletionJobApiTest'`
Expected: compilation fails (`AccountDeletionJob`, `UserReferences` missing).

- [ ] **Step 4: Write the code**

`server/src/main/java/in/gullak/common/db/UserReferences.java`:

```java
package in.gullak.common.db;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * SEC-14's guard: counts rows anywhere in the public schema whose uuid columns hold the user's id or whose
 * email columns hold the address. Table and column names come from the catalog and are quoted, never from input.
 */
@Component
public class UserReferences {
    private record Column(String table, String column, boolean uuid) {}

    private final JdbcClient jdbc;

    UserReferences(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public long count(UUID userId, String email) {
        List<Column> columns = jdbc.sql("""
                select c.table_name, c.column_name, c.data_type = 'uuid' as is_uuid
                from information_schema.columns c
                join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
                where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
                  and (c.data_type = 'uuid' or c.column_name = 'email')
                order by c.table_name, c.column_name
                """)
            .query((rs, n) -> new Column(rs.getString(1), rs.getString(2), rs.getBoolean(3)))
            .list();
        long total = 0;
        for (Column c : columns) {
            total += jdbc.sql("select count(*) from " + quote(c.table()) + " where " + quote(c.column()) + " = ?")
                .param(c.uuid() ? userId : email)
                .query(Long.class).single();
        }
        return total;
    }

    private static String quote(String identifier) {
        return "\"" + identifier.replace("\"", "\"\"") + "\"";
    }
}
```

In `server/src/main/java/in/gullak/auth/UserRepository.java`, add:

```java
    @Query("select u.id from UserEntity u where u.status = 'locked' and u.deletionRequestedAt <= :cutoff")
    List<UUID> lockedBefore(@Param("cutoff") Instant cutoff);
```

(imports `java.time.Instant`, `java.util.List`). In `server/src/main/java/in/gullak/auth/OtpCodeRepository.java`, add:

```java
    @Modifying
    @Query("delete from OtpCodeEntity o where o.email = :email")
    int deleteByEmail(@Param("email") String email);
```

`server/src/main/java/in/gullak/auth/AccountDeletionService.java`:

```java
package in.gullak.auth;

import in.gullak.common.db.UserReferences;
import in.gullak.common.log.Events;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Deletes accounts locked for the full grace period (spec 4.7). The users row goes, and with it, by cascade, every
 * row that references it; sign-in codes are keyed by email and go separately. Restore (now < requested + grace)
 * and deletion (now >= requested + grace) can never both apply, and both lock the users row first.
 */
@Service
public class AccountDeletionService {
    private static final Logger log = LoggerFactory.getLogger(AccountDeletionService.class);

    private final UserRepository users;
    private final OtpCodeRepository otpCodes;
    private final UserReferences references;
    private final AccountProperties props;
    private final Clock clock;

    AccountDeletionService(UserRepository users, OtpCodeRepository otpCodes, UserReferences references,
                           AccountProperties props, Clock clock) {
        this.users = users;
        this.otpCodes = otpCodes;
        this.references = references;
        this.props = props;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<UUID> dueForDeletion() {
        return users.lockedBefore(clock.instant().minus(props.grace()));
    }

    /** True when the account was deleted; false when it was restored or is not yet due. Rolls back if anything remains. */
    @Transactional
    public boolean deleteIfDue(UUID userId) {
        Optional<UserEntity> found = users.findForUpdate(userId);
        if (found.isEmpty()) {
            return false;
        }
        UserEntity u = found.get();
        Instant cutoff = clock.instant().minus(props.grace());
        if (!u.isLocked() || u.getDeletionRequestedAt().isAfter(cutoff)) {
            return false;
        }
        String email = u.getEmail();
        otpCodes.deleteByEmail(email);
        users.delete(u);
        users.flush();
        long left = references.count(userId, email);
        if (left > 0) {
            throw new IllegalStateException("rows still reference a deleted user: " + left);
        }
        log.info("{} user={}", Events.ACCOUNT_DELETED, userId);
        return true;
    }
}
```

`server/src/main/java/in/gullak/jobs/AccountDeletionJob.java`:

```java
package in.gullak.jobs;

import in.gullak.auth.AccountDeletionService;
import in.gullak.common.jobs.JobResult;
import in.gullak.common.jobs.JobRunner;
import in.gullak.common.time.Ist;
import java.time.Clock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 01:30 IST: deletes accounts locked 30 days or more (JOB-09). A unit that fails is retried and alerted by JobRunner. */
@Component
class AccountDeletionJob {
    static final String NAME = "account-deletion";

    private final JobRunner runner;
    private final AccountDeletionService deletions;
    private final Clock clock;

    AccountDeletionJob(JobRunner runner, AccountDeletionService deletions, Clock clock) {
        this.runner = runner;
        this.deletions = deletions;
        this.clock = clock;
    }

    @Scheduled(cron = "0 30 1 * * *", zone = "Asia/Kolkata")
    public void scheduled() {
        run();
    }

    JobResult run() {
        return runner.run(NAME, Ist.today(clock).toString(), deletions::dueForDeletion, userId -> deletions.deleteIfDue(userId));
    }
}
```

Append to `Events.java`:

```java
    public static final String ACCOUNT_DELETED = "account.deleted";
```

In `server/src/test/java/in/gullak/rules/ArchitectureTest.java`, in `ALLOWED_FEATURE_DEPENDENCIES`, make sure the `jobs` entry contains `"auth"` (add it to the set if it is an explicit list). If the map is still built with `Map.of(…)` and this plan's new entries take it past ten pairs, rewrite it as `Map.ofEntries(Map.entry("common", Set.of()), …)` with the same contents.

- [ ] **Step 5: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.jobs.AccountDeletionJobApiTest' --tests 'in.gullak.rules.*'`
Expected: PASS.

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 6: Red team**

Dispatch `red-team` with task id `plan-08-task-6`: build a user with data in every table the app has (spends, imports, goals, XP, badges, streaks, celebrations, consents, restore tokens, push tokens and outbox rows once Tasks 8–9 land, mail outbox), delete and run the job, then search every table by id and by email; restore at the boundary second; make `deleteIfDue` fail mid-way (a trigger that raises) and confirm nothing is half deleted and an alert is raised. Report to `docs/reports/red-team/plan-08-task-6.md`.

- [ ] **Step 7: Commit**

```bash
git add server/src/main/resources/db/migration/V063__cascade_user_references.sql server/src/main/java/in/gullak/common/db/UserReferences.java server/src/main/java/in/gullak/auth server/src/main/java/in/gullak/jobs/AccountDeletionJob.java server/src/main/java/in/gullak/common/log/Events.java server/src/test/java/in/gullak/jobs/AccountDeletionJobApiTest.java server/src/test/java/in/gullak/rules/ArchitectureTest.java docs/reports/red-team/plan-08-task-6.md
git commit -m "feat(server): delete accounts after 30 days with cascades everywhere and a reference check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Data export: an emailed 24-hour link to a ZIP of CSV files

**Owner:** backend-engineer. **Test IDs:** API-DT-01, API-DT-02, API-DT-03, API-DT-04, ERR-08 (export mail queued and rebuilt), new SEC-16 (no email or link token in any log of the data flows). **Red team:** yes (export links expired, guessed, or for another user; one export an hour under a race; CSV formula injection; a locked account's link).

**Files:**
- Create: `server/src/main/resources/db/migration/V064__export_links.sql`
- Create: `server/src/main/java/in/gullak/common/data/UserDataSection.java`, `Csv.java`
- Create: `server/src/main/java/in/gullak/common/error/GoneException.java`
- Modify: `server/src/main/java/in/gullak/common/error/RateLimitedException.java` (message constructor)
- Create: `server/src/main/java/in/gullak/data/ExportLinkEntity.java`, `ExportLinkRepository.java`, `ExportRequested.java`, `ExportFile.java`, `ExportService.java`, `ExportController.java`, `ExportMailResender.java`, `DataAccountListener.java`
- Create: `server/src/main/java/in/gullak/auth/AccountExportSection.java`, `server/src/main/java/in/gullak/profile/ProfileExportSection.java`, `FixedCostExportSection.java`, `server/src/main/java/in/gullak/ingestion/TransactionExportSection.java`, `server/src/main/java/in/gullak/goals/GoalExportSection.java`, `server/src/main/java/in/gullak/gamification/XpExportSection.java`, `BadgeExportSection.java`
- Modify: `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/test/java/in/gullak/rules/ArchitectureTest.java`
- Create: `docs/api.md` (or add a section if it exists)
- Test: `server/src/test/java/in/gullak/common/data/CsvTest.java`, `server/src/test/java/in/gullak/data/ExportApiTest.java`, `server/src/test/java/in/gullak/security/DataLogRedactionApiTest.java`

**Interfaces:**
- Consumes: `AccountService.emailOf(UUID)`, `AccountLocked` (Task 5); `MailDelivery.deliverAfterCommit`, `MailOutbox.queueOnGiveUp`, `MailResender`, `MailRetryJob.runOnce` (Tasks 1–3); `OpaqueTokens`, `SecurityConfig.PUBLIC_LINKS` (Task 5); `RateLimiter`, `Ist`, `Db` (Plan 1); tables `transactions` (Plan 3), `goals` (Plan 5), `xp_events`, `user_badges` (Plans 3 and 6).
- Produces: `UserDataSection { String file(); List<String> columns(); List<List<String>> rows(UUID userId); }`; `Csv.write(List<String>, List<List<String>>)`, `Csv.cell(String)`, `Csv.rupees(long)`, `Csv.time(OffsetDateTime)`, `Csv.text(Object)`; `GoneException(ErrorCode, String)` (410); `RateLimitedException(String message)`; `POST /api/v1/me/export` → 202 `{expiresAt}` (429 within the hour); `GET /api/v1/exports/{token}` → 200 `application/zip` (404 unknown, 410 `LINK_EXPIRED`); `ExportService.request(UUID) : ExportRequested`, `download(String token, String ip) : ExportFile`; event `export.downloaded`.

- [ ] **Step 1: Migration**

`server/src/main/resources/db/migration/V064__export_links.sql`:

```sql
-- Spec 4.7: exports are emailed as a link that expires in 24 hours. Only the token's SHA-256 is stored; the file is
-- built from live data when the link is opened (spec 4.1: no files stored). created_at is written by the app's
-- clock because "one export an hour" is counted on it.
create table export_links (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    token_hash varchar(64) not null unique,
    expires_at timestamptz not null,
    downloads int not null default 0,
    created_at timestamptz not null,
    updated_at timestamptz not null default now()
);
create index export_links_user_created_idx on export_links (user_id, created_at desc);
```

- [ ] **Step 2: Write the failing tests**

`server/src/test/java/in/gullak/common/data/CsvTest.java`:

```java
package in.gullak.common.data;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

class CsvTest {
    @Test
    void formulaLikeCellsAreDefused() { // Review Focus
        assertThat(Csv.cell("=HYPERLINK(\"http://evil\")")).isEqualTo("\"'=HYPERLINK(\"\"http://evil\"\")\"");
        assertThat(Csv.cell("+91 98765 43210")).isEqualTo("'+91 98765 43210");
        assertThat(Csv.cell("-cmd")).isEqualTo("'-cmd");
        assertThat(Csv.cell("@SUM(A1)")).isEqualTo("'@SUM(A1)");
        assertThat(Csv.cell("\tTAB")).isEqualTo("\"'\tTAB\"");
        assertThat(Csv.cell("Swiggy")).isEqualTo("Swiggy");
    }

    @Test
    void commasQuotesAndNewlinesAreQuoted() {
        assertThat(Csv.cell("Chai, samosa")).isEqualTo("\"Chai, samosa\"");
        assertThat(Csv.cell("6\" sub")).isEqualTo("\"6\"\" sub\"");
        assertThat(Csv.cell("line\nbreak")).isEqualTo("\"line\nbreak\"");
    }

    @Test
    void nullAndEmptyAreEmptyCells() {
        assertThat(Csv.cell(null)).isEmpty();
        assertThat(Csv.write(List.of("a", "b"), List.of(Arrays.asList(null, "")))).isEqualTo("a,b\r\n,\r\n");
    }

    @Test
    void rupeesComeFromPaiseWithoutFloatingPoint() {
        assertThat(Csv.rupees(25_000)).isEqualTo("250.00");
        assertThat(Csv.rupees(5)).isEqualTo("0.05");
        assertThat(Csv.rupees(0)).isEqualTo("0.00");
        assertThat(Csv.rupees(999_999_999)).isEqualTo("9999999.99");
    }

    @Test
    void linesEndWithCrLf() {
        assertThat(Csv.write(List.of("x"), List.of(List.of("1"), List.of("2")))).isEqualTo("x\r\n1\r\n2\r\n");
    }
}
```

`server/src/test/java/in/gullak/data/ExportApiTest.java`:

```java
package in.gullak.data;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.common.mail.MailRetryJob;
import in.gullak.common.token.OpaqueTokens;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.ResultActions;

class ExportApiTest extends ApiTest {
    static final String SPENDS_HEADER =
        "id,occurred_at,direction,amount_rupees,category,merchant,tag,paid_with,source,status,note,spread_over_cycle,deleted_at";

    @Autowired MailRetryJob retries;

    private ResultActions requestExport(TestUser u) throws Exception {
        return mvc.perform(post("/api/v1/me/export").with(auth(u)));
    }

    private ResultActions download(String token) throws Exception {
        return mvc.perform(get("/api/v1/exports/" + token).with(freshIp()));
    }

    private static Map<String, String> unzip(byte[] bytes) throws Exception {
        Map<String, String> files = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes), StandardCharsets.UTF_8)) {
            for (ZipEntry e = zip.getNextEntry(); e != null; e = zip.getNextEntry()) {
                files.put(e.getName(), new String(zip.readAllBytes(), StandardCharsets.UTF_8));
            }
        }
        return files;
    }

    private UUID spendId(TestUser u) {
        return jdbc.sql("select id from transactions where user_id = ? limit 1").param(u.id()).query(UUID.class).single();
    }

    @Test
    void theExportIsMailedAsALinkThatWorks() throws Exception { // API-DT-01
        TestUser u = exampleUser();
        seedSpend(u, 25_000, Instant.parse("2026-10-22T06:00:00Z"));
        requestExport(u).andExpect(status().isAccepted()).andExpect(jsonPath("$.expiresAt").value("2026-10-24T08:00:00Z"));
        var mail = lastMail(u.email(), "export");
        assertThat(mail.subject()).isEqualTo("Your Gullak data is ready");
        String token = linkToken(mail);
        byte[] zip = download(token)
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Type", "application/zip"))
            .andExpect(header().string("Content-Disposition", "attachment; filename=\"gullak-export-2026-10-23.zip\""))
            .andExpect(header().string("Cache-Control", "no-store"))
            .andReturn().getResponse().getContentAsByteArray();
        Map<String, String> files = unzip(zip);
        assertThat(files).containsKeys("README.txt", "account.csv", "profile.csv", "fixed_costs.csv", "spends.csv");
        assertThat(files.get("spends.csv")).startsWith(SPENDS_HEADER + "\r\n").contains(spendId(u).toString(), ",250.00,");
        assertThat(files.get("fixed_costs.csv")).contains("Rent,10000.00");
        assertThat(files.get("account.csv")).contains(u.email(), "2026-10");
        download(token).andExpect(status().isOk()); // works more than once within the 24 hours
    }

    @Test
    void anExpiredLinkIsGone() throws Exception { // API-DT-02
        TestUser u = signIn();
        requestExport(u);
        String token = linkToken(lastMail(u.email(), "export"));
        clock.advance(Duration.ofHours(25));
        download(token).andExpect(status().isGone()).andExpect(jsonPath("$.code").value("LINK_EXPIRED"));
    }

    @Test
    void aSecondRequestWithinTheHourIsRateLimited() throws Exception { // API-DT-03
        TestUser u = signIn();
        requestExport(u).andExpect(status().isAccepted());
        requestExport(u).andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.code").value("RATE_LIMITED"))
            .andExpect(jsonPath("$.message").value("We sent your data less than an hour ago. Check your email."));
        clock.advance(Duration.ofMinutes(60));
        requestExport(u).andExpect(status().isAccepted());
    }

    @Test
    void twoRequestsAtOnceMakeOneLink() throws Exception { // API-DT-03 under a race
        TestUser u = signIn();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Integer> a = pool.submit(() -> requestExport(u).andReturn().getResponse().getStatus());
            Future<Integer> b = pool.submit(() -> requestExport(u).andReturn().getResponse().getStatus());
            assertThat(List.of(a.get(), b.get())).containsExactlyInAnyOrder(202, 429);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void theFileHoldsOnlyTheCallersRows() throws Exception { // API-DT-04
        TestUser a = exampleUser();
        TestUser b = exampleUser();
        seedSpend(a, 11_100, Instant.parse("2026-10-22T06:00:00Z"));
        seedSpend(b, 22_200, Instant.parse("2026-10-22T06:00:00Z"));
        requestExport(a);
        Map<String, String> files = unzip(download(linkToken(lastMail(a.email(), "export")))
            .andReturn().getResponse().getContentAsByteArray());
        assertThat(files.get("spends.csv")).contains(spendId(a).toString()).doesNotContain(spendId(b).toString(), "222.00");
        assertThat(files.get("account.csv")).contains(a.email()).doesNotContain(b.email());
    }

    @Test
    void anUnknownOrMalformedTokenIsNotFound() throws Exception {
        download(OpaqueTokens.generate()).andExpect(status().isNotFound());
        download("short").andExpect(status().isNotFound());
    }

    @Test
    void theTokenIsStoredOnlyAsAHash() throws Exception {
        TestUser u = signIn();
        requestExport(u);
        String token = linkToken(lastMail(u.email(), "export"));
        assertThat(jdbc.sql("select count(*) from export_links where token_hash = ?").param(token).query(Long.class).single()).isZero();
        assertThat(jdbc.sql("select count(*) from export_links where token_hash = ?").param(OpaqueTokens.hash(token))
            .query(Long.class).single()).isEqualTo(1);
    }

    @Test
    void deletingTheAccountKillsItsLinks() throws Exception {
        TestUser u = signIn();
        requestExport(u);
        String token = linkToken(lastMail(u.email(), "export"));
        mvc.perform(delete("/api/v1/me").with(auth(u))).andExpect(status().isAccepted());
        download(token).andExpect(status().isNotFound());
    }

    @Test
    void exportWorksBeforeConsent() throws Exception { // API-CON-05: a person can always take their data
        TestUser u = signInWithoutConsent();
        requestExport(u).andExpect(status().isAccepted());
    }

    @Test
    void aProviderOutageStillAnswers202AndTheRetrySendsAFreshLink() throws Exception { // ERR-08 (export)
        TestUser u = signIn();
        mailbox.failNext(3);
        requestExport(u).andExpect(status().isAccepted());
        assertThat(mailbox.lastTo(u.email(), "export")).isEmpty();
        assertThat(jdbc.sql("select count(*) from mail_outbox where user_id = ? and kind = 'export' and status = 'queued'")
            .param(u.id()).query(Long.class).single()).isEqualTo(1);
        clock.advance(Duration.ofMinutes(16));
        retries.runOnce();
        download(linkToken(lastMail(u.email(), "export"))).andExpect(status().isOk());
    }
}
```

`server/src/test/java/in/gullak/security/DataLogRedactionApiTest.java`:

```java
package in.gullak.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;

/** SEC-16: consent, export, deletion, locked sign-in and restore leave no email or link token in the logs. */
@ExtendWith(OutputCaptureExtension.class)
class DataLogRedactionApiTest extends ApiTest {
    @Test
    void theDataFlowsLogNoEmailAndNoToken(CapturedOutput out) throws Exception {
        TestUser u = exampleUser();
        mvc.perform(post("/api/v1/me/export").with(auth(u))).andExpect(status().isAccepted());
        String exportToken = linkToken(lastMail(u.email(), "export"));
        mvc.perform(get("/api/v1/exports/" + exportToken).with(freshIp())).andExpect(status().isOk());
        mvc.perform(delete("/api/v1/me").with(auth(u))).andExpect(status().isAccepted());
        requestCode(u.email(), freshIp());
        verifyCode(u.email(), mailer.lastCodeFor(u.email()), freshIp()).andExpect(status().isForbidden());
        String restoreToken = linkToken(lastMail(u.email(), "restore"));
        mvc.perform(get("/api/v1/me/restore/" + restoreToken).with(freshIp())).andExpect(status().isOk());
        mvc.perform(post("/api/v1/me/restore").with(freshIp()).contentType(MediaType.APPLICATION_JSON)
            .content("{\"token\":\"" + restoreToken + "\"}")).andExpect(status().isOk());

        assertThat(out.getAll()).doesNotContain(u.email(), exportToken, restoreToken, u.accessToken(), u.refreshToken());
        assertThat(out.getAll()).contains("export.requested", "export.downloaded", "account.deletion.requested",
            "account.locked_sign_in", "account.restored");
    }
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.data.*' --tests 'in.gullak.data.*' --tests 'in.gullak.security.DataLogRedactionApiTest'`
Expected: compilation fails (`Csv`, `MailRetryJob` import resolves, `ExportService` missing).

- [ ] **Step 4: Shared pieces**

`server/src/main/java/in/gullak/common/data/UserDataSection.java`:

```java
package in.gullak.common.data;

import java.util.List;
import java.util.UUID;

/**
 * One CSV file in the user's export, contributed by the feature that owns the table. Rows are the caller's only:
 * every implementation filters by {@code userId}. Columns are documented in docs/api.md.
 */
public interface UserDataSection {
    String file();

    List<String> columns();

    List<List<String>> rows(UUID userId);
}
```

`server/src/main/java/in/gullak/common/data/Csv.java`:

```java
package in.gullak.common.data;

import java.time.OffsetDateTime;
import java.util.List;

/** RFC 4180 CSV with CRLF lines, and cells that a spreadsheet would run as a formula defused with a leading quote. */
public final class Csv {
    private static final String FORMULA_START = "=+-@\t\r";

    private Csv() {}

    public static String write(List<String> columns, List<List<String>> rows) {
        StringBuilder out = new StringBuilder();
        line(out, columns);
        rows.forEach(row -> line(out, row));
        return out.toString();
    }

    public static String cell(String raw) {
        if (raw == null || raw.isEmpty()) {
            return "";
        }
        String v = FORMULA_START.indexOf(raw.charAt(0)) >= 0 ? "'" + raw : raw;
        boolean quote = v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0
            || v.indexOf('\t') >= 0;
        return quote ? "\"" + v.replace("\"", "\"\"") + "\"" : v;
    }

    /** 25000 paise → "250.00". Integer arithmetic only. Amounts in Gullak are never negative. */
    public static String rupees(long paise) {
        return (paise / 100) + "." + (paise % 100 < 10 ? "0" : "") + (paise % 100);
    }

    /** An instant as ISO-8601 UTC ("2026-10-22T06:00:00Z"), or empty. */
    public static String time(OffsetDateTime t) {
        return t == null ? "" : t.toInstant().toString();
    }

    public static String text(Object v) {
        return v == null ? "" : v.toString();
    }

    private static void line(StringBuilder out, List<String> cells) {
        for (int i = 0; i < cells.size(); i++) {
            if (i > 0) {
                out.append(',');
            }
            out.append(cell(cells.get(i)));
        }
        out.append("\r\n");
    }
}
```

`server/src/main/java/in/gullak/common/error/GoneException.java`:

```java
package in.gullak.common.error;

import org.springframework.http.HttpStatus;

/** 410: the thing existed but its time is over (an expired download link). */
public class GoneException extends GullakException {
    public GoneException(ErrorCode code, String message) {
        super(code, HttpStatus.GONE, message);
    }
}
```

In `server/src/main/java/in/gullak/common/error/RateLimitedException.java`, add a second constructor:

```java
    /** A limit with its own explanation (one export an hour). */
    public RateLimitedException(String message) {
        super(ErrorCode.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS, message);
    }
```

Append to `Events.java`:

```java
    public static final String EXPORT_DOWNLOADED = "export.downloaded";
```

- [ ] **Step 5: The sections (each in the package that owns its table)**

Export sections read with `JdbcClient`: an export is a report over the user's rows, like an aggregate, and it must not load entities from other features. Each is package-private and a `@Component`.

`server/src/main/java/in/gullak/auth/AccountExportSection.java`:

```java
package in.gullak.auth;

import in.gullak.common.data.Csv;
import in.gullak.common.data.UserDataSection;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class AccountExportSection implements UserDataSection {
    private final JdbcClient jdbc;

    AccountExportSection(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String file() {
        return "account.csv";
    }

    @Override
    public List<String> columns() {
        return List.of("email", "status", "consent_version", "consented_at", "deletion_requested_at", "created_at");
    }

    @Override
    public List<List<String>> rows(UUID userId) {
        return jdbc.sql("select email, status, consent_version, consented_at, deletion_requested_at, created_at from users where id = ?")
            .param(userId)
            .query((rs, n) -> List.of(rs.getString("email"), rs.getString("status"), Csv.text(rs.getString("consent_version")),
                Csv.time(rs.getObject("consented_at", OffsetDateTime.class)),
                Csv.time(rs.getObject("deletion_requested_at", OffsetDateTime.class)),
                Csv.time(rs.getObject("created_at", OffsetDateTime.class))))
            .list();
    }
}
```

`server/src/main/java/in/gullak/profile/ProfileExportSection.java`:

```java
package in.gullak.profile;

import in.gullak.common.data.Csv;
import in.gullak.common.data.UserDataSection;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class ProfileExportSection implements UserDataSection {
    private final JdbcClient jdbc;

    ProfileExportSection(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String file() {
        return "profile.csv";
    }

    @Override
    public List<String> columns() {
        return List.of("income_rupees", "savings_rupees", "payday_rule", "payday_day", "personality", "morning_time",
            "night_time", "timezone");
    }

    @Override
    public List<List<String>> rows(UUID userId) {
        return jdbc.sql("""
                select income_paise, savings_paise, payday_rule, payday_day, personality, morning_time, night_time, timezone
                from profiles where user_id = ?
                """)
            .param(userId)
            .query((rs, n) -> List.of(Csv.rupees(rs.getLong("income_paise")), Csv.rupees(rs.getLong("savings_paise")),
                rs.getString("payday_rule"), Csv.text(rs.getObject("payday_day")), rs.getString("personality"),
                rs.getString("morning_time").substring(0, 5), rs.getString("night_time").substring(0, 5), rs.getString("timezone")))
            .list();
    }
}
```

`server/src/main/java/in/gullak/profile/FixedCostExportSection.java`:

```java
package in.gullak.profile;

import in.gullak.common.data.Csv;
import in.gullak.common.data.UserDataSection;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class FixedCostExportSection implements UserDataSection {
    private final JdbcClient jdbc;

    FixedCostExportSection(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String file() {
        return "fixed_costs.csv";
    }

    @Override
    public List<String> columns() {
        return List.of("name", "amount_rupees", "active", "created_at");
    }

    @Override
    public List<List<String>> rows(UUID userId) {
        return jdbc.sql("select name, amount_paise, active, created_at from fixed_costs where user_id = ? order by created_at, id")
            .param(userId)
            .query((rs, n) -> List.of(rs.getString("name"), Csv.rupees(rs.getLong("amount_paise")),
                String.valueOf(rs.getBoolean("active")), Csv.time(rs.getObject("created_at", OffsetDateTime.class))))
            .list();
    }
}
```

`server/src/main/java/in/gullak/ingestion/TransactionExportSection.java` (check the column names against Plan 3's migrations first; `note` is Plan 3's):

```java
package in.gullak.ingestion;

import in.gullak.common.data.Csv;
import in.gullak.common.data.UserDataSection;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Every spend and credit, deleted ones included with deleted_at. Raw statement text is not exported (Decisions). */
@Component
class TransactionExportSection implements UserDataSection {
    private final JdbcClient jdbc;

    TransactionExportSection(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String file() {
        return "spends.csv";
    }

    @Override
    public List<String> columns() {
        return List.of("id", "occurred_at", "direction", "amount_rupees", "category", "merchant", "tag", "paid_with",
            "source", "status", "note", "spread_over_cycle", "deleted_at");
    }

    @Override
    public List<List<String>> rows(UUID userId) {
        return jdbc.sql("""
                select id, occurred_at, direction, amount_paise, category_code, merchant_name, tag, payment_method, source,
                       status, note, spread_over_cycle, deleted_at
                from transactions where user_id = ? order by occurred_at, id
                """)
            .param(userId)
            .query((rs, n) -> List.of(rs.getObject("id", UUID.class).toString(),
                Csv.time(rs.getObject("occurred_at", OffsetDateTime.class)), rs.getString("direction"),
                Csv.rupees(rs.getLong("amount_paise")), rs.getString("category_code"), Csv.text(rs.getString("merchant_name")),
                Csv.text(rs.getString("tag")), rs.getString("payment_method"), rs.getString("source"), rs.getString("status"),
                Csv.text(rs.getString("note")), String.valueOf(rs.getBoolean("spread_over_cycle")),
                Csv.time(rs.getObject("deleted_at", OffsetDateTime.class))))
            .list();
    }
}
```

`server/src/main/java/in/gullak/goals/GoalExportSection.java` (Plan 5's `goals` columns from spec 4.5; check them against Plan 5's migration):

```java
package in.gullak.goals;

import in.gullak.common.data.Csv;
import in.gullak.common.data.UserDataSection;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class GoalExportSection implements UserDataSection {
    private final JdbcClient jdbc;

    GoalExportSection(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String file() {
        return "goals.csv";
    }

    @Override
    public List<String> columns() {
        return List.of("name", "type", "target_rupees", "deadline", "mode", "status", "created_at");
    }

    @Override
    public List<List<String>> rows(UUID userId) {
        return jdbc.sql("select name, type, target_paise, deadline, mode, status, created_at from goals where user_id = ? order by created_at, id")
            .param(userId)
            .query((rs, n) -> List.of(rs.getString("name"), rs.getString("type"), Csv.rupees(rs.getLong("target_paise")),
                Csv.text(rs.getObject("deadline")), rs.getString("mode"), rs.getString("status"),
                Csv.time(rs.getObject("created_at", OffsetDateTime.class))))
            .list();
    }
}
```

`server/src/main/java/in/gullak/gamification/XpExportSection.java`:

```java
package in.gullak.gamification;

import in.gullak.common.data.Csv;
import in.gullak.common.data.UserDataSection;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class XpExportSection implements UserDataSection {
    private final JdbcClient jdbc;

    XpExportSection(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String file() {
        return "xp_events.csv";
    }

    @Override
    public List<String> columns() {
        return List.of("kind", "xp", "earned_at", "reversed_at");
    }

    @Override
    public List<List<String>> rows(UUID userId) {
        return jdbc.sql("select kind, xp, created_at, reversed_at from xp_events where user_id = ? order by created_at, id")
            .param(userId)
            .query((rs, n) -> List.of(rs.getString("kind"), String.valueOf(rs.getInt("xp")),
                Csv.time(rs.getObject("created_at", OffsetDateTime.class)),
                Csv.time(rs.getObject("reversed_at", OffsetDateTime.class))))
            .list();
    }
}
```

`server/src/main/java/in/gullak/gamification/BadgeExportSection.java`:

```java
package in.gullak.gamification;

import in.gullak.common.data.Csv;
import in.gullak.common.data.UserDataSection;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class BadgeExportSection implements UserDataSection {
    private final JdbcClient jdbc;

    BadgeExportSection(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String file() {
        return "badges.csv";
    }

    @Override
    public List<String> columns() {
        return List.of("badge", "earned_at");
    }

    @Override
    public List<List<String>> rows(UUID userId) {
        return jdbc.sql("select badge_code, earned_at from user_badges where user_id = ? order by earned_at")
            .param(userId)
            .query((rs, n) -> List.of(rs.getString("badge_code"), Csv.time(rs.getObject("earned_at", OffsetDateTime.class))))
            .list();
    }
}
```

- [ ] **Step 6: The data package**

`server/src/main/java/in/gullak/data/ExportLinkEntity.java`:

```java
package in.gullak.data;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "export_links")
class ExportLinkEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(nullable = false)
    private int downloads;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected ExportLinkEntity() {}

    ExportLinkEntity(UUID userId, String tokenHash, Instant expiresAt, Instant createdAt) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    UUID getId() { return id; }
    UUID getUserId() { return userId; }
    Instant getExpiresAt() { return expiresAt; }

    void recordDownload() {
        downloads++;
    }

    /** The mail retry sends a new token; the one in the undelivered mail stops working. */
    void rotate(String newTokenHash) {
        this.tokenHash = newTokenHash;
    }
}
```

`server/src/main/java/in/gullak/data/ExportLinkRepository.java`:

```java
package in.gullak.data;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface ExportLinkRepository extends JpaRepository<ExportLinkEntity, UUID> {
    Optional<ExportLinkEntity> findByTokenHash(String tokenHash);

    long countByUserIdAndCreatedAtAfter(UUID userId, Instant after);

    @Modifying
    @Query("delete from ExportLinkEntity l where l.userId = :userId")
    int deleteByUserId(@Param("userId") UUID userId);
}
```

`server/src/main/java/in/gullak/data/ExportRequested.java`:

```java
package in.gullak.data;

import java.time.Instant;

/** POST /me/export: when the emailed link stops working. */
public record ExportRequested(Instant expiresAt) {}
```

`server/src/main/java/in/gullak/data/ExportFile.java`:

```java
package in.gullak.data;

public record ExportFile(String fileName, byte[] bytes) {}
```

`server/src/main/java/in/gullak/data/ExportService.java`:

```java
package in.gullak.data;

import in.gullak.auth.AccountService;
import in.gullak.common.data.Csv;
import in.gullak.common.data.UserDataSection;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.GoneException;
import in.gullak.common.error.NotFoundException;
import in.gullak.common.error.RateLimitedException;
import in.gullak.common.log.Events;
import in.gullak.common.mail.Mail;
import in.gullak.common.mail.MailDelivery;
import in.gullak.common.mail.MailOutbox;
import in.gullak.common.mail.MailProperties;
import in.gullak.common.time.Ist;
import in.gullak.common.token.OpaqueTokens;
import in.gullak.common.web.RateLimiter;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Spec 4.7: export generated on the server and emailed as a link that works for 24 hours. */
@Service
public class ExportService {
    static final String KIND = "export";
    static final Duration LINK_LIFE = Duration.ofHours(24);
    static final Duration ONE_AN_HOUR = Duration.ofHours(1);
    private static final Logger log = LoggerFactory.getLogger(ExportService.class);

    private final ExportLinkRepository links;
    private final AccountService accounts;
    private final List<UserDataSection> sections;
    private final MailDelivery delivery;
    private final MailOutbox outbox;
    private final MailProperties mail;
    private final RateLimiter limiter;
    private final JdbcClient jdbc;
    private final Clock clock;

    ExportService(ExportLinkRepository links, AccountService accounts, List<UserDataSection> sections, MailDelivery delivery,
                  MailOutbox outbox, MailProperties mail, RateLimiter limiter, JdbcClient jdbc, Clock clock) {
        this.links = links;
        this.accounts = accounts;
        this.sections = sections.stream().sorted(Comparator.comparing(UserDataSection::file)).toList();
        this.delivery = delivery;
        this.outbox = outbox;
        this.mail = mail;
        this.limiter = limiter;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** One export an hour, counted in the database under a per-user advisory lock so two taps make one link. */
    @Transactional
    public ExportRequested request(UUID userId) {
        jdbc.sql("select 1 from (select pg_advisory_xact_lock(hashtextextended(?, 0))) l")
            .param("export:" + userId).query(Integer.class).single();
        Instant now = clock.instant();
        if (links.countByUserIdAndCreatedAtAfter(userId, now.minus(ONE_AN_HOUR)) > 0) {
            throw new RateLimitedException("We sent your data less than an hour ago. Check your email.");
        }
        String token = OpaqueTokens.generate();
        ExportLinkEntity link = links.save(new ExportLinkEntity(userId, OpaqueTokens.hash(token), now.plus(LINK_LIFE), now));
        delivery.deliverAfterCommit(exportMail(accounts.emailOf(userId), token), outbox.queueOnGiveUp(userId, KIND, link.getId()));
        log.info("{} user={}", Events.EXPORT_REQUESTED, userId);
        return new ExportRequested(link.getExpiresAt());
    }

    /** The link is the credential (public route). Unknown → 404; past 24 hours → 410 LINK_EXPIRED. */
    @Transactional
    public ExportFile download(String token, String ip) {
        limiter.check("export-ip:" + ip, 30, Duration.ofMinutes(10));
        if (!token.matches(OpaqueTokens.PATTERN)) {
            throw new NotFoundException("Download link");
        }
        ExportLinkEntity link = links.findByTokenHash(OpaqueTokens.hash(token))
            .orElseThrow(() -> new NotFoundException("Download link"));
        if (!clock.instant().isBefore(link.getExpiresAt())) {
            throw new GoneException(ErrorCode.LINK_EXPIRED, "This download link has expired. Ask for a new one from Me.");
        }
        link.recordDownload();
        byte[] zip = archive(link.getUserId());
        log.info("{} user={} files={}", Events.EXPORT_DOWNLOADED, link.getUserId(), sections.size() + 1);
        return new ExportFile("gullak-export-" + Ist.today(clock) + ".zip", zip);
    }

    /** For the mail retry job: a fresh token on the same link while it is still valid. */
    @Transactional
    public Optional<Mail> rebuildMail(UUID userId, UUID linkId) {
        return links.findById(linkId)
            .filter(l -> l.getUserId().equals(userId))
            .filter(l -> clock.instant().isBefore(l.getExpiresAt()))
            .map(l -> {
                String token = OpaqueTokens.generate();
                l.rotate(OpaqueTokens.hash(token));
                return exportMail(accounts.emailOf(userId), token);
            });
    }

    private Mail exportMail(String email, String token) {
        return new Mail(KIND, email, "Your Gullak data is ready",
            "Here is everything Gullak holds about you, as a ZIP of CSV files you can open in any spreadsheet:\n"
                + mail.linksBaseUrl() + "/api/v1/exports/" + token
                + "\n\nThe link works for 24 hours. If you didn't ask for this, you can ignore this email; the link stops working on its own.\n");
    }

    private byte[] archive(UUID userId) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
            put(zip, "README.txt", readme());
            for (UserDataSection s : sections) {
                put(zip, s.file(), Csv.write(s.columns(), s.rows(userId)));
            }
        } catch (IOException e) {
            throw new UncheckedIOException("export archive", e);
        }
        return bytes.toByteArray();
    }

    private String readme() {
        StringBuilder out = new StringBuilder("Your Gullak data, exported on " + Ist.today(clock) + ".\r\n"
            + "Amounts are in rupees. Times are UTC (ISO 8601). One file per kind of record:\r\n\r\n");
        sections.forEach(s -> out.append(s.file()).append(": ").append(String.join(", ", s.columns())).append("\r\n"));
        return out.toString();
    }

    private static void put(ZipOutputStream zip, String name, String content) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(content.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }
}
```

`server/src/main/java/in/gullak/data/ExportMailResender.java`:

```java
package in.gullak.data;

import in.gullak.common.mail.Mail;
import in.gullak.common.mail.MailResender;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
class ExportMailResender implements MailResender {
    private final ExportService exports;

    ExportMailResender(ExportService exports) {
        this.exports = exports;
    }

    @Override
    public String kind() {
        return ExportService.KIND;
    }

    @Override
    public Optional<Mail> rebuild(UUID userId, UUID refId) {
        return exports.rebuildMail(userId, refId);
    }
}
```

`server/src/main/java/in/gullak/data/DataAccountListener.java`:

```java
package in.gullak.data;

import in.gullak.common.account.AccountLocked;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** A locked account's export links stop working at once, inside the deletion request's transaction. */
@Component
class DataAccountListener {
    private final ExportLinkRepository links;

    DataAccountListener(ExportLinkRepository links) {
        this.links = links;
    }

    @EventListener
    void onLocked(AccountLocked event) {
        links.deleteByUserId(event.userId());
    }
}
```

`server/src/main/java/in/gullak/data/ExportController.java`:

```java
package in.gullak.data;

import in.gullak.common.web.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ExportController {
    private final ExportService exports;

    ExportController(ExportService exports) {
        this.exports = exports;
    }

    @PostMapping("/api/v1/me/export")
    @ResponseStatus(HttpStatus.ACCEPTED)
    ExportRequested request(@AuthenticationPrincipal Jwt jwt) {
        return exports.request(CurrentUser.id(jwt));
    }

    /** Public (SecurityConfig.PUBLIC_LINKS): opened from the email, often in a browser. */
    @GetMapping("/api/v1/exports/{token}")
    ResponseEntity<byte[]> download(@PathVariable String token, HttpServletRequest http) {
        ExportFile file = exports.download(token, http.getRemoteAddr());
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("application/zip"))
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(file.fileName()).build().toString())
            .header(HttpHeaders.CACHE_CONTROL, "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("Referrer-Policy", "no-referrer")
            .body(file.bytes());
    }
}
```

In `ArchitectureTest.ALLOWED_FEATURE_DEPENDENCIES`, add `"data", Set.of("common", "auth")`.

- [ ] **Step 6b: Document the endpoints and columns**

Create `docs/api.md` (if Plans 3–7 already created it, add these two sections at the end):

````markdown
## Me and data (Plan 8)

All under `/api/v1`. Bearer token unless marked public.

| Method and path | Body | Answer |
|---|---|---|
| `GET /me/account` | | `{email, status, consentVersion, consentedAt, currentConsentVersion, deletionRequestedAt, supportEmail}` |
| `POST /me/consent` | `{version}` | 201 `{version, consentedAt}`; 200 on a replay; 400 for another version |
| `POST /me/export` | | 202 `{expiresAt}`; 429 within an hour of the last one |
| `GET /exports/{token}` (public) | | 200 `application/zip`; 404 unknown; 410 `LINK_EXPIRED` after 24 hours |
| `DELETE /me` | | 202 `{deletionDate}` |
| `POST /me/restore` (public) | `{token}` | 200 `{status: "ACTIVE"}`; 401 bad or used token; 404 after the 30 days |
| `GET`/`POST /me/restore/{token}` (public) | | the HTML page behind the emailed link |
| `POST /me/push-tokens` | `{token, platform}` | 201 new for this account; 200 already registered |
| `DELETE /me/push-tokens` | `{token}` | 204 |
| `GET /me/notifications` | | `{morning, night, nearLimit, offTrack, wins}` |
| `PATCH /me/notifications` | any of those booleans | the merged switches; 409 `SETUP_INCOMPLETE` before setup |

Before consent every bearer route answers 403 `CONSENT_REQUIRED` except `GET /me/account`, `POST /me/consent`,
`POST /me/export` and `DELETE /me`. A locked account answers 403 `ACCOUNT_LOCKED` everywhere.

## Data export files

The download is a ZIP. Amounts are rupees with two decimals (`250.00`), made from paise. Times are UTC, ISO 8601.
A cell that starts with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with `'` so spreadsheets show it as text.

| File | Columns |
|---|---|
| `README.txt` | what each file holds |
| `account.csv` | email, status, consent_version, consented_at, deletion_requested_at, created_at |
| `profile.csv` | income_rupees, savings_rupees, payday_rule, payday_day, personality, morning_time, night_time, timezone |
| `fixed_costs.csv` | name, amount_rupees, active, created_at |
| `spends.csv` | id, occurred_at, direction, amount_rupees, category, merchant, tag, paid_with, source, status, note, spread_over_cycle, deleted_at |
| `goals.csv` | name, type, target_rupees, deadline, mode, status, created_at |
| `xp_events.csv` | kind, xp, earned_at, reversed_at |
| `badges.csv` | badge, earned_at |

Raw statement text is not exported; the cleaned merchant name is. A feature that adds user data adds a
`UserDataSection` and a row here.
````

- [ ] **Step 7: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.data.*' --tests 'in.gullak.data.*' --tests 'in.gullak.security.*' --tests 'in.gullak.rules.*'`
Expected: PASS.

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 8: Update the test-cases doc**

Replace the API-DT-01 row with:
`| API-DT-01 | Export | POST /me/export | 202; an email with a link; the link downloads a ZIP of CSV files; files and columns are listed in docs/api.md |`

Add to the security section after SEC-15:
`| SEC-16 | Data flows in logs | consent, export, download, delete, locked sign-in and restore | no email, link token or session token in any log line |`

- [ ] **Step 9: Red team and commit**

Dispatch `red-team` with task id `plan-08-task-7`: guess export tokens; open another user's link while signed in as yourself (works only with the token: confirm the link is the only credential and the rows are the link owner's); open a link after 24 hours and after `DELETE /me`; fire 20 export requests at once; put `=cmd|' /C calc'!A0` and `@SUM(1+1)` in a merchant name and a fixed-cost name and open the CSV in a spreadsheet; check that the response has no-store and nosniff. Report to `docs/reports/red-team/plan-08-task-7.md`.

```bash
git add server/src/main/resources/db/migration/V064__export_links.sql server/src/main/java/in/gullak/common server/src/main/java/in/gullak/data server/src/main/java/in/gullak/auth/AccountExportSection.java server/src/main/java/in/gullak/profile/ProfileExportSection.java server/src/main/java/in/gullak/profile/FixedCostExportSection.java server/src/main/java/in/gullak/ingestion/TransactionExportSection.java server/src/main/java/in/gullak/goals/GoalExportSection.java server/src/main/java/in/gullak/gamification/XpExportSection.java server/src/main/java/in/gullak/gamification/BadgeExportSection.java server/src/test/java/in/gullak/common/data server/src/test/java/in/gullak/data server/src/test/java/in/gullak/security/DataLogRedactionApiTest.java server/src/test/java/in/gullak/rules/ArchitectureTest.java docs/api.md docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/reports/red-team/plan-08-task-7.md
git commit -m "feat(server): data export as an emailed 24-hour link to a ZIP of CSV files, one an hour

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Push tokens and the per-type notification switches

**Owner:** backend-engineer. **Test IDs:** API-PUSH-01, API-PUSH-02, API-PUSH-03, new API-PUSH-04, API-PUSH-05, new API-NTF-01 to API-NTF-03, spec 3.2 item 9 (per-message switches, server half). **Red team:** yes (registering or removing another user's push token; token format abuse; a locked account keeping tokens; the jsonb merge with odd input).

**Files:**
- Create: `server/src/main/resources/db/migration/V065__push_tokens_and_switches.sql`
- Create: `server/src/main/java/in/gullak/notify/Platform.java`, `PushTokenEntity.java`, `PushTokenRepository.java`, `PushTokenService.java`, `PushTokenController.java`, `NotifyAccountListener.java`
- Create: `server/src/main/java/in/gullak/profile/NotificationSwitches.java`, `NotificationSwitchesPatch.java`, `NotificationSwitchesStore.java`, `NotificationsController.java`
- Modify: `server/src/main/java/in/gullak/profile/ProfileService.java`, `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/test/java/in/gullak/rules/ArchitectureTest.java`
- Test: `server/src/test/java/in/gullak/notify/PushTokenApiTest.java`, `server/src/test/java/in/gullak/profile/NotificationSwitchesApiTest.java`

**Interfaces:**
- Consumes: `AccountLocked` (Task 5); `ProfileService`, `ProfileRepository`, `Personality`, `GullakException`, `ErrorCode.SETUP_INCOMPLETE` (Plan 1).
- Produces: table `push_tokens`; column `profiles.notifications` (jsonb); `Platform { IOS, ANDROID }`; `PushTokenService.register(UUID, String, Platform) : boolean` (true when new for this account), `unregister(UUID, String)`, `tokensFor(UUID) : List<String>`, `remove(String)`, `removeAllFor(UUID)`, `PushTokenService.FORMAT`; `POST /api/v1/me/push-tokens` (201 new, 200 known), `DELETE /api/v1/me/push-tokens {token}` (204); `NotificationSwitches(boolean morning, boolean night, boolean nearLimit, boolean offTrack, boolean wins)` with `DEFAULTS`; `NotificationSwitchesPatch(Boolean …)`; `ProfileService.switches(UUID)`, `updateSwitches(UUID, NotificationSwitchesPatch)`, `personalityOf(UUID) : Personality`; `GET|PATCH /api/v1/me/notifications`; events `push.token.registered`, `push.token.removed`.

- [ ] **Step 1: Migration**

`server/src/main/resources/db/migration/V065__push_tokens_and_switches.sql`:

```sql
-- Spec 4.5 push_tokens. A token is unique across accounts: the phone belongs to whoever signed in on it last.
create table push_tokens (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    token varchar(200) not null unique,
    platform varchar(10) not null check (platform in ('IOS', 'ANDROID')),
    last_seen_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on push_tokens (user_id, last_seen_at desc);

-- Spec 4.5 profiles.notifications: one switch per message type (spec 2.7), all on until the user turns one off.
alter table profiles add column notifications jsonb not null
    default '{"morning": true, "night": true, "nearLimit": true, "offTrack": true, "wins": true}'::jsonb;
```

- [ ] **Step 2: Write the failing tests**

`server/src/test/java/in/gullak/notify/PushTokenApiTest.java`:

```java
package in.gullak.notify;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class PushTokenApiTest extends ApiTest {
    static String expoToken(String suffix) {
        return "ExponentPushToken[" + ("gullaktest" + suffix).substring(0, Math.min(40, 10 + suffix.length())) + "]";
    }

    private ResultActions register(TestUser u, String token, String platform) throws Exception {
        return mvc.perform(post("/api/v1/me/push-tokens").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"token\":\"" + token + "\",\"platform\":\"" + platform + "\"}"));
    }

    private ResultActions unregister(TestUser u, String token) throws Exception {
        return mvc.perform(delete("/api/v1/me/push-tokens").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"token\":\"" + token + "\"}"));
    }

    private List<String> tokensOf(TestUser u) {
        return jdbc.sql("select token from push_tokens where user_id = ? order by last_seen_at").param(u.id()).query(String.class).list();
    }

    @Test
    void registersAnExpoToken() throws Exception { // API-PUSH-01
        TestUser u = signIn();
        String token = expoToken(u.id().toString().substring(0, 8));
        register(u, token, "ANDROID").andExpect(status().isCreated());
        assertThat(tokensOf(u)).containsExactly(token);
    }

    @Test
    void aBadFormatIs400() throws Exception { // API-PUSH-02
        TestUser u = signIn();
        register(u, "abc", "ANDROID").andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        register(u, "ExponentPushToken[<script>]", "IOS").andExpect(status().isBadRequest());
        register(u, expoToken("okokokok"), "WINDOWS").andExpect(status().isBadRequest());
        assertThat(tokensOf(u)).isEmpty();
    }

    @Test
    void theSameTokenTwiceIs200AndOneRow() throws Exception { // API-PUSH-03
        TestUser u = signIn();
        String token = expoToken(u.id().toString().substring(0, 8));
        register(u, token, "IOS").andExpect(status().isCreated());
        register(u, token, "IOS").andExpect(status().isOk());
        assertThat(tokensOf(u)).hasSize(1);
    }

    @Test
    void aTokenRegisteredByAnotherAccountMovesToTheNewOne() throws Exception { // API-PUSH-05
        TestUser first = signIn();
        TestUser next = signIn();
        String token = expoToken(first.id().toString().substring(0, 8));
        register(first, token, "ANDROID").andExpect(status().isCreated());
        register(next, token, "ANDROID").andExpect(status().isCreated());
        assertThat(tokensOf(first)).isEmpty();
        assertThat(tokensOf(next)).containsExactly(token);
    }

    @Test
    void removingTouchesOnlyTheCallersToken() throws Exception { // API-PUSH-04
        TestUser owner = signIn();
        TestUser other = signIn();
        String token = expoToken(owner.id().toString().substring(0, 8));
        register(owner, token, "IOS");
        unregister(other, token).andExpect(status().isNoContent());
        assertThat(tokensOf(owner)).containsExactly(token);
        unregister(owner, token).andExpect(status().isNoContent());
        assertThat(tokensOf(owner)).isEmpty();
    }

    @Test
    void anAccountKeepsAtMostTenTokens() throws Exception {
        TestUser u = signIn();
        String base = u.id().toString().replace("-", "").substring(0, 12);
        for (int i = 0; i < 11; i++) {
            clock.advance(Duration.ofMinutes(1));
            register(u, expoToken(base + "x" + (char) ('a' + i)), "ANDROID");
        }
        assertThat(tokensOf(u)).hasSize(10).doesNotContain(expoToken(base + "xa"));
    }

    @Test
    void aLockedAccountLosesItsTokensAtOnce() throws Exception {
        TestUser u = signIn();
        register(u, expoToken(u.id().toString().substring(0, 8)), "IOS");
        mvc.perform(delete("/api/v1/me").with(auth(u))).andExpect(status().isAccepted());
        assertThat(tokensOf(u)).isEmpty();
    }
}
```

`server/src/test/java/in/gullak/profile/NotificationSwitchesApiTest.java`:

```java
package in.gullak.profile;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class NotificationSwitchesApiTest extends ApiTest {
    private ResultActions patchSwitches(TestUser u, String json) throws Exception {
        return mvc.perform(patch("/api/v1/me/notifications").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content(json));
    }

    @Test
    void everythingIsOnByDefaultEvenBeforeSetup() throws Exception { // API-NTF-01
        mvc.perform(get("/api/v1/me/notifications").with(auth(signIn())))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.morning").value(true))
            .andExpect(jsonPath("$.night").value(true))
            .andExpect(jsonPath("$.nearLimit").value(true))
            .andExpect(jsonPath("$.offTrack").value(true))
            .andExpect(jsonPath("$.wins").value(true));
    }

    @Test
    void aPatchMergesOneSwitchAtATime() throws Exception { // API-NTF-02
        TestUser u = exampleUser();
        patchSwitches(u, "{\"offTrack\":false}").andExpect(status().isOk()).andExpect(jsonPath("$.offTrack").value(false));
        patchSwitches(u, "{\"wins\":false}")
            .andExpect(jsonPath("$.offTrack").value(false))
            .andExpect(jsonPath("$.wins").value(false))
            .andExpect(jsonPath("$.morning").value(true));
        putProfile(u, EXAMPLE_PROFILE).andExpect(status().isOk()); // editing the profile keeps the switches
        mvc.perform(get("/api/v1/me/notifications").with(auth(u))).andExpect(jsonPath("$.offTrack").value(false));
    }

    @Test
    void beforeSetupAPatchIs409() throws Exception { // API-NTF-03
        patchSwitches(signIn(), "{\"morning\":false}")
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SETUP_INCOMPLETE"));
    }

    @Test
    void aSwitchThatIsNotABooleanIs400() throws Exception {
        patchSwitches(exampleUser(), "{\"offTrack\":\"no\"}").andExpect(status().isBadRequest());
    }

    @Test
    void switchesAreTheCallersOwn() throws Exception {
        TestUser a = exampleUser();
        TestUser b = exampleUser();
        patchSwitches(a, "{\"night\":false}");
        mvc.perform(get("/api/v1/me/notifications").with(auth(b))).andExpect(jsonPath("$.night").value(true));
    }
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.notify.PushTokenApiTest' --tests 'in.gullak.profile.NotificationSwitchesApiTest'`
Expected: FAIL (404 on the new routes; `push_tokens` does not exist).

- [ ] **Step 4: Push tokens**

`server/src/main/java/in/gullak/notify/Platform.java`:

```java
package in.gullak.notify;

public enum Platform { IOS, ANDROID }
```

`server/src/main/java/in/gullak/notify/PushTokenEntity.java`:

```java
package in.gullak.notify;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Rows are written by {@link PushTokenRepository#upsert}; JPA reads and deletes them. */
@Entity
@Table(name = "push_tokens")
class PushTokenEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, unique = true, length = 200)
    private String token;

    @Column(nullable = false, length = 10)
    private String platform;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;

    protected PushTokenEntity() {}
}
```

`server/src/main/java/in/gullak/notify/PushTokenRepository.java`:

```java
package in.gullak.notify;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface PushTokenRepository extends JpaRepository<PushTokenEntity, UUID> {

    @Query("select t.userId from PushTokenEntity t where t.token = :token")
    Optional<UUID> ownerOf(@Param("token") String token);

    /** One row per token; a token seen under a new account moves to it. */
    @Modifying
    @Query(value = """
            insert into push_tokens (id, user_id, token, platform, last_seen_at) values (:id, :userId, :token, :platform, :now)
            on conflict (token) do update
                set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = excluded.last_seen_at
            """, nativeQuery = true)
    int upsert(@Param("id") UUID id, @Param("userId") UUID userId, @Param("token") String token,
               @Param("platform") String platform, @Param("now") Instant now);

    @Modifying
    @Query(value = """
            delete from push_tokens where user_id = :userId and id not in (
                select id from push_tokens where user_id = :userId order by last_seen_at desc limit :keep)
            """, nativeQuery = true)
    int keepNewest(@Param("userId") UUID userId, @Param("keep") int keep);

    @Query("select t.token from PushTokenEntity t where t.userId = :userId order by t.lastSeenAt desc")
    List<String> tokensOf(@Param("userId") UUID userId);

    @Modifying
    @Query("delete from PushTokenEntity t where t.userId = :userId and t.token = :token")
    int deleteOwn(@Param("userId") UUID userId, @Param("token") String token);

    @Modifying
    @Query("delete from PushTokenEntity t where t.token = :token")
    int deleteToken(@Param("token") String token);

    @Modifying
    @Query("delete from PushTokenEntity t where t.userId = :userId")
    int deleteAllOf(@Param("userId") UUID userId);
}
```

`server/src/main/java/in/gullak/notify/PushTokenService.java`:

```java
package in.gullak.notify;

import in.gullak.common.log.Events;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Expo push tokens per account. Tokens are never logged. */
@Service
public class PushTokenService {
    /** Expo's two token spellings; the inside is Expo's id alphabet. */
    public static final String FORMAT = "^Expo(nent)?PushToken\\[[A-Za-z0-9_-]{10,100}\\]$";
    static final int MAX_PER_USER = 10;
    private static final Logger log = LoggerFactory.getLogger(PushTokenService.class);

    private final PushTokenRepository tokens;
    private final Clock clock;

    PushTokenService(PushTokenRepository tokens, Clock clock) {
        this.tokens = tokens;
        this.clock = clock;
    }

    /** True when the token is new for this account (first time, or moved from another account). */
    @Transactional
    public boolean register(UUID userId, String token, Platform platform) {
        boolean created = tokens.ownerOf(token).map(owner -> !owner.equals(userId)).orElse(true);
        tokens.upsert(UUID.randomUUID(), userId, token, platform.name(), clock.instant());
        tokens.keepNewest(userId, MAX_PER_USER);
        if (created) {
            log.info("{} user={} platform={}", Events.PUSH_TOKEN_REGISTERED, userId, platform);
        }
        return created;
    }

    /** Sign-out on a phone. Someone else's token is left alone (the delete is scoped to the caller). */
    @Transactional
    public void unregister(UUID userId, String token) {
        if (tokens.deleteOwn(userId, token) > 0) {
            log.info("{} user={} reason=sign_out", Events.PUSH_TOKEN_REMOVED, userId);
        }
    }

    @Transactional(readOnly = true)
    public List<String> tokensFor(UUID userId) {
        return tokens.tokensOf(userId);
    }

    /** Expo said the device is gone (DeviceNotRegistered). */
    @Transactional
    public void remove(String token) {
        tokens.deleteToken(token);
    }

    @Transactional
    public void removeAllFor(UUID userId) {
        if (tokens.deleteAllOf(userId) > 0) {
            log.info("{} user={} reason=account_locked", Events.PUSH_TOKEN_REMOVED, userId);
        }
    }
}
```

`server/src/main/java/in/gullak/notify/PushTokenController.java`:

```java
package in.gullak.notify;

import in.gullak.common.web.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/me/push-tokens")
class PushTokenController {
    record Register(@NotBlank @Size(max = 200) @Pattern(regexp = PushTokenService.FORMAT) String token,
                    @NotNull Platform platform) {}

    record Unregister(@NotBlank @Size(max = 200) String token) {}

    private final PushTokenService tokens;

    PushTokenController(PushTokenService tokens) {
        this.tokens = tokens;
    }

    @PostMapping
    ResponseEntity<Void> register(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Register body) {
        boolean created = tokens.register(CurrentUser.id(jwt), body.token(), body.platform());
        return ResponseEntity.status(created ? HttpStatus.CREATED : HttpStatus.OK).build();
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void unregister(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Unregister body) {
        tokens.unregister(CurrentUser.id(jwt), body.token());
    }
}
```

`server/src/main/java/in/gullak/notify/NotifyAccountListener.java` (Task 9 adds the outbox line):

```java
package in.gullak.notify;

import in.gullak.common.account.AccountLocked;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** A locked account gets nothing more on its phones, decided inside the deletion request's transaction. */
@Component
class NotifyAccountListener {
    private final PushTokenService tokens;

    NotifyAccountListener(PushTokenService tokens) {
        this.tokens = tokens;
    }

    @EventListener
    void onLocked(AccountLocked event) {
        tokens.removeAllFor(event.userId());
    }
}
```

- [ ] **Step 5: Switches**

`server/src/main/java/in/gullak/profile/NotificationSwitches.java`:

```java
package in.gullak.profile;

/**
 * Spec 2.7: every message type can be switched off. The phone obeys morning, night and nearLimit (its local
 * messages); the server obeys offTrack and wins (milestones, level-ups, badges and streak milestones).
 */
public record NotificationSwitches(boolean morning, boolean night, boolean nearLimit, boolean offTrack, boolean wins) {
    public static final NotificationSwitches DEFAULTS = new NotificationSwitches(true, true, true, true, true);

    /** How many of the phone's local message types (morning, night, the 80% alert) are switched on: 0 to 3. */
    public int localTypesOn() {
        return (morning ? 1 : 0) + (night ? 1 : 0) + (nearLimit ? 1 : 0);
    }
}
```

`server/src/main/java/in/gullak/profile/NotificationSwitchesPatch.java`:

```java
package in.gullak.profile;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/** PATCH body: only the switches sent change. Booleans only, so the JSON built here needs no escaping. */
public record NotificationSwitchesPatch(Boolean morning, Boolean night, Boolean nearLimit, Boolean offTrack, Boolean wins) {
    boolean isEmpty() {
        return values().isEmpty();
    }

    String toJson() {
        return values().entrySet().stream()
            .map(e -> "\"" + e.getKey() + "\":" + e.getValue())
            .collect(Collectors.joining(",", "{", "}"));
    }

    private Map<String, Boolean> values() {
        Map<String, Boolean> m = new LinkedHashMap<>();
        if (morning != null) m.put("morning", morning);
        if (night != null) m.put("night", night);
        if (nearLimit != null) m.put("nearLimit", nearLimit);
        if (offTrack != null) m.put("offTrack", offTrack);
        if (wins != null) m.put("wins", wins);
        return m;
    }
}
```

`server/src/main/java/in/gullak/profile/NotificationSwitchesStore.java`:

```java
package in.gullak.profile;

import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * profiles.notifications is not mapped by JPA: it is read key by key and merged in one statement
 * ({@code notifications || patch}), so two phones changing different switches never lose each other's change.
 */
@Component
class NotificationSwitchesStore {
    private final JdbcClient jdbc;

    NotificationSwitchesStore(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Optional<NotificationSwitches> find(UUID userId) {
        return jdbc.sql("""
                select coalesce((notifications->>'morning')::boolean, true) as morning,
                       coalesce((notifications->>'night')::boolean, true) as night,
                       coalesce((notifications->>'nearLimit')::boolean, true) as near_limit,
                       coalesce((notifications->>'offTrack')::boolean, true) as off_track,
                       coalesce((notifications->>'wins')::boolean, true) as wins
                from profiles where user_id = ?
                """)
            .param(userId)
            .query((rs, n) -> new NotificationSwitches(rs.getBoolean("morning"), rs.getBoolean("night"),
                rs.getBoolean("near_limit"), rs.getBoolean("off_track"), rs.getBoolean("wins")))
            .optional();
    }

    /** False when the user has no profile yet. */
    boolean merge(UUID userId, NotificationSwitchesPatch patch) {
        return jdbc.sql("update profiles set notifications = notifications || cast(? as jsonb) where user_id = ?")
            .params(patch.toJson(), userId)
            .update() == 1;
    }
}
```

In `server/src/main/java/in/gullak/profile/ProfileService.java`: add the field `private final NotificationSwitchesStore switchesStore;`, add `NotificationSwitchesStore switchesStore` as the last constructor parameter (assigning it), and add these methods:

```java
    /** Everything on until the user switches something off; also before setup. */
    @Transactional(readOnly = true)
    public NotificationSwitches switches(UUID userId) {
        return switchesStore.find(userId).orElse(NotificationSwitches.DEFAULTS);
    }

    @Transactional
    public NotificationSwitches updateSwitches(UUID userId, NotificationSwitchesPatch patch) {
        boolean known = patch.isEmpty() ? profiles.existsById(userId) : switchesStore.merge(userId, patch);
        if (!known) {
            throw new GullakException(ErrorCode.SETUP_INCOMPLETE, HttpStatus.CONFLICT, "Finish setup first");
        }
        log.info("{} user={} part=notifications", Events.PROFILE_UPDATED, userId);
        return switches(userId);
    }

    /** For notification copy; the default personality before setup. */
    @Transactional(readOnly = true)
    public Personality personalityOf(UUID userId) {
        return profiles.findById(userId).map(p -> p.toProfile().personality()).orElse(Personality.CHILL);
    }
```

`server/src/main/java/in/gullak/profile/NotificationsController.java`:

```java
package in.gullak.profile;

import in.gullak.common.web.CurrentUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/me/notifications")
class NotificationsController {
    private final ProfileService profiles;

    NotificationsController(ProfileService profiles) {
        this.profiles = profiles;
    }

    @GetMapping
    NotificationSwitches get(@AuthenticationPrincipal Jwt jwt) {
        return profiles.switches(CurrentUser.id(jwt));
    }

    @PatchMapping
    NotificationSwitches patch(@AuthenticationPrincipal Jwt jwt, @RequestBody NotificationSwitchesPatch body) {
        return profiles.updateSwitches(CurrentUser.id(jwt), body);
    }
}
```

Append to `Events.java`:

```java
    public static final String PUSH_TOKEN_REGISTERED = "push.token.registered";
    public static final String PUSH_TOKEN_REMOVED = "push.token.removed";
```

In `ArchitectureTest.ALLOWED_FEATURE_DEPENDENCIES`, add `"notify", Set.of("common", "profile")`.

- [ ] **Step 6: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.notify.*' --tests 'in.gullak.profile.*' --tests 'in.gullak.rules.*'`
Expected: PASS.

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 7: Update the test-cases doc**

After API-PUSH-03 add:
`| API-PUSH-04 | Remove a token | DELETE /me/push-tokens {token} by its owner, and by another user | owner: 204 and gone; other user: 204 and the owner's row stays |`
`| API-PUSH-05 | Token on a new account | a token registered by A is registered by B | 201; the row now belongs to B; A has none |`

After API-CON rows add:
`| API-NTF-01 | Switch defaults | GET /me/notifications | all five on, also before setup |`
`| API-NTF-02 | Switch merge | PATCH {offTrack:false} then {wins:false} | both off, the rest on; a profile PUT keeps them |`
`| API-NTF-03 | Switch before setup | PATCH before the profile exists | 409 SETUP_INCOMPLETE |`

- [ ] **Step 8: Red team and commit**

Dispatch `red-team` with task id `plan-08-task-8`: register a token held by another account; remove another account's token; register 1,000 tokens; send tokens with unicode, brackets, 10 KB strings and SQL; PATCH with nested objects, arrays, `null` and unknown keys; confirm a locked account's tokens are gone in the same transaction as the lock. Report to `docs/reports/red-team/plan-08-task-8.md`.

```bash
git add server/src/main/resources/db/migration/V065__push_tokens_and_switches.sql server/src/main/java/in/gullak/notify server/src/main/java/in/gullak/profile server/src/main/java/in/gullak/common/log/Events.java server/src/test/java/in/gullak/notify server/src/test/java/in/gullak/profile/NotificationSwitchesApiTest.java server/src/test/java/in/gullak/rules/ArchitectureTest.java docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/reports/red-team/plan-08-task-8.md
git commit -m "feat(server): Expo push tokens per account and per-type notification switches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Server pushes: the outbox, quiet hours, the daily cap, switches, and Expo Push with retries

**Owner:** backend-engineer. **Test IDs:** JOB-05, JOB-06, JOB-07 (dispatch half), ERR-08 (push half), ERR-09 (push half), JOB-10 (lease, for the dispatcher), new JOB-17 (a removed device), JOB-19 (quiet-hours backlog). **Red team:** yes (quiet-hours bypass through retries and backlogs; cap bypass; pushes to a locked account; another user's pushes; push text with amounts or names; Expo error text in logs).

**Files:**
- Create: `server/src/main/resources/db/migration/V066__push_outbox.sql`
- Create: `server/src/main/java/in/gullak/notify/PushKind.java`, `PushCopy.java`, `QuietHours.java`, `PushProperties.java`, `PushOutbox.java`, `PushPlanner.java`, `PushEnvelope.java`, `PushTicket.java`, `PushSendException.java`, `PushTransport.java`, `InMemoryPushTransport.java`, `ExpoPushTransport.java`, `NotifyConfig.java`, `PushConfigCheck.java`, `PushDispatcher.java`, `PushDispatchJob.java`
- Modify: `server/src/main/java/in/gullak/notify/NotifyAccountListener.java` (whole file)
- Delete: `server/src/main/java/in/gullak/notify/InMemoryNotifier.java` (Plan 6; `PushPlanner` is now the `Notifier` in every profile)
- Modify: `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/main/resources/application.yml`, `application-prod.yml`, `server/src/test/resources/application-test.yml`, `README.md`
- Test: `server/src/test/java/in/gullak/notify/QuietHoursTest.java`, `PushCopyTest.java`, `PushDispatchApiTest.java`, `ExpoPushTransportTest.java`

**Interfaces:**
- Consumes: `Notifier`, `PushMessage(String title, String body, String url)` (Plan 6); `JobLock` (Plan 6); `PushTokenService`, `ProfileService.switches`, `personalityOf`, `NotificationSwitches` (Task 8); `AccountLocked` (Task 5); `StubHttpServer` (Task 2); `Ist`, `Db`.
- Produces: table `push_outbox`; `PushKind { OFF_TRACK(50), GOAL_MILESTONE(40), LEVEL_UP(30), STREAK_MILESTONE(25), BADGE(20), OTHER(10) }` with `priority`, `url`, `allowedBy(NotificationSwitches)`; `PushCopy.of(Personality, PushKind, String value) : PushMessage`; `QuietHours.isQuiet(Instant)`, `nextAllowed(Instant)`; `PushPlanner.plan(UUID userId, PushKind kind, String dedupeKey, String value) : boolean`, `planOffTrack(UUID, LocalDate) : boolean`, `send(UUID, PushMessage)` (the `Notifier`); `PushTransport.send(List<PushEnvelope>) : List<PushTicket>`; `InMemoryPushTransport.sent()`, `failNext(int)`, `failAlways(boolean)`, `unregister(String)`, `reset()`; `PushDispatcher.dispatch() : int` (-1 when another instance holds the lease); config `gullak.push.*`; deep links `gullak://goals`, `gullak://badges`; events `push.queued`, `push.dropped`, `push.retry`, `push.gave_up`, `push.failed`.

- [ ] **Step 1: Migration and configuration**

`server/src/main/resources/db/migration/V066__push_outbox.sql`:

```sql
-- Server pushes (spec 2.7). Every push is a row first: quiet hours set due_at, the dispatcher applies the switches
-- and the daily cap, and retries live here. One row per (user, dedupe_key) makes planning idempotent.
-- created_at is written by the app's clock: the off-track "once per 3 days" rule counts on it.
create table push_outbox (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    kind varchar(20) not null,
    priority int not null,
    dedupe_key varchar(80) not null,
    title varchar(80) not null,
    body varchar(200) not null,
    url varchar(60),
    status varchar(10) not null default 'queued' check (status in ('queued', 'sent', 'dropped', 'failed')),
    drop_reason varchar(20),
    due_at timestamptz not null,
    attempts int not null default 0,
    next_attempt_at timestamptz not null,
    sent_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null default now(),
    unique (user_id, dedupe_key)
);
create index push_outbox_due_idx on push_outbox (next_attempt_at) where status = 'queued';
create index push_outbox_sent_idx on push_outbox (user_id, sent_at) where status = 'sent';
create index push_outbox_kind_idx on push_outbox (user_id, kind, created_at);
```

Append under `gullak:` in `application.yml`:

```yaml
  push:
    expo-url: https://exp.host
    access-token: ${GULLAK_EXPO_ACCESS_TOKEN:}
    timeout: 5s
    attempts: 3
    backoff: 1s
    daily-cap: 4
    max-rounds: 4
    retry-delay: 15m
```

Append under `gullak:` in `application-test.yml`:

```yaml
  push:
    backoff: 0s
```

Append under `gullak:` in `application-prod.yml`:

```yaml
  push:
    access-token: ${GULLAK_EXPO_ACCESS_TOKEN}
```

README Configuration table:

```markdown
| `GULLAK_EXPO_ACCESS_TOKEN` | prod | Expo access token with "enhanced push security" on, so a push token alone cannot send. Prod refuses to start without it. |
```

- [ ] **Step 2: Write the failing tests**

`server/src/test/java/in/gullak/notify/QuietHoursTest.java`:

```java
package in.gullak.notify;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

/** Quiet hours are 23:00 to 07:00 IST (UTC+5:30). */
class QuietHoursTest {
    private static Instant ist(String localIso) {
        return Instant.parse(localIso + "Z").minusSeconds(5 * 3600 + 30 * 60);
    }

    @Test
    void theEveningBeforeElevenIsNotQuiet() {
        assertThat(QuietHours.isQuiet(ist("2026-10-23T22:59:59"))).isFalse();
        assertThat(QuietHours.nextAllowed(ist("2026-10-23T22:59:59"))).isEqualTo(ist("2026-10-23T22:59:59"));
    }

    @Test
    void elevenAtNightWaitsForSevenTheNextMorning() { // JOB-05
        assertThat(QuietHours.nextAllowed(ist("2026-10-23T23:00:00"))).isEqualTo(ist("2026-10-24T07:00:00"));
        assertThat(QuietHours.nextAllowed(ist("2026-10-23T23:30:00"))).isEqualTo(ist("2026-10-24T07:00:00"));
    }

    @Test
    void afterMidnightWaitsForSevenTheSameMorning() {
        assertThat(QuietHours.nextAllowed(ist("2026-10-24T00:20:00"))).isEqualTo(ist("2026-10-24T07:00:00"));
        assertThat(QuietHours.nextAllowed(ist("2026-10-24T06:59:59"))).isEqualTo(ist("2026-10-24T07:00:00"));
    }

    @Test
    void sevenIsAllowed() {
        assertThat(QuietHours.isQuiet(ist("2026-10-24T07:00:00"))).isFalse();
    }
}
```

`server/src/test/java/in/gullak/notify/PushCopyTest.java`:

```java
package in.gullak.notify;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.profile.Personality;
import org.junit.jupiter.api.Test;

class PushCopyTest {
    @Test
    void everyPersonalityHasALineForEveryKind() { // spec 2.6: every notification has a version per personality
        for (Personality p : Personality.values()) {
            for (PushKind k : PushKind.values()) {
                if (k == PushKind.OTHER) {
                    continue;
                }
                PushMessage m = PushCopy.of(p, k, k == PushKind.GOAL_MILESTONE ? "3f2a:50" : "7");
                assertThat(m.title()).isNotBlank().hasSizeLessThanOrEqualTo(60);
                assertThat(m.body()).isNotBlank().hasSizeLessThanOrEqualTo(160);
                assertThat(m.title() + m.body()).doesNotContain("₹", "{", "}", "3f2a");
                assertThat(m.url()).isEqualTo(k.url);
            }
        }
    }

    @Test
    void valuesAreFilledIn() {
        assertThat(PushCopy.of(Personality.CHILL, PushKind.LEVEL_UP, "5").title()).isEqualTo("Level 5");
        assertThat(PushCopy.of(Personality.CHILL, PushKind.GOAL_MILESTONE, "3f2a:50").body()).contains("50%");
        assertThat(PushCopy.of(Personality.CHILL, PushKind.GOAL_MILESTONE, "3f2a:100").title()).isEqualTo("Goal done");
        assertThat(PushCopy.of(Personality.HYPE, PushKind.STREAK_MILESTONE, "30").title()).isEqualTo("30-day streak");
    }
}
```

`server/src/test/java/in/gullak/notify/PushDispatchApiTest.java`:

```java
package in.gullak.notify;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.common.jobs.JobLock;
import in.gullak.profile.NotificationSwitches;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;

@ExtendWith(OutputCaptureExtension.class)
class PushDispatchApiTest extends ApiTest {
    static final Instant TEN_AM_IST = Instant.parse("2026-10-23T04:30:00Z");
    static final Instant ELEVEN_THIRTY_PM_IST = Instant.parse("2026-10-23T18:00:00Z");
    static final Instant SEVEN_AM_NEXT_DAY_IST = Instant.parse("2026-10-24T01:30:00Z");

    @Autowired PushPlanner planner;
    @Autowired PushDispatcher dispatcher;
    @Autowired InMemoryPushTransport transport;
    @Autowired JobLock lock;

    private String token;

    @BeforeEach
    void cleanTransport() {
        transport.reset();
    }

    /** A user with a phone and the phone's local messages switched off, so all 4 daily slots belong to the server. */
    private TestUser userWithPhone() throws Exception {
        TestUser u = userWithPhoneAndLocalMessages();
        mvc.perform(patch("/api/v1/me/notifications").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"morning\":false,\"night\":false,\"nearLimit\":false}")).andExpect(status().isOk());
        return u;
    }

    /** A user with a phone and the default switches: morning, night and the 80% alert all on. */
    private TestUser userWithPhoneAndLocalMessages() throws Exception {
        TestUser u = exampleUser();
        token = "ExponentPushToken[" + u.id().toString().replace("-", "").substring(0, 20) + "]";
        mvc.perform(post("/api/v1/me/push-tokens").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"token\":\"" + token + "\",\"platform\":\"ANDROID\"}")).andExpect(status().isCreated());
        return u;
    }

    private List<String> statuses(TestUser u, String kind) {
        return jdbc.sql("select status from push_outbox where user_id = ? and kind = ? order by created_at")
            .params(u.id(), kind).query(String.class).list();
    }

    private long sentTo(TestUser u) {
        return transport.sent().stream().filter(e -> e.token().equals(token)).count();
    }

    @Test
    void aPushDueAtHalfPastElevenIsSentAtSeven() throws Exception { // JOB-05
        TestUser u = userWithPhone();
        clock.set(ELEVEN_THIRTY_PM_IST);
        assertThat(planner.plan(u.id(), PushKind.LEVEL_UP, "level:2", "2")).isTrue();
        assertThat(jdbc.sql("select due_at from push_outbox where user_id = ?").param(u.id())
            .query(OffsetDateTime.class).single().toInstant()).isEqualTo(SEVEN_AM_NEXT_DAY_IST);
        dispatcher.dispatch();
        clock.set(SEVEN_AM_NEXT_DAY_IST.minusSeconds(1));
        dispatcher.dispatch();
        assertThat(sentTo(u)).isZero();
        clock.set(SEVEN_AM_NEXT_DAY_IST);
        dispatcher.dispatch();
        assertThat(sentTo(u)).isEqualTo(1);
        assertThat(statuses(u, "LEVEL_UP")).containsExactly("sent");
    }

    @Test
    void fivePushesDueSendFourAndDropTheLowestPriority() throws Exception { // JOB-06
        TestUser u = userWithPhone();
        clock.set(TEN_AM_IST);
        planner.plan(u.id(), PushKind.BADGE, "badge:SORTED", "SORTED");
        planner.plan(u.id(), PushKind.STREAK_MILESTONE, "streak:7", "7");
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:3", "3");
        planner.plan(u.id(), PushKind.GOAL_MILESTONE, "goal:g1:25", "g1:25");
        planner.plan(u.id(), PushKind.OFF_TRACK, "off-track:2026-10-22", "2026-10-22");
        dispatcher.dispatch();
        assertThat(sentTo(u)).isEqualTo(4);
        assertThat(statuses(u, "BADGE")).containsExactly("dropped");
        assertThat(jdbc.sql("select drop_reason from push_outbox where user_id = ? and kind = 'BADGE'").param(u.id())
            .query(String.class).single()).isEqualTo("daily_cap");
    }

    @Test
    void theServerCapLeavesRoomForThePhonesLocalMessages() throws Exception { // JOB-06, spec 2.7: 4 a day in total
        TestUser u = userWithPhoneAndLocalMessages(); // morning, night and 80% on: 4 - 3 = 1 server push
        clock.set(TEN_AM_IST);
        planner.plan(u.id(), PushKind.OFF_TRACK, "off-track:2026-10-22", "2026-10-22");
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:3", "3");
        dispatcher.dispatch();
        assertThat(sentTo(u)).isEqualTo(1);
        assertThat(statuses(u, "OFF_TRACK")).containsExactly("sent");
        assertThat(statuses(u, "LEVEL_UP")).containsExactly("dropped");

        clock.set(Instant.parse("2026-10-24T03:00:00Z")); // 08:30 IST the next day
        mvc.perform(patch("/api/v1/me/notifications").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"night\":false}")).andExpect(status().isOk()); // two local types on: 2 server pushes
        planner.plan(u.id(), PushKind.BADGE, "badge:FIRST_LOG", "FIRST_LOG");
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:4", "4");
        planner.plan(u.id(), PushKind.STREAK_MILESTONE, "streak:7", "7");
        dispatcher.dispatch();
        assertThat(sentTo(u)).isEqualTo(3);
        assertThat(statuses(u, "BADGE")).containsExactly("dropped");
    }

    @Test
    void theServerCapIsNeverBelowOne() { // JOB-06
        NotificationSwitches allLocal = new NotificationSwitches(true, true, true, true, true);
        NotificationSwitches noLocal = new NotificationSwitches(false, false, false, true, true);
        assertThat(PushDispatcher.serverCap(4, allLocal)).isEqualTo(1);
        assertThat(PushDispatcher.serverCap(4, noLocal)).isEqualTo(4);
        assertThat(PushDispatcher.serverCap(2, allLocal)).isEqualTo(1);
    }

    @Test
    void theCapCountsWhatWasSentEarlierThatDayAndResetsAtMidnightIst() throws Exception { // JOB-06
        TestUser u = userWithPhone();
        clock.set(TEN_AM_IST);
        for (int level = 2; level <= 5; level++) {
            planner.plan(u.id(), PushKind.LEVEL_UP, "level:" + level, String.valueOf(level));
            dispatcher.dispatch();
        }
        clock.advance(Duration.ofHours(8));
        planner.plan(u.id(), PushKind.OFF_TRACK, "off-track:x", "2026-10-22");
        dispatcher.dispatch();
        assertThat(statuses(u, "OFF_TRACK")).containsExactly("dropped");
        clock.set(Instant.parse("2026-10-24T03:00:00Z")); // 08:30 IST the next day
        planner.plan(u.id(), PushKind.BADGE, "badge:FIRST_LOG", "FIRST_LOG");
        dispatcher.dispatch();
        assertThat(statuses(u, "BADGE")).containsExactly("sent");
    }

    @Test
    void quietHoursBacklogStillRespectsTheCap() throws Exception { // JOB-19, Review Focus
        TestUser u = userWithPhone();
        clock.set(ELEVEN_THIRTY_PM_IST);
        planner.plan(u.id(), PushKind.OFF_TRACK, "off-track:a", "2026-10-22");
        planner.plan(u.id(), PushKind.GOAL_MILESTONE, "goal:g1:50", "g1:50");
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:4", "4");
        planner.plan(u.id(), PushKind.STREAK_MILESTONE, "streak:30", "30");
        planner.plan(u.id(), PushKind.BADGE, "badge:WEEK_WARRIOR", "WEEK_WARRIOR");
        planner.send(u.id(), new PushMessage("Hello", "A note from Gullak", null));
        clock.set(SEVEN_AM_NEXT_DAY_IST);
        dispatcher.dispatch();
        assertThat(sentTo(u)).isEqualTo(4);
        assertThat(statuses(u, "BADGE")).containsExactly("dropped");
        assertThat(statuses(u, "OTHER")).containsExactly("dropped");
    }

    @Test
    void aSwitchedOffTypeIsNeverQueuedAndIsDroppedIfSwitchedOffLater() throws Exception { // JOB-07
        TestUser u = userWithPhone();
        clock.set(TEN_AM_IST);
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:2", "2");
        mvc.perform(patch("/api/v1/me/notifications").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"offTrack\":false,\"wins\":false}")).andExpect(status().isOk());
        assertThat(planner.plan(u.id(), PushKind.OFF_TRACK, "off-track:2026-10-22", "2026-10-22")).isFalse();
        assertThat(statuses(u, "OFF_TRACK")).isEmpty();
        dispatcher.dispatch();
        assertThat(statuses(u, "LEVEL_UP")).containsExactly("dropped");
        assertThat(sentTo(u)).isZero();
    }

    @Test
    void aFailingProviderNeverBlocksAndQueuesARetry(CapturedOutput out) throws Exception { // ERR-08, ERR-09 (push)
        TestUser u = userWithPhone();
        clock.set(TEN_AM_IST);
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:2", "2");
        transport.failAlways(true);
        dispatcher.dispatch();
        assertThat(out.getOut().split("push.retry", -1)).hasSize(4);
        assertThat(out.getOut()).contains("push.gave_up");
        assertThat(statuses(u, "LEVEL_UP")).containsExactly("queued");
        assertThat(jdbc.sql("select next_attempt_at from push_outbox where user_id = ?").param(u.id())
            .query(OffsetDateTime.class).single().toInstant()).isEqualTo(TEN_AM_IST.plus(Duration.ofMinutes(15)));

        transport.failAlways(false);
        clock.advance(Duration.ofMinutes(15));
        dispatcher.dispatch();
        assertThat(statuses(u, "LEVEL_UP")).containsExactly("sent");
    }

    @Test
    void afterFourFailedRoundsThePushIsMarkedFailed(CapturedOutput out) throws Exception {
        TestUser u = userWithPhone();
        clock.set(TEN_AM_IST);
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:2", "2");
        transport.failAlways(true);
        for (int round = 0; round < 4; round++) {
            dispatcher.dispatch();
            clock.advance(Duration.ofHours(1));
        }
        assertThat(statuses(u, "LEVEL_UP")).containsExactly("failed");
        assertThat(out.getOut()).contains("push.failed");
    }

    @Test
    void aRetryThatFallsIntoTheNightWaitsForMorning() throws Exception {
        TestUser u = userWithPhone();
        clock.set(Instant.parse("2026-10-23T17:25:00Z")); // 22:55 IST
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:2", "2");
        transport.failAlways(true);
        dispatcher.dispatch();
        assertThat(jdbc.sql("select next_attempt_at from push_outbox where user_id = ?").param(u.id())
            .query(OffsetDateTime.class).single().toInstant()).isEqualTo(SEVEN_AM_NEXT_DAY_IST);
    }

    @Test
    void aRemovedDeviceLosesItsToken() throws Exception { // JOB-17
        TestUser u = userWithPhone();
        clock.set(TEN_AM_IST);
        transport.unregister(token);
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:2", "2");
        dispatcher.dispatch();
        assertThat(statuses(u, "LEVEL_UP")).containsExactly("dropped");
        assertThat(jdbc.sql("select count(*) from push_tokens where user_id = ?").param(u.id()).query(Long.class).single()).isZero();
    }

    @Test
    void noPhoneMeansDropped() throws Exception {
        TestUser u = exampleUser();
        clock.set(TEN_AM_IST);
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:2", "2");
        dispatcher.dispatch();
        assertThat(statuses(u, "LEVEL_UP")).containsExactly("dropped");
    }

    @Test
    void planningTheSamePushTwiceQueuesOne() throws Exception {
        TestUser u = userWithPhone();
        assertThat(planner.plan(u.id(), PushKind.LEVEL_UP, "level:2", "2")).isTrue();
        assertThat(planner.plan(u.id(), PushKind.LEVEL_UP, "level:2", "2")).isFalse();
    }

    @Test
    void aLockedAccountsQueuedPushesAreDropped() throws Exception {
        TestUser u = userWithPhone();
        clock.set(TEN_AM_IST);
        planner.plan(u.id(), PushKind.LEVEL_UP, "level:2", "2");
        mvc.perform(delete("/api/v1/me").with(auth(u))).andExpect(status().isAccepted());
        dispatcher.dispatch();
        assertThat(statuses(u, "LEVEL_UP")).containsExactly("dropped");
        assertThat(sentTo(u)).isZero();
    }

    @Test
    void eachUserGetsOnlyTheirOwnPushes() throws Exception {
        TestUser a = userWithPhone();
        String aToken = token;
        TestUser b = userWithPhone();
        clock.set(TEN_AM_IST);
        planner.plan(a.id(), PushKind.LEVEL_UP, "level:2", "2");
        dispatcher.dispatch();
        assertThat(transport.sent()).extracting(PushEnvelope::token).contains(aToken).doesNotContain(token);
        assertThat(statuses(b, "LEVEL_UP")).isEmpty();
    }

    @Test
    void anotherInstanceHoldingTheLeaseSkips() { // JOB-10 (dispatch)
        assertThat(lock.tryAcquire(PushDispatcher.NAME)).isTrue();
        try {
            assertThat(dispatcher.dispatch()).isEqualTo(-1);
        } finally {
            lock.release(PushDispatcher.NAME);
        }
    }

    @Test
    void pushesCarryNoAmountAndLogsCarryNoText(CapturedOutput out) throws Exception {
        TestUser u = userWithPhone();
        clock.set(TEN_AM_IST);
        planner.plan(u.id(), PushKind.OFF_TRACK, "off-track:2026-10-22", "2026-10-22");
        dispatcher.dispatch();
        assertThat(transport.sent()).allSatisfy(e -> assertThat(e.title() + e.body()).doesNotContain("₹"));
        String body = transport.sent().getFirst().body();
        assertThat(out.getAll()).doesNotContain(body, token);
    }
}
```

`server/src/test/java/in/gullak/notify/ExpoPushTransportTest.java`:

```java
package in.gullak.notify;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import in.gullak.support.StubHttpServer;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ExpoPushTransportTest {
    private static final PushEnvelope ONE =
        new PushEnvelope("ExponentPushToken[abcdefghij1234]", "Level 5", "You levelled up. Keep it going", "gullak://badges");

    private StubHttpServer expo;

    @BeforeEach
    void start() throws Exception {
        expo = new StubHttpServer();
    }

    @AfterEach
    void stop() {
        expo.close();
    }

    private ExpoPushTransport transport(Duration timeout) {
        return new ExpoPushTransport(new PushProperties(expo.uri().toString(), "test-access", timeout, 3, Duration.ZERO, 4, 4,
            Duration.ofMinutes(15)));
    }

    @Test
    void postsAnArrayWithTheAccessToken() {
        expo.respond(200, "{\"data\":[{\"status\":\"ok\",\"id\":\"t-1\"}]}");
        List<PushTicket> tickets = transport(Duration.ofSeconds(5)).send(List.of(ONE));
        assertThat(tickets).singleElement().satisfies(t -> {
            assertThat(t.ok()).isTrue();
            assertThat(t.token()).isEqualTo(ONE.token());
        });
        assertThat(expo.received()).singleElement().satisfies(r -> {
            assertThat(r.path()).isEqualTo("/--/api/v2/push/send");
            assertThat(StubHttpServer.header(r, "Authorization")).isEqualTo("Bearer test-access");
            assertThat(r.body()).startsWith("[").contains("\"to\":\"ExponentPushToken[abcdefghij1234]\"", "\"url\":\"gullak://badges\"");
        });
    }

    @Test
    void aDeviceThatIsGoneIsReportedByCode() {
        expo.respond(200, "{\"data\":[{\"status\":\"error\",\"message\":\"\\\"ExponentPushToken[abcdefghij1234]\\\" is not a registered push notification recipient\",\"details\":{\"error\":\"DeviceNotRegistered\"}}]}");
        PushTicket t = transport(Duration.ofSeconds(5)).send(List.of(ONE)).getFirst();
        assertThat(t.ok()).isFalse();
        assertThat(t.error()).isEqualTo("DeviceNotRegistered");
    }

    @Test
    void aServerErrorThrows() {
        expo.respond(500, "{\"errors\":[{\"code\":\"INTERNAL_SERVER_ERROR\"}]}");
        assertThatThrownBy(() -> transport(Duration.ofSeconds(5)).send(List.of(ONE))).isInstanceOf(PushSendException.class);
    }

    @Test
    void aHangingProviderEndsAtTheTimeout() { // ERR-08 (push provider)
        expo.delay(Duration.ofSeconds(5));
        long started = System.nanoTime();
        assertThatThrownBy(() -> transport(Duration.ofMillis(300)).send(List.of(ONE))).isInstanceOf(PushSendException.class);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(3));
    }

    @Test
    void aTicketCountThatDoesNotMatchThrows() {
        expo.respond(200, "{\"data\":[]}");
        assertThatThrownBy(() -> transport(Duration.ofSeconds(5)).send(List.of(ONE))).isInstanceOf(PushSendException.class);
    }
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.notify.*'`
Expected: compilation fails (`QuietHours`, `PushKind`, `PushPlanner`, `PushDispatcher`, `ExpoPushTransport` missing).

- [ ] **Step 4: Kinds, copy, quiet hours, properties**

`server/src/main/java/in/gullak/notify/PushKind.java`:

```java
package in.gullak.notify;

import in.gullak.profile.NotificationSwitches;

/** Server push types (spec 2.7), most important first. The URL is the deep link the app allows (notification-routes.ts). */
public enum PushKind {
    OFF_TRACK(50, "gullak://goals"),
    GOAL_MILESTONE(40, "gullak://goals"),
    LEVEL_UP(30, "gullak://badges"),
    STREAK_MILESTONE(25, null),
    BADGE(20, "gullak://badges"),
    OTHER(10, null);

    final int priority;
    final String url;

    PushKind(int priority, String url) {
        this.priority = priority;
        this.url = url;
    }

    boolean allowedBy(NotificationSwitches s) {
        return this == OFF_TRACK ? s.offTrack() : s.wins();
    }
}
```

`server/src/main/java/in/gullak/notify/PushCopy.java` (every line checked against `.claude/design.md`: one sentence, no full stop; two or more, a full stop after each; no amounts, no goal names):

```java
package in.gullak.notify;

import in.gullak.profile.Personality;

/** One title and body per personality and kind (spec 2.6). {value}: a level, a streak length or a goal percent. */
final class PushCopy {
    private PushCopy() {}

    static PushMessage of(Personality p, PushKind kind, String value) {
        String v = kind == PushKind.GOAL_MILESTONE ? value.substring(value.lastIndexOf(':') + 1) : value;
        String[] tb = switch (kind) {
            case OFF_TRACK -> switch (p) {
                case CHILL -> new String[] {"Small course correction", "You're a bit off track this cycle. A catch-up plan is ready."};
                case SAVAGE -> new String[] {"We need to talk", "At this pace payday will be rough. There's a plan waiting."};
                case MOM -> new String[] {"Beta, listen", "This month's spending is running ahead. I made a plan for you."};
                case HYPE -> new String[] {"Comeback time", "You're off track, but there's a plan to win it back"};
            };
            case GOAL_MILESTONE -> "100".equals(v) ? switch (p) {
                case CHILL -> new String[] {"Goal done", "You finished a goal. Enjoy it."};
                case SAVAGE -> new String[] {"Goal done", "You actually finished a goal. Respect."};
                case MOM -> new String[] {"Goal done", "You finished your goal. I knew you could."};
                case HYPE -> new String[] {"Goal smashed", "You finished a goal. Legend."};
            } : switch (p) {
                case CHILL -> new String[] {"Goal check-in", v + "% of a goal saved. Nice and steady."};
                case SAVAGE -> new String[] {"Look at you", v + "% of a goal saved. Didn't think you had it in you."};
                case MOM -> new String[] {"So proud", v + "% of your goal saved. Call me sometime."};
                case HYPE -> new String[] {"Let's go", v + "% of a goal saved. Unstoppable."};
            };
            case LEVEL_UP -> switch (p) {
                case CHILL -> new String[] {"Level " + v, "You levelled up. Keep it going."};
                case SAVAGE -> new String[] {"Level " + v, "Fine, you levelled up. Don't let it go to your head."};
                case MOM -> new String[] {"Level " + v, "See, I told you saving was good"};
                case HYPE -> new String[] {"Level " + v, "You levelled up. Keep stacking."};
            };
            case STREAK_MILESTONE -> switch (p) {
                case CHILL -> new String[] {v + "-day streak", v + " days under budget in a row"};
                case SAVAGE -> new String[] {v + " days", v + " days under budget. Who are you?"};
                case MOM -> new String[] {v + " days", v + " days under budget. Now eat something."};
                case HYPE -> new String[] {v + "-day streak", v + " days under budget. On fire."};
            };
            case BADGE -> switch (p) {
                case CHILL -> new String[] {"New badge", "You earned a badge. Take a look."};
                case SAVAGE -> new String[] {"Badge unlocked", "You earned a badge. Try not to brag."};
                case MOM -> new String[] {"A new badge", "You earned a badge. Show your father."};
                case HYPE -> new String[] {"New badge", "Badge unlocked. Keep collecting."};
            };
            case OTHER -> throw new IllegalArgumentException("OTHER pushes carry their own text");
        };
        return new PushMessage(tb[0], tb[1], kind.url);
    }
}
```

`server/src/main/java/in/gullak/notify/QuietHours.java`:

```java
package in.gullak.notify;

import in.gullak.common.time.Ist;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;

/** Spec 2.7: no pushes from 23:00 to 07:00 IST. */
final class QuietHours {
    static final LocalTime START = LocalTime.of(23, 0);
    static final LocalTime END = LocalTime.of(7, 0);

    private QuietHours() {}

    static boolean isQuiet(Instant at) {
        LocalTime t = LocalTime.ofInstant(at, Ist.ZONE);
        return !t.isBefore(START) || t.isBefore(END);
    }

    /** {@code at} itself outside quiet hours, else the next 07:00 IST. */
    static Instant nextAllowed(Instant at) {
        if (!isQuiet(at)) {
            return at;
        }
        ZonedDateTime local = at.atZone(Ist.ZONE);
        LocalDate day = local.toLocalTime().isBefore(END) ? local.toLocalDate() : local.toLocalDate().plusDays(1);
        return day.atTime(END).atZone(Ist.ZONE).toInstant();
    }
}
```

`server/src/main/java/in/gullak/notify/PushProperties.java`:

```java
package in.gullak.notify;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param expoUrl     Expo's push host
 * @param accessToken Expo access token (enhanced push security); required in prod
 * @param timeout     per Expo call
 * @param attempts    tries per dispatch round
 * @param backoff     wait before the second try; the third waits twice as long
 * @param dailyCap    messages per user per IST day, local and server together (spec 2.7: at most 4); the server's
 *                    share is this minus the local types switched on, at least 1 ({@code PushDispatcher.serverCap})
 * @param maxRounds   dispatch rounds before a push is marked failed
 * @param retryDelay  wait after a failed round, times the round number
 */
@ConfigurationProperties("gullak.push")
public record PushProperties(String expoUrl, String accessToken, Duration timeout, int attempts, Duration backoff,
                             int dailyCap, int maxRounds, Duration retryDelay) {}
```

- [ ] **Step 5: Outbox and planner**

`server/src/main/java/in/gullak/notify/PushOutbox.java`:

```java
package in.gullak.notify;

import in.gullak.common.db.Db;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * The push queue. JdbcClient: an idempotent insert (on conflict do nothing) and a queue worked under the
 * dispatcher's lease. Every statement is scoped by user or by row id.
 */
@Component
class PushOutbox {
    record Row(UUID id, UUID userId, PushKind kind, String title, String body, String url, int attempts, Instant createdAt) {}

    private final JdbcClient jdbc;

    PushOutbox(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    boolean enqueue(UUID userId, PushKind kind, String dedupeKey, PushMessage m, Instant due, Instant now) {
        return jdbc.sql("""
                insert into push_outbox (id, user_id, kind, priority, dedupe_key, title, body, url, due_at, next_attempt_at, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (user_id, dedupe_key) do nothing
                """)
            .params(UUID.randomUUID(), userId, kind.name(), kind.priority, dedupeKey, m.title(), m.body(), m.url(),
                Db.ts(due), Db.ts(due), Db.ts(now))
            .update() == 1;
    }

    List<Row> due(Instant now, int limit) {
        return jdbc.sql("""
                select id, user_id, kind, title, body, url, attempts, created_at from push_outbox
                where status = 'queued' and next_attempt_at <= ?
                order by user_id, priority desc, created_at, id limit ?
                """)
            .params(Db.ts(now), limit)
            .query((rs, n) -> new Row(rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                PushKind.valueOf(rs.getString("kind")), rs.getString("title"), rs.getString("body"), rs.getString("url"),
                rs.getInt("attempts"), rs.getObject("created_at", OffsetDateTime.class).toInstant()))
            .list();
    }

    int sentSince(UUID userId, Instant since) {
        return jdbc.sql("select count(*) from push_outbox where user_id = ? and status = 'sent' and sent_at >= ?")
            .params(userId, Db.ts(since)).query(Integer.class).single();
    }

    /** An off-track push queued or sent after {@code since} (spec 2.7: at most once per 3 days). */
    boolean offTrackSince(UUID userId, Instant since) {
        return jdbc.sql("""
                select exists (select 1 from push_outbox where user_id = ? and kind = 'OFF_TRACK'
                               and status in ('queued', 'sent') and created_at > ?)
                """)
            .params(userId, Db.ts(since)).query(Boolean.class).single();
    }

    void defer(UUID id, Instant until) {
        jdbc.sql("update push_outbox set due_at = ?, next_attempt_at = ? where id = ?").params(Db.ts(until), Db.ts(until), id).update();
    }

    void markSent(UUID id, Instant now) {
        jdbc.sql("update push_outbox set status = 'sent', sent_at = ? where id = ?").params(Db.ts(now), id).update();
    }

    void drop(UUID id, String reason) {
        jdbc.sql("update push_outbox set status = 'dropped', drop_reason = ? where id = ?").params(reason, id).update();
    }

    void retryLater(UUID id, int attempts, Instant next) {
        jdbc.sql("update push_outbox set attempts = ?, next_attempt_at = ? where id = ?").params(attempts, Db.ts(next), id).update();
    }

    void fail(UUID id, int attempts) {
        jdbc.sql("update push_outbox set status = 'failed', attempts = ? where id = ?").params(attempts, id).update();
    }

    int cancelQueued(UUID userId) {
        return jdbc.sql("update push_outbox set status = 'dropped', drop_reason = 'account_locked' where user_id = ? and status = 'queued'")
            .param(userId).update();
    }
}
```

`server/src/main/java/in/gullak/notify/PushPlanner.java`:

```java
package in.gullak.notify;

import in.gullak.common.log.Events;
import in.gullak.profile.ProfileService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Plan 6's Notifier, for every profile: a push is planned into push_outbox with quiet hours applied, unless its
 * switch is off. PushDispatcher sends it. Planning never calls the provider, so it never fails for a provider reason.
 */
@Component
public class PushPlanner implements Notifier {
    static final Duration OFF_TRACK_GAP = Duration.ofDays(3);
    private static final Logger log = LoggerFactory.getLogger(PushPlanner.class);

    private final PushOutbox outbox;
    private final ProfileService profiles;
    private final Clock clock;

    PushPlanner(PushOutbox outbox, ProfileService profiles, Clock clock) {
        this.outbox = outbox;
        this.profiles = profiles;
        this.clock = clock;
    }

    /** True when a new push was queued; false when switched off or already planned under this key. */
    @Transactional
    public boolean plan(UUID userId, PushKind kind, String dedupeKey, String value) {
        if (!kind.allowedBy(profiles.switches(userId))) {
            log.info("{} user={} kind={} reason=switched_off", Events.PUSH_DROPPED, userId, kind);
            return false;
        }
        return enqueue(userId, kind, dedupeKey, PushCopy.of(profiles.personalityOf(userId), kind, value));
    }

    /** Spec 2.7: the off-track push goes at most once per 3 days. */
    @Transactional
    public boolean planOffTrack(UUID userId, LocalDate closedDay) {
        if (outbox.offTrackSince(userId, clock.instant().minus(OFF_TRACK_GAP))) {
            return false;
        }
        return plan(userId, PushKind.OFF_TRACK, "off-track:" + closedDay, closedDay.toString());
    }

    /** Plan 6's generic Notifier: lowest priority, under the wins switch. */
    @Override
    @Transactional
    public void send(UUID userId, PushMessage message) {
        if (PushKind.OTHER.allowedBy(profiles.switches(userId))) {
            enqueue(userId, PushKind.OTHER, "other:" + UUID.randomUUID(), message);
        }
    }

    private boolean enqueue(UUID userId, PushKind kind, String dedupeKey, PushMessage message) {
        Instant now = clock.instant();
        boolean added = outbox.enqueue(userId, kind, dedupeKey, message, QuietHours.nextAllowed(now), now);
        if (added) {
            log.info("{} user={} kind={}", Events.PUSH_QUEUED, userId, kind);
        }
        return added;
    }
}
```

- [ ] **Step 6: The transport**

`server/src/main/java/in/gullak/notify/PushEnvelope.java`:

```java
package in.gullak.notify;

/** One push to one device. toString hides the token and the text. */
public record PushEnvelope(String token, String title, String body, String url) {
    @Override
    public String toString() {
        return "PushEnvelope[url=" + url + "]";
    }
}
```

`server/src/main/java/in/gullak/notify/PushTicket.java`:

```java
package in.gullak.notify;

/** Expo's answer for one envelope. {@code error} is Expo's code (DeviceNotRegistered, MessageRateExceeded…), never its text. */
public record PushTicket(String token, boolean ok, String error) {
    @Override
    public String toString() {
        return "PushTicket[ok=" + ok + ", error=" + error + "]";
    }
}
```

`server/src/main/java/in/gullak/notify/PushSendException.java`:

```java
package in.gullak.notify;

/** The provider call failed or timed out. The message is a short reason we wrote. */
public class PushSendException extends RuntimeException {
    public PushSendException(String reason) {
        super(reason);
    }
}
```

`server/src/main/java/in/gullak/notify/PushTransport.java`:

```java
package in.gullak.notify;

import java.util.List;

/** One attempt at handing pushes to the provider; one ticket per envelope, in order. Throws PushSendException. */
public interface PushTransport {
    List<PushTicket> send(List<PushEnvelope> envelopes);
}
```

`server/src/main/java/in/gullak/notify/InMemoryPushTransport.java`:

```java
package in.gullak.notify;

import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Local and test only: records pushes, fails on demand, and can pretend a device is gone. */
@Component
@Profile({"local", "test"})
public class InMemoryPushTransport implements PushTransport {
    private final List<PushEnvelope> sent = new CopyOnWriteArrayList<>();
    private final Set<String> gone = ConcurrentHashMap.newKeySet();
    private final AtomicInteger failNext = new AtomicInteger();
    private volatile boolean failAlways;

    @Override
    public List<PushTicket> send(List<PushEnvelope> envelopes) {
        if (failAlways || failNext.getAndUpdate(n -> Math.max(0, n - 1)) > 0) {
            throw new PushSendException("stub-failure");
        }
        return envelopes.stream().map(e -> {
            if (gone.contains(e.token())) {
                return new PushTicket(e.token(), false, "DeviceNotRegistered");
            }
            sent.add(e);
            return new PushTicket(e.token(), true, null);
        }).toList();
    }

    public List<PushEnvelope> sent() {
        return List.copyOf(sent);
    }

    public void failNext(int n) {
        failNext.set(n);
    }

    public void failAlways(boolean on) {
        failAlways = on;
    }

    public void unregister(String token) {
        gone.add(token);
    }

    /** Clears everything, the sent list included (each test reads only its own pushes). */
    public void reset() {
        sent.clear();
        failNext.set(0);
        failAlways = false;
        gone.clear();
    }
}
```

`server/src/main/java/in/gullak/notify/ExpoPushTransport.java`:

```java
package in.gullak.notify;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.net.http.HttpClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** Expo Push (https://docs.expo.dev/push-notifications/sending-notifications/): one POST of up to 100 messages. */
class ExpoPushTransport implements PushTransport {
    @JsonIgnoreProperties(ignoreUnknown = true)
    record ExpoResponse(List<ExpoTicket> data) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ExpoTicket(String status, String id, Details details) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Details(String error) {}

    record ExpoMessage(String to, String title, String body, Map<String, String> data, String sound) {}

    private final RestClient client;

    ExpoPushTransport(PushProperties props) {
        HttpClient http = HttpClient.newBuilder().connectTimeout(props.timeout()).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(props.timeout());
        RestClient.Builder builder = RestClient.builder()
            .baseUrl(props.expoUrl())
            .requestFactory(factory)
            .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE);
        if (props.accessToken() != null && !props.accessToken().isBlank()) {
            builder.defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + props.accessToken());
        }
        this.client = builder.build();
    }

    @Override
    public List<PushTicket> send(List<PushEnvelope> envelopes) {
        List<ExpoMessage> body = envelopes.stream()
            .map(e -> new ExpoMessage(e.token(), e.title(), e.body(), e.url() == null ? Map.of() : Map.of("url", e.url()), "default"))
            .toList();
        ExpoResponse response;
        try {
            response = client.post().uri("/--/api/v2/push/send")
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(ExpoResponse.class);
        } catch (RestClientException e) {
            throw new PushSendException("expo-" + e.getClass().getSimpleName());
        }
        if (response == null || response.data() == null || response.data().size() != envelopes.size()) {
            throw new PushSendException("expo-bad-response");
        }
        List<PushTicket> tickets = new ArrayList<>();
        for (int i = 0; i < envelopes.size(); i++) {
            ExpoTicket t = response.data().get(i);
            boolean ok = "ok".equals(t.status());
            String error = ok ? null : t.details() != null && t.details().error() != null ? t.details().error() : "unknown";
            tickets.add(new PushTicket(envelopes.get(i).token(), ok, error));
        }
        return tickets;
    }
}
```

`server/src/main/java/in/gullak/notify/NotifyConfig.java`:

```java
package in.gullak.notify;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration(proxyBeanMethods = false)
@Profile("prod")
class NotifyConfig {
    @Bean
    ExpoPushTransport expoPushTransport(PushProperties props) {
        return new ExpoPushTransport(props);
    }
}
```

`server/src/main/java/in/gullak/notify/PushConfigCheck.java`:

```java
package in.gullak.notify;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Prod refuses to start without an Expo access token or with a non-https Expo host. */
@Component
@Profile("prod")
class PushConfigCheck {
    PushConfigCheck(PushProperties props) {
        if (props.accessToken() == null || props.accessToken().isBlank()) {
            throw new IllegalStateException("GULLAK_EXPO_ACCESS_TOKEN must be set in prod (Expo enhanced push security).");
        }
        if (props.expoUrl() == null || !props.expoUrl().startsWith("https://")) {
            throw new IllegalStateException("gullak.push.expo-url must be https in prod.");
        }
    }
}
```

- [ ] **Step 7: The dispatcher**

`server/src/main/java/in/gullak/notify/PushDispatcher.java`:

```java
package in.gullak.notify;

import in.gullak.common.jobs.JobLock;
import in.gullak.common.log.Events;
import in.gullak.common.time.Ist;
import in.gullak.profile.NotificationSwitches;
import in.gullak.profile.ProfileService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Sends due pushes under a lease. Per user: quiet hours (defer to 07:00 IST), switches (drop), the daily cap
 * (send the highest priorities, drop the rest), then Expo with three tries; a failed round is retried later,
 * never inside quiet hours, and marked failed after maxRounds. The provider's failures never escape this class.
 */
@Component
public class PushDispatcher {
    public static final String NAME = "push-dispatch";
    private static final Logger log = LoggerFactory.getLogger(PushDispatcher.class);

    private final JobLock lock;
    private final PushOutbox outbox;
    private final PushTokenService tokens;
    private final ProfileService profiles;
    private final PushTransport transport;
    private final PushProperties props;
    private final Clock clock;

    PushDispatcher(JobLock lock, PushOutbox outbox, PushTokenService tokens, ProfileService profiles, PushTransport transport,
                   PushProperties props, Clock clock) {
        this.lock = lock;
        this.outbox = outbox;
        this.tokens = tokens;
        this.profiles = profiles;
        this.transport = transport;
        this.props = props;
        this.clock = clock;
    }

    /** Pushes sent, or -1 when another instance holds the lease. */
    public int dispatch() {
        if (!lock.tryAcquire(NAME)) {
            return -1;
        }
        try {
            Instant now = clock.instant();
            Map<UUID, List<PushOutbox.Row>> byUser = outbox.due(now, 500).stream()
                .collect(Collectors.groupingBy(PushOutbox.Row::userId, LinkedHashMap::new, Collectors.toList()));
            int sent = 0;
            for (Map.Entry<UUID, List<PushOutbox.Row>> e : byUser.entrySet()) {
                sent += dispatchUser(e.getKey(), e.getValue(), now);
            }
            return sent;
        } finally {
            lock.release(NAME);
        }
    }

    private int dispatchUser(UUID userId, List<PushOutbox.Row> rows, Instant now) {
        if (QuietHours.isQuiet(now)) {
            Instant morning = QuietHours.nextAllowed(now);
            rows.forEach(r -> outbox.defer(r.id(), morning));
            return 0;
        }
        NotificationSwitches switches = profiles.switches(userId);
        List<PushOutbox.Row> wanted = new ArrayList<>();
        for (PushOutbox.Row r : rows) {
            if (r.kind().allowedBy(switches)) {
                wanted.add(r);
            } else {
                drop(userId, r, "switched_off");
            }
        }
        wanted.sort(Comparator.comparingInt((PushOutbox.Row r) -> -r.kind().priority).thenComparing(PushOutbox.Row::createdAt));
        int cap = serverCap(props.dailyCap(), switches);
        int room = Math.max(0, cap - outbox.sentSince(userId, Ist.startOf(LocalDate.ofInstant(now, Ist.ZONE))));
        List<PushOutbox.Row> sendNow = List.copyOf(wanted.subList(0, Math.min(room, wanted.size())));
        wanted.subList(sendNow.size(), wanted.size()).forEach(r -> drop(userId, r, "daily_cap"));
        List<String> devices = tokens.tokensFor(userId);
        int sent = 0;
        for (PushOutbox.Row r : sendNow) {
            if (devices.isEmpty()) {
                drop(userId, r, "no_device");
            } else if (deliver(userId, r, devices, now)) {
                sent++;
            }
        }
        return sent;
    }

    /**
     * Spec 2.7: at most {@code totalCap} messages a day in total. Each local type the phone may show (morning,
     * night, the 80% alert) takes one slot; the server keeps the rest, never fewer than 1.
     */
    static int serverCap(int totalCap, NotificationSwitches switches) {
        return Math.max(1, totalCap - switches.localTypesOn());
    }

    private boolean deliver(UUID userId, PushOutbox.Row r, List<String> devices, Instant now) {
        List<PushEnvelope> envelopes = devices.stream().map(t -> new PushEnvelope(t, r.title(), r.body(), r.url())).toList();
        for (int i = 1; i <= props.attempts(); i++) {
            try {
                List<PushTicket> tickets = transport.send(envelopes);
                tickets.stream().filter(t -> "DeviceNotRegistered".equals(t.error())).forEach(t -> tokens.remove(t.token()));
                if (tickets.stream().anyMatch(PushTicket::ok)) {
                    outbox.markSent(r.id(), now);
                    log.info("{} user={} kind={}", Events.PUSH_SENT, userId, r.kind());
                    return true;
                }
                if (tickets.stream().allMatch(t -> "DeviceNotRegistered".equals(t.error()))) {
                    drop(userId, r, "no_device");
                    return false;
                }
                log.warn("{} user={} kind={} attempt={} reason=ticket_error", Events.PUSH_RETRY, userId, r.kind(), i);
            } catch (PushSendException e) {
                log.warn("{} user={} kind={} attempt={} reason={}", Events.PUSH_RETRY, userId, r.kind(), i, e.getMessage());
            }
            if (i < props.attempts() && !pause(props.backoff().multipliedBy(i))) {
                break;
            }
        }
        int rounds = r.attempts() + 1;
        if (rounds >= props.maxRounds()) {
            outbox.fail(r.id(), rounds);
            log.warn("{} user={} kind={} rounds={}", Events.PUSH_FAILED, userId, r.kind(), rounds);
        } else {
            outbox.retryLater(r.id(), rounds, QuietHours.nextAllowed(now.plus(props.retryDelay().multipliedBy(rounds))));
            log.warn("{} user={} kind={} round={}", Events.PUSH_GAVE_UP, userId, r.kind(), rounds);
        }
        return false;
    }

    private void drop(UUID userId, PushOutbox.Row r, String reason) {
        outbox.drop(r.id(), reason);
        log.info("{} user={} kind={} reason={}", Events.PUSH_DROPPED, userId, r.kind(), reason);
    }

    private static boolean pause(Duration wait) {
        if (wait.isZero()) {
            return true;
        }
        try {
            Thread.sleep(wait);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("{} reason=interrupted", Events.PUSH_RETRY);
            return false;
        }
    }
}
```

`server/src/main/java/in/gullak/notify/PushDispatchJob.java`:

```java
package in.gullak.notify;

import java.util.concurrent.TimeUnit;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Every minute (when gullak.jobs.enabled). The lease and the queue make it safe on any number of instances. */
@Component
class PushDispatchJob {
    private final PushDispatcher dispatcher;

    PushDispatchJob(PushDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    @Scheduled(fixedDelay = 1, timeUnit = TimeUnit.MINUTES)
    public void scheduled() {
        dispatcher.dispatch();
    }
}
```

`server/src/main/java/in/gullak/notify/NotifyAccountListener.java` (whole file):

```java
package in.gullak.notify;

import in.gullak.common.account.AccountLocked;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** A locked account gets nothing more on its phones, decided inside the deletion request's transaction. */
@Component
class NotifyAccountListener {
    private final PushTokenService tokens;
    private final PushOutbox outbox;

    NotifyAccountListener(PushTokenService tokens, PushOutbox outbox) {
        this.tokens = tokens;
        this.outbox = outbox;
    }

    @EventListener
    void onLocked(AccountLocked event) {
        tokens.removeAllFor(event.userId());
        outbox.cancelQueued(event.userId());
    }
}
```

Delete `server/src/main/java/in/gullak/notify/InMemoryNotifier.java`. Then `grep -rn "InMemoryNotifier" server/src`: replace any remaining test use with an assertion on `push_outbox` rows (`jdbc.sql("select count(*) from push_outbox where user_id = ?")`), since every `Notifier.send` now lands there.

Append to `Events.java` (`PUSH_SENT` exists from Plan 1):

```java
    public static final String PUSH_QUEUED = "push.queued";
    public static final String PUSH_DROPPED = "push.dropped";
    public static final String PUSH_RETRY = "push.retry";
    public static final String PUSH_GAVE_UP = "push.gave_up";
    public static final String PUSH_FAILED = "push.failed";
```

- [ ] **Step 8: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.notify.*'`
Expected: PASS.

Then: `cd server && ./gradlew test`
Expected: PASS (Plan 6's job tests use their own `FlakyNotifier` and do not need `InMemoryNotifier`).

- [ ] **Step 9: Update the test-cases doc**

Reword JOB-06: `| JOB-06 | Daily cap | 4 messages a day in total: the server sends at most 4 − (local types switched on among morning, night and the 80% alert), at least 1; with those three off, 5 pushes due: 4 sent, the lowest priority dropped; with all three on, 1 sent |`

Add after JOB-16 (Plan 6's last row), before JOB-20:
`| JOB-17 | Device gone | Expo answers DeviceNotRegistered for the only token | the token is deleted; the push is dropped (no_device) |`
`| JOB-19 | Quiet-hours backlog | 6 pushes planned at 23:30, local messages switched off | at 07:00 four go out, highest priority first; two are dropped (daily_cap) |`

Reword ERR-08 to: `| ERR-08 | External call timeout | email or push provider stub that hangs | the request or job completes, WARN logged, retry queued (mail_outbox / push_outbox), no user-facing failure |`

- [ ] **Step 10: Red team and commit**

Dispatch `red-team` with task id `plan-08-task-9`: try to get a push out between 23:00 and 07:00 (a retry scheduled for 22:59, a plan at 22:59:59 dispatched at 23:00:01, a backlog); plan 20 pushes in a day and count what is sent; switch a type off between planning and dispatch; lock an account with pushes queued; register another account's token and see whose pushes arrive; grep logs for push titles, bodies, tokens and Expo error messages; point the transport at a stub that returns 200 with HTML. Report to `docs/reports/red-team/plan-08-task-9.md`.

```bash
git add server/src/main/resources/db/migration/V066__push_outbox.sql server/src/main/java/in/gullak/notify server/src/main/java/in/gullak/common/log/Events.java server/src/main/resources/application.yml server/src/main/resources/application-prod.yml server/src/test/resources/application-test.yml server/src/test/java/in/gullak/notify README.md docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/reports/red-team/plan-08-task-9.md
git rm server/src/main/java/in/gullak/notify/InMemoryNotifier.java
git commit -m "feat(server): push outbox with quiet hours, a daily cap of 4, switches and Expo Push with retries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Off-track pushes after the daily close, and milestone, level-up, badge and streak pushes

**Owner:** backend-engineer. **Test IDs:** JOB-04, JOB-07 (off-track half), new JOB-18 (win pushes once, after commit). **Red team:** yes (a rolled-back celebration pushing; one off-track push per 3 days under re-runs; a push for a user who switched wins off; a failure while planning leaking into the request that earned the win).

**Files:**
- Create: `server/src/main/java/in/gullak/common/game/WinEarned.java`
- Modify: `server/src/main/java/in/gullak/gamification/CelebrationService.java` (constructor and `record`)
- Modify: Plan 5's goal-milestone method in `server/src/main/java/in/gullak/goals/` (the method that logs `Events.GOAL_MILESTONE`)
- Create: `server/src/main/java/in/gullak/notify/WinPushListener.java`
- Create: `server/src/main/java/in/gullak/jobs/OffTrackCheck.java`, `InsightsOffTrackCheck.java`, `OffTrackPushJob.java`
- Modify: `server/src/main/java/in/gullak/common/log/Events.java`, `docs/engineering-standards.md`, `server/src/test/java/in/gullak/rules/ArchitectureTest.java`
- Test: `server/src/test/java/in/gullak/notify/WinPushApiTest.java`, `server/src/test/java/in/gullak/jobs/OffTrackPushJobApiTest.java`, `server/src/test/java/in/gullak/jobs/InsightsOffTrackCheckApiTest.java`

**Interfaces:**
- Consumes: `PushPlanner.plan`, `planOffTrack`, `PushKind` (Task 9); `CelebrationService.record`, `CelebrationKind`, `DailyCloseService.find(UUID, LocalDate)`, `DailyCloseService.close(ClosedDay)`, `ClosedDay(UUID, LocalDate, long, long)`, `ProfileService.userIdsSetUpBefore(Instant)`, `JobRunner.run`, `gameUser()` (Plan 6); `InsightsService.offTrack(UUID)` (Plan 7, spending half); `GoalService.list(UUID) : GoalsResponse` with `GoalView.status()`/`behindPaise()` (Plan 5, goal half); test helper `createGoal` and `GoalService.devFallBehind(UUID, UUID)` (Plan 5).
- Produces: `WinEarned(UUID userId, String kind, String value)` (kinds `LEVEL_UP`, `STAGE_UP`, `BADGE`, `STREAK_DAY`, `STREAK_MILESTONE`, `GOAL_MILESTONE`; the goal value is `<goalId>:<percent>`); job `off-track-push` at 00:20 IST (`OffTrackPushJob.runFor(LocalDate) : JobResult`); event `push.plan_failed`.

- [ ] **Step 1: Check the contracts**

Open Plan 7's code and confirm `in.gullak.insights.InsightsService.offTrack(UUID userId) : boolean` exists (spending half of spec 2.7, decided as of yesterday). Open Plan 5's code and confirm `in.gullak.goals.GoalService.list(UUID) : GoalsResponse` with `GoalView.status()` and `behindPaise()` (goal half). `InsightsOffTrackCheck` below ORs the two. If a name differs, use the real one and note it in the task report. Find Plan 5's milestone method: `grep -rn "GOAL_MILESTONE" server/src/main/java/in/gullak/goals`.

- [ ] **Step 2: Write the failing tests**

`server/src/test/java/in/gullak/notify/WinPushApiTest.java`:

```java
package in.gullak.notify;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.common.game.WinEarned;
import in.gullak.gamification.CelebrationKind;
import in.gullak.gamification.CelebrationService;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.MediaType;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@ExtendWith(OutputCaptureExtension.class)
class WinPushApiTest extends ApiTest {
    @Autowired CelebrationService celebrations;
    @Autowired ApplicationEventPublisher events;
    @Autowired PlatformTransactionManager transactions;

    private long rows(TestUser u, String kind) {
        return jdbc.sql("select count(*) from push_outbox where user_id = ? and kind = ?").params(u.id(), kind)
            .query(Long.class).single();
    }

    @Test
    void aLevelUpQueuesOnePush() throws Exception { // JOB-18
        TestUser u = exampleUser();
        assertThat(celebrations.record(u.id(), CelebrationKind.LEVEL_UP, "2")).isTrue();
        assertThat(rows(u, "LEVEL_UP")).isEqualTo(1);
        assertThat(jdbc.sql("select title from push_outbox where user_id = ?").param(u.id()).query(String.class).single())
            .isEqualTo("Level 2");
        assertThat(celebrations.record(u.id(), CelebrationKind.LEVEL_UP, "2")).isFalse();
        assertThat(rows(u, "LEVEL_UP")).isEqualTo(1);
    }

    @Test
    void badgesAndStreakMilestonesPushButStreakDaysAndStagesDoNot() throws Exception {
        TestUser u = exampleUser();
        celebrations.record(u.id(), CelebrationKind.BADGE, "SORTED");
        celebrations.record(u.id(), CelebrationKind.STREAK_MILESTONE, "7");
        celebrations.record(u.id(), CelebrationKind.STREAK_DAY, "2026-10-22");
        celebrations.record(u.id(), CelebrationKind.STAGE_UP, "PAINTED");
        assertThat(rows(u, "BADGE")).isEqualTo(1);
        assertThat(rows(u, "STREAK_MILESTONE")).isEqualTo(1);
        assertThat(jdbc.sql("select count(*) from push_outbox where user_id = ?").param(u.id()).query(Long.class).single())
            .isEqualTo(2);
    }

    @Test
    void aRolledBackCelebrationDoesNotPush() throws Exception { // JOB-18
        TestUser u = exampleUser();
        new TransactionTemplate(transactions).executeWithoutResult(s -> {
            celebrations.record(u.id(), CelebrationKind.LEVEL_UP, "3");
            s.setRollbackOnly();
        });
        assertThat(rows(u, "LEVEL_UP")).isZero();
    }

    @Test
    void aGoalMilestonePushNamesNoGoal() throws Exception {
        TestUser u = exampleUser();
        UUID goal = UUID.randomUUID();
        events.publishEvent(new WinEarned(u.id(), "GOAL_MILESTONE", goal + ":50"));
        String body = jdbc.sql("select body from push_outbox where user_id = ? and kind = 'GOAL_MILESTONE'").param(u.id())
            .query(String.class).single();
        assertThat(body).contains("50%").doesNotContain(goal.toString());
    }

    @Test
    void winsSwitchedOffQueueNothing() throws Exception { // JOB-07 (wins)
        TestUser u = exampleUser();
        mvc.perform(patch("/api/v1/me/notifications").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"wins\":false}")).andExpect(status().isOk());
        celebrations.record(u.id(), CelebrationKind.BADGE, "FIRST_LOG");
        assertThat(rows(u, "BADGE")).isZero();
    }

    @Test
    void aPlanningFailureNeverReachesTheCaller(CapturedOutput out) {
        UUID nobody = UUID.randomUUID(); // no users row: the outbox insert fails its foreign key
        assertThatCode(() -> events.publishEvent(new WinEarned(nobody, "BADGE", "SORTED"))).doesNotThrowAnyException();
        assertThat(out.getOut()).contains("push.plan_failed user=" + nobody);
    }
}
```

`server/src/test/java/in/gullak/jobs/OffTrackPushJobApiTest.java`:

```java
package in.gullak.jobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.common.time.Ist;
import in.gullak.gamification.ClosedDay;
import in.gullak.gamification.DailyCloseService;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;

@Import(OffTrackPushJobApiTest.Stub.class)
class OffTrackPushJobApiTest extends ApiTest {
    static class StubCheck implements OffTrackCheck {
        final Set<UUID> off = ConcurrentHashMap.newKeySet();

        @Override
        public boolean isOffTrack(UUID userId, LocalDate date) {
            return off.contains(userId);
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Stub {
        @Bean
        @Primary
        StubCheck stubOffTrackCheck() {
            return new StubCheck();
        }
    }

    @Autowired OffTrackPushJob job;
    @Autowired StubCheck offTrack;
    @Autowired DailyCloseService closes;

    private void closeAndRun(TestUser u, LocalDate day) {
        closes.close(new ClosedDay(u.id(), day, 50_000, 60_000));
        clock.set(Ist.startOf(day.plusDays(1)).plus(Duration.ofMinutes(20)));
        job.runFor(day);
    }

    private long offTrackRows(TestUser u) {
        return jdbc.sql("select count(*) from push_outbox where user_id = ? and kind = 'OFF_TRACK'").param(u.id())
            .query(Long.class).single();
    }

    @Test
    void offTrackOnThreeClosesInARowPushesOnceThenAgainAfterThreeDays() throws Exception { // JOB-04
        TestUser u = gameUser();
        offTrack.off.add(u.id());
        closeAndRun(u, LocalDate.of(2026, 10, 23));
        closeAndRun(u, LocalDate.of(2026, 10, 24));
        closeAndRun(u, LocalDate.of(2026, 10, 25));
        assertThat(offTrackRows(u)).isEqualTo(1);
        assertThat(jdbc.sql("select due_at from push_outbox where user_id = ? and kind = 'OFF_TRACK'").param(u.id())
            .query(OffsetDateTime.class).single().toInstant()).isEqualTo(Instant.parse("2026-10-24T01:30:00Z")); // 07:00 IST
        closeAndRun(u, LocalDate.of(2026, 10, 26)); // 27 Oct 00:20: 72 hours after the first
        assertThat(offTrackRows(u)).isEqualTo(2);
    }

    @Test
    void onTrackSendsNothing() throws Exception {
        TestUser u = gameUser();
        closeAndRun(u, LocalDate.of(2026, 10, 23));
        assertThat(offTrackRows(u)).isZero();
    }

    @Test
    void switchedOffSendsNothing() throws Exception { // JOB-07
        TestUser u = gameUser();
        offTrack.off.add(u.id());
        mvc.perform(patch("/api/v1/me/notifications").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"offTrack\":false}")).andExpect(status().isOk());
        closeAndRun(u, LocalDate.of(2026, 10, 23));
        assertThat(offTrackRows(u)).isZero();
    }

    @Test
    void aDayThatWasNotClosedSendsNothing() throws Exception {
        TestUser u = gameUser();
        offTrack.off.add(u.id());
        clock.set(Ist.startOf(LocalDate.of(2026, 10, 24)).plus(Duration.ofMinutes(20)));
        job.runFor(LocalDate.of(2026, 10, 23));
        assertThat(offTrackRows(u)).isZero();
    }

    @Test
    void aRerunOfTheSameNightQueuesNothingNew() throws Exception {
        TestUser u = gameUser();
        offTrack.off.add(u.id());
        closeAndRun(u, LocalDate.of(2026, 10, 23));
        job.runFor(LocalDate.of(2026, 10, 23));
        assertThat(offTrackRows(u)).isEqualTo(1);
    }
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.notify.WinPushApiTest' --tests 'in.gullak.jobs.OffTrackPushJobApiTest'`
Expected: compilation fails (`WinEarned`, `OffTrackCheck`, `OffTrackPushJob` missing).

- [ ] **Step 4: Win events**

`server/src/main/java/in/gullak/common/game/WinEarned.java`:

```java
package in.gullak.common.game;

import java.util.UUID;

/**
 * Something worth a push was earned. Published by gamification (celebrations) and goals (milestones) inside their
 * own transactions; notify plans the push after commit. {@code kind} is a CelebrationKind name or GOAL_MILESTONE;
 * for a goal, {@code value} is "goalId:percent".
 */
public record WinEarned(UUID userId, String kind, String value) {}
```

In `server/src/main/java/in/gullak/gamification/CelebrationService.java`, add `ApplicationEventPublisher events` as a constructor parameter and field (import `org.springframework.context.ApplicationEventPublisher`, `in.gullak.common.game.WinEarned`) and replace `record` with:

```java
    /** True when this (kind, value) is new for the user; a repeat is ignored. A new one is announced for pushes. */
    @Transactional
    public boolean record(UUID userId, CelebrationKind kind, String value) {
        boolean added = celebrations.insertIfAbsent(UUID.randomUUID(), userId, kind.name(), value, clock.instant()) == 1;
        if (added) {
            events.publishEvent(new WinEarned(userId, kind.name(), value));
        }
        return added;
    }
```

In Plan 5's goal-milestone method (the one that logs `Events.GOAL_MILESTONE`), inject `ApplicationEventPublisher events` through the constructor and add right after that log line, using the method's own user id, goal id and percent variables:

```java
        events.publishEvent(new WinEarned(userId, "GOAL_MILESTONE", goalId + ":" + percent));
```

`server/src/main/java/in/gullak/notify/WinPushListener.java`:

```java
package in.gullak.notify;

import in.gullak.common.game.WinEarned;
import in.gullak.common.log.Events;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Plans a push once the win's own transaction has committed (a rolled-back win never pushes), in a new transaction
 * of its own. A failure here is a WARN and never reaches the request or job that earned the win.
 */
@Component
class WinPushListener {
    private static final Logger log = LoggerFactory.getLogger(WinPushListener.class);

    private final PushPlanner planner;
    private final TransactionTemplate ownTransaction;

    WinPushListener(PushPlanner planner, PlatformTransactionManager transactions) {
        this.planner = planner;
        this.ownTransaction = new TransactionTemplate(transactions);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void on(WinEarned win) {
        PushKind kind = switch (win.kind()) {
            case "LEVEL_UP" -> PushKind.LEVEL_UP;
            case "BADGE" -> PushKind.BADGE;
            case "STREAK_MILESTONE" -> PushKind.STREAK_MILESTONE;
            case "GOAL_MILESTONE" -> PushKind.GOAL_MILESTONE;
            default -> null; // STREAK_DAY and STAGE_UP are shown in the app only
        };
        if (kind == null) {
            return;
        }
        String key = kind.name().toLowerCase(Locale.ROOT) + ":" + win.value();
        try {
            ownTransaction.executeWithoutResult(s -> planner.plan(win.userId(), kind, key, win.value()));
        } catch (DataAccessException | TransactionException e) {
            log.warn("{} user={} kind={}", Events.PUSH_PLAN_FAILED, win.userId(), kind);
        }
    }
}
```

Append to `Events.java`:

```java
    public static final String PUSH_PLAN_FAILED = "push.plan_failed";
```

- [ ] **Step 5: The off-track job**

`server/src/main/java/in/gullak/jobs/OffTrackCheck.java`:

```java
package in.gullak.jobs;

import java.time.LocalDate;
import java.util.UUID;

/** Job-local view of Plan 7's forecast, so this job's tests do not depend on insights' internals. */
interface OffTrackCheck {
    boolean isOffTrack(UUID userId, LocalDate date);
}
```

`server/src/main/java/in/gullak/jobs/InsightsOffTrackCheck.java`:

```java
package in.gullak.jobs;

import in.gullak.goals.GoalService;
import in.gullak.goals.GoalStatus;
import in.gullak.insights.InsightsService;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The only place Plans 5 and 7 are named in this job. Spec 2.7: off track when the forecast cycle spend is above
 * spendable (Plan 7, decided as of yesterday, the day the close just ran) or a deadline goal is behind (Plan 5).
 */
@Component
class InsightsOffTrackCheck implements OffTrackCheck {
    private final InsightsService insights;
    private final GoalService goals;

    InsightsOffTrackCheck(InsightsService insights, GoalService goals) {
        this.insights = insights;
        this.goals = goals;
    }

    @Override
    public boolean isOffTrack(UUID userId, LocalDate date) {
        return insights.offTrack(userId) || goalBehind(userId);
    }

    private boolean goalBehind(UUID userId) {
        return goals.list(userId).goals().stream()
            .anyMatch(g -> g.status() == GoalStatus.ACTIVE && g.behindPaise() > 0);
    }
}
```

`server/src/test/java/in/gullak/jobs/InsightsOffTrackCheckApiTest.java` (the real adapter, against Plans 5 and 7):

```java
package in.gullak.jobs;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.common.time.Ist;
import in.gullak.goals.GoalService;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class InsightsOffTrackCheckApiTest extends ApiTest {
    @Autowired InsightsOffTrackCheck check;
    @Autowired GoalService goals;

    @Test
    void aGoalBehindIsOffTrackEvenWhenSpendingIsCalm() throws Exception { // JOB-04, the goal half of spec 2.7
        TestUser u = exampleUser();
        LocalDate yesterday = Ist.today(clock).minusDays(1);
        assertThat(check.isOffTrack(u.id(), yesterday)).isFalse();
        String id = createGoal(u, "Goa trip", 1_800_000, "2027-03", "FLEXIBLE");
        goals.devFallBehind(u.id(), UUID.fromString(id));
        assertThat(check.isOffTrack(u.id(), yesterday)).isTrue();
    }
}
```

The spending half is covered by Plan 7's `offTrackIsDecidedOnYesterday`; this test pins the OR.

`server/src/main/java/in/gullak/jobs/OffTrackPushJob.java`:

```java
package in.gullak.jobs;

import in.gullak.common.jobs.JobResult;
import in.gullak.common.jobs.JobRunner;
import in.gullak.common.time.Ist;
import in.gullak.gamification.DailyCloseService;
import in.gullak.notify.PushPlanner;
import in.gullak.profile.ProfileService;
import java.time.Clock;
import java.time.LocalDate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 00:20 IST, after the 00:05 daily close (spec 2.7): for every user whose yesterday was closed and who is off track,
 * plan one off-track push, at most once per 3 days. Quiet hours hold it until 07:00. Idempotent per (user, date).
 */
@Component
class OffTrackPushJob {
    static final String NAME = "off-track-push";

    private final JobRunner runner;
    private final ProfileService profiles;
    private final DailyCloseService closes;
    private final OffTrackCheck offTrack;
    private final PushPlanner planner;
    private final Clock clock;

    OffTrackPushJob(JobRunner runner, ProfileService profiles, DailyCloseService closes, OffTrackCheck offTrack,
                    PushPlanner planner, Clock clock) {
        this.runner = runner;
        this.profiles = profiles;
        this.closes = closes;
        this.offTrack = offTrack;
        this.planner = planner;
        this.clock = clock;
    }

    @Scheduled(cron = "0 20 0 * * *", zone = "Asia/Kolkata")
    public void scheduled() {
        runFor(Ist.today(clock).minusDays(1));
    }

    JobResult runFor(LocalDate date) {
        return runner.run(NAME, date.toString(),
            () -> profiles.userIdsSetUpBefore(Ist.startOf(date.plusDays(1))),
            userId -> {
                if (closes.find(userId, date).isPresent() && offTrack.isOffTrack(userId, date)) {
                    planner.planOffTrack(userId, date);
                }
            });
    }
}
```

In `ArchitectureTest.ALLOWED_FEATURE_DEPENDENCIES`, make sure `jobs` contains `"notify"`, `"insights"` and `"goals"`.

In `docs/engineering-standards.md` section 1, append to the event vocabulary: `mail.sent`, `mail.retry`, `mail.gave_up`, `mail.queued`, `mail.failed`, `consent.recorded`, `account.locked_sign_in`, `account.deleted`, `export.downloaded`, `push.token.registered`, `push.token.removed`, `push.queued`, `push.dropped`, `push.retry`, `push.gave_up`, `push.failed`, `push.plan_failed`.

- [ ] **Step 6: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.notify.*' --tests 'in.gullak.jobs.*' --tests 'in.gullak.gamification.*' --tests 'in.gullak.rules.*'`
Expected: PASS.

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 7: Update the test-cases doc**

Add after JOB-17:
`| JOB-18 | Win pushes | a level-up, a badge and a streak milestone recorded | one push each, planned after commit; a rolled-back celebration, a streak day and a stage-up push nothing |`

- [ ] **Step 8: Red team and commit**

Dispatch `red-team` with task id `plan-08-task-10`: run the off-track job three nights in a row, re-run each night twice, and count pushes; switch off-track off between the close and 00:20; roll back a transaction that recorded a celebration; make the outbox insert fail during a spend that levels up and confirm the spend still succeeds. Report to `docs/reports/red-team/plan-08-task-10.md`.

```bash
git add server/src/main/java/in/gullak/common/game/WinEarned.java server/src/main/java/in/gullak/gamification/CelebrationService.java server/src/main/java/in/gullak/goals server/src/main/java/in/gullak/notify/WinPushListener.java server/src/main/java/in/gullak/jobs server/src/main/java/in/gullak/common/log/Events.java docs/engineering-standards.md server/src/test/java/in/gullak/notify/WinPushApiTest.java server/src/test/java/in/gullak/jobs/OffTrackPushJobApiTest.java server/src/test/java/in/gullak/rules/ArchitectureTest.java docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/reports/red-team/plan-08-task-10.md
git commit -m "feat(server): off-track push after the close at most every 3 days; level-up, badge, streak and goal pushes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: App: the consent screen, the in-app privacy policy, and routing on account state

**Owner:** app-engineer. **Test IDs:** new APP-45 (consent screen and routing), spec 4.7 DPDP (consent screen at sign-up with the purpose, the version recorded and the privacy policy), spec 3.2 item 9 (privacy policy), E2E-01 (consent step added). **Red team:** yes (skipping consent by deep link; an old app build posting an old version; a locked account still seeing cached screens).

Copy (new; checked against `.claude/design.md`): title "Before we start"; body "Gullak uses your email and the money you log for one thing: working out your daily budget. We never sell it or use it for ads."; points "What we keep" / "Your email, income, fixed costs, savings, spends, goals and the statement lines you upload", "Where" / "On servers in India", "Your control" / "Download everything or delete your account from Me at any time"; buttons "Read the privacy policy", "I agree", "Sign out"; caption "By agreeing you confirm you're 18 or older. Privacy policy version 2026-10."; error messages "This account is being deleted. Use the link we emailed you to restore it." (`ACCOUNT_LOCKED`), "Agree to the privacy policy to carry on" (`CONSENT_REQUIRED`), "That link has expired. Ask for a new one from Me." (`LINK_EXPIRED`).

**Files:**
- Create: `app/scripts/gen-privacy.mjs`; generated `app/src/features/account/privacy-policy.ts`
- Modify: `app/package.json` (script), `app/src/lib/error-codes.ts` (regenerated), `app/src/lib/errors.ts`
- Create: `app/src/lib/account-events.ts`
- Create: `app/src/features/account/api.ts`, `hooks.ts`, `entry.ts`, `screens/consent-screen.tsx`, `screens/privacy-screen.tsx`, `account.test.tsx`
- Create: `app/app/consent.tsx`, `app/app/privacy.tsx`
- Modify: `app/app/index.tsx` (whole file), `app/app/_layout.tsx`, `app/src/routing.test.tsx`, `app/e2e/setup.yaml`

**Interfaces:**
- Consumes: `GET /me/account`, `POST /me/consent`, `POST /me/export`, `DELETE /me`, `POST /me/restore` (Tasks 4, 5, 7); `api`, `ApiError`, `isApiError`, `describeError`, `messageFor`, `queryClient`, `useSession`, `useProfile`, `Screen`, `Text`, `Button`, `Icon`, `ErrorState` (Plan 2).
- Produces: `Account`, `AccountStatus`, `accountApi.get/consent/requestExport/remove/restore`; `accountKey`, `useAccount(options)`, `useConsent()`, `useRequestExport()`, `useDeleteAccount()`, `useRestore()`; `entryRoute(input) : Entry`; `PRIVACY_POLICY`, `CONSENT_VERSION`; `accountEvents.on/emit`, `reportAccountError(error)`, `watchAccountErrors(client)`; `ConsentScreen`, `PrivacyScreen`; routes `/consent`, `/privacy`.

- [ ] **Step 1: The privacy policy generator**

`app/scripts/gen-privacy.mjs`:

```js
#!/usr/bin/env node
// Turns docs/privacy-policy.md into src/features/account/privacy-policy.ts, so the app shows exactly the text the
// server's consent version points at. Run from app/: npm run gen:privacy
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "..", "docs", "privacy-policy.md"), "utf8");
const lines = source.split(/\r?\n/);
const title = (lines.find((l) => l.startsWith("# ")) ?? "# Privacy policy").slice(2).trim();
const version = /^Version: (\S+)$/m.exec(source)?.[1];
if (!version) throw new Error("docs/privacy-policy.md needs a 'Version: ...' line");

const plain = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
const sections = [];
let current = null;
let para = [];
const flush = () => {
  if (para.length && current) current.blocks.push({ kind: "p", text: plain(para.join(" ")) });
  para = [];
};
for (const raw of lines) {
  const line = raw.trim();
  if (line.startsWith("## ")) {
    flush();
    current = { heading: line.slice(3), blocks: [] };
    sections.push(current);
  } else if (line.startsWith("- ")) {
    flush();
    if (current) current.blocks.push({ kind: "li", text: plain(line.slice(2)) });
  } else if (line === "") {
    flush();
  } else if (current) {
    para.push(line);
  }
}
flush();

const out =
  "// Generated by scripts/gen-privacy.mjs from docs/privacy-policy.md. Do not edit by hand.\n" +
  'export type PolicyBlock = { kind: "p" | "li"; text: string };\n' +
  "export type PolicySection = { heading: string; blocks: PolicyBlock[] };\n\n" +
  `export const PRIVACY_POLICY: { title: string; version: string; sections: PolicySection[] } = ${JSON.stringify({ title, version, sections }, null, 2)};\n\n` +
  "/** The policy version the consent screen shows and posts (spec 4.7). */\n" +
  "export const CONSENT_VERSION = PRIVACY_POLICY.version;\n";
writeFileSync(join(here, "..", "src", "features", "account", "privacy-policy.ts"), out);
process.stdout.write(`privacy-policy.ts: version ${version}, ${sections.length} sections\n`);
```

In `app/package.json` `scripts`, add `"gen:privacy": "node scripts/gen-privacy.mjs && prettier --write src/features/account/privacy-policy.ts"`.

Run: `cd app && mkdir -p src/features/account && npm run gen:privacy`
Expected: `privacy-policy.ts: version 2026-10, 8 sections`.

- [ ] **Step 2: Error codes and messages**

Run: `cd app && node scripts/gen-error-codes.mjs` (picks up `ACCOUNT_LOCKED`, `CONSENT_REQUIRED`, `LINK_EXPIRED`).

In `app/src/lib/errors.ts`, add to `messages`:

```ts
  ACCOUNT_LOCKED: "This account is being deleted. Use the link we emailed you to restore it.",
  CONSENT_REQUIRED: "Agree to the privacy policy to carry on",
  LINK_EXPIRED: "That link has expired. Ask for a new one from Me.",
```

- [ ] **Step 3: Write the failing tests**

`app/src/features/account/account.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { readFileSync } from "fs";
import { join } from "path";
import React from "react";
import { ApiError } from "@/lib/api-errors";
import { accountEvents, reportAccountError, type AccountEvent } from "@/lib/account-events";
import type { Account } from "./api";
import { entryRoute } from "./entry";
import { CONSENT_VERSION, PRIVACY_POLICY } from "./privacy-policy";
import { ConsentScreen } from "./screens/consent-screen";
import { PrivacyScreen } from "./screens/privacy-screen";

const account = (over: Partial<Account> = {}): Account => ({
  email: "priya@example.test",
  status: "ACTIVE",
  consentVersion: "2026-10",
  consentedAt: "2026-10-23T08:00:00Z",
  currentConsentVersion: "2026-10",
  deletionRequestedAt: null,
  supportEmail: "help@example.test",
  ...over,
});

describe("entryRoute (APP-45)", () => {
  it("sends a signed-out person to login", () => {
    expect(entryRoute({ signedIn: false, account: undefined, profileMissing: undefined })).toBe("/login");
  });
  it("waits for the account before deciding", () => {
    expect(entryRoute({ signedIn: true, account: undefined, profileMissing: undefined })).toBeNull();
  });
  it("asks for consent after the first sign-in and before setup", () => {
    expect(entryRoute({ signedIn: true, account: account({ consentVersion: null, consentedAt: null }), profileMissing: undefined })).toBe("/consent");
  });
  it("asks again when the policy has a new version", () => {
    expect(entryRoute({ signedIn: true, account: account({ consentVersion: "2025-01" }), profileMissing: false })).toBe("/consent");
  });
  it("goes to setup without a profile and home with one", () => {
    expect(entryRoute({ signedIn: true, account: account(), profileMissing: true })).toBe("/onboarding/income");
    expect(entryRoute({ signedIn: true, account: account(), profileMissing: false })).toBe("/(tabs)");
  });
});

describe("ConsentScreen (APP-45)", () => {
  it("states the purpose and the version, and every action works", () => {
    const onAgree = jest.fn();
    const onSignOut = jest.fn();
    const onOpenPolicy = jest.fn();
    render(<ConsentScreen busy={false} onAgree={onAgree} onSignOut={onSignOut} onOpenPolicy={onOpenPolicy} />);
    expect(screen.getByText("Before we start")).toBeTruthy();
    expect(screen.getByText(/one thing: working out your daily budget/)).toBeTruthy();
    expect(screen.getByText(`By agreeing you confirm you're 18 or older. Privacy policy version ${CONSENT_VERSION}.`)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Read the privacy policy" }));
    fireEvent.press(screen.getByRole("button", { name: "I agree" }));
    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(onOpenPolicy).toHaveBeenCalledTimes(1);
    expect(onAgree).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("shows a failure inline, not as a toast", () => {
    render(<ConsentScreen busy={false} error="Update the app to see the current privacy policy" onAgree={jest.fn()} onSignOut={jest.fn()} onOpenPolicy={jest.fn()} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Update the app to see the current privacy policy")).toBeTruthy();
  });
});

describe("privacy policy", () => {
  it("is generated from docs/privacy-policy.md at its current version", () => {
    const doc = readFileSync(join(__dirname, "..", "..", "..", "..", "docs", "privacy-policy.md"), "utf8");
    expect(doc).toContain(`Version: ${PRIVACY_POLICY.version}`);
    const headings = doc.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
    expect(PRIVACY_POLICY.sections.map((s) => s.heading)).toEqual(headings);
  });

  it("renders every section with a way back", () => {
    const onBack = jest.fn();
    render(<PrivacyScreen onBack={onBack} />);
    for (const s of PRIVACY_POLICY.sections) expect(screen.getByText(s.heading)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("account events", () => {
  it("turns the gate's 403s into events and ignores everything else", () => {
    const seen: AccountEvent[] = [];
    const off = accountEvents.on((e) => seen.push(e));
    reportAccountError(new ApiError("ACCOUNT_LOCKED", 403, "x"));
    reportAccountError(new ApiError("CONSENT_REQUIRED", 403, "x"));
    reportAccountError(new ApiError("FORBIDDEN", 403, "x"));
    reportAccountError(new ApiError("ACCOUNT_LOCKED", 401, "x"));
    reportAccountError(new Error("boom"));
    off();
    reportAccountError(new ApiError("ACCOUNT_LOCKED", 403, "x"));
    expect(seen).toEqual(["locked", "consentRequired"]);
  });
});
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd app && npx jest src/features/account`
Expected: FAIL (modules missing).

- [ ] **Step 5: Write the code**

`app/src/lib/account-events.ts`:

```ts
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-errors";

export type AccountEvent = "locked" | "consentRequired";
type Listener = (event: AccountEvent) => void;

const listeners = new Set<Listener>();

/** The server's account gate (403 ACCOUNT_LOCKED / CONSENT_REQUIRED) as app-wide events; the root layout routes them. */
export const accountEvents = {
  on(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  emit(event: AccountEvent): void {
    listeners.forEach((l) => l(event));
  },
};

export function reportAccountError(error: unknown): void {
  if (!(error instanceof ApiError) || error.status !== 403) return;
  if (error.code === "ACCOUNT_LOCKED") accountEvents.emit("locked");
  else if (error.code === "CONSENT_REQUIRED") accountEvents.emit("consentRequired");
}

/** Watches every query and mutation failure. Returns the unsubscribe function. */
export function watchAccountErrors(client: QueryClient): () => void {
  const queries = client.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "error") reportAccountError(event.action.error);
  });
  const mutations = client.getMutationCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "error") reportAccountError(event.action.error);
  });
  return () => {
    queries();
    mutations();
  };
}
```

`app/src/features/account/api.ts`:

```ts
import { api } from "@/lib/client";

export type AccountStatus = "ACTIVE" | "LOCKED";

export type Account = {
  email: string;
  status: AccountStatus;
  consentVersion: string | null;
  consentedAt: string | null;
  currentConsentVersion: string;
  deletionRequestedAt: string | null;
  supportEmail: string;
};

export type ConsentRecord = { version: string; consentedAt: string };

export const accountApi = {
  get: () => api.get<Account>("/me/account"),
  consent: (version: string) => api.post<ConsentRecord>("/me/consent", { version }),
  requestExport: () => api.post<{ expiresAt: string }>("/me/export"),
  remove: () => api.del<{ deletionDate: string }>("/me"),
  /** Public: the emailed token is the only credential. */
  restore: (token: string) => api.post<{ status: AccountStatus }>("/me/restore", { token }, { auth: false }),
};
```

`app/src/features/account/hooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountApi, type Account } from "./api";

export const accountKey = ["account"] as const;

export function useAccount(options: { enabled?: boolean } = {}) {
  return useQuery<Account>({ queryKey: accountKey, queryFn: accountApi.get, enabled: options.enabled ?? true, staleTime: 5 * 60_000 });
}

export function useConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => accountApi.consent(version),
    onSuccess: (record) => {
      qc.setQueryData<Account>(accountKey, (old) => (old ? { ...old, consentVersion: record.version, consentedAt: record.consentedAt } : old));
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== accountKey[0] });
    },
  });
}

export function useRequestExport() {
  return useMutation({ mutationFn: accountApi.requestExport });
}

export function useDeleteAccount() {
  return useMutation({ mutationFn: accountApi.remove });
}

export function useRestore() {
  return useMutation({ mutationFn: (token: string) => accountApi.restore(token) });
}
```

`app/src/features/account/entry.ts`:

```ts
import type { Account } from "./api";

export type Entry = "/login" | "/consent" | "/onboarding/income" | "/(tabs)" | null;

export type EntryInput = {
  signedIn: boolean;
  account: Account | undefined;
  /** undefined while the profile is loading or not yet asked for. */
  profileMissing: boolean | undefined;
};

/** Where the app opens (spec 4.7: consent after first sign-in and before setup). null: still loading. */
export function entryRoute(i: EntryInput): Entry {
  if (!i.signedIn) return "/login";
  if (!i.account) return null;
  if (i.account.consentVersion !== i.account.currentConsentVersion) return "/consent";
  if (i.profileMissing === undefined) return null;
  return i.profileMissing ? "/onboarding/income" : "/(tabs)";
}
```

`app/src/features/account/screens/consent-screen.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { colors, spacing } from "@/theme";
import { CONSENT_VERSION } from "../privacy-policy";

const points = [
  { title: "What we keep", body: "Your email, income, fixed costs, savings, spends, goals and the statement lines you upload" },
  { title: "Where", body: "On servers in India" },
  { title: "Your control", body: "Download everything or delete your account from Me at any time" },
];

type Props = { busy: boolean; error?: string; onAgree: () => void; onSignOut: () => void; onOpenPolicy: () => void };

/** DPDP consent (spec 4.7): purpose, what is kept, where, the user's control, the version, and the full policy. */
export function ConsentScreen({ busy, error, onAgree, onSignOut, onOpenPolicy }: Props) {
  return (
    <Screen
      testID="consent"
      footer={
        <View style={{ gap: spacing.sm }}>
          {error ? (
            <Text variant="label" color={colors.bad} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button title="I agree" onPress={onAgree} loading={busy} />
          <Button title="Sign out" variant="ghost" onPress={onSignOut} disabled={busy} />
        </View>
      }
    >
      <Text variant="heading" accessibilityRole="header">
        Before we start
      </Text>
      <Text variant="body">
        Gullak uses your email and the money you log for one thing: working out your daily budget. We never sell it or use it for ads.
      </Text>
      {points.map((p) => (
        <View key={p.title} style={{ gap: spacing.xs }}>
          <Text variant="bodyStrong">{p.title}</Text>
          <Text variant="bodyMuted">{p.body}</Text>
        </View>
      ))}
      <Button title="Read the privacy policy" variant="secondary" onPress={onOpenPolicy} />
      <Text variant="caption">{`By agreeing you confirm you're 18 or older. Privacy policy version ${CONSENT_VERSION}.`}</Text>
    </Screen>
  );
}
```

`app/src/features/account/screens/privacy-screen.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { spacing } from "@/theme";
import { PRIVACY_POLICY } from "../privacy-policy";

/** The full policy, bundled with the app (works offline; generated from docs/privacy-policy.md). */
export function PrivacyScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen testID="privacy">
      <View style={{ alignSelf: "flex-start" }}>
        <Button title="Back" variant="ghost" icon={<Icon name="left" size={20} />} iconOnly onPress={onBack} />
      </View>
      <Text variant="heading" accessibilityRole="header">
        {PRIVACY_POLICY.title}
      </Text>
      <Text variant="caption">{`Version ${PRIVACY_POLICY.version}`}</Text>
      {PRIVACY_POLICY.sections.map((s) => (
        <View key={s.heading} style={{ gap: spacing.sm }}>
          <Text variant="title" accessibilityRole="header">
            {s.heading}
          </Text>
          {s.blocks.map((b, i) => (
            <Text key={`${s.heading}-${i}`} variant="body">
              {b.kind === "li" ? `•  ${b.text}` : b.text}
            </Text>
          ))}
        </View>
      ))}
    </Screen>
  );
}
```

`app/app/consent.tsx`:

```tsx
import { router } from "expo-router";
import React from "react";
import { useConsent } from "@/features/account/hooks";
import { CONSENT_VERSION } from "@/features/account/privacy-policy";
import { ConsentScreen } from "@/features/account/screens/consent-screen";
import { useSession } from "@/features/auth/session";
import { describeError, isApiError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

/** A 400 on the version means this build shows an older policy: say so instead of "Check the highlighted fields". */
function consentError(e: unknown): string {
  if (isApiError(e, "VALIDATION") && e.fields[0]) return e.fields[0].message;
  return describeError(e, messageFor);
}

export default function ConsentRoute() {
  const { signOut } = useSession();
  const consent = useConsent();
  return (
    <ConsentScreen
      busy={consent.isPending}
      error={consent.error ? consentError(consent.error) : undefined}
      onAgree={() => consent.mutate(CONSENT_VERSION, { onSuccess: () => router.replace("/") })}
      onSignOut={() => void signOut()}
      onOpenPolicy={() => router.push("/privacy")}
    />
  );
}
```

`app/app/privacy.tsx`:

```tsx
import { router } from "expo-router";
import React from "react";
import { PrivacyScreen } from "@/features/account/screens/privacy-screen";

export default function PrivacyRoute() {
  return <PrivacyScreen onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />;
}
```

`app/app/index.tsx` (whole file):

```tsx
import { Redirect } from "expo-router";
import React from "react";
import { View } from "react-native";
import { ErrorState } from "@/components/ui/error-state";
import { entryRoute } from "@/features/account/entry";
import { useAccount } from "@/features/account/hooks";
import { useSession } from "@/features/auth/session";
import { useProfile } from "@/features/profile/hooks";
import { colors, spacing } from "@/theme";

export default function Index() {
  const { status } = useSession();
  const signedIn = status === "signedIn";
  const account = useAccount({ enabled: signedIn });
  const consented = account.data !== undefined && account.data.consentVersion === account.data.currentConsentVersion;
  const profile = useProfile({ enabled: signedIn && consented });
  if (status === "signedOut") return <Redirect href="/login" />;
  const failed = account.error ?? (consented ? profile.error : null);
  if (failed) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: spacing.md, backgroundColor: colors.ground }}>
        <ErrorState
          body="Could not load your account"
          onRetry={() => {
            void account.refetch();
            if (consented) void profile.refetch();
          }}
        />
      </View>
    );
  }
  const to = entryRoute({
    signedIn,
    account: account.data,
    profileMissing: !consented || profile.data === undefined ? undefined : profile.data === null,
  });
  return to ? <Redirect href={to} /> : null;
}
```

In `app/app/_layout.tsx`:

- add imports `import { useRouter } from "expo-router";` (merge with the existing `expo-router` import) and `import { accountEvents, watchAccountErrors } from "@/lib/account-events";` (`queryClient` and `useSession` are already imported);
- inside `Navigation`'s `Stack`, add `<Stack.Screen name="privacy" />` next to `+not-found` (outside the guards: readable signed in or out) and `<Stack.Screen name="consent" />` as the first screen of the `status === "signedIn"` group;
- add this component below `Gate`:

```tsx
/** Routes the server's account gate: consent missing → the consent screen; account locked → signed out. */
function AccountEventsBridge() {
  const { status, signOut } = useSession();
  const router = useRouter();
  useEffect(() => watchAccountErrors(queryClient), []);
  useEffect(
    () =>
      accountEvents.on((event) => {
        if (status !== "signedIn") return;
        if (event === "consentRequired") router.replace("/consent");
        else void signOut(); // locked: the server has already revoked every session
      }),
    [status, signOut, router],
  );
  return null;
}
```

- and render it next to the navigator: replace `<Navigation />` inside `<Gate …>` with:

```tsx
                <>
                  <Navigation />
                  <AccountEventsBridge />
                </>
```

In `app/src/routing.test.tsx`, add next to the existing `useProfile` mock:

```tsx
jest.mock("@/features/account/hooks", () => ({
  useAccount: () => ({
    data: { email: "priya@example.test", status: "ACTIVE", consentVersion: "2026-10", consentedAt: "2026-10-23T08:00:00Z", currentConsentVersion: "2026-10", deletionRequestedAt: null, supportEmail: "help@example.test" },
    error: null,
    isLoading: false,
    refetch: jest.fn(),
  }),
}));
```

In `app/e2e/setup.yaml`, insert after `- inputText: ${output.code}`:

```yaml
- assertVisible: "Before we start"
- tapOn: "I agree"
```

- [ ] **Step 6: Run the tests**

Run: `cd app && npx jest src/features/account src/routing.test.tsx && npm run lint && npm run typecheck`
Expected: PASS.

Then: `cd app && npm test`
Expected: PASS.

- [ ] **Step 7: Use it**

Server up (`local`), fresh email: sign in → "Before we start" → "Read the privacy policy" shows the policy and Back returns → "I agree" → setup step 1. Kill and reopen: straight to setup (consent remembered). In psql set `consent_version = '2025-01'` for the user and pull to refresh Home: the app moves to the consent screen.

- [ ] **Step 8: Update the test-cases doc and commit**

Add after APP-44 (Plan 7's last row):
`| APP-45 | Consent | first sign-in → consent screen before setup with purpose, version and policy link; "I agree" records it and moves on; a 403 CONSENT_REQUIRED anywhere returns to it |`

Dispatch `red-team` with task id `plan-08-task-11`: deep link to `gullak://(tabs)` and `gullak://onboarding/income` before consenting (the server must refuse every call; the screens must show errors, not data); post an old version; lock the account from another device and keep using this one. Report to `docs/reports/red-team/plan-08-task-11.md`.

```bash
git add app/scripts/gen-privacy.mjs app/package.json app/src/lib app/src/features/account app/app/consent.tsx app/app/privacy.tsx app/app/index.tsx app/app/_layout.tsx app/src/routing.test.tsx app/e2e/setup.yaml docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/reports/red-team/plan-08-task-11.md
git commit -m "feat(app): consent screen before setup, in-app privacy policy, routing on the account gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: App: Me from the mockup, profile editing, help and contact

**Owner:** app-engineer. **Test IDs:** APP-26 (Me shell and sign-out), new APP-46 (profile editing from Me), APP-29 (new controls), ERR-13 (Me and edit screens: loading, error, empty), spec 3.2 item 9 (sign out, help and contact, privacy policy, consent record), ux finding 12. **Red team:** no (screens over endpoints already attacked in Plans 1, 2 and Task 4; no new data path).

Copy from `Me.dc.html`, verbatim: title "Me"; level card "Level 3 · Clay pot" and "1,240 XP · 6 of 10 badges" (the user's real figures); groups "Budget" (rows "Take-home pay", "Fixed costs", "Payday" with "1st of the month", "Monthly savings") and "Gullak" (rows "Personality", "Daily messages" with "8:00 am, 10:00 pm"). New copy (spec 3.2 item 9; checked against `.claude/design.md`): group "Help" with "Help and contact" and "Privacy policy"; "You agreed to the privacy policy (version 2026-10) on Fri, 23 Oct"; "Signed in as priya@example.test"; edit screens "Income and payday", "Monthly savings", "Gullak", "Fixed costs" with "Save" / "Done"; payday note "The new payday starts with your next cycle. This cycle keeps its dates."; savings nudge "No savings this month. You can set a target here any time."; "Lower your savings first"; Gullak caption "Your phone shows these two messages at the times you pick"; Help: "How is my daily budget worked out?" / "Take-home pay minus fixed costs and savings, spread over the days left until payday. Money you don't spend today rolls into tomorrow.", "Does Gullak move my money?" / "No. It only keeps the plan. Your money stays in your bank.", "Who can see my data?" / "Only you. We never sell it or use it for ads.", "Email us", "Write to help@…"; level card failure "Couldn't load your level" with "Try again". The sign-out confirmation keeps Plan 2's copy.

**Files:**
- Create: `app/src/features/profile/me-format.ts`, `me-fixtures.ts`, `me-format.test.ts`
- Create: `app/src/features/profile/components/me-row.tsx` (`MeGroup`, `MeRow`, `EditHeader`), `level-card.tsx`, `profile-gate.tsx`
- Replace: `app/src/features/profile/screens/me-screen.tsx`
- Create: `app/src/features/profile/screens/edit-income-screen.tsx`, `edit-savings-screen.tsx`, `edit-gullak-screen.tsx`, `help-screen.tsx`, `me.test.tsx`, `edit-profile.test.tsx`
- Modify: `app/src/features/profile/screens/fixed-costs-screen.tsx` (a `mode` prop)
- Modify: `app/app/(tabs)/me.tsx` (whole file), `app/app/_layout.tsx`
- Create: `app/app/me/_layout.tsx`, `income.tsx`, `fixed-costs.tsx`, `savings.tsx`, `gullak.tsx`, `help.tsx`

**Interfaces:**
- Consumes: `useAccount`, `Account` (Task 11); `useProgress` (`@/features/game/hooks`), `Progress`, `BadgeCode`, `fromServerStage` (`@/features/game/api`) (Plan 6); `stageLabels` (`@/features/gullak/stage`), `Gullak` (`@/features/gullak/gullak`), `PaydayPicker`, `PaydayValue`, `paydayIsComplete`, `SavingsStepper`, `RealityCheck`, `PersonalityPicker`, `personalities`, `TimePicker`, `morningOptions`, `nightOptions`, `FixedCostsScreen`, `useProfile`, `usePutProfile`, `useFixedCosts`, `Profile`, `ProfileRequest`, `Personality`, `realityCheck`, `perDayPreview`, `wholeRupees`, `parseRupeesToPaise`, `formatRupees`, `formatDay`, `todayIst`, `scheduleDaily`, `useToday` (Plan 2).
- Produces: `MeScreen(props: MeScreenProps)` with slots `notifications?` and `dataSection?` (Tasks 13 and 14 fill them), `MeHref`; `MeGroup`, `MeRow({label, value?, valueColor?, onPress, tone?, last?, testID?})`, `EditHeader({title, onBack})`; `LevelCard({onPress})`; `ProfileGate({children})`, `backToMe()`; `ordinal`, `paydayLabel`, `timeLabel`, `messagesLabel`, `levelLine`, `xpLine`, `consentLine`, `paydayOf`, `samePayday`, `toRequest(profile, change)`; `EditIncomeScreen`, `EditSavingsScreen`, `EditGullakScreen`, `HelpScreen`; routes `/me/income`, `/me/fixed-costs`, `/me/savings`, `/me/gullak`, `/me/help`; `FixedCostsScreen` prop `mode?: "setup" | "me"`.

- [ ] **Step 1: Write the failing tests**

`app/src/features/profile/me-fixtures.ts` (shared test data; not a test file, so importing it runs no tests):

```ts
import type { Account } from "@/features/account/api";
import type { BadgeCode, Progress } from "@/features/game/api";
import type { Profile } from "./api";

export const exampleProfile: Profile = {
  incomePaise: 5_000_000,
  savingsPaise: 2_000_000,
  paydayRule: "FIXED_DAY",
  paydayDay: 1,
  personality: "CHILL",
  morningTime: "08:00",
  nightTime: "22:00",
  timezone: "Asia/Kolkata",
};

export const exampleProgress: Progress = {
  xp: 1240,
  level: 3,
  stage: "CLAY",
  levelFloorXp: 900,
  nextLevelXp: 1600,
  toNextLevelPercent: 49,
  streak: { current: 5, best: 9, freezes: 1 },
  badges: Array.from({ length: 10 }, (_, i) => ({ code: "FIRST_LOG" as BadgeCode, earned: i < 6, earnedOn: null, progress: null, target: null })),
  challengeBadges: [],
  furthestGoal: null,
  challenge: null,
};

export const exampleAccount: Account = {
  email: "priya@example.test",
  status: "ACTIVE",
  consentVersion: "2026-10",
  consentedAt: "2026-10-23T08:00:00Z",
  currentConsentVersion: "2026-10",
  deletionRequestedAt: null,
  supportEmail: "help@example.test",
};
```

`app/src/features/profile/me-format.test.ts`:

```ts
import { exampleAccount, exampleProfile, exampleProgress } from "./me-fixtures";
import { consentLine, levelLine, messagesLabel, ordinal, paydayLabel, samePayday, toRequest, xpLine } from "./me-format";

describe("Me formatting", () => {
  it("writes ordinals the Indian-English way", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "28th"]);
  });
  it("labels payday and message times as the mockup does", () => {
    expect(paydayLabel(exampleProfile)).toBe("1st of the month");
    expect(paydayLabel({ ...exampleProfile, paydayRule: "LAST_WORKING_DAY", paydayDay: undefined })).toBe("Last working day");
    expect(messagesLabel(exampleProfile)).toBe("8:00 am, 10:00 pm");
    expect(messagesLabel({ ...exampleProfile, morningTime: "06:30", nightTime: "12:00" })).toBe("6:30 am, 12:00 pm");
  });
  it("writes the level card lines", () => {
    expect(levelLine(exampleProgress)).toBe("Level 3 · Clay pot");
    expect(xpLine(exampleProgress)).toBe("1,240 XP · 6 of 10 badges");
    expect(xpLine({ ...exampleProgress, xp: 125000 })).toBe("1,25,000 XP · 6 of 10 badges");
  });
  it("writes the consent record in IST", () => {
    expect(consentLine(exampleAccount)).toBe("You agreed to the privacy policy (version 2026-10) on Fri, 23 Oct");
    expect(consentLine({ ...exampleAccount, consentedAt: "2026-10-23T19:00:00Z" })).toBe("You agreed to the privacy policy (version 2026-10) on Sat, 24 Oct");
    expect(consentLine({ ...exampleAccount, consentVersion: null, consentedAt: null })).toBeNull();
  });
  it("builds a full profile request from one change", () => {
    expect(toRequest(exampleProfile, { incomePaise: 6_000_000 })).toEqual({ ...exampleProfile, incomePaise: 6_000_000 });
    const lwd = toRequest(exampleProfile, { payday: { rule: "LAST_WORKING_DAY" } });
    expect(lwd.paydayRule).toBe("LAST_WORKING_DAY");
    expect("paydayDay" in lwd).toBe(false);
    expect(samePayday({ rule: "FIXED_DAY", day: 1 }, { rule: "FIXED_DAY", day: 1 })).toBe(true);
    expect(samePayday({ rule: "FIXED_DAY", day: 1 }, { rule: "FIXED_DAY", day: 7 })).toBe(false);
  });
});
```

`app/src/features/profile/screens/me.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Text as RNText } from "react-native";
import { exampleAccount, exampleProfile, exampleProgress } from "../me-fixtures";
import { MeScreen, type MeScreenProps } from "./me-screen";

jest.mock("@/features/game/hooks", () => ({ useProgress: jest.fn() }));
jest.mock("@/features/gullak/gullak", () => ({ Gullak: () => null }));
import { useProgress } from "@/features/game/hooks";

const progressOk = { data: exampleProgress, isLoading: false, error: null, refetch: jest.fn() };

function renderMe(over: Partial<MeScreenProps> = {}) {
  const open = jest.fn();
  const signOut = jest.fn(() => Promise.resolve());
  const onRetry = jest.fn();
  render(
    <MeScreen profile={exampleProfile} loading={false} failed={false} onRetry={onRetry} fixedTotalPaise={1_500_000} account={exampleAccount} open={open} signOut={signOut} {...over} />,
  );
  return { open, signOut, onRetry };
}

beforeEach(() => (useProgress as jest.Mock).mockReturnValue(progressOk));

describe("Me (APP-26, APP-46)", () => {
  it("shows the mockup's rows with the user's own figures", () => {
    renderMe();
    expect(screen.getByText("Level 3 · Clay pot")).toBeTruthy();
    expect(screen.getByText("1,240 XP · 6 of 10 badges")).toBeTruthy();
    for (const [label, value] of [
      ["Take-home pay", "₹50,000"],
      ["Fixed costs", "₹15,000"],
      ["Payday", "1st of the month"],
      ["Monthly savings", "₹20,000"],
      ["Personality", "Chill friend"],
      ["Daily messages", "8:00 am, 10:00 pm"],
    ] as const) {
      expect(screen.getByRole("button", { name: `${label}, ${value}` })).toBeTruthy();
    }
  });

  it("opens each edit screen, badges, help and the privacy policy", () => {
    const { open } = renderMe();
    fireEvent.press(screen.getByRole("button", { name: "Take-home pay, ₹50,000" }));
    fireEvent.press(screen.getByRole("button", { name: "Fixed costs, ₹15,000" }));
    fireEvent.press(screen.getByRole("button", { name: "Monthly savings, ₹20,000" }));
    fireEvent.press(screen.getByRole("button", { name: "Daily messages, 8:00 am, 10:00 pm" }));
    fireEvent.press(screen.getByRole("button", { name: "Level 3 · Clay pot, 1,240 XP · 6 of 10 badges. Open badges" }));
    fireEvent.press(screen.getByRole("button", { name: "Help and contact" }));
    fireEvent.press(screen.getByRole("button", { name: "Privacy policy" }));
    expect(open.mock.calls.map((c) => c[0])).toEqual(["/me/income", "/me/fixed-costs", "/me/savings", "/me/gullak", "/badges", "/me/help", "/privacy"]);
  });

  it("shows the consent record and who is signed in", () => {
    renderMe();
    expect(screen.getByText("You agreed to the privacy policy (version 2026-10) on Fri, 23 Oct")).toBeTruthy();
    expect(screen.getByText("Signed in as priya@example.test")).toBeTruthy();
  });

  it("renders loading, error and not-set-up states (ERR-13)", () => {
    const { rerender } = render(<MeScreen profile={undefined} loading failed={false} onRetry={jest.fn()} fixedTotalPaise={undefined} account={undefined} open={jest.fn()} signOut={jest.fn()} />);
    expect(screen.queryByText("Budget")).toBeNull();
    const onRetry = jest.fn();
    rerender(<MeScreen profile={undefined} loading={false} failed onRetry={onRetry} fixedTotalPaise={undefined} account={undefined} open={jest.fn()} signOut={jest.fn()} />);
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<MeScreen profile={null} loading={false} failed={false} onRetry={jest.fn()} fixedTotalPaise={undefined} account={undefined} open={jest.fn()} signOut={jest.fn()} />);
    expect(screen.getByText("Finish setup first")).toBeTruthy();
  });

  it("asks before signing out, then signs out (APP-26)", async () => {
    const { signOut } = renderMe();
    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Yes, sign out" })));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when the level card cannot load", () => {
    const refetch = jest.fn();
    (useProgress as jest.Mock).mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch });
    renderMe();
    expect(screen.getByText("Couldn't load your level")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the slots it is given", () => {
    renderMe({ notifications: <RNText>notifications slot</RNText>, dataSection: <RNText>data slot</RNText> });
    expect(screen.getByText("notifications slot")).toBeTruthy();
    expect(screen.getByText("data slot")).toBeTruthy();
  });
});
```

`ErrorState`'s retry button is labelled "Retry" in Plan 2; if it is "Try again", change the name in the test.

`app/src/features/profile/screens/edit-profile.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { exampleProfile } from "../me-fixtures";
import { EditGullakScreen } from "./edit-gullak-screen";
import { EditIncomeScreen } from "./edit-income-screen";
import { EditSavingsScreen } from "./edit-savings-screen";
import { FixedCostsScreen } from "./fixed-costs-screen";
import { HelpScreen } from "./help-screen";

jest.mock("../api", () => ({
  fixedCostApi: { list: jest.fn(() => Promise.resolve([])), add: jest.fn(), patch: jest.fn(), remove: jest.fn() },
  profileApi: { get: jest.fn(), put: jest.fn() },
}));

describe("editing from Me (APP-46)", () => {
  it("saves a new income with the rest of the profile unchanged", () => {
    const onSave = jest.fn();
    render(<EditIncomeScreen profile={exampleProfile} today="2026-10-23" saving={false} onSave={onSave} onBack={jest.fn()} />);
    fireEvent.changeText(screen.getByLabelText("Take-home pay per month"), "₹60,000");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ ...exampleProfile, incomePaise: 6_000_000 });
  });

  it("says a new payday waits for the next cycle", () => {
    const onSave = jest.fn();
    render(<EditIncomeScreen profile={exampleProfile} today="2026-10-23" saving={false} onSave={onSave} onBack={jest.fn()} />);
    expect(screen.queryByText("The new payday starts with your next cycle. This cycle keeps its dates.")).toBeNull();
    fireEvent.press(screen.getByText("Last working day"));
    expect(screen.getByText("The new payday starts with your next cycle. This cycle keeps its dates.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0].paydayRule).toBe("LAST_WORKING_DAY");
  });

  it("blocks savings that leave nothing to spend and nudges at ₹0", () => {
    const { rerender } = render(
      <EditSavingsScreen profile={{ ...exampleProfile, savingsPaise: 3_500_000 }} fixedPaise={1_500_000} today="2026-10-23" saving={false} onSave={jest.fn()} onBack={jest.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Lower your savings first" })).toBeDisabled();
    rerender(<EditSavingsScreen profile={{ ...exampleProfile, savingsPaise: 0 }} fixedPaise={1_500_000} today="2026-10-23" saving={false} onSave={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByText("No savings this month. You can set a target here any time.")).toBeTruthy();
  });

  it("saves the savings figure", () => {
    const onSave = jest.fn();
    render(<EditSavingsScreen profile={exampleProfile} fixedPaise={1_500_000} today="2026-10-23" saving={false} onSave={onSave} onBack={jest.fn()} />);
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(exampleProfile);
  });

  it("changes the personality and message times", () => {
    const onSave = jest.fn();
    render(<EditGullakScreen profile={exampleProfile} dayBudgetPaise={59_300} saving={false} onSave={onSave} onBack={jest.fn()} />);
    fireEvent.press(screen.getByText("Savage"));
    fireEvent.press(screen.getByText("9:00 am"));
    fireEvent.press(screen.getByText("10:30 pm"));
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ ...exampleProfile, personality: "SAVAGE", morningTime: "09:00", nightTime: "22:30" });
  });

  it("shows a save error inline", () => {
    render(<EditGullakScreen profile={exampleProfile} dayBudgetPaise={59_300} saving={false} error="No connection. Check your network and try again." onSave={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("reuses the setup fixed-cost list with a Done button", async () => {
    const onContinue = jest.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FixedCostsScreen mode="me" onContinue={onContinue} onBack={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/Step 2 of 4/)).toBeNull();
    fireEvent.press(await screen.findByRole("button", { name: "Done" }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("help offers email to the support address", () => {
    const onEmail = jest.fn();
    render(<HelpScreen supportEmail="help@example.test" onBack={jest.fn()} onEmail={onEmail} />);
    expect(screen.getByText("Does Gullak move my money?")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Email us" }));
    expect(onEmail).toHaveBeenCalledWith("help@example.test");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx jest src/features/profile`
Expected: FAIL (new modules missing).

- [ ] **Step 3: Formatting**

`app/src/features/profile/me-format.ts`:

```ts
import type { Account } from "@/features/account/api";
import { fromServerStage, type Progress } from "@/features/game/api";
import { stageLabels } from "@/features/gullak/stage";
import type { PaydayRule } from "@/lib/cycle";
import { formatDay, todayIst } from "@/lib/dates";
import type { Personality, Profile, ProfileRequest } from "./api";

const count = new Intl.NumberFormat("en-IN");

export function ordinal(n: number): string {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}

export function paydayLabel(p: Profile): string {
  return p.paydayRule === "LAST_WORKING_DAY" ? "Last working day" : `${ordinal(p.paydayDay ?? 1)} of the month`;
}

/** "08:00" → "8:00 am" */
export function timeLabel(t: string): string {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function messagesLabel(p: Profile): string {
  return `${timeLabel(p.morningTime)}, ${timeLabel(p.nightTime)}`;
}

export function levelLine(progress: Progress): string {
  const stage = fromServerStage(progress.stage) ?? "clay";
  return `Level ${progress.level} · ${stageLabels[stage]}`;
}

export function xpLine(progress: Progress): string {
  return `${count.format(progress.xp)} XP · ${progress.badges.filter((b) => b.earned).length} of 10 badges`;
}

export function consentLine(a: Account): string | null {
  if (!a.consentVersion || !a.consentedAt) return null;
  return `You agreed to the privacy policy (version ${a.consentVersion}) on ${formatDay(todayIst(new Date(a.consentedAt)))}`;
}

export function paydayOf(p: Profile): PaydayRule {
  return p.paydayRule === "LAST_WORKING_DAY" ? { rule: "LAST_WORKING_DAY" } : { rule: "FIXED_DAY", day: p.paydayDay ?? 1 };
}

export function samePayday(a: PaydayRule, b: PaydayRule): boolean {
  if (a.rule === "LAST_WORKING_DAY" || b.rule === "LAST_WORKING_DAY") return a.rule === b.rule;
  return a.day === b.day;
}

export type ProfileChange = {
  incomePaise?: number;
  savingsPaise?: number;
  payday?: PaydayRule;
  personality?: Personality;
  morningTime?: string;
  nightTime?: string;
};

/** PUT /me/profile replaces the whole profile: one change plus everything else as it is. */
export function toRequest(p: Profile, change: ProfileChange): ProfileRequest {
  const payday = change.payday ?? paydayOf(p);
  const base = {
    incomePaise: change.incomePaise ?? p.incomePaise,
    savingsPaise: change.savingsPaise ?? p.savingsPaise,
    personality: change.personality ?? p.personality,
    morningTime: change.morningTime ?? p.morningTime,
    nightTime: change.nightTime ?? p.nightTime,
    timezone: p.timezone,
  };
  return payday.rule === "FIXED_DAY" ? { ...base, paydayRule: "FIXED_DAY", paydayDay: payday.day } : { ...base, paydayRule: "LAST_WORKING_DAY" };
}
```

- [ ] **Step 4: Components**

`app/src/features/profile/components/me-row.tsx`:

```tsx
import React from "react";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors, fonts, radius, spacing, touchTarget } from "@/theme";

/** A titled white card of rows (Me.dc.html). */
export function MeGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="labelMuted" style={{ fontFamily: fonts.ui700 }} accessibilityRole="header">
        {title}
      </Text>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, overflow: "hidden" }}>
        {children}
      </View>
    </View>
  );
}

type RowProps = {
  label: string;
  value?: string;
  valueColor?: string;
  onPress: () => void;
  tone?: "ink" | "bad";
  last?: boolean;
  testID?: string;
};

/** One 52pt row: label, value, chevron. The accessible name carries the value ("Payday, 1st of the month"). */
export function MeRow({ label, value, valueColor = colors.muted, onPress, tone = "ink", last = false, testID }: RowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: touchTarget + spacing.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.cm,
        paddingHorizontal: spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
        backgroundColor: pressed ? colors.stack1 : "transparent",
      })}
    >
      <Text variant="body" style={{ flex: 1, fontFamily: fonts.ui500 }} color={tone === "bad" ? colors.bad : colors.ink}>
        {label}
      </Text>
      {value ? (
        <Text variant="label" color={valueColor} style={{ fontVariant: ["tabular-nums"] }}>
          {value}
        </Text>
      ) : null}
      {tone === "ink" ? <Icon name="right" size={16} color={colors.muted} /> : null}
    </Pressable>
  );
}

/** The top of every screen opened from Me: an icon-only back button and the title. */
export function EditHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ alignSelf: "flex-start" }}>
        <Button title="Back" variant="ghost" icon={<Icon name="left" size={20} />} iconOnly onPress={onBack} />
      </View>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}
```

`app/src/features/profile/components/level-card.tsx`:

```tsx
import React from "react";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { fromServerStage } from "@/features/game/api";
import { useProgress } from "@/features/game/hooks";
import { Gullak } from "@/features/gullak/gullak";
import { colors, radius, spacing } from "@/theme";
import { levelLine, xpLine } from "../me-format";

/** The dark card at the top of Me (Me.dc.html): the Gullak, level and stage, XP and badges; opens Badges. */
export function LevelCard({ onPress }: { onPress: () => void }) {
  const progress = useProgress();
  if (progress.isLoading) return <Skeleton height={88} />;
  if (progress.error || !progress.data) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Text variant="labelMuted">Couldn't load your level</Text>
        <Button title="Try again" variant="secondary" onPress={() => void progress.refetch()} />
      </View>
    );
  }
  const p = progress.data;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${levelLine(p)}, ${xpLine(p)}. Open badges`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.cm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: colors.dark,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Gullak mood="happy" stage={fromServerStage(p.stage) ?? "clay"} size={64} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text variant="bodyStrong" color={colors.darkText}>
          {levelLine(p)}
        </Text>
        <Text variant="label" color={colors.darkMuted}>
          {xpLine(p)}
        </Text>
      </View>
      <Icon name="right" size={20} color={colors.darkText} />
    </Pressable>
  );
}
```

`app/src/features/profile/components/profile-gate.tsx`:

```tsx
import { router } from "expo-router";
import React from "react";
import { ErrorState } from "@/components/ui/error-state";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import type { Profile } from "../api";
import { useProfile } from "../hooks";

/** Loading and error states for the screens opened from Me; renders its child once the profile is here. */
export function ProfileGate({ children }: { children: (profile: Profile) => React.ReactNode }) {
  const profile = useProfile();
  if (profile.isLoading) {
    return (
      <Screen>
        <Skeleton height={48} />
        <Skeleton height={48} />
      </Screen>
    );
  }
  if (profile.error || !profile.data) {
    return (
      <Screen>
        <ErrorState body="Could not load your profile" onRetry={() => void profile.refetch()} />
      </Screen>
    );
  }
  return <>{children(profile.data)}</>;
}

export function backToMe(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)/me");
}
```

- [ ] **Step 5: Screens**

`app/src/features/profile/screens/me-screen.tsx` (whole file, replacing Plan 2's and Plan 6's version; the Badges entry is now the level card):

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import type { Account } from "@/features/account/api";
import { formatRupees } from "@/lib/money";
import { spacing } from "@/theme";
import type { Profile } from "../api";
import { LevelCard } from "../components/level-card";
import { MeGroup, MeRow } from "../components/me-row";
import { personalities } from "../components/personality-picker";
import { consentLine, messagesLabel, paydayLabel } from "../me-format";

export type MeHref = "/badges" | "/me/income" | "/me/fixed-costs" | "/me/savings" | "/me/gullak" | "/me/help" | "/privacy";

export type MeScreenProps = {
  profile: Profile | null | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  fixedTotalPaise: number | undefined;
  account: Account | undefined;
  open: (href: MeHref) => void;
  signOut: () => Promise<void>;
  /** Task 13: switches and the permission state. */
  notifications?: React.ReactNode;
  /** Task 14: download and delete. */
  dataSection?: React.ReactNode;
};

export function MeScreen({ profile, loading, failed, onRetry, fixedTotalPaise, account, open, signOut, notifications, dataSection }: MeScreenProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const personality = personalities.find((p) => p.id === profile?.personality)?.label;
  const consent = account ? consentLine(account) : null;
  return (
    <Screen testID="me">
      <Text variant="heading" accessibilityRole="header">
        Me
      </Text>
      <LevelCard onPress={() => open("/badges")} />
      {loading ? (
        <View style={{ gap: spacing.sm }}>
          <Skeleton height={52} />
          <Skeleton height={52} />
          <Skeleton height={52} />
        </View>
      ) : failed ? (
        <ErrorState body="Could not load your profile" onRetry={onRetry} />
      ) : profile ? (
        <>
          <MeGroup title="Budget">
            <MeRow label="Take-home pay" value={formatRupees(profile.incomePaise)} onPress={() => open("/me/income")} />
            <MeRow label="Fixed costs" value={fixedTotalPaise === undefined ? undefined : formatRupees(fixedTotalPaise)} onPress={() => open("/me/fixed-costs")} />
            <MeRow label="Payday" value={paydayLabel(profile)} onPress={() => open("/me/income")} />
            <MeRow label="Monthly savings" value={formatRupees(profile.savingsPaise)} onPress={() => open("/me/savings")} last />
          </MeGroup>
          <MeGroup title="Gullak">
            <MeRow label="Personality" value={personality} onPress={() => open("/me/gullak")} />
            <MeRow label="Daily messages" value={messagesLabel(profile)} onPress={() => open("/me/gullak")} last />
          </MeGroup>
        </>
      ) : (
        <EmptyState title="Finish setup first" body="Your budget settings show here once setup is done" />
      )}
      {notifications ?? null}
      {dataSection ?? null}
      <MeGroup title="Help">
        <MeRow label="Help and contact" onPress={() => open("/me/help")} />
        <MeRow label="Privacy policy" onPress={() => open("/privacy")} last />
      </MeGroup>
      {consent ? <Text variant="caption">{consent}</Text> : null}
      {account ? (
        <Text variant="caption" selectable>
          {`Signed in as ${account.email}`}
        </Text>
      ) : null}
      {confirming ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="bodyStrong">Sign out of Gullak on this phone?</Text>
          <Button
            title="Yes, sign out"
            variant="danger"
            loading={busy}
            onPress={() => {
              setBusy(true);
              void signOut().finally(() => setBusy(false));
            }}
          />
          <Button title="Keep me signed in" variant="secondary" onPress={() => setConfirming(false)} />
        </View>
      ) : (
        <Button title="Sign out" variant="secondary" onPress={() => setConfirming(true)} />
      )}
    </Screen>
  );
}
```

`app/src/features/profile/screens/edit-income-screen.tsx`:

```tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { parseRupeesToPaise } from "@/lib/money";
import { colors } from "@/theme";
import type { Profile, ProfileRequest } from "../api";
import { EditHeader } from "../components/me-row";
import { PaydayPicker, type PaydayValue } from "../components/payday-picker";
import { paydayOf, samePayday, toRequest } from "../me-format";
import { paydayIsComplete } from "../setup-store";

type Props = { profile: Profile; today: string; saving: boolean; error?: string; onSave: (body: ProfileRequest) => void; onBack: () => void };

/** Income applies to this cycle at once; a new payday from the next cycle (spec 2.1). */
export function EditIncomeScreen({ profile, today, saving, error, onSave, onBack }: Props) {
  const [typed, setTyped] = useState(String(Math.floor(profile.incomePaise / 100)));
  const [payday, setPayday] = useState<PaydayValue>(paydayOf(profile));
  const incomePaise = parseRupeesToPaise(typed);
  const complete = paydayIsComplete(payday);
  const paydayChanged = paydayIsComplete(payday) && !samePayday(payday, paydayOf(profile));
  return (
    <Screen
      testID="me-income"
      footer={
        <Button
          title="Save"
          disabled={incomePaise <= 0 || !complete}
          loading={saving}
          onPress={() => {
            if (paydayIsComplete(payday)) onSave(toRequest(profile, { incomePaise, payday }));
          }}
        />
      }
    >
      <EditHeader title="Income and payday" onBack={onBack} />
      <Field
        label="Take-home pay per month"
        prefix="₹"
        large
        value={typed}
        onChangeText={(t) => {
          const paise = parseRupeesToPaise(t);
          setTyped(paise ? String(paise / 100) : "");
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        hint="After tax and PF. Only you can see this."
      />
      <PaydayPicker value={payday} today={today} onChange={setPayday} />
      {paydayChanged ? (
        <Text variant="label" color={colors.warnInk}>
          The new payday starts with your next cycle. This cycle keeps its dates.
        </Text>
      ) : null}
      {error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
```

`app/src/features/profile/screens/edit-savings-screen.tsx`:

```tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { perDayPreview, realityCheck, wholeRupees } from "@/lib/budget";
import { colors } from "@/theme";
import type { Profile, ProfileRequest } from "../api";
import { EditHeader } from "../components/me-row";
import { RealityCheck } from "../components/reality-check";
import { SavingsStepper } from "../components/savings-stepper";
import { paydayOf, toRequest } from "../me-format";

/** realityCheck's "tight" line: ₹250 a day (lib/budget.ts). */
const TIGHT_PER_DAY_PAISE = 25_000;

type Props = { profile: Profile; fixedPaise: number; today: string; saving: boolean; error?: string; onSave: (body: ProfileRequest) => void; onBack: () => void };

export function EditSavingsScreen({ profile, fixedPaise, today, saving, error, onSave, onBack }: Props) {
  const [savingsPaise, setSavings] = useState(profile.savingsPaise);
  const next = perDayPreview({ freePaise: profile.incomePaise - fixedPaise - savingsPaise, today, payday: paydayOf(profile) });
  const check = realityCheck({ incomePaise: profile.incomePaise, fixedPaise, savingsPaise, cycleDays: next.cycleDays });
  const suggested = wholeRupees(Math.max(0, Math.floor((profile.incomePaise - fixedPaise - TIGHT_PER_DAY_PAISE * next.cycleDays) / 100000) * 100000));
  const blocked = check.verdict === "notPossible";
  return (
    <Screen
      testID="me-savings"
      footer={<Button title={blocked ? "Lower your savings first" : "Save"} disabled={blocked} loading={saving} onPress={() => onSave(toRequest(profile, { savingsPaise }))} />}
    >
      <EditHeader title="Monthly savings" onBack={onBack} />
      <Text variant="bodyMuted">This comes out first. Your daily budget is what's left.</Text>
      <SavingsStepper valuePaise={savingsPaise} max={Math.max(0, profile.incomePaise - fixedPaise)} onChange={setSavings} />
      <RealityCheck verdict={check.verdict} perDayPaise={check.perDayPaise} essentialsLeftPaise={profile.incomePaise - fixedPaise} suggestedSavingsPaise={suggested} />
      {savingsPaise === 0 ? (
        <Text variant="label" color={colors.warnInk}>
          No savings this month. You can set a target here any time.
        </Text>
      ) : null}
      {error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
```

(If `perDayPreview`, `realityCheck` and `wholeRupees` live in `@/lib/cycle` rather than `@/lib/budget` in the implemented Plan 2, import them from there.)

`app/src/features/profile/screens/edit-gullak-screen.tsx`:

```tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { colors } from "@/theme";
import type { Profile, ProfileRequest } from "../api";
import { EditHeader } from "../components/me-row";
import { PersonalityPicker } from "../components/personality-picker";
import { TimePicker, morningOptions, nightOptions } from "../components/time-picker";
import { toRequest } from "../me-format";

type Props = { profile: Profile; dayBudgetPaise: number; saving: boolean; error?: string; onSave: (body: ProfileRequest) => void; onBack: () => void };

export function EditGullakScreen({ profile, dayBudgetPaise, saving, error, onSave, onBack }: Props) {
  const [personality, setPersonality] = useState(profile.personality);
  const [morningTime, setMorning] = useState(profile.morningTime);
  const [nightTime, setNight] = useState(profile.nightTime);
  return (
    <Screen testID="me-gullak" footer={<Button title="Save" loading={saving} onPress={() => onSave(toRequest(profile, { personality, morningTime, nightTime }))} />}>
      <EditHeader title="Gullak" onBack={onBack} />
      <PersonalityPicker value={personality} dayBudgetPaise={dayBudgetPaise} onChange={setPersonality} />
      <TimePicker title="Morning budget" value={morningTime} options={morningOptions} onChange={setMorning} />
      <TimePicker title="Night report" value={nightTime} options={nightOptions} onChange={setNight} />
      <Text variant="caption">Your phone shows these two messages at the times you pick</Text>
      {error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
```

`app/src/features/profile/screens/help-screen.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { spacing } from "@/theme";
import { EditHeader } from "../components/me-row";

const answers = [
  {
    q: "How is my daily budget worked out?",
    a: "Take-home pay minus fixed costs and savings, spread over the days left until payday. Money you don't spend today rolls into tomorrow.",
  },
  { q: "Does Gullak move my money?", a: "No. It only keeps the plan. Your money stays in your bank." },
  { q: "Who can see my data?", a: "Only you. We never sell it or use it for ads." },
];

export function HelpScreen({ supportEmail, onBack, onEmail }: { supportEmail: string | undefined; onBack: () => void; onEmail: (address: string) => void }) {
  return (
    <Screen testID="me-help">
      <EditHeader title="Help and contact" onBack={onBack} />
      {answers.map((x) => (
        <View key={x.q} style={{ gap: spacing.xs }}>
          <Text variant="bodyStrong">{x.q}</Text>
          <Text variant="body">{x.a}</Text>
        </View>
      ))}
      <Button
        title="Email us"
        variant="secondary"
        disabled={!supportEmail}
        onPress={() => {
          if (supportEmail) onEmail(supportEmail);
        }}
      />
      {supportEmail ? (
        <Text variant="caption" selectable>
          {`Write to ${supportEmail}`}
        </Text>
      ) : null}
    </Screen>
  );
}
```

In `app/src/features/profile/screens/fixed-costs-screen.tsx`: change the signature to

```tsx
export function FixedCostsScreen({ onContinue, onBack, mode = "setup" }: { onContinue: () => void; onBack: () => void; mode?: "setup" | "me" }) {
```

replace the `Screen` opening tag and the two header lines with

```tsx
    <Screen testID={mode === "me" ? "me-fixed-costs" : "setup-fixed-costs"} footer={<Button title={mode === "me" ? "Done" : "Continue"} onPress={onContinue} />}>
      {mode === "me" ? <EditHeader title="Fixed costs" onBack={onBack} /> : <StepHeader step={2} total={4} name="Fixed costs" onBack={onBack} />}
      {mode === "setup" ? <Text variant="heading">Fixed costs</Text> : null}
```

replace the closing caption with `{mode === "setup" ? <Text variant="caption">SIPs and RDs go in the next step, as savings</Text> : null}`, and add `import { EditHeader } from "../components/me-row";`.

- [ ] **Step 6: Routes**

`app/app/(tabs)/me.tsx` (whole file):

```tsx
import { router } from "expo-router";
import React from "react";
import { useAccount } from "@/features/account/hooks";
import { useSession } from "@/features/auth/session";
import { useFixedCosts, useProfile } from "@/features/profile/hooks";
import { MeScreen } from "@/features/profile/screens/me-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function MeRoute() {
  const { signOut } = useSession();
  const profile = useProfile();
  const fixed = useFixedCosts();
  const account = useAccount();
  return (
    <MeScreen
      profile={profile.data}
      loading={profile.isLoading}
      failed={profile.error !== null && profile.data === undefined}
      onRetry={() => void profile.refetch()}
      fixedTotalPaise={fixed.data?.reduce((s, c) => s + c.amountPaise, 0)}
      account={account.data}
      open={(href) => router.push(href)}
      signOut={signOut}
    />
  );
}
```

`app/app/me/_layout.tsx`:

```tsx
import { Stack } from "expo-router/stack";
import React from "react";
import { colors } from "@/theme";

export default function MeLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />;
}
```

`app/app/me/income.tsx`:

```tsx
import React from "react";
import { backToMe, ProfileGate } from "@/features/profile/components/profile-gate";
import { usePutProfile } from "@/features/profile/hooks";
import { EditIncomeScreen } from "@/features/profile/screens/edit-income-screen";
import { describeError } from "@/lib/api-errors";
import { todayIst } from "@/lib/dates";
import { messageFor } from "@/lib/errors";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function MeIncomeRoute() {
  const put = usePutProfile();
  return (
    <ProfileGate>
      {(profile) => (
        <EditIncomeScreen
          profile={profile}
          today={todayIst()}
          saving={put.isPending}
          error={put.error ? describeError(put.error, messageFor) : undefined}
          onSave={(body) => put.mutate(body, { onSuccess: backToMe })}
          onBack={backToMe}
        />
      )}
    </ProfileGate>
  );
}
```

`app/app/me/savings.tsx`:

```tsx
import React from "react";
import { backToMe, ProfileGate } from "@/features/profile/components/profile-gate";
import { useFixedCosts, usePutProfile } from "@/features/profile/hooks";
import { EditSavingsScreen } from "@/features/profile/screens/edit-savings-screen";
import { describeError } from "@/lib/api-errors";
import { todayIst } from "@/lib/dates";
import { messageFor } from "@/lib/errors";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function MeSavingsRoute() {
  const put = usePutProfile();
  const fixed = useFixedCosts();
  return (
    <ProfileGate>
      {(profile) => (
        <EditSavingsScreen
          profile={profile}
          fixedPaise={(fixed.data ?? []).reduce((s, c) => s + c.amountPaise, 0)}
          today={todayIst()}
          saving={put.isPending}
          error={put.error ? describeError(put.error, messageFor) : undefined}
          onSave={(body) => put.mutate(body, { onSuccess: backToMe })}
          onBack={backToMe}
        />
      )}
    </ProfileGate>
  );
}
```

`app/app/me/gullak.tsx` (Task 13 replaces the rescheduling line):

```tsx
import React from "react";
import { useToday } from "@/features/budget/hooks";
import { backToMe, ProfileGate } from "@/features/profile/components/profile-gate";
import { usePutProfile } from "@/features/profile/hooks";
import { EditGullakScreen } from "@/features/profile/screens/edit-gullak-screen";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { scheduleDaily } from "@/lib/notifications";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function MeGullakRoute() {
  const put = usePutProfile();
  const today = useToday();
  return (
    <ProfileGate>
      {(profile) => (
        <EditGullakScreen
          profile={profile}
          dayBudgetPaise={today.data?.budgetPaise ?? 50_000}
          saving={put.isPending}
          error={put.error ? describeError(put.error, messageFor) : undefined}
          onSave={(body) =>
            put.mutate(body, {
              onSuccess: (saved) => {
                // The morning and night messages are scheduled on the phone (spec 2.7): move them to the new times.
                void scheduleDaily({ morningTime: saved.morningTime, nightTime: saved.nightTime, personality: saved.personality });
                backToMe();
              },
            })
          }
          onBack={backToMe}
        />
      )}
    </ProfileGate>
  );
}
```

`app/app/me/fixed-costs.tsx`:

```tsx
import React from "react";
import { backToMe } from "@/features/profile/components/profile-gate";
import { FixedCostsScreen } from "@/features/profile/screens/fixed-costs-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function MeFixedCostsRoute() {
  return <FixedCostsScreen mode="me" onContinue={backToMe} onBack={backToMe} />;
}
```

`app/app/me/help.tsx`:

```tsx
import React from "react";
import { Linking } from "react-native";
import { useAccount } from "@/features/account/hooks";
import { backToMe } from "@/features/profile/components/profile-gate";
import { HelpScreen } from "@/features/profile/screens/help-screen";

export default function MeHelpRoute() {
  const account = useAccount();
  return (
    <HelpScreen
      supportEmail={account.data?.supportEmail}
      onBack={backToMe}
      onEmail={(address) => void Linking.openURL(`mailto:${address}?subject=${encodeURIComponent("Gullak help")}`)}
    />
  );
}
```

In `app/app/_layout.tsx`, add `<Stack.Screen name="me" />` to the `status === "signedIn"` group of `Navigation`. In `app/app/(tabs)/me.tsx` the Plan 6 `onOpenBadges` prop is gone: the level card opens `/badges`.

- [ ] **Step 7: Run the tests**

Run: `cd app && npx jest src/features/profile src/a11y.test.tsx && npm run lint && npm run typecheck`
Expected: PASS. (If Plan 2's `a11y.test.tsx` renders `MeScreen` with the old props, update that render to the new `MeScreenProps` shown in `me.test.tsx`.)

Then: `cd app && npm test`
Expected: PASS.

- [ ] **Step 8: Use it**

Server up, signed in with the example user: Me shows the level card and the six rows with ₹50,000, ₹15,000, 1st of the month, ₹20,000, Chill friend, 8:00 am, 10:00 pm. Change income to ₹60,000 → Home's budget rises at once. Pick "Last working day" → the note appears; save; Home keeps this cycle's dates. Set savings to ₹0 → the nudge; save. Change the morning time to 9:00 am → `adb shell dumpsys alarm | grep -i gullak` (or the iOS notification settings) shows the new time. Help → Email us opens the mail app with the support address.

- [ ] **Step 9: Update the test-cases doc and commit**

Add after APP-45:
`| APP-46 | Edit from Me | income, payday (note says next cycle), fixed costs (setup list with Done), savings (blocked when nothing is left, nudge at ₹0), personality and times (local messages rescheduled) all save and return to Me |`

```bash
git add app/src/features/profile app/app/me "app/app/(tabs)/me.tsx" app/app/_layout.tsx app/src/a11y.test.tsx docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md
git commit -m "feat(app): Me from the mockup with profile editing, help and contact, consent record

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: App: notification switches, the OS permission state with a way to turn it on, and push-token registration

**Owner:** app-engineer. **Test IDs:** new APP-47 (switches and permission in Me), spec 2.7 ("every type can be switched off in Me"), spec 3.2 item 9 (per-message switches), API-PUSH-01 (app half: registration after permission), APP-26 (sign-out unregisters the push token). **Red team:** yes (the previous account's pushes reaching a phone after sign-out and a new sign-in; a push deep link to anything but the allowed routes; a switched-off local message still firing).

Copy (new; checked against `.claude/design.md`): group "Notifications"; toggles "Morning budget" / "Your number for the day", "Night report" / "How the day went", "Close to the limit" / "When a spend takes you past 80% of today", "Goals off track" / "A catch-up plan, at most every 3 days", "Wins" / "Milestones, level-ups and badges"; caption "Quiet from 11 pm to 7 am. At most 4 a day."; permission "Notifications are off for Gullak" with "Turn on", "Notifications are off in your phone's settings" with "Open settings", web "Notifications work in the phone app"; error "Could not load your notification settings".

**Files:**
- Create: `app/src/features/notify/api.ts`, `push.ts`, `hooks.ts`, `components/notification-settings.tsx`, `components/notification-section.tsx`, `notify.test.tsx`
- Modify: `app/src/lib/notifications.ts` (`NotificationsApi.getPermissionsAsync`, `scheduleDaily`, `notifyEightyPercent`, `EIGHTY_OFF_KEY`, `applyLocalSwitches`, `GOALS_URL`, `BADGES_URL`), `app/src/lib/notification-routes.ts` (`Route`, `ROUTES`)
- Modify: `app/app/(tabs)/me.tsx`, `app/app/me/gullak.tsx`, `app/app/onboarding/notifications.tsx`, `app/app/_layout.tsx`
- Install: `npx expo install expo-constants`

**Interfaces:**
- Consumes: `GET|PATCH /me/notifications`, `POST|DELETE /me/push-tokens` (Task 8); `MeScreen` slots, `MeGroup` (Task 12); `Toggle` (Plan 3); `kv`, `log`, `notificationsSupported`, `notificationCopy`, `REPORT_CARD_URL`, `askPermission`, `scheduleDaily`, `notifyEightyPercent`, `EIGHTY_KEY`, `hourIst` (Plans 2, 3, 6).
- Produces: `Switches`, `SwitchName`, `notifyApi.switches/update/registerToken/unregisterToken`; `switchesKey`, `useSwitches()`, `useUpdateSwitch(onApplied)`, `useNotificationPermission()`, `usePushRegistration(signedIn)`; `PermissionState`, `PushDeps`, `permissionState()`, `registerPushToken()`, `unregisterPushToken()`, `turnOnNotifications()`, `openNotificationSettings()`, `signOutOnThisPhone(signOut, unregister?)`; `NotificationSettings`, `NotificationSection`; `applyLocalSwitches(switches, profile, api?, store?)`, `EIGHTY_OFF_KEY`, `GOALS_URL`, `BADGES_URL`; `scheduleDaily` options `morning?`, `night?`.

- [ ] **Step 1: Install**

Run: `cd app && npx expo install expo-constants`
Expected: added to `package.json` (it may already be there as an Expo Router dependency; then nothing changes).

- [ ] **Step 2: Write the failing tests**

`app/src/features/notify/notify.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { applyLocalSwitches, EIGHTY_OFF_KEY, notifyEightyPercent, type NotificationsApi } from "@/lib/notifications";
import { routeForNotification } from "@/lib/notification-routes";
import type { Switches } from "./api";
import { NotificationSettings } from "./components/notification-settings";
import { permissionState, registerPushToken, signOutOnThisPhone, turnOnNotifications, unregisterPushToken, type PushDeps } from "./push";

function memoryStore() {
  const m = new Map<string, string>();
  return {
    map: m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => {
      m.set(k, v);
    },
    remove: async (k: string) => {
      m.delete(k);
    },
  };
}

function deps(over: Partial<PushDeps> = {}): PushDeps & { store: ReturnType<typeof memoryStore> } {
  const store = memoryStore();
  return {
    supported: true,
    os: "android",
    projectId: "proj-1",
    permissions: jest.fn(async () => ({ granted: true, canAskAgain: true })),
    request: jest.fn(async () => ({ granted: true })),
    expoToken: jest.fn(async () => "ExponentPushToken[abcdefghij12]"),
    register: jest.fn(async () => undefined),
    unregister: jest.fn(async () => undefined),
    ...over,
    store,
  };
}

function fakeNotifications(granted = true): NotificationsApi & { scheduled: string[] } {
  const scheduled: string[] = [];
  return {
    scheduled,
    getPermissionsAsync: jest.fn(async () => ({ granted })),
    requestPermissionsAsync: jest.fn(async () => ({ granted })),
    getAllScheduledNotificationsAsync: jest.fn(async () => scheduled.map((identifier) => ({ identifier }))),
    cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
      scheduled.splice(scheduled.indexOf(id), 1);
    }),
    scheduleNotificationAsync: jest.fn(async (r: { identifier: string }) => {
      scheduled.push(r.identifier);
      return r.identifier;
    }),
    presentNotificationAsync: jest.fn(async (r: { identifier: string }) => r.identifier),
    setForegroundHandler: jest.fn(),
  };
}

const allOn: Switches = { morning: true, night: true, nearLimit: true, offTrack: true, wins: true };
const example = { morningTime: "08:00", nightTime: "22:00", personality: "CHILL" as const };

describe("push token (API-PUSH-01 app half, APP-26)", () => {
  it("registers this phone's token once permission is granted", async () => {
    const d = deps();
    expect(await registerPushToken(d)).toBe(true);
    expect(d.register).toHaveBeenCalledWith("ExponentPushToken[abcdefghij12]", "ANDROID");
    expect(d.store.map.get("push.token")).toBe("ExponentPushToken[abcdefghij12]");
  });

  it("registers nothing without permission, a project id, or on web", async () => {
    expect(await registerPushToken(deps({ permissions: jest.fn(async () => ({ granted: false })) }))).toBe(false);
    expect(await registerPushToken(deps({ projectId: undefined }))).toBe(false);
    expect(await registerPushToken(deps({ supported: false }))).toBe(false);
  });

  it("signOutUnregistersThePushToken before the session ends", async () => {
    const d = deps();
    await registerPushToken(d);
    const order: string[] = [];
    await signOutOnThisPhone(
      async () => {
        order.push("signOut");
      },
      async () => {
        order.push("unregister");
        await unregisterPushToken(d);
      },
    );
    expect(order).toEqual(["unregister", "signOut"]);
    expect(d.unregister).toHaveBeenCalledWith("ExponentPushToken[abcdefghij12]");
    expect(d.store.map.has("push.token")).toBe(false);
  });

  it("an offline unregister still forgets the token locally", async () => {
    const d = deps({ unregister: jest.fn(async () => Promise.reject(new Error("offline"))) });
    await registerPushToken(d);
    await unregisterPushToken(d);
    expect(d.store.map.has("push.token")).toBe(false);
  });
});

describe("permission state (APP-47)", () => {
  it("maps the OS answer", async () => {
    expect(await permissionState(deps())).toBe("granted");
    expect(await permissionState(deps({ permissions: jest.fn(async () => ({ granted: false, canAskAgain: true })) }))).toBe("askable");
    expect(await permissionState(deps({ permissions: jest.fn(async () => ({ granted: false, canAskAgain: false })) }))).toBe("blocked");
    expect(await permissionState(deps({ supported: false }))).toBe("unsupported");
  });

  it("Turn on asks the OS only when it still can, then registers", async () => {
    let granted = false;
    const d = deps({
      permissions: jest.fn(async () => ({ granted, canAskAgain: true })),
      request: jest.fn(async () => {
        granted = true;
        return { granted };
      }),
    });
    expect(await turnOnNotifications(d)).toBe("granted");
    expect(d.request).toHaveBeenCalledTimes(1);
    expect(d.register).toHaveBeenCalled();
    const blocked = deps({ permissions: jest.fn(async () => ({ granted: false, canAskAgain: false })) });
    expect(await turnOnNotifications(blocked)).toBe("blocked");
    expect(blocked.request).not.toHaveBeenCalled();
  });
});

describe("local messages follow the switches (spec 2.7)", () => {
  it("a switched-off morning message is not scheduled", async () => {
    const api = fakeNotifications();
    const store = memoryStore();
    await applyLocalSwitches({ ...allOn, morning: false }, example, api, store);
    expect(api.scheduled).toEqual(["gullak.night"]);
    await applyLocalSwitches(allOn, example, api, store);
    expect(api.scheduled.sort()).toEqual(["gullak.morning", "gullak.night"]);
  });

  it("the 80% message stays quiet when switched off", async () => {
    const api = fakeNotifications();
    const store = memoryStore();
    await applyLocalSwitches({ ...allOn, nearLimit: false }, example, api, store);
    expect(store.map.get(EIGHTY_OFF_KEY)).toBe("1");
    const afternoon = new Date("2026-10-23T09:30:00Z");
    expect(await notifyEightyPercent({ personality: "CHILL", date: "2026-10-23", now: afternoon }, api, store)).toBe(false);
    await applyLocalSwitches(allOn, example, api, store);
    expect(await notifyEightyPercent({ personality: "CHILL", date: "2026-10-23", now: afternoon }, api, store)).toBe(true);
  });
});

describe("push deep links", () => {
  it("open goals and badges, and nothing else new", () => {
    expect(routeForNotification({ url: "gullak://goals" })).toBe("/(tabs)/goals");
    expect(routeForNotification({ url: "gullak://badges" })).toBe("/badges");
    expect(routeForNotification({ url: "gullak://me" })).toBeNull();
    expect(routeForNotification({ url: "https://evil.example/goals" })).toBeNull();
  });
});

describe("NotificationSettings (APP-47)", () => {
  const base = { switches: allOn, loading: false, failed: false, onRetry: jest.fn(), onToggle: jest.fn(), permission: "granted" as const, onTurnOn: jest.fn(), onOpenSettings: jest.fn() };

  it("shows one switch per message type and reports a change", () => {
    const onToggle = jest.fn();
    render(<NotificationSettings {...base} onToggle={onToggle} />);
    for (const label of ["Morning budget", "Night report", "Close to the limit", "Goals off track", "Wins"]) {
      expect(screen.getByRole("switch", { name: label })).toBeTruthy();
    }
    fireEvent.press(screen.getByRole("switch", { name: "Goals off track" }));
    expect(onToggle).toHaveBeenCalledWith("offTrack", false);
    expect(screen.getByText("Quiet from 11 pm to 7 am. At most 4 a day.")).toBeTruthy();
  });

  it("offers Turn on, or the phone's settings, or says it is phone-only", () => {
    const onTurnOn = jest.fn();
    const onOpenSettings = jest.fn();
    const { rerender } = render(<NotificationSettings {...base} permission="askable" onTurnOn={onTurnOn} onOpenSettings={onOpenSettings} />);
    expect(screen.getByText("Notifications are off for Gullak")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Turn on" }));
    expect(onTurnOn).toHaveBeenCalled();
    rerender(<NotificationSettings {...base} permission="blocked" onTurnOn={onTurnOn} onOpenSettings={onOpenSettings} />);
    fireEvent.press(screen.getByRole("button", { name: "Open settings" }));
    expect(onOpenSettings).toHaveBeenCalled();
    rerender(<NotificationSettings {...base} permission="unsupported" />);
    expect(screen.getByText("Notifications work in the phone app")).toBeTruthy();
  });

  it("renders loading and error states", () => {
    const onRetry = jest.fn();
    const { rerender } = render(<NotificationSettings {...base} switches={undefined} loading />);
    expect(screen.queryByRole("switch")).toBeNull();
    rerender(<NotificationSettings {...base} switches={undefined} failed onRetry={onRetry} />);
    expect(screen.getByText("Could not load your notification settings")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd app && npx jest src/features/notify`
Expected: FAIL (modules missing).

- [ ] **Step 4: Local notifications follow the switches**

In `app/src/lib/notifications.ts`:

Change the `getPermissionsAsync` member of `NotificationsApi` to:

```ts
  getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain?: boolean }>;
```

Add the deep-link constants next to `REPORT_CARD_URL`:

```ts
/** Server push deep links (Plan 8). notification-routes.ts allows exactly these. */
export const GOALS_URL = "gullak://goals";
export const BADGES_URL = "gullak://badges";
```

Replace `scheduleDaily` with:

```ts
/** Replaces Gullak's daily messages with the ones switched on. Does nothing without permission. */
export async function scheduleDaily(
  opts: { morningTime: string; nightTime: string; personality: Personality; morning?: boolean; night?: boolean },
  api: NotificationsApi = realApi(),
): Promise<void> {
  if (!(await api.getPermissionsAsync()).granted) return;
  const existing = await api.getAllScheduledNotificationsAsync();
  for (const n of existing) if (n.identifier.startsWith("gullak.")) await api.cancelScheduledNotificationAsync(n.identifier);
  const copy = notificationCopy[opts.personality];
  let count = 0;
  if (opts.morning !== false) {
    await api.scheduleNotificationAsync({ identifier: "gullak.morning", content: copy.morning, trigger: { type: "daily", ...parse(opts.morningTime) } });
    count++;
  }
  if (opts.night !== false) {
    await api.scheduleNotificationAsync({
      identifier: "gullak.night",
      content: { ...copy.night, data: { url: REPORT_CARD_URL } },
      trigger: { type: "daily", ...parse(opts.nightTime) },
    });
    count++;
  }
  log.info("notifications.scheduled", { count });
}
```

Add below `EIGHTY_KEY`:

```ts
/** "1" when the user switched the 80% message off in Me; mirrored from the server's switches. */
export const EIGHTY_OFF_KEY = "alert80.off";
```

Replace `notifyEightyPercent` with:

```ts
export async function notifyEightyPercent(
  opts: { personality: Personality; date: string; now: Date },
  api: NotificationsApi = realApi(),
  store: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> } = kv,
): Promise<boolean> {
  if (!notificationsSupported) return false;
  const hour = hourIst(opts.now);
  if (hour >= 23 || hour < 7) return false;
  if ((await store.get(EIGHTY_OFF_KEY)) === "1") return false; // switched off in Me (spec 2.7)
  if ((await store.get(EIGHTY_KEY)) === opts.date) return false;
  if (!(await api.getPermissionsAsync()).granted) return false;
  await api.presentNotificationAsync({ identifier: `gullak.eighty.${opts.date}`, content: eightyPercentCopy[opts.personality] });
  await store.set(EIGHTY_KEY, opts.date);
  log.info("notifications.eighty_percent");
  return true;
}
```

and add:

```ts
/** Applies Me's switches to the messages the phone sends itself: morning, night and the 80% message. */
export async function applyLocalSwitches(
  switches: { morning: boolean; night: boolean; nearLimit: boolean },
  profile: { morningTime: string; nightTime: string; personality: Personality },
  api?: NotificationsApi,
  store: { set(key: string, value: string): Promise<void> } = kv,
): Promise<void> {
  await store.set(EIGHTY_OFF_KEY, switches.nearLimit ? "0" : "1");
  if (!notificationsSupported) return;
  await scheduleDaily({ ...profile, morning: switches.morning, night: switches.night }, api ?? realApi());
}
```

In `app/src/lib/notification-routes.ts`, import `BADGES_URL` and `GOALS_URL` with `REPORT_CARD_URL`, and replace the `Route` type and `ROUTES` map with:

```ts
type Route = "/report-card" | "/(tabs)/goals" | "/badges";

/** Exact links only. A push payload can never steer the app anywhere else (no prefixes, no web URLs). */
const ROUTES = new Map<string, Route>([
  [REPORT_CARD_URL, "/report-card"],
  [GOALS_URL, "/(tabs)/goals"],
  [BADGES_URL, "/badges"],
]);
```

- [ ] **Step 5: The notify feature**

`app/src/features/notify/api.ts`:

```ts
import { api } from "@/lib/client";

export type Switches = { morning: boolean; night: boolean; nearLimit: boolean; offTrack: boolean; wins: boolean };
export type SwitchName = keyof Switches;

export const notifyApi = {
  switches: () => api.get<Switches>("/me/notifications"),
  update: (patch: Partial<Switches>) => api.patch<Switches>("/me/notifications", patch),
  registerToken: (token: string, platform: "IOS" | "ANDROID") => api.post<void>("/me/push-tokens", { token, platform }),
  unregisterToken: (token: string) => api.request<void>("DELETE", "/me/push-tokens", { token }),
};
```

`app/src/features/notify/push.ts`:

```ts
import { Linking } from "react-native";
import { kv } from "@/lib/kv";
import { log } from "@/lib/log";
import { notificationsSupported } from "@/lib/notifications";
import { notifyApi } from "./api";

export type PermissionState = "granted" | "askable" | "blocked" | "unsupported";

export type PushDeps = {
  supported: boolean;
  os: string | undefined;
  projectId: string | undefined;
  permissions(): Promise<{ granted: boolean; canAskAgain?: boolean }>;
  request(): Promise<{ granted: boolean }>;
  expoToken(projectId: string): Promise<string>;
  register(token: string, platform: "IOS" | "ANDROID"): Promise<void>;
  unregister(token: string): Promise<void>;
  store: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> };
};

const TOKEN_KEY = "push.token";

const unsupported: PushDeps = {
  supported: false,
  os: process.env.EXPO_OS,
  projectId: undefined,
  permissions: async () => ({ granted: false, canAskAgain: false }),
  request: async () => ({ granted: false }),
  expoToken: async () => Promise.reject(new Error("unsupported")),
  register: async () => undefined,
  unregister: async () => undefined,
  store: kv,
};

function realDeps(): PushDeps {
  if (!notificationsSupported) return unsupported;
  // Imported lazily so the web build never loads expo-notifications (it is phone-only).
  const N = require("expo-notifications") as typeof import("expo-notifications");
  const Constants = (require("expo-constants") as typeof import("expo-constants")).default;
  return {
    supported: true,
    os: process.env.EXPO_OS,
    projectId: Constants.easConfig?.projectId,
    permissions: () => N.getPermissionsAsync(),
    request: () => N.requestPermissionsAsync(),
    expoToken: async (projectId) => (await N.getExpoPushTokenAsync({ projectId })).data,
    register: (token, platform) => notifyApi.registerToken(token, platform),
    unregister: (token) => notifyApi.unregisterToken(token),
    store: kv,
  };
}

export async function permissionState(deps: PushDeps = realDeps()): Promise<PermissionState> {
  if (!deps.supported) return "unsupported";
  const p = await deps.permissions();
  if (p.granted) return "granted";
  return p.canAskAgain === false ? "blocked" : "askable";
}

/** Registers this phone for server pushes. Safe to repeat (the server answers 200 for a known token). */
export async function registerPushToken(deps: PushDeps = realDeps()): Promise<boolean> {
  if (!deps.supported || !deps.projectId) return false;
  if (!(await deps.permissions()).granted) return false;
  const platform = deps.os === "ios" ? "IOS" : "ANDROID";
  try {
    const token = await deps.expoToken(deps.projectId);
    await deps.register(token, platform);
    await deps.store.set(TOKEN_KEY, token);
    log.info("push.registered", { platform });
    return true;
  } catch (e) {
    log.warn("push.register_failed", { reason: e instanceof Error ? e.name : "unknown" });
    return false;
  }
}

/** Best effort: the server forgets this phone for this account; the local copy goes either way. */
export async function unregisterPushToken(deps: PushDeps = realDeps()): Promise<void> {
  const token = await deps.store.get(TOKEN_KEY);
  if (!token) return;
  try {
    await deps.unregister(token);
  } catch (e) {
    log.warn("push.unregister_failed", { reason: e instanceof Error ? e.name : "unknown" });
  }
  await deps.store.remove(TOKEN_KEY);
}

/** Me's "Turn on": ask only while the OS still allows it, then register. */
export async function turnOnNotifications(deps: PushDeps = realDeps()): Promise<PermissionState> {
  const state = await permissionState(deps);
  if (state !== "askable") return state;
  const asked = await deps.request();
  if (!asked.granted) return permissionState(deps);
  await registerPushToken(deps);
  return "granted";
}

export function openNotificationSettings(): void {
  void Linking.openSettings();
}

/** Sign-out from Me: the phone stops getting this account's pushes before the session ends. */
export async function signOutOnThisPhone(signOut: () => Promise<void>, unregister: () => Promise<void> = () => unregisterPushToken()): Promise<void> {
  await unregister();
  await signOut();
}
```

`app/src/features/notify/hooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { notifyApi, type Switches } from "./api";
import { permissionState, registerPushToken, type PermissionState } from "./push";

export const switchesKey = ["notification-switches"] as const;

export function useSwitches(enabled = true) {
  return useQuery<Switches>({ queryKey: switchesKey, queryFn: notifyApi.switches, enabled });
}

/** Optimistic: the switch moves at once and moves back if the server refuses. */
export function useUpdateSwitch(onApplied: (switches: Switches) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Switches>) => notifyApi.update(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: switchesKey });
      const previous = qc.getQueryData<Switches>(switchesKey);
      if (previous) qc.setQueryData<Switches>(switchesKey, { ...previous, ...patch });
      return { previous };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(switchesKey, ctx.previous);
    },
    onSuccess: (switches) => {
      qc.setQueryData(switchesKey, switches);
      onApplied(switches);
    },
  });
}

/** The OS permission, re-read whenever the app comes back to the front (the user may have changed it in Settings). */
export function useNotificationPermission(read: () => Promise<PermissionState> = () => permissionState()) {
  const [state, setState] = useState<PermissionState | null>(null);
  const refresh = useCallback(() => {
    void read().then(setState);
  }, [read]);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  return { state, setState, refresh };
}

/** Signed in: register the push token now and each time the app returns to the front (covers a permission just granted). */
export function usePushRegistration(signedIn: boolean, register: () => Promise<boolean> = () => registerPushToken()) {
  useEffect(() => {
    if (!signedIn) return;
    void register();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void register();
    });
    return () => sub.remove();
  }, [signedIn, register]);
}
```

`app/src/features/notify/components/notification-settings.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { MeGroup } from "@/features/profile/components/me-row";
import { spacing } from "@/theme";
import type { SwitchName, Switches } from "../api";
import type { PermissionState } from "../push";

const rows: { name: SwitchName; label: string; description: string }[] = [
  { name: "morning", label: "Morning budget", description: "Your number for the day" },
  { name: "night", label: "Night report", description: "How the day went" },
  { name: "nearLimit", label: "Close to the limit", description: "When a spend takes you past 80% of today" },
  { name: "offTrack", label: "Goals off track", description: "A catch-up plan, at most every 3 days" },
  { name: "wins", label: "Wins", description: "Milestones, level-ups and badges" },
];

type Props = {
  switches: Switches | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onToggle: (name: SwitchName, value: boolean) => void;
  permission: PermissionState | null;
  onTurnOn: () => void;
  onOpenSettings: () => void;
};

export function NotificationSettings({ switches, loading, failed, onRetry, onToggle, permission, onTurnOn, onOpenSettings }: Props) {
  return (
    <MeGroup title="Notifications">
      <View style={{ padding: spacing.md, gap: spacing.md }}>
        {permission === "askable" ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="body">Notifications are off for Gullak</Text>
            <Button title="Turn on" variant="secondary" onPress={onTurnOn} />
          </View>
        ) : permission === "blocked" ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="body">Notifications are off in your phone's settings</Text>
            <Button title="Open settings" variant="secondary" onPress={onOpenSettings} />
          </View>
        ) : permission === "unsupported" ? (
          <Text variant="caption">Notifications work in the phone app</Text>
        ) : null}
        {loading ? (
          <View style={{ gap: spacing.sm }}>
            <Skeleton height={44} />
            <Skeleton height={44} />
          </View>
        ) : failed ? (
          <ErrorState body="Could not load your notification settings" onRetry={onRetry} />
        ) : switches ? (
          rows.map((r) => (
            <Toggle key={r.name} label={r.label} description={r.description} value={switches[r.name]} onChange={(v) => onToggle(r.name, v)} testID={`switch-${r.name}`} />
          ))
        ) : null}
        <Text variant="caption">Quiet from 11 pm to 7 am. At most 4 a day.</Text>
      </View>
    </MeGroup>
  );
}
```

`app/src/features/notify/components/notification-section.tsx`:

```tsx
import React from "react";
import type { Profile } from "@/features/profile/api";
import { applyLocalSwitches } from "@/lib/notifications";
import type { SwitchName, Switches } from "../api";
import { useNotificationPermission, useSwitches, useUpdateSwitch } from "../hooks";
import { openNotificationSettings, turnOnNotifications } from "../push";
import { NotificationSettings } from "./notification-settings";

/** Me's notifications block: server switches, the phone's own messages kept in step, and the OS permission. */
export function NotificationSection({ profile }: { profile: Profile | null | undefined }) {
  const switches = useSwitches(profile !== null);
  const update = useUpdateSwitch((s) => {
    if (profile) void applyLocalSwitches(s, profile);
  });
  const permission = useNotificationPermission();
  return (
    <NotificationSettings
      switches={switches.data}
      loading={switches.isLoading}
      failed={switches.error !== null && switches.data === undefined}
      onRetry={() => void switches.refetch()}
      onToggle={(name: SwitchName, value: boolean) => {
        const patch: Partial<Switches> = {};
        patch[name] = value;
        update.mutate(patch);
      }}
      permission={permission.state}
      onTurnOn={() => void turnOnNotifications().then(permission.setState)}
      onOpenSettings={openNotificationSettings}
    />
  );
}
```

- [ ] **Step 6: Wire it in**

`app/app/(tabs)/me.tsx` — add the imports `NotificationSection` (`@/features/notify/components/notification-section`) and `signOutOnThisPhone` (`@/features/notify/push`), and change two props of `MeScreen`:

```tsx
      signOut={() => signOutOnThisPhone(signOut)}
      notifications={<NotificationSection profile={profile.data} />}
```

`app/app/me/gullak.tsx` — import `useSwitches` from `@/features/notify/hooks` and `applyLocalSwitches` from `@/lib/notifications` (drop the `scheduleDaily` import), add `const switches = useSwitches();` after `const today = useToday();`, and replace the `scheduleDaily` line with:

```tsx
                void applyLocalSwitches(switches.data ?? { morning: true, night: true, nearLimit: true }, saved);
```

`app/app/onboarding/notifications.tsx` — in the handler that runs after `askPermission()` returns `true` (where it calls `scheduleDaily`), add `await registerPushToken();` after the scheduling line (import from `@/features/notify/push`).

`app/app/_layout.tsx` — import `usePushRegistration` from `@/features/notify/hooks`, add below `AccountEventsBridge`:

```tsx
/** Signed in: this phone's push token is registered (and re-registered when the app returns to the front). */
function PushRegistration() {
  const { status } = useSession();
  usePushRegistration(status === "signedIn");
  return null;
}
```

and render `<PushRegistration />` next to `<AccountEventsBridge />`.

- [ ] **Step 7: Run the tests**

Run: `cd app && npx jest src/features/notify src/lib src/features/profile && npm run lint && npm run typecheck`
Expected: PASS (Plan 3's and Plan 6's notification tests still pass: `scheduleDaily` with no flags schedules both messages, and the 80% message is on unless switched off).

Then: `cd app && npm test && npx expo export --platform web && rm -rf dist`
Expected: PASS; the web export proves `expo-notifications` stays out of the web bundle.

- [ ] **Step 8: Use it**

On an Android emulator with a development build and the local server: set up a new user and allow notifications → `push_tokens` has a row. In Me switch "Morning budget" off → `adb shell dumpsys alarm | grep gullak` shows only the night message. Switch "Close to the limit" off → a spend past 80% stays quiet. Deny the permission in Android Settings and return to the app → "Notifications are off in your phone's settings" with "Open settings". Sign out → the token row is gone; sign in as another user → the row belongs to the new user.

- [ ] **Step 9: Update the test-cases doc, red team and commit**

Add after APP-46:
`| APP-47 | Notifications in Me | five switches save at once and roll back on error; morning, night and 80% follow them on the phone; permission off shows Turn on (or Open settings when the OS will not ask again); sign-out unregisters the push token |`

Dispatch `red-team` with task id `plan-08-task-13`: sign out (and let a session expire) on a phone, sign in as another account and trigger a level-up for the first account: nothing may arrive; send a push whose `data.url` is `gullak://me`, `gullak://goals/../me`, `https://evil.example` or `gullak://badges?x=1` (only the exact allowed URLs open anything); switch every local type off and confirm nothing fires for a day. Report to `docs/reports/red-team/plan-08-task-13.md`.

```bash
git add app/package.json app/package-lock.json app/src/features/notify app/src/lib/notifications.ts app/src/lib/notification-routes.ts "app/app/(tabs)/me.tsx" app/app/me/gullak.tsx app/app/onboarding/notifications.tsx app/app/_layout.tsx docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/reports/red-team/plan-08-task-13.md
git commit -m "feat(app): notification switches and permission in Me, push-token registration, local messages follow the switches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: App: download my data, delete with the 30-day grace, the restore link, and E2E-09

**Owner:** app-engineer (screens); qa-engineer (the Maestro flow). **Test IDs:** APP-26 (in full), E2E-09, new APP-48 (restore screen), spec 3.2 item 10 (account deletion with a 30-day grace and a restore email link). **Red team:** yes (restore deep links with junk, other users' or reused tokens; the deleted account's cached screens after deletion; a second tap on delete; download spam).

Copy from `Me.dc.html`, verbatim: group "Your data"; "Download my data" with "CSV", then "Sent to your email"; "Delete account"; dialog title "Delete your account?" and "Keep my account". Changed (Decisions): the dialog body is now "Your account locks now and everything in it is deleted for good in 30 days. Changed your mind? Use the restore link we email you. Download your data first if you want a copy." and "Delete for good" is now "Delete my account". New copy (checked against `.claude/design.md`): "Sending…", "Already sent this hour", "Couldn't send. Try again."; "Your account is locked" / "Everything in it is deleted for good on Sun, 22 Nov 2026. To keep it, use the restore link we've emailed you before then." / "Done"; restore: "Restoring your account", "Your account is back" / "Sign in with your email to carry on.", "That link doesn't work" / "Open it again from the email, or sign in to get a new one." (or "Sign in to get a new one."), "That account is gone" / "Its 30 days ran out, so everything was deleted.", "Too many tries" / "Wait a few minutes and try again.", "Couldn't restore your account", button "Sign in".

**Files:**
- Create: `app/src/features/account/components/data-section.tsx` (`DataSection`, `MeDataSection`, `exportStateOf`)
- Create: `app/src/features/account/screens/delete-account-screen.tsx`, `account-deleted-screen.tsx`, `restore-screen.tsx` (`RestoreScreen`, `restoreView`), `data.test.tsx`
- Create: `app/app/me/delete.tsx`, `app/app/account-deleted.tsx`, `app/app/restore.tsx`
- Modify: `app/app/me/_layout.tsx` (whole file), `app/app/(tabs)/me.tsx`, `app/app/_layout.tsx`
- Create: `app/e2e/delete-account.yaml`, `app/e2e/scripts/restore.js`; modify `app/e2e/README.md`

**Interfaces:**
- Consumes: `useRequestExport`, `useDeleteAccount`, `useRestore` (Task 11); `MeGroup`, `MeRow`, `backToMe`, `MeScreen` slot `dataSection` (Task 12); `signOutOnThisPhone` (Task 13); `POST /api/v1/auth/dev/restore-link` (Task 5, `local` only); `useSession`, `formatDayLong`, `describeError`, `isApiError`, `ApiError`, `messageFor`, `Skeleton`, `Screen`, `Button`, `Text`, `e2e/setup.yaml`, `e2e/scripts/otp.js` (Plan 2).
- Produces: `ExportState`, `exportStateOf(mutation)`, `DataSection({state, onDownload, onDelete})`, `MeDataSection()`; `DeleteAccountScreen({busy, error?, onKeep, onDelete})`; `AccountDeletedScreen({date, onDone})`; `RestoreView`, `restoreView(input)`, `RestoreScreen({view, onSignIn})`; routes `/me/delete` (form sheet), `/account-deleted?date`, `/restore?token` (deep link `gullak://restore?token=…`); Maestro flow `e2e/delete-account.yaml`.

- [ ] **Step 1: Write the failing tests**

`app/src/features/account/data.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { ApiError, NetworkError } from "@/lib/api-errors";
import { DataSection, exportStateOf } from "./components/data-section";
import { AccountDeletedScreen } from "./screens/account-deleted-screen";
import { DeleteAccountScreen } from "./screens/delete-account-screen";
import { RestoreScreen, restoreView } from "./screens/restore-screen";

describe("Your data in Me (APP-26)", () => {
  it("maps the export request to the row's status", () => {
    expect(exportStateOf({ isPending: false, isSuccess: false, error: null })).toBe("idle");
    expect(exportStateOf({ isPending: true, isSuccess: false, error: null })).toBe("sending");
    expect(exportStateOf({ isPending: false, isSuccess: true, error: null })).toBe("sent");
    expect(exportStateOf({ isPending: false, isSuccess: false, error: new ApiError("RATE_LIMITED", 429, "x") })).toBe("limited");
    expect(exportStateOf({ isPending: false, isSuccess: false, error: new NetworkError("offline") })).toBe("failed");
  });

  it("download shows its status and delete opens the confirmation", () => {
    const onDownload = jest.fn();
    const onDelete = jest.fn();
    const { rerender } = render(<DataSection state="idle" onDownload={onDownload} onDelete={onDelete} />);
    fireEvent.press(screen.getByRole("button", { name: "Download my data, CSV" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    rerender(<DataSection state="sending" onDownload={onDownload} onDelete={onDelete} />);
    fireEvent.press(screen.getByRole("button", { name: "Download my data, Sending…" }));
    expect(onDownload).toHaveBeenCalledTimes(1); // no second request while one is on its way
    rerender(<DataSection state="sent" onDownload={onDownload} onDelete={onDelete} />);
    expect(screen.getByText("Sent to your email")).toBeTruthy();
    rerender(<DataSection state="limited" onDownload={onDownload} onDelete={onDelete} />);
    expect(screen.getByText("Already sent this hour")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Delete account" }));
    expect(onDelete).toHaveBeenCalled();
  });
});

describe("deleting the account (spec 3.2 item 10)", () => {
  it("states the 30-day grace and the restore link before anything happens", () => {
    const onKeep = jest.fn();
    const onDelete = jest.fn();
    render(<DeleteAccountScreen busy={false} onKeep={onKeep} onDelete={onDelete} />);
    expect(screen.getByText("Delete your account?")).toBeTruthy();
    expect(
      screen.getByText("Your account locks now and everything in it is deleted for good in 30 days. Changed your mind? Use the restore link we email you. Download your data first if you want a copy."),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Keep my account" }));
    expect(onKeep).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Delete my account" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("says when the data goes and how to keep it", () => {
    const onDone = jest.fn();
    render(<AccountDeletedScreen date="2026-11-22" onDone={onDone} />);
    expect(screen.getByText("Your account is locked")).toBeTruthy();
    expect(screen.getByText("Everything in it is deleted for good on Sun, 22 Nov 2026. To keep it, use the restore link we've emailed you before then.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("a junk date falls back to the 30 days", () => {
    render(<AccountDeletedScreen date="<b>soon</b>" onDone={jest.fn()} />);
    expect(screen.getByText(/deleted for good in 30 days/)).toBeTruthy();
  });
});

describe("restore link (APP-48)", () => {
  it("maps every answer to what the person sees", () => {
    expect(restoreView({ valid: false, pending: false, success: false, error: null }).title).toBe("That link doesn't work");
    expect(restoreView({ valid: true, pending: true, success: false, error: null }).kind).toBe("working");
    expect(restoreView({ valid: true, pending: false, success: true, error: null }).title).toBe("Your account is back");
    expect(restoreView({ valid: true, pending: false, success: false, error: new ApiError("NOT_FOUND", 404, "x") }).title).toBe("That account is gone");
    expect(restoreView({ valid: true, pending: false, success: false, error: new ApiError("UNAUTHENTICATED", 401, "x") }).body).toBe("Sign in to get a new one.");
    expect(restoreView({ valid: true, pending: false, success: false, error: new ApiError("RATE_LIMITED", 429, "x") }).title).toBe("Too many tries");
    expect(restoreView({ valid: true, pending: false, success: false, error: new NetworkError("offline") }).title).toBe("Couldn't restore your account");
  });

  it("offers sign-in once restored", () => {
    const onSignIn = jest.fn();
    render(<RestoreScreen view={restoreView({ valid: true, pending: false, success: true, error: null })} onSignIn={onSignIn} />);
    fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalled();
  });

  it("shows progress while restoring, with no button to press twice", () => {
    render(<RestoreScreen view={restoreView({ valid: true, pending: true, success: false, error: null })} onSignIn={jest.fn()} />);
    expect(screen.getByText("Restoring your account")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx jest src/features/account/data.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Write the code**

`app/src/features/account/components/data-section.tsx`:

```tsx
import { router } from "expo-router";
import React from "react";
import { MeGroup, MeRow } from "@/features/profile/components/me-row";
import { isApiError } from "@/lib/api-errors";
import { colors } from "@/theme";
import { useRequestExport } from "../hooks";

export type ExportState = "idle" | "sending" | "sent" | "limited" | "failed";

const statusText: Record<ExportState, string> = {
  idle: "CSV",
  sending: "Sending…",
  sent: "Sent to your email",
  limited: "Already sent this hour",
  failed: "Couldn't send. Try again.",
};

export function exportStateOf(m: { isPending: boolean; isSuccess: boolean; error: unknown }): ExportState {
  if (m.isPending) return "sending";
  if (m.isSuccess) return "sent";
  if (m.error) return isApiError(m.error, "RATE_LIMITED") ? "limited" : "failed";
  return "idle";
}

/** Me.dc.html "Your data": the export link is emailed (spec 4.7); delete opens the confirmation sheet. */
export function DataSection({ state, onDownload, onDelete }: { state: ExportState; onDownload: () => void; onDelete: () => void }) {
  const valueColor = state === "sent" ? colors.goodDeep : state === "failed" ? colors.bad : colors.muted;
  return (
    <MeGroup title="Your data">
      <MeRow
        label="Download my data"
        value={statusText[state]}
        valueColor={valueColor}
        onPress={state === "sending" ? () => undefined : onDownload}
        testID="download-data"
      />
      <MeRow label="Delete account" tone="bad" onPress={onDelete} last />
    </MeGroup>
  );
}

export function MeDataSection() {
  const exportData = useRequestExport();
  return <DataSection state={exportStateOf(exportData)} onDownload={() => exportData.mutate()} onDelete={() => router.push("/me/delete")} />;
}
```

`app/src/features/account/screens/delete-account-screen.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { colors, spacing } from "@/theme";

type Props = { busy: boolean; error?: string; onKeep: () => void; onDelete: () => void };

/** The confirmation sheet (Me.dc.html), with the 30-day grace of spec 3.2 item 10. */
export function DeleteAccountScreen({ busy, error, onKeep, onDelete }: Props) {
  return (
    <Screen
      testID="delete-account"
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button title="Keep my account" onPress={onKeep} disabled={busy} />
          <Button title="Delete my account" variant="danger" onPress={onDelete} loading={busy} />
        </View>
      }
    >
      <Text variant="title" accessibilityRole="header">
        Delete your account?
      </Text>
      <Text variant="body">
        Your account locks now and everything in it is deleted for good in 30 days. Changed your mind? Use the restore link we email you. Download your data first if you want a copy.
      </Text>
      {error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
```

`app/src/features/account/screens/account-deleted-screen.tsx`:

```tsx
import React from "react";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { formatDayLong } from "@/lib/dates";

/** Shown once after DELETE /me, outside the signed-in routes (the session is gone by then). */
export function AccountDeletedScreen({ date, onDone }: { date: string; onDone: () => void }) {
  const when = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `on ${formatDayLong(date)}` : "in 30 days";
  return (
    <Screen testID="account-deleted" footer={<Button title="Done" onPress={onDone} />}>
      <Text variant="heading" accessibilityRole="header">
        Your account is locked
      </Text>
      <Text variant="body">{`Everything in it is deleted for good ${when}. To keep it, use the restore link we've emailed you before then.`}</Text>
    </Screen>
  );
}
```

`app/src/features/account/screens/restore-screen.tsx`:

```tsx
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { ApiError, describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { colors, spacing } from "@/theme";

export type RestoreView = { kind: "working" | "done" | "failed"; title: string; body: string };

export function restoreView(i: { valid: boolean; pending: boolean; success: boolean; error: unknown }): RestoreView {
  if (!i.valid) return { kind: "failed", title: "That link doesn't work", body: "Open it again from the email, or sign in to get a new one." };
  if (i.success) return { kind: "done", title: "Your account is back", body: "Sign in with your email to carry on." };
  if (i.error instanceof ApiError) {
    if (i.error.status === 404) return { kind: "failed", title: "That account is gone", body: "Its 30 days ran out, so everything was deleted." };
    if (i.error.status === 401) return { kind: "failed", title: "That link doesn't work", body: "Sign in to get a new one." };
    if (i.error.code === "RATE_LIMITED") return { kind: "failed", title: "Too many tries", body: "Wait a few minutes and try again." };
  }
  if (i.error) return { kind: "failed", title: "Couldn't restore your account", body: describeError(i.error, messageFor) };
  return { kind: "working", title: "Restoring your account", body: "" };
}

/** Opened from gullak://restore?token=… (the email's link opens the server page; this route serves the app). */
export function RestoreScreen({ view, onSignIn }: { view: RestoreView; onSignIn: () => void }) {
  return (
    <Screen testID="restore" footer={view.kind === "working" ? undefined : <Button title="Sign in" onPress={onSignIn} />}>
      <Text variant="heading" accessibilityRole="header">
        {view.title}
      </Text>
      {view.kind === "working" ? (
        <View style={{ alignItems: "flex-start", gap: spacing.sm }}>
          <ActivityIndicator color={colors.ink} accessibilityLabel="Restoring" />
        </View>
      ) : (
        <Text variant="body">{view.body}</Text>
      )}
    </Screen>
  );
}
```

`app/app/me/_layout.tsx` (whole file):

```tsx
import { Stack } from "expo-router/stack";
import React from "react";
import { colors } from "@/theme";

export default function MeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
      <Stack.Screen name="delete" options={{ presentation: "formSheet", sheetGrabberVisible: true, sheetAllowedDetents: [0.6, 1] }} />
    </Stack>
  );
}
```

`app/app/me/delete.tsx`:

```tsx
import { router } from "expo-router";
import React from "react";
import { useDeleteAccount } from "@/features/account/hooks";
import { DeleteAccountScreen } from "@/features/account/screens/delete-account-screen";
import { useSession } from "@/features/auth/session";
import { signOutOnThisPhone } from "@/features/notify/push";
import { backToMe } from "@/features/profile/components/profile-gate";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";

export default function DeleteAccountRoute() {
  const { signOut } = useSession();
  const remove = useDeleteAccount();
  return (
    <DeleteAccountScreen
      busy={remove.isPending}
      error={remove.error ? describeError(remove.error, messageFor) : undefined}
      onKeep={backToMe}
      onDelete={() => {
        if (remove.isPending) return;
        remove.mutate(undefined, {
          onSuccess: ({ deletionDate }) => {
            // The deleted screen sits outside the signed-in routes, so it stays when the session ends.
            router.replace({ pathname: "/account-deleted", params: { date: deletionDate } });
            void signOutOnThisPhone(signOut);
          },
        });
      }}
    />
  );
}
```

`app/app/account-deleted.tsx`:

```tsx
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { AccountDeletedScreen } from "@/features/account/screens/account-deleted-screen";

export default function AccountDeletedRoute() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  return <AccountDeletedScreen date={typeof date === "string" ? date : ""} onDone={() => router.replace("/login")} />;
}
```

`app/app/restore.tsx`:

```tsx
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef } from "react";
import { useRestore } from "@/features/account/hooks";
import { RestoreScreen, restoreView } from "@/features/account/screens/restore-screen";
import { useSession } from "@/features/auth/session";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** gullak://restore?token=… : posts the token once (never logs it) and says what happened. */
export default function RestoreRoute() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { status } = useSession();
  const restore = useRestore();
  const started = useRef(false);
  const valid = typeof token === "string" && TOKEN.test(token);
  useEffect(() => {
    if (valid && !started.current) {
      started.current = true;
      restore.mutate(token);
    }
  }, [valid, token, restore]);
  const view = restoreView({ valid, pending: restore.isPending || (valid && restore.isIdle), success: restore.isSuccess, error: restore.error });
  return <RestoreScreen view={view} onSignIn={() => router.replace(status === "signedIn" ? "/" : "/login")} />;
}
```

In `app/app/_layout.tsx`, add `<Stack.Screen name="restore" />` and `<Stack.Screen name="account-deleted" />` outside the guards (next to `privacy` and `+not-found`).

In `app/app/(tabs)/me.tsx`, import `MeDataSection` from `@/features/account/components/data-section` and add the prop `dataSection={<MeDataSection />}` to `MeScreen`.

- [ ] **Step 4: Run the tests**

Run: `cd app && npx jest src/features/account src/features/profile && npm run lint && npm run typecheck`
Expected: PASS.

Then: `cd app && npm test && npx expo export --platform web && rm -rf dist`
Expected: PASS.

- [ ] **Step 5: E2E-09**

`app/e2e/scripts/restore.js`:

```js
// Reads the token of the last restore mail the local server "sent" (dev endpoint, local profile only).
const base = typeof GULLAK_API !== "undefined" ? GULLAK_API : "http://10.0.2.2:8080/api/v1";
const res = http.post(base + "/auth/dev/restore-link", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: output.email }),
});
if (!res.ok) throw new Error("dev restore link failed: " + res.status);
output.restoreToken = json(res.body).token;
```

`app/e2e/delete-account.yaml`:

```yaml
appId: in.gullak.app
---
# E2E-09: Me → delete → login shows locked → restore link → login works
- runFlow: setup.yaml
- tapOn: "Me"
- scrollUntilVisible:
    element: "Delete account"
- tapOn: "Delete account"
- assertVisible: "Delete your account?"
- tapOn: "Delete my account"
- assertVisible: "Your account is locked"
- tapOn: "Done"
- tapOn: "Email"
- inputText: ${output.email}
- tapOn: "Send code"
- assertVisible: "Enter the code"
- runScript: scripts/otp.js
- inputText: ${output.code}
- assertVisible: "This account is being deleted. Use the link we emailed you to restore it."
- runScript: scripts/restore.js
- openLink: gullak://restore?token=${output.restoreToken}
- assertVisible: "Your account is back"
- tapOn: "Sign in"
- tapOn: "Email"
- inputText: ${output.email}
- tapOn: "Send code"
- runScript: scripts/otp.js
- inputText: ${output.code}
- assertVisible:
    text: "left of ₹.* today"
```

In `app/e2e/README.md`, add after the `setup.yaml` command:

```bash
cd app && maestro test -e GULLAK_API=http://10.0.2.2:8080/api/v1 e2e/delete-account.yaml
```

and the line "E2E-09 deletes and restores a fresh account; it needs the `local` profile for both dev endpoints (`/auth/dev/otp`, `/auth/dev/restore-link`)."

Run (emulator and local server up): `cd app && maestro test -e GULLAK_API=http://10.0.2.2:8080/api/v1 e2e/delete-account.yaml`
Expected: all steps pass. Record the run in `docs/reports/` with the date.

- [ ] **Step 6: Update the test-cases doc**

Replace the APP-26 row with:
`| APP-26 | Me | download shows its status (CSV, Sending…, Sent to your email, Already sent this hour) and ignores taps while sending; delete opens the confirmation with the 30-day grace; sign out unregisters the push token, then clears tokens and the offline queue |`

Replace the E2E-09 row with:
`| E2E-09 | Delete account | Me → Delete account → Delete my account → "Your account is locked" → sign in shows the locked message → open gullak://restore?token= (dev endpoint) → "Your account is back" → sign in → Home |`

Add after APP-47:
`| APP-48 | Restore screen | gullak://restore with a good token restores and offers sign-in; a junk token, a used token (401), an expired grace (404) and too many tries each show their own message; the token is posted once and never logged |`

- [ ] **Step 7: Red team**

Dispatch `red-team` with task id `plan-08-task-14`: open `gullak://restore` with no token, a 42- and 44-character token, another account's used token and a token with `%00`; tap "Delete my account" twice fast; after deletion, background and foreground the app and check no cached figure or name shows; hammer "Download my data"; read the device log for the restore token. Report to `docs/reports/red-team/plan-08-task-14.md`.

- [ ] **Step 8: Commit**

```bash
git add app/src/features/account app/app/me app/app/account-deleted.tsx app/app/restore.tsx app/app/_layout.tsx "app/app/(tabs)/me.tsx" app/e2e docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/reports
git commit -m "feat(app): download my data, delete with a 30-day grace, restore from the emailed link; E2E-09

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the last task

- Run everything: `cd server && ./gradlew test` and `cd app && npm test && npm run lint && npm run typecheck`. Both must be green.
- Dispatch `manager` for the whole-branch review and the plan report in `docs/reports/` (decisions waiting for the founder: the email provider and its setup, the export format, the 4-a-day total cap reserving one slot per local message type switched on, the privacy policy's contact line and legal entity).
- Before the first production deploy, set `GULLAK_MAIL_FROM`, `GULLAK_PUBLIC_URL`, `GULLAK_SUPPORT_EMAIL`, `GULLAK_EXPO_ACCESS_TOKEN` and the AWS keys (README), verify the SES domain and request production access, and configure FCM and APNs credentials for Expo push in EAS (Plan 9's builds).
