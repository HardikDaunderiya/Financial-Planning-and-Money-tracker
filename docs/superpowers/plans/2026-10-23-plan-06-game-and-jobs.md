# Plan 6: Game and jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** XP levels and the Gullak's growth stages, streaks with freezes, the ten badges, the weekly challenge, a night-time job framework (daily close, cycle close, draft cleanup, purges, challenge selection) that is idempotent, locked and retried, and the app's streak and level pills, celebrations, stage-up moment, night report card with sharing and Badges screen.

**Architecture:** Server work stays packaged by feature. `common/jobs` is a small framework (a lease row per job in `job_locks` so two instances never run one job together, a `job_runs` history, per-unit isolation with three attempts and an alert). Concrete jobs live in a new top-level `jobs` package that may depend on every feature; nothing depends on it. The `gamification` package (created by Plan 3 for `xp_events`) gains levels, stages, celebrations, streaks, badges, daily closes and challenges, and depends only on `common`, so it can never join a package cycle with `budget` or `goals`. Home's game strip reaches `budget` through a small interface in `common/game` that `gamification` implements. The report card is its own `report` package (it reads `budget`, `gamification` and `content`). The app adds a `features/game` folder with the API, hooks, celebration handling, the report card, the stage-up moment and the Badges screen.

**Tech Stack:** Spring Boot 4.1.1, Java 21, Spring Data JPA, `JdbcClient` for aggregates and `on conflict` writes, Flyway, Spring scheduling, PostgreSQL 17, Testcontainers, JUnit 5, AssertJ, MockMvc, ArchUnit. Expo (Plan 2's SDK), Expo Router, TypeScript strict, Reanimated 4 with Gesture Handler, react-native-svg, `react-native-view-shot`, `expo-sharing`, `expo-notifications`, TanStack Query v5, Jest with React Native Testing Library, Maestro.

**Spec:** `docs/superpowers/specs/2026-10-23-gullak-v1-design.md` (sections 2.6, 2.7, 4.1, 4.3, 4.5, 4.8), with test cases in `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`, rules in `docs/engineering-standards.md`, visual rules in `.claude/design.md` and prototype findings in `docs/ux-test-findings.md`. Read all of them before starting any task. Plans 1 and 2 are the base; Plans 3, 4 and 5 are implemented before this one, and the contracts this plan expects from them are listed under "Cross-plan contracts".

## Global Constraints

- XP kinds are stored in upper case, matching Plan 3's `XpKind` enum (`LOG_SPEND`, …). Any lower-case kind string written by this plan's `XpLedger` (for example a day-under-budget or streak kind) is written in upper case instead, and its tests assert the upper-case value.

- Money is `long` paise on the server and whole-number paise in the app. No floating point near money. Every percentage of money is computed with integer arithmetic and rounded down.
- Day boundaries are `Asia/Kolkata` (`Ist.ZONE`, `Ist.startOf`, `Ist.today`). The daily close for a date runs after that date has ended in India.
- Every query on user data filters by the user ID from the JWT subject or by a user ID the job enumerated. No endpoint accepts a user ID from the client. Another user's object returns 404, and a list never mixes users.
- Never log amounts, merchant text, goal names, emails, tokens or line text. Event logs use `Events` constants with ids and counts only. XP values, grades, levels and badge codes are not money and may be logged.
- No empty catch blocks. Broad catches (`RuntimeException`) are allowed only in `common/error` and `common/jobs` (the job runner boundary).
- Constructor injection only. Records at service boundaries. Entities and repositories are package-private to their feature. Controllers never touch `JdbcClient`, repositories or entities.
- `gamification` depends only on `in.gullak.common..` inside the app. `common` depends on no feature. Feature packages stay free of cycles (ArchUnit).
- Jobs are idempotent per (user, date) or per reference, use the database to detect repeats, run under a lease in `job_locks`, retry a failed unit three times and raise an alert after the third failure.
- `ErrorCode` is append-only (add before `INTERNAL`). This plan adds no error codes. `Events` is append-only.
- Migrations for this plan use V040–V049; if an earlier plan was executed with more migrations than planned, renumber to the next free number in this block. This plan uses V040–V045. `ddl-auto: validate`.
- API base path `/api/v1`. JSON enums are Java constant names (`A_PLUS`, `GOLD`, `WEEK_WARRIOR`).
- App: features never call `fetch` (only `api` from `@/lib/client`); money only through `lib/money.ts`, dates only through `lib/dates.ts`; tokens only in `src/theme/`; `console` only in `lib/log.ts`; no `any`; every control at least 44×44 with a label; every screen renders loading, error (with Retry) and empty states; animations on the UI thread with `.get()`/`.set()`, `scheduleOnRN`, Reduce Motion respected; no `&&` with a possibly falsy value in JSX (use a ternary).
- Copy follows `.claude/design.md`: sentence case; a single sentence has no full stop; two or more sentences take a full stop after each; ₹ with Indian grouping; dates as "Fri, 23 Oct"; locale en-IN.
- Each task's owner is named; after the owner hands back, `qa-engineer` runs, then `red-team` where the task says so, then `manager` reviews (`docs/team.md`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A spend back-dated into a day that is already closed (spec 2.3 allows dates up to 90 days old) leaves that day's grade, streak and XP untouched, so back-dating cannot farm a streak. Pinned in Task 6 (`backdatedSpendDoesNotReopenAClosedDay`).
- A server that was down at 00:05 catches up the missed nights in date order the next night, and nobody is credited for days before they finished setup. Pinned in Task 6 (`missedNightIsCaughtUpButNotBeforeSetup`).
- Deleting spends until the XP drops below a level, then earning it back, does not replay the level-up or stage-up celebration. Pinned in Task 3 (`levelUpIsNotReplayedAfterReversalAndReEarn`).
- A celebration acknowledged once never fires again after a refetch or on a second phone, and acknowledging another user's celebration id changes nothing. Pinned in Task 10 (`ackedCelebrationsNeverComeBack`, `ackWithAnotherUsersIdChangesNothing`).
- A notification whose payload carries any URL other than the report card (for example `gullak://me` or `https://evil.example`) opens nothing. Pinned in Task 13 (`unknownNotificationUrlsAreIgnored`).

## Decisions made in this plan

| Decision | Why | Cost if wrong |
|---|---|---|
| Package layout: framework in `common/jobs`; concrete jobs in a new top-level `jobs` package; the report card in a new `report` package; `gamification` depends only on `common`; Home's game strip reaches `budget` through `common/game.HomeGameSource` | Plan 5's goals call into gamification (Goal crusher, +1,000 XP) and `budget` shows Plan 5's catch-up, so `gamification → budget` or `gamification → goals` would close a package cycle that ArchUnit rejects | a later feature that needs a budget figure inside gamification has to receive it as a parameter |
| Job lock: a lease row in `job_locks` (`insert … on conflict do update … where locked_until <= now`), 30-minute lease, released in `finally` | Session advisory locks are tied to one pooled connection, which the runner does not hold across a run; a lease survives a crashed instance | a run longer than 30 minutes could overlap a second instance; the lease is configuration |
| Retries: each unit (one user) gets 3 attempts with 2 s and 4 s backoff; after the third failure the unit is logged `job.failed` with an error id, the run is marked `failed` in `job_runs` and `JobAlerts.raise` is called. The default `JobAlerts` writes one ERROR line `job.alert` for the log platform to page on | The spec asks for retry and an alert; there is no paging provider yet | Plan 8 can add an email or push alert behind the same interface |
| `Notifier` interface (`in.gullak.notify`) with an in-memory implementation for `local` and `test`; the retry and alert tests run a job that sends through a stub that fails on demand | The push provider is Plan 8; the job semantics are tested here | none; Plan 8 supplies the real bean |
| Daily close catch-up: each night closes yesterday, plus either of the two days before it whose run never succeeded; a user is closed for a date only if their profile was created before that date ended | A missed night would otherwise break every streak; closing days before setup would hand out free streak days | a server down for more than three nights resets streaks (a gap); that would need a manual re-run |
| Grade boundaries use exact integer comparison (`spent × 100 < 50 × budget` for A+, `< 70` A, `≤ 100` B, `≤ 125` C, `≤ 150` D, else F); a ₹0 budget with ₹0 spent is A+, with any spend F | "B 70 to 100%" and "C 101 to 125%" leave fractions undefined; under budget (B or better) must match the streak rule "spent ≤ budget" | a grade label moves at a boundary fraction |
| Streak rules: a day counts when spent ≤ budget (no-spend days count); a freeze is earned each time the streak reaches a multiple of 7, up to 2 held; a freeze day keeps the count without adding to it; a gap in closes resets the streak | The spec defines earning and using freezes but not whether a frozen day adds to the count | a 40-day streak with one freeze shows 40, not 41 |
| Level-ups are detected against a high-water mark (`game_progress.max_level`) whenever XP is read for Home, closed for a day or awarded by a job; the mark never goes down | Plan 3 writes spend XP; the mark avoids editing Plan 3's award path and makes a level-up celebrate once even after reversals | a level-up from a spend shows on the next Home refresh (immediately after the spend, because Home refetches) rather than inside the spend's own transaction (spec 4.1 says "same transaction"; this is the one place that is relaxed) |
| One-shot celebrations are rows in `celebrations` (unique per user, kind and value), returned by `GET /budget/today` until `POST /me/celebrations/ack` marks them seen, and dropped after 3 days | Flags consumed by a GET would be lost on a refetch race and replayed by a second device; an ack is idempotent and scoped to the caller | a phone that never acks sees a celebration on every open for 3 days |
| `GET /budget/today` gains a nested `game` object: `{streak, level, stage, celebrate}`; Home reads the stage from it instead of a second call to `/me/progress` | One request for Home; the brief's `/me/progress` still serves Badges and the report card | none |
| Badges are never taken back. The challenge's "badge for that category" is a separate family (`CHALLENGE_FOOD_DELIVERY` …) shown under "Challenges won" and not counted in "N of 10 earned" | Spec 2.6 lists exactly 10 badges and also promises a category badge for the challenge | a founder who wants challenge badges in the count changes one filter |
| No-Swiggy Sunday is a closed Sunday with no Food delivery spend; Zepto-free week is 7 consecutive closed days with no Quick commerce spend (a spend resets the count to 0); Comeback kid is an under-budget day right after 3 or more over-budget days in a row | The spec's words, made precise at the close | a never-Swiggy user gets the badge on their first Sunday |
| Weekly challenge: the window is the 14 days before Monday; a user needs spends on at least 7 different days in it; the top discretionary category by total wins (ties by code); target = 70% of the weekly average, rounded half-up to ₹50; a target under ₹50 means no challenge; done when the week's spend in that category is at or under the target; progress is computed live and stored when the week is evaluated | CHL-04's "not enough data" needs a threshold; "Spend under ₹800" reads as at-or-under like the budget | a stricter reading flips a ₹800.00 week to failed |
| XP awards made by this plan go through `XpLedger.awardOnce`, an `insert … on conflict do nothing` on a new unique index `(user_id, kind, ref_type, ref_id) where reversed_at is null`; streak milestones use a per-user deterministic reference so each is paid once ever | Idempotent jobs need the database to refuse a second award; Plan 3's daily cap stays in Plan 3's `XpService` | if Plan 3 already wrote two unreversed events with the same reference, the index migration fails loudly |
| The report card for a closed day reads `daily_closes`; for today (or a day the close has not reached yet) it is computed live. The first day with a card is the day the profile was created; earlier dates are 404, later than today 400 | The night report at 22:00 shows "the day so far" (spec 2.1) | none |
| The shared 1080×1920 image shows the date, grade, streak, the Gullak and its line, and no rupee amounts | An Instagram story is public; amounts stay on the phone unless the user types them | a user who wants amounts in the image cannot get them in V1 |
| Content lines live in `content_lines` (seeded from `GullakLines`), cached for 5 minutes, with `GullakLines`'s static map as the fallback for any missing row; `GET /content/lines?personality=` accepts any letter case | New lines ship without a release (spec 2.6); a deleted row never blanks the Gullak | an edited line takes up to 5 minutes to appear |
| The report card's card 4 body drops the mockup's trailing full stop ("Cook at home and the Goa trip gets a day closer.") because it is one sentence (`.claude/design.md`); report lines may carry `{goal}`, filled with the furthest active goal's name or "your goal" | Copy rule; the mockup's line names a goal | none |
| Migrations use the block V040–V049 | Blocks per plan (README): Plan 3 V006–V009, Plan 4 V010–V019, Plan 5 V020–V039, Plan 7 V050–V059, Plan 8 V060–V069, Plan 9 V070–V079 | the executor renumbers if an earlier plan reached V040 |
| `otp_codes` rows are purged 2 days after creation; `refresh_tokens` 1 day after expiry; only expired tokens are deleted | The per-email daily guess cap sums attempts over the last 24 hours; a used-but-unexpired token must stay so its reuse still revokes the family | none |
| `updated_at` is kept by one trigger function on every table that has the column, installed by Flyway's `afterMigrate.sql` callback so tables added by later plans get it without remembering | Deferred from Plan 1; a per-migration step would be forgotten | the callback runs on every start (a few milliseconds) |
| The streak pill is hidden at 0 days (Home's first-run line already says the streak starts tonight); the level pill always shows | The mockup shows "5 days"; "0 days" on a flame reads as a failure | a one-line change |
| Cycle close and draft cleanup call Plans 5 and 4 through two job-local interfaces (`CycleCloser`, `DraftDiscarder`) with one adapter each, and the job owns the `cycle.closed` log line | The job's tests do not depend on Plans 4 and 5's internals; the adapters are the only place their names appear | if Plan 5 also logs `cycle.closed`, remove one (LOG-03 wants exactly one) |

## Cross-plan contracts

This plan consumes these from plans implemented before it. Task 3 Step 1 and the adapter steps in Tasks 5, 8 and 10 check each one against the real code before building on it.

- **Plan 3 (spends):** package `in.gullak.gamification` exists with `xp_events (id uuid, user_id uuid, kind varchar, xp int, ref_type varchar, ref_id uuid, day date not null (the IST day earned; Plan 3's daily cap counts on it), reversed_at timestamptz, created_at timestamptz, updated_at timestamptz)` and `unique (user_id, kind, ref_type, ref_id)`; Plan 3 stores `XpKind.name()` (upper case) as `kind` and Plans 4 and 5 append `IMPORT_SORTED`, `LOGGING_ACCURACY`, `GOAL_MILESTONE`, `GOAL_COMPLETED` to Plan 3's `XpKind`; Plan 3's spend XP rows are written there and reversed by setting `reversed_at`. Table `categories (code, name, sort_order, discretionary)` seeded with the twelve spec categories using codes that include `food_delivery`, `eating_out`, `quick_commerce`, `groceries`, `shopping`; `food_delivery`, `eating_out`, `quick_commerce` and `shopping` are discretionary and `groceries` is not. `transactions.category_code` holds those codes and manual spends have `source = 'manual'`.
- **Plan 4 (statements):** `in.gullak.ingestion.imports.ImportService.discardOlderThan(int days) : int` discards draft imports created more than `days` days before the database's `now()` (Plan 4 Task 8); the commit path awards +10 XP for sorting and +50 XP for logging accuracy of 90% or more.
- **Plan 5 (goals):** `in.gullak.goals.CycleCloseService.close(UUID userId, UUID cycleId) : CycleCloseService.CloseOutcome(boolean alreadyClosed, boolean savingsMet, CycleClose.Result result)` closes one ended cycle idempotently (sets `cycles.closed_at` and the leftover; Plan 5 Task 6); tables `goals (id, user_id, name, type, target_paise, deadline, mode, status, created_cycle_id, …)` and `goal_contributions (id, goal_id, cycle_id, amount_paise, kind, …)`; goal completion is a single method this plan adds one call to.
- **Plan 2 (app):** `api`, `Screen`, `Button`, `Text`, `Icon`, `ProgressBar`, `Skeleton`, `EmptyState`, `ErrorState`, `Gullak` (`mood`, `stage`, `event`), `GullakEvent`, `stageFor`, `stageLabels`, `Stage`, `Mood`, `fromServerMood`, `useToday`, `todayKey`, `Today`, `formatRupees`, `formatDay`, `formatDayMonth`, `todayIst`, `log`, `messageFor`, `describeError`, `notificationCopy`, `scheduleDaily`, `notificationsSupported`, `MeScreen`, the root `_layout.tsx` with `Stack.Protected`, the `gullak` URL scheme, and `e2e/setup.yaml`.

This plan produces for later plans:

- `BadgeService` implements Plan 4's `in.gullak.gamification.BadgeTrigger.fire(UUID userId, String trigger, UUID refId)` (Plan 4 owns the interface; Plans 4, 5 and 7 fire through it), and this plan appends `BadgeTrigger.SUBSCRIPTION_SLAYER = "subscription_slayer"` (Plan 7 fires it).
- `Notifier.send(UUID userId, PushMessage message)` (Plan 8 implements it).
- `JobRunner.run(String job, String runKey, Supplier<List<UUID>> units, Consumer<UUID> work) : JobResult` and `JobAlerts` (Plan 8's off-track push and deletion jobs use them).
- `CelebrationService.pending(UUID userId)` (Plan 8's level-up and badge pushes read new rows).
- `DailyCloseService.find(UUID userId, LocalDate date)` and `daily_closes` (Plan 7's cycle summary reads grades; Plan 8's off-track check runs after the close).
- `GET /api/v1/me/progress`, `GET /api/v1/report-card?date`, `GET /api/v1/content/lines?personality`, `POST /api/v1/me/celebrations/ack`, and the `game` object on `GET /api/v1/budget/today`.

## File structure

```
server/src/main/resources/
  db/migration/V040__jobs.sql                               Task 1
  db/migration/afterMigrate.sql                             Task 2
  db/migration/V041__game_progress.sql                      Task 3
  db/migration/V042__streaks_and_closes.sql                 Task 4
  db/migration/V043__badges.sql                             Task 5
  db/migration/V044__weekly_challenges.sql                  Task 7
  db/migration/V045__content_lines.sql                      Task 9
  application.yml (gullak.jobs, gullak.game)                Tasks 1, 3
server/src/main/java/in/gullak/
  common/jobs/JobProperties.java, SchedulingConfig.java, JobLock.java, JobRunLog.java,
    JobStatus.java, JobResult.java, JobAlerts.java, LoggingJobAlerts.java, JobRunner.java    Task 1
  common/game/HomeGame.java, HomeCelebration.java, HomeGameSource.java                      Task 10
  common/log/Events.java (append)                                                           Tasks 1, 2, 3, 6, 7
  notify/Notifier.java, PushMessage.java, InMemoryNotifier.java                             Task 1
  auth/AuthPurgeService.java, PurgeCounts.java; OtpCodeRepository, RefreshTokenRepository (edit)   Task 2
  jobs/AuthPurgeJob.java                                                                    Task 2
  gamification/GameProperties.java, GameConfig.java, Levels.java, Stage.java, LevelView.java,
    XpKinds.java, RefTypes.java, XpLedger.java, CelebrationKind.java, Celebration.java,
    CelebrationEntity.java, CelebrationRepository.java, CelebrationService.java, LevelTracker.java   Task 3
  gamification/Grade.java, StreakState.java, StreakOutcome.java, StreakRules.java,
    StreakEntity.java, StreakRepository.java, StreakService.java                            Task 4
  gamification/Badge.java, BadgeTrigger.java (Plan 4's; one constant appended), EarnedBadge.java, UserBadgeEntity.java,
    UserBadgeRepository.java, BadgeCounters.java, DayFacts.java, GameQueries.java, BadgeService.java   Task 5
  gamification/ClosedDay.java, CloseOutcome.java, DailyCloseView.java, DailyCloseEntity.java,
    DailyCloseRepository.java, DailyCloseService.java                                       Task 6
  budget/DayFigures.java; BudgetService.day (edit)                                          Task 6
  profile/ProfileService.userIdsSetUpBefore, setUpOn; ProfileRepository (edit)              Tasks 6, 11
  jobs/DailyCloseJob.java                                                                   Task 6
  gamification/ChallengePick.java, ChallengePicker.java, ChallengeView.java,
    WeeklyChallengeEntity.java, WeeklyChallengeRepository.java, ChallengeService.java       Task 7
  jobs/WeeklyChallengeJob.java                                                              Task 7
  budget/CycleService.usersWithEndedUnclosed, endedUnclosed; CycleRepository (edit)         Task 8
  jobs/CycleCloser.java, CycleCloseOutcome.java, GoalsCycleCloser.java, CycleCloseJob.java,
    DraftDiscarder.java, ImportsDraftDiscarder.java, DraftCleanupJob.java                   Task 8
  content/LineSlots.java, ReportBand.java, ReportLine.java, ContentLineEntity.java,
    ContentLineRepository.java, ContentLines.java, ContentController.java; GullakLines (edit)   Task 9
  budget/BudgetService (ContentLines)                                                       Task 9
  gamification/FurthestGoal.java, FurthestGoalSource.java, GameStatusService.java,
    ProgressResponse.java, ProgressService.java, ProgressController.java, CelebrationController.java   Task 10
  goals/FurthestGoalQuery.java                                                              Task 10
  budget/TodayResponse.java, BudgetService.today (edit)                                     Task 10
  report/ReportCardResponse.java, ReportQueries.java, ReportCardService.java, ReportCardController.java   Task 11
server/src/test/java/in/gullak/
  common/jobs/JobRunnerApiTest.java, FlakyNotifier.java, RecordingAlerts.java               Task 1
  common/db/UpdatedAtTriggerApiTest.java; auth/AuthPurgeApiTest.java; jobs/AuthPurgeJobApiTest.java   Task 2
  gamification/LevelsTest.java, StageTest.java, LevelTrackerApiTest.java, XpSchemaApiTest.java   Task 3
  gamification/GradeTest.java, StreakRulesTest.java, StreakServiceApiTest.java              Task 4
  gamification/BadgeServiceApiTest.java                                                     Task 5
  jobs/DailyCloseJobApiTest.java                                                            Task 6
  gamification/ChallengePickerTest.java; jobs/WeeklyChallengeJobApiTest.java                Task 7
  jobs/CycleCloseJobApiTest.java, DraftCleanupJobApiTest.java                               Task 8
  content/ContentApiTest.java                                                               Task 9
  gamification/ProgressApiTest.java, budget/TodayGameApiTest.java                           Task 10
  report/ReportCardApiTest.java, security/GameLogRedactionApiTest.java                      Task 11
  support/ApiTest.java (seedXp, gameUser, backdateSetup, seedCategorySpend)                 Tasks 3, 5, 6
  rules/ArchitectureTest.java, rules/SourceRulesTest.java (edit)                            Tasks 1, 3
app/
  src/features/game/api.ts, hooks.ts, celebrations.ts, celebrations.test.tsx                Task 12
  src/features/game/components/game-pills.tsx, game-pills.test.tsx, share-frame.tsx         Task 12
  src/features/home/home-game.test.tsx; jest.setup.ts (native module mocks)                  Task 12
  src/features/game/screens/stage-up-screen.tsx, stage-up.test.tsx                          Task 12
  src/lib/share-image.ts, share-image.test.ts                                               Task 12
  app/stage-up.tsx                                                                          Task 12
  src/features/budget/api.ts, home/hero.tsx, home/home-screen.tsx, app/_layout.tsx (edit)   Tasks 12, 13, 14
  src/features/game/report-card/cards.ts, cards.test.ts, xp-bar.tsx, grade-rule.tsx,
    share-card.tsx, report-card-screen.tsx, report-card.test.tsx                            Task 13
  src/lib/dates.ts (formatTime), dates.test.ts                                              Task 13
  src/lib/notifications.ts (night deep link), notifications.test.ts                         Task 13
  src/lib/notification-routes.ts, notification-routes.test.ts                               Task 13
  app/report-card.tsx; e2e/report-card.yaml                                                 Task 13
  src/features/game/badges/badge-catalog.ts, badges-screen.tsx, badges.test.tsx             Task 14
  app/badges.tsx; src/features/profile/screens/me-screen.tsx, app/(tabs)/me.tsx (edit)      Task 14
docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md (rows added and reworded)         Tasks 6, 11, 13
docs/engineering-standards.md (event vocabulary)                                            Task 1
README.md (API and configuration)                                                           Task 11
```

---
### Task 1: Job framework: lease lock, run history, per-unit retries, alerts and the Notifier interface

**Owner:** backend-engineer. **Test IDs:** JOB-10, JOB-11, JOB-12, LOG-07, ERR-06 (job runner boundary). **Red team:** yes (two instances racing the lease; a crashed instance's lease; a unit that throws forever must not stop the others; nothing sensitive in `job.failed`).

**Files:**
- Create: `server/src/main/resources/db/migration/V040__jobs.sql`
- Create: `server/src/main/java/in/gullak/common/jobs/JobProperties.java`, `SchedulingConfig.java`, `JobLock.java`, `JobRunLog.java`, `JobStatus.java`, `JobResult.java`, `JobAlerts.java`, `LoggingJobAlerts.java`, `JobRunner.java`
- Create: `server/src/main/java/in/gullak/notify/Notifier.java`, `PushMessage.java`, `InMemoryNotifier.java`
- Modify: `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/main/resources/application.yml`, `server/src/test/resources/application-test.yml`, `server/src/test/java/in/gullak/rules/SourceRulesTest.java`, `server/src/test/java/in/gullak/rules/ArchitectureTest.java`, `docs/engineering-standards.md`
- Test: `server/src/test/java/in/gullak/common/jobs/JobRunnerApiTest.java`, `FlakyNotifier.java`, `RecordingAlerts.java`

**Interfaces:**
- Consumes: `Db.ts`, `Events`, the `Clock` bean, `ApiTest` (Plan 1).
- Produces: `JobRunner.run(String job, String runKey, Supplier<List<UUID>> units, Consumer<UUID> work) : JobResult`; `JobRunner.GLOBAL` (the unit id for jobs that are not per user); `JobRunner.hasSucceeded(String job, String runKey) : boolean`; `JobResult(String job, String runKey, JobStatus status, int processed, int failed)`; `JobStatus { SUCCEEDED, FAILED, SKIPPED }`; `JobAlerts.raise(String job, String runKey, int failedUnits)`; `JobLock.tryAcquire(String job) : boolean`, `JobLock.release(String job)`; `Notifier.send(UUID userId, PushMessage message)`; `PushMessage(String title, String body, String url)`; `InMemoryNotifier.sent() : List<InMemoryNotifier.Sent>`; config `gullak.jobs.enabled|attempts|backoff|lease`; events `job.skipped`, `job.retry`, `job.alert`.

- [ ] **Step 1: Migration**

`server/src/main/resources/db/migration/V040__jobs.sql`:

```sql
-- One lease row per job name. An instance holds the job while locked_until is in the future; a crashed
-- instance's lease simply runs out. Spec 4.3: two instances can never run the same job together.
create table job_locks (
    job_name varchar(60) primary key,
    locked_by uuid not null,
    locked_until timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- One row per run of a job for a run key (a date for nightly jobs, a Monday for the weekly one).
create table job_runs (
    id uuid primary key,
    job_name varchar(60) not null,
    run_key varchar(40) not null,
    status varchar(10) not null check (status in ('running', 'succeeded', 'failed')),
    processed int not null default 0,
    failed int not null default 0,
    started_at timestamptz not null,
    finished_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index job_runs_job_key_idx on job_runs (job_name, run_key, status);
```

- [ ] **Step 2: Configuration**

Append to `server/src/main/resources/application.yml` under the existing `gullak:` key (keep `http` and `auth` as they are):

```yaml
  jobs:
    # Scheduled jobs run only when this is true; tests call jobs directly.
    enabled: true
    attempts: 3
    backoff: 2s
    lease: 30m
```

Replace `server/src/test/resources/application-test.yml` with:

```yaml
gullak:
  auth:
    jwt-secret: test-only-jwt-secret-0123456789abcdef0123456789
    otp-pepper: test-only-otp-pepper-0123456789abcdef0123456789
  jobs:
    enabled: false
    backoff: 0s
```

- [ ] **Step 3: Write the failing tests**

`server/src/test/java/in/gullak/common/jobs/FlakyNotifier.java`:

```java
package in.gullak.common.jobs;

import in.gullak.notify.Notifier;
import in.gullak.notify.PushMessage;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

/** A push provider that fails the next {@code n} sends, then delivers. Test-only. */
class FlakyNotifier implements Notifier {
    private final AtomicInteger failuresLeft;
    final List<UUID> delivered = new CopyOnWriteArrayList<>();
    final AtomicInteger calls = new AtomicInteger();

    FlakyNotifier(int failures) {
        this.failuresLeft = new AtomicInteger(failures);
    }

    @Override
    public void send(UUID userId, PushMessage message) {
        calls.incrementAndGet();
        if (failuresLeft.getAndDecrement() > 0) {
            throw new IllegalStateException("provider unavailable");
        }
        delivered.add(userId);
    }
}
```

`server/src/test/java/in/gullak/common/jobs/RecordingAlerts.java`:

```java
package in.gullak.common.jobs;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

class RecordingAlerts implements JobAlerts {
    record Raised(String job, String runKey, int failedUnits) {}

    final List<Raised> raised = new CopyOnWriteArrayList<>();

    @Override
    public void raise(String job, String runKey, int failedUnits) {
        raised.add(new Raised(job, runKey, failedUnits));
    }
}
```

`server/src/test/java/in/gullak/common/jobs/JobRunnerApiTest.java`:

```java
package in.gullak.common.jobs;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.notify.PushMessage;
import in.gullak.support.ApiTest;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
class JobRunnerApiTest extends ApiTest {
    static final PushMessage MSG = new PushMessage("Gullak", "Your report card is in", "gullak://report-card");
    static final JobProperties PROPS = new JobProperties(false, 3, Duration.ZERO, Duration.ofMinutes(30));

    @Autowired JobRunLog runs;

    /** A runner as a separate server instance would build it: its own lock identity. */
    JobRunner instance(JobAlerts alerts) {
        return new JobRunner(new JobLock(jdbc, clock, PROPS), runs, alerts, PROPS);
    }

    static String jobName() {
        return "test-" + UUID.randomUUID().toString().substring(0, 8);
    }

    @Test
    void twoInstancesStartingTogetherRunTheJobOnce() throws Exception { // JOB-10
        String job = jobName();
        CountDownLatch inside = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Consumer<UUID> slow = unit -> {
            inside.countDown();
            try {
                release.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };
        JobRunner a = instance(new RecordingAlerts());
        JobRunner b = instance(new RecordingAlerts());
        ExecutorService pool = Executors.newFixedThreadPool(1);
        try {
            Future<JobResult> first = pool.submit(() -> a.run(job, "2026-10-23", () -> List.of(JobRunner.GLOBAL), slow));
            assertThat(inside.await(10, TimeUnit.SECONDS)).isTrue();
            JobResult second = b.run(job, "2026-10-23", () -> List.of(JobRunner.GLOBAL), unit -> { });
            release.countDown();
            assertThat(second.status()).isEqualTo(JobStatus.SKIPPED);
            assertThat(first.get(10, TimeUnit.SECONDS).status()).isEqualTo(JobStatus.SUCCEEDED);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.sql("select count(*) from job_runs where job_name = ?").param(job).query(Integer.class).single())
            .isEqualTo(1);
    }

    @Test
    void theLeaseIsReleasedSoTheNextRunCanStart() { // JOB-10
        String job = jobName();
        JobRunner a = instance(new RecordingAlerts());
        JobRunner b = instance(new RecordingAlerts());
        assertThat(a.run(job, "k1", () -> List.of(JobRunner.GLOBAL), u -> { }).status()).isEqualTo(JobStatus.SUCCEEDED);
        assertThat(b.run(job, "k2", () -> List.of(JobRunner.GLOBAL), u -> { }).status()).isEqualTo(JobStatus.SUCCEEDED);
    }

    @Test
    void aCrashedInstancesLeaseExpires() {
        String job = jobName();
        jdbc.sql("insert into job_locks (job_name, locked_by, locked_until) values (?, ?, ?)")
            .params(job, UUID.randomUUID(), OffsetDateTime.ofInstant(clock.instant().minusSeconds(1), ZoneOffset.UTC))
            .update();
        assertThat(instance(new RecordingAlerts()).run(job, "k", () -> List.of(JobRunner.GLOBAL), u -> { }).status())
            .isEqualTo(JobStatus.SUCCEEDED);
    }

    @Test
    void aLiveLeaseHeldElsewhereSkips() {
        String job = jobName();
        jdbc.sql("insert into job_locks (job_name, locked_by, locked_until) values (?, ?, ?)")
            .params(job, UUID.randomUUID(), OffsetDateTime.ofInstant(clock.instant().plusSeconds(600), ZoneOffset.UTC))
            .update();
        assertThat(instance(new RecordingAlerts()).run(job, "k", () -> List.of(JobRunner.GLOBAL), u -> { }).status())
            .isEqualTo(JobStatus.SKIPPED);
    }

    @Test
    void providerFailingOnceIsRetriedThenSent() { // JOB-11
        FlakyNotifier push = new FlakyNotifier(1);
        RecordingAlerts alerts = new RecordingAlerts();
        UUID user = UUID.randomUUID();
        JobResult r = instance(alerts).run(jobName(), "k", () -> List.of(user), u -> push.send(u, MSG));
        assertThat(r.status()).isEqualTo(JobStatus.SUCCEEDED);
        assertThat(r.processed()).isEqualTo(1);
        assertThat(push.calls.get()).isEqualTo(2);
        assertThat(push.delivered).containsExactly(user);
        assertThat(alerts.raised).isEmpty();
    }

    @Test
    void providerFailingThreeTimesRaisesAnAlertAndMarksTheRunFailed() { // JOB-12
        FlakyNotifier push = new FlakyNotifier(3);
        RecordingAlerts alerts = new RecordingAlerts();
        String job = jobName();
        JobResult r = instance(alerts).run(job, "2026-10-23", () -> List.of(UUID.randomUUID()), u -> push.send(u, MSG));
        assertThat(r.status()).isEqualTo(JobStatus.FAILED);
        assertThat(r.failed()).isEqualTo(1);
        assertThat(push.calls.get()).isEqualTo(3);
        assertThat(alerts.raised).containsExactly(new RecordingAlerts.Raised(job, "2026-10-23", 1));
        assertThat(jdbc.sql("select status from job_runs where job_name = ?").param(job).query(String.class).single())
            .isEqualTo("failed");
        assertThat(runs.succeeded(job, "2026-10-23")).isFalse();
    }

    @Test
    void oneUserFailingIsLoggedAndTheOthersStillRun(CapturedOutput out) { // LOG-07
        UUID u1 = UUID.randomUUID();
        UUID u2 = UUID.randomUUID();
        UUID u3 = UUID.randomUUID();
        String job = jobName();
        JobResult r = instance(new RecordingAlerts()).run(job, "2026-10-23", () -> List.of(u1, u2, u3), u -> {
            if (u.equals(u2)) {
                throw new IllegalStateException("boom for this user only");
            }
        });
        assertThat(r.processed()).isEqualTo(2);
        assertThat(r.failed()).isEqualTo(1);
        String log = out.getAll();
        assertThat(log).contains("job.started job=" + job);
        assertThat(log.lines().filter(l -> l.contains("job.failed")).toList())
            .hasSize(1).allMatch(l -> l.contains("unit=" + u2) && l.contains("errorId="));
        assertThat(log).contains("job.finished job=" + job + " run=2026-10-23 status=FAILED processed=2 failed=1");
    }

    @Test
    void theUnitListFailingMarksTheRunFailed() {
        RecordingAlerts alerts = new RecordingAlerts();
        String job = jobName();
        JobResult r = instance(alerts).run(job, "k", () -> {
            throw new IllegalStateException("database down");
        }, u -> { });
        assertThat(r.status()).isEqualTo(JobStatus.FAILED);
        assertThat(alerts.raised).hasSize(1);
        assertThat(instance(alerts).run(job, "k2", () -> List.of(), u -> { }).status()).isEqualTo(JobStatus.SUCCEEDED);
    }

    @Test
    void hasSucceededReadsTheHistory() {
        JobRunner runner = instance(new RecordingAlerts());
        String job = jobName();
        assertThat(runner.hasSucceeded(job, "2026-10-22")).isFalse();
        runner.run(job, "2026-10-22", () -> List.of(), u -> { });
        assertThat(runner.hasSucceeded(job, "2026-10-22")).isTrue();
        assertThat(runner.hasSucceeded(job, "2026-10-21")).isFalse();
    }

    @Test
    void theRealRunnerBeanIsWired(@Autowired JobRunner runner) {
        Instant before = clock.instant();
        assertThat(runner.run(jobName(), "k", () -> List.of(JobRunner.GLOBAL), u -> { }).status()).isEqualTo(JobStatus.SUCCEEDED);
        assertThat(clock.instant()).isEqualTo(before);
    }
}
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.jobs.*'`
Expected: compilation fails (`JobRunner`, `JobLock`, `JobProperties`, `Notifier` do not exist).

- [ ] **Step 5: Write the framework**

`server/src/main/java/in/gullak/common/jobs/JobProperties.java`:

```java
package in.gullak.common.jobs;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * @param enabled  scheduled jobs run only when true (tests set false and call jobs directly)
 * @param attempts tries per unit before it counts as failed and an alert is raised (spec 4.8)
 * @param backoff  wait before the second try; the third waits twice as long
 * @param lease    how long a running instance holds a job before another may take it
 */
@Validated
@ConfigurationProperties("gullak.jobs")
public record JobProperties(boolean enabled, @Positive int attempts, @NotNull Duration backoff, @NotNull Duration lease) {}
```

`server/src/main/java/in/gullak/common/jobs/SchedulingConfig.java`:

```java
package in.gullak.common.jobs;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Turns on the @Scheduled methods of the job classes. Off under the test profile. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
@ConditionalOnProperty(prefix = "gullak.jobs", name = "enabled", havingValue = "true", matchIfMissing = true)
class SchedulingConfig {}
```

`server/src/main/java/in/gullak/common/jobs/JobStatus.java`:

```java
package in.gullak.common.jobs;

public enum JobStatus { SUCCEEDED, FAILED, SKIPPED }
```

`server/src/main/java/in/gullak/common/jobs/JobResult.java`:

```java
package in.gullak.common.jobs;

/** What one run did. SKIPPED means another instance held the job's lease. */
public record JobResult(String job, String runKey, JobStatus status, int processed, int failed) {}
```

`server/src/main/java/in/gullak/common/jobs/JobAlerts.java`:

```java
package in.gullak.common.jobs;

/** Raised when a run ends with units that failed every attempt (spec 4.8: a repeated failure sends an alert). */
public interface JobAlerts {
    void raise(String job, String runKey, int failedUnits);
}
```

`server/src/main/java/in/gullak/common/jobs/LoggingJobAlerts.java`:

```java
package in.gullak.common.jobs;

import in.gullak.common.log.Events;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** The V1 alert: one ERROR line the log platform pages on. Plan 8 may add an email behind the same interface. */
@Component
class LoggingJobAlerts implements JobAlerts {
    private static final Logger log = LoggerFactory.getLogger(LoggingJobAlerts.class);

    @Override
    public void raise(String job, String runKey, int failedUnits) {
        log.error("{} job={} run={} failed={}", Events.JOB_ALERT, job, runKey, failedUnits);
    }
}
```

`server/src/main/java/in/gullak/common/jobs/JobLock.java`:

```java
package in.gullak.common.jobs;

import in.gullak.common.db.Db;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * A lease per job name in {@code job_locks}. Each statement commits on its own (no surrounding transaction),
 * so a racing instance sees the lease at once. The conditional upsert lets exactly one instance win.
 */
@Component
public class JobLock {
    private final JdbcClient jdbc;
    private final Clock clock;
    private final Duration lease;
    private final UUID instance = UUID.randomUUID();

    JobLock(JdbcClient jdbc, Clock clock, JobProperties props) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.lease = props.lease();
    }

    /** True when this instance now holds the lease: the row was new, or the previous lease had run out. */
    public boolean tryAcquire(String job) {
        Instant now = clock.instant();
        return jdbc.sql("""
                insert into job_locks (job_name, locked_by, locked_until) values (:job, :me, :until)
                on conflict (job_name) do update
                    set locked_by = excluded.locked_by, locked_until = excluded.locked_until
                    where job_locks.locked_until <= :now
                """)
            .param("job", job)
            .param("me", instance)
            .param("until", Db.ts(now.plus(lease)))
            .param("now", Db.ts(now))
            .update() == 1;
    }

    /** Ends this instance's lease; does nothing if another instance has taken it over. */
    public void release(String job) {
        jdbc.sql("update job_locks set locked_until = :now where job_name = :job and locked_by = :me")
            .param("now", Db.ts(clock.instant()))
            .param("job", job)
            .param("me", instance)
            .update();
    }
}
```

`server/src/main/java/in/gullak/common/jobs/JobRunLog.java`:

```java
package in.gullak.common.jobs;

import in.gullak.common.db.Db;
import java.time.Clock;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** The {@code job_runs} history: one row per run, finished with its status and counts. */
@Component
public class JobRunLog {
    private final JdbcClient jdbc;
    private final Clock clock;

    JobRunLog(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    UUID start(String job, String runKey) {
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into job_runs (id, job_name, run_key, status, started_at) values (?, ?, ?, 'running', ?)")
            .params(id, job, runKey, Db.ts(clock.instant()))
            .update();
        return id;
    }

    void finish(UUID runId, JobStatus status, int processed, int failed) {
        jdbc.sql("update job_runs set status = ?, processed = ?, failed = ?, finished_at = ? where id = ?")
            .params(status == JobStatus.SUCCEEDED ? "succeeded" : "failed", processed, failed, Db.ts(clock.instant()), runId)
            .update();
    }

    /** True when some run of this job for this key finished with every unit done. */
    public boolean succeeded(String job, String runKey) {
        return jdbc.sql("select exists (select 1 from job_runs where job_name = ? and run_key = ? and status = 'succeeded')")
            .params(job, runKey)
            .query(Boolean.class)
            .single();
    }
}
```

`server/src/main/java/in/gullak/common/jobs/JobRunner.java`:

```java
package in.gullak.common.jobs;

import in.gullak.common.log.Events;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Runs a job over its units (usually user ids) under the job's lease. Each unit is isolated: it gets
 * {@code attempts} tries; a unit that fails every try is logged once as job.failed with an error id and the
 * run carries on with the next unit. Units do their own transactions; the runner holds none.
 */
@Component
public class JobRunner {
    /** The single unit of a job that is not per user (purges, draft cleanup). */
    public static final UUID GLOBAL = new UUID(0L, 0L);

    private static final Logger log = LoggerFactory.getLogger(JobRunner.class);

    private final JobLock lock;
    private final JobRunLog runs;
    private final JobAlerts alerts;
    private final JobProperties props;

    JobRunner(JobLock lock, JobRunLog runs, JobAlerts alerts, JobProperties props) {
        this.lock = lock;
        this.runs = runs;
        this.alerts = alerts;
        this.props = props;
    }

    public JobResult run(String job, String runKey, Supplier<List<UUID>> units, Consumer<UUID> work) {
        if (!lock.tryAcquire(job)) {
            log.info("{} job={} run={}", Events.JOB_SKIPPED, job, runKey);
            return new JobResult(job, runKey, JobStatus.SKIPPED, 0, 0);
        }
        long started = System.nanoTime();
        try {
            UUID runId = runs.start(job, runKey);
            log.info("{} job={} run={}", Events.JOB_STARTED, job, runKey);
            List<UUID> list;
            try {
                list = units.get();
            } catch (RuntimeException e) { // job runner boundary: record the failed run, alert, keep the scheduler alive
                String errorId = UUID.randomUUID().toString();
                log.error("{} job={} unit=all errorId={}", Events.JOB_FAILED, job, errorId, e);
                return finish(job, runKey, runId, 0, 0, true, started);
            }
            int processed = 0;
            int failed = 0;
            for (UUID unit : list) {
                if (Thread.currentThread().isInterrupted()) {
                    break;
                }
                if (attempt(job, unit, work)) {
                    processed++;
                } else {
                    failed++;
                }
            }
            return finish(job, runKey, runId, processed, failed, failed > 0, started);
        } finally {
            lock.release(job);
        }
    }

    public boolean hasSucceeded(String job, String runKey) {
        return runs.succeeded(job, runKey);
    }

    private JobResult finish(String job, String runKey, UUID runId, int processed, int failed, boolean hasFailure, long started) {
        JobStatus status = hasFailure ? JobStatus.FAILED : JobStatus.SUCCEEDED;
        runs.finish(runId, status, processed, failed);
        log.info("{} job={} run={} status={} processed={} failed={} ms={}", Events.JOB_FINISHED, job, runKey, status,
            processed, failed, (System.nanoTime() - started) / 1_000_000);
        if (hasFailure) {
            alerts.raise(job, runKey, failed);
        }
        return new JobResult(job, runKey, status, processed, failed);
    }

    private boolean attempt(String job, UUID unit, Consumer<UUID> work) {
        for (int i = 1; i <= props.attempts(); i++) {
            try {
                work.accept(unit);
                return true;
            } catch (RuntimeException e) { // job runner boundary: one unit's failure never stops the others
                if (i == props.attempts()) {
                    String errorId = UUID.randomUUID().toString();
                    log.error("{} job={} unit={} attempts={} errorId={}", Events.JOB_FAILED, job, unit, i, errorId, e);
                    return false;
                }
                log.warn("{} job={} unit={} attempt={} error={}", Events.JOB_RETRY, job, unit, i, e.getClass().getSimpleName());
                if (!pause(props.backoff().multipliedBy(i))) {
                    return false;
                }
            }
        }
        return false;
    }

    /** Waits before a retry; false when the thread was interrupted (the server is shutting down). */
    private static boolean pause(Duration wait) {
        if (wait.isZero()) {
            return true;
        }
        try {
            Thread.sleep(wait);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("{} reason=interrupted", Events.JOB_RETRY);
            return false;
        }
    }
}
```

`server/src/main/java/in/gullak/notify/PushMessage.java`:

```java
package in.gullak.notify;

/** A push notification. {@code url} is an in-app deep link such as gullak://report-card, or null. */
public record PushMessage(String title, String body, String url) {}
```

`server/src/main/java/in/gullak/notify/Notifier.java`:

```java
package in.gullak.notify;

import java.util.UUID;

/**
 * Sends a push to one user's devices. Plan 8 provides the Expo Push implementation (timeouts, quiet hours,
 * daily cap). A send that fails throws; job callers rely on the JobRunner's retries.
 */
public interface Notifier {
    void send(UUID userId, PushMessage message);
}
```

`server/src/main/java/in/gullak/notify/InMemoryNotifier.java`:

```java
package in.gullak.notify;

import in.gullak.common.log.Events;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Local and test only: keeps sent pushes in memory. Production has no Notifier until Plan 8 adds one. */
@Component
@Profile({"local", "test"})
public class InMemoryNotifier implements Notifier {
    private static final Logger log = LoggerFactory.getLogger(InMemoryNotifier.class);

    public record Sent(UUID userId, PushMessage message) {}

    private final List<Sent> sent = new CopyOnWriteArrayList<>();

    @Override
    public void send(UUID userId, PushMessage message) {
        sent.add(new Sent(userId, message));
        log.info("{} user={}", Events.PUSH_SENT, userId);
    }

    public List<Sent> sent() {
        return List.copyOf(sent);
    }
}
```

Append to `server/src/main/java/in/gullak/common/log/Events.java`, before `private Events() {}`:

```java
    public static final String JOB_SKIPPED = "job.skipped";
    public static final String JOB_RETRY = "job.retry";
    public static final String JOB_ALERT = "job.alert";
```

- [ ] **Step 6: Let the job runner catch broadly, and make the common-package rule cover every feature**

In `server/src/test/java/in/gullak/rules/SourceRulesTest.java`, replace the `violations` method with:

```java
    /** The error handler and the job runner are the two boundaries where a broad catch is allowed (ERR-06). */
    private static List<String> violations(Pattern pattern, boolean allowBoundaries) throws IOException {
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(MAIN)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String path = file.toString().replace('\\', '/');
                if (allowBoundaries && (path.contains("/common/error/") || path.contains("/common/jobs/"))) {
                    continue;
                }
                String text = Files.readString(file);
                if (pattern.matcher(text).find()) {
                    found.add(path);
                }
            }
        }
        return found;
    }
```

and rename the test that calls it to keep its meaning:

```java
    @Test
    void noBroadCatchOutsideErrorHandlingAndJobs() throws IOException { // ERR-06
        assertThat(violations(BROAD_CATCH, true)).isEmpty();
    }
```

In `server/src/test/java/in/gullak/rules/ArchitectureTest.java`, replace `commonDoesNotDependOnFeatures` (whatever package list earlier plans gave it) with a rule that covers every feature, present and future:

```java
    @ArchTest
    static final ArchRule commonDoesNotDependOnFeatures = noClasses()
        .that().resideInAPackage("in.gullak.common..")
        .should().dependOnClassesThat(JavaClass.Predicates.resideInAPackage("in.gullak..")
            .and(DescribedPredicate.not(JavaClass.Predicates.resideInAPackage("in.gullak.common.."))));
```

(`DescribedPredicate` and `JavaClass` are already imported in that file.)

In `docs/engineering-standards.md` section 1, append to the event vocabulary sentence: `` `job.skipped`, `job.retry`, `job.alert` `` (and, as later tasks add them, the events they append to `Events.java`).

- [ ] **Step 7: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.jobs.*' --tests 'in.gullak.rules.*'`
Expected: PASS (10 job tests; the rules tests still pass).

Then the whole suite: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/main/resources/db/migration/V040__jobs.sql server/src/main/java/in/gullak/common/jobs server/src/main/java/in/gullak/notify server/src/main/java/in/gullak/common/log/Events.java server/src/main/resources/application.yml server/src/test/resources/application-test.yml server/src/test/java/in/gullak/common/jobs server/src/test/java/in/gullak/rules docs/engineering-standards.md
git commit -m "feat(server): job framework: lease lock, run history, per-unit retries, alerts, Notifier interface

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared updated_at trigger and the auth purge job

**Owner:** backend-engineer. **Test IDs:** JOB-13 (new: expired codes and tokens purged), JOB-14 (new: every table keeps `updated_at`), API-AUTH-08b (still passes after the purge). **Red team:** yes (the purge must not delete a code inside the 24-hour guess window or a used-but-live refresh token, which would disable reuse detection).

**Files:**
- Create: `server/src/main/resources/db/migration/afterMigrate.sql`
- Create: `server/src/main/java/in/gullak/auth/AuthPurgeService.java`, `server/src/main/java/in/gullak/auth/PurgeCounts.java`, `server/src/main/java/in/gullak/jobs/AuthPurgeJob.java`
- Modify: `server/src/main/java/in/gullak/auth/OtpCodeRepository.java`, `server/src/main/java/in/gullak/auth/RefreshTokenRepository.java`, `server/src/main/java/in/gullak/common/log/Events.java`
- Test: `server/src/test/java/in/gullak/common/db/UpdatedAtTriggerApiTest.java`, `server/src/test/java/in/gullak/auth/AuthPurgeApiTest.java`, `server/src/test/java/in/gullak/jobs/AuthPurgeJobApiTest.java`

**Interfaces:**
- Consumes: `JobRunner` (Task 1), `Ist`.
- Produces: trigger function `gullak_set_updated_at()` and a `set_updated_at` trigger on every table with an `updated_at` column, re-applied after every migration; `AuthPurgeService.purgeExpired(Instant now) : PurgeCounts`; `PurgeCounts(int otpCodes, int refreshTokens)`; job `auth-purge` at 03:30 IST; event `auth.purged`. Later plans need do nothing to get the trigger on new tables.

- [ ] **Step 1: Write the failing tests**

`server/src/test/java/in/gullak/common/db/UpdatedAtTriggerApiTest.java`:

```java
package in.gullak.common.db;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class UpdatedAtTriggerApiTest extends ApiTest {
    static final OffsetDateTime Y2K = OffsetDateTime.of(2000, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @Test
    void everyTableWithUpdatedAtHasTheTrigger() { // JOB-14
        List<String> missing = jdbc.sql("""
                select c.table_name from information_schema.columns c
                join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
                where c.table_schema = current_schema() and c.column_name = 'updated_at' and t.table_type = 'BASE TABLE'
                  and not exists (
                    select 1 from pg_trigger tg
                    join pg_class pc on pc.oid = tg.tgrelid
                    join pg_namespace n on n.oid = pc.relnamespace
                    where n.nspname = c.table_schema and pc.relname = c.table_name
                      and tg.tgname = 'set_updated_at' and not tg.tgisinternal)
                """)
            .query(String.class).list();
        assertThat(missing).isEmpty();
    }

    @Test
    void anUpdateMovesUpdatedAt() throws Exception { // JOB-14
        TestUser u = signIn();
        jdbc.sql("update users set updated_at = ? where id = ?").params(Y2K, u.id()).update();
        assertThat(updatedAt(u)).isEqualTo(Y2K);
        jdbc.sql("update users set consent_version = 'test-1' where id = ?").param(u.id()).update();
        assertThat(updatedAt(u)).isAfter(Y2K.plusYears(20));
    }

    @Test
    void anExplicitUpdatedAtIsKept() throws Exception {
        TestUser u = signIn();
        jdbc.sql("update users set consent_version = 'test-2', updated_at = ? where id = ?").params(Y2K, u.id()).update();
        assertThat(updatedAt(u)).isEqualTo(Y2K);
    }

    private OffsetDateTime updatedAt(TestUser u) {
        return jdbc.sql("select updated_at from users where id = ?").param(u.id()).query(OffsetDateTime.class).single()
            .withOffsetSameInstant(ZoneOffset.UTC);
    }
}
```

`server/src/test/java/in/gullak/auth/AuthPurgeApiTest.java`:

```java
package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class AuthPurgeApiTest extends ApiTest {
    @Autowired AuthPurgeService purge;

    @Test
    void oldCodesGoButCodesInsideTheGuessWindowStay() { // JOB-13
        Instant now = clock.instant();
        UUID old = otp(now.minus(Duration.ofDays(3)));
        UUID recent = otp(now.minus(Duration.ofHours(23)));
        UUID yesterday = otp(now.minus(Duration.ofHours(47)));
        purge.purgeExpired(now);
        assertThat(exists("otp_codes", old)).isFalse();
        assertThat(exists("otp_codes", recent)).isTrue();
        assertThat(exists("otp_codes", yesterday)).isTrue();
    }

    @Test
    void onlyTokensExpiredForADayGo() throws Exception { // JOB-13
        TestUser u = signIn();
        Instant now = clock.instant();
        UUID longExpired = token(u, now.minus(Duration.ofDays(2)), null);
        UUID justExpired = token(u, now.minus(Duration.ofHours(12)), null);
        UUID usedButLive = token(u, now.plus(Duration.ofDays(10)), now.minus(Duration.ofDays(1)));
        PurgeCounts counts = purge.purgeExpired(now);
        assertThat(counts.refreshTokens()).isGreaterThanOrEqualTo(1);
        assertThat(exists("refresh_tokens", longExpired)).isFalse();
        assertThat(exists("refresh_tokens", justExpired)).isTrue();
        assertThat(exists("refresh_tokens", usedButLive)).isTrue();
    }

    private UUID otp(Instant createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into otp_codes (id, email, code_hash, expires_at, created_at) values (?, ?, ?, ?, ?)")
            .params(id, uniqueEmail(), "x".repeat(64), ts(createdAt.plus(Duration.ofMinutes(10))), ts(createdAt))
            .update();
        return id;
    }

    private UUID token(TestUser u, Instant expiresAt, Instant usedAt) {
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into refresh_tokens (id, user_id, token_hash, family_id, expires_at, used_at) values (?, ?, ?, ?, ?, ?)")
            .params(id, u.id(), UUID.randomUUID().toString().replace("-", "") + "00000000000000000000000000000000",
                UUID.randomUUID(), ts(expiresAt), usedAt == null ? null : ts(usedAt))
            .update();
        return id;
    }

    private boolean exists(String table, UUID id) {
        return jdbc.sql("select count(*) from " + table + " where id = ?").param(id).query(Integer.class).single() == 1;
    }

    private static OffsetDateTime ts(Instant i) {
        return OffsetDateTime.ofInstant(i, ZoneOffset.UTC);
    }
}
```

(`table` comes from the two literals in this test, never from input.)

`server/src/test/java/in/gullak/jobs/AuthPurgeJobApiTest.java`:

```java
package in.gullak.jobs;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.common.jobs.JobStatus;
import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
class AuthPurgeJobApiTest extends ApiTest {
    @Autowired AuthPurgeJob job;

    @Test
    void runsUnderTheRunnerAndLogsCounts(CapturedOutput out) { // JOB-13
        assertThat(job.run().status()).isEqualTo(JobStatus.SUCCEEDED);
        assertThat(out.getAll()).contains("job.started job=auth-purge").contains("auth.purged otpCodes=");
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.db.*' --tests 'in.gullak.auth.AuthPurgeApiTest' --tests 'in.gullak.jobs.AuthPurgeJobApiTest'`
Expected: compilation fails (`AuthPurgeService`, `AuthPurgeJob`); after the code exists but before the callback, `everyTableWithUpdatedAtHasTheTrigger` fails listing every table.

- [ ] **Step 3: The trigger, installed after every migration**

`server/src/main/resources/db/migration/afterMigrate.sql` (Flyway runs this callback after each migrate, so tables added by any later migration get the trigger too):

```sql
-- Keeps updated_at current on every table that has the column (spec 4.5). A statement that sets
-- updated_at itself keeps its value; any other update gets now().
create or replace function gullak_set_updated_at() returns trigger language plpgsql as $$
begin
    if new.updated_at is not distinct from old.updated_at then
        new.updated_at := now();
    end if;
    return new;
end
$$;

do $$
declare
    t record;
begin
    for t in
        select c.table_name
        from information_schema.columns c
        join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
        where c.table_schema = current_schema() and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
          and not exists (
            select 1 from pg_trigger tg
            join pg_class pc on pc.oid = tg.tgrelid
            join pg_namespace n on n.oid = pc.relnamespace
            where n.nspname = c.table_schema and pc.relname = c.table_name and tg.tgname = 'set_updated_at')
    loop
        execute format('create trigger set_updated_at before update on %I for each row execute function gullak_set_updated_at()',
                       t.table_name);
    end loop;
end
$$;
```

- [ ] **Step 4: The purge**

Add to `server/src/main/java/in/gullak/auth/OtpCodeRepository.java`:

```java
    /** Codes older than the cutoff; the cutoff must stay outside the 24-hour guess-count window. */
    @Modifying
    @Query("delete from OtpCodeEntity o where o.createdAt < :cutoff")
    int deleteCreatedBefore(@Param("cutoff") Instant cutoff);
```

Add to `server/src/main/java/in/gullak/auth/RefreshTokenRepository.java`:

```java
    /** Only expired tokens: a used token that has not expired must stay so its reuse still revokes the family. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from RefreshTokenEntity t where t.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") Instant cutoff);
```

`server/src/main/java/in/gullak/auth/PurgeCounts.java`:

```java
package in.gullak.auth;

public record PurgeCounts(int otpCodes, int refreshTokens) {}
```

`server/src/main/java/in/gullak/auth/AuthPurgeService.java`:

```java
package in.gullak.auth;

import java.time.Duration;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Deletes sign-in rows nobody can use any more (deferred from Plan 1). */
@Service
public class AuthPurgeService {
    /** Longer than the 24-hour window over which wrong guesses per email are summed. */
    static final Duration KEEP_CODES = Duration.ofDays(2);
    static final Duration KEEP_EXPIRED_TOKENS = Duration.ofDays(1);

    private final OtpCodeRepository codes;
    private final RefreshTokenRepository tokens;

    AuthPurgeService(OtpCodeRepository codes, RefreshTokenRepository tokens) {
        this.codes = codes;
        this.tokens = tokens;
    }

    @Transactional
    public PurgeCounts purgeExpired(Instant now) {
        int c = codes.deleteCreatedBefore(now.minus(KEEP_CODES));
        int t = tokens.deleteExpiredBefore(now.minus(KEEP_EXPIRED_TOKENS));
        return new PurgeCounts(c, t);
    }
}
```

Append to `Events.java`, before `private Events() {}`:

```java
    public static final String AUTH_PURGED = "auth.purged";
```

`server/src/main/java/in/gullak/jobs/AuthPurgeJob.java`:

```java
package in.gullak.jobs;

import in.gullak.auth.AuthPurgeService;
import in.gullak.auth.PurgeCounts;
import in.gullak.common.jobs.JobResult;
import in.gullak.common.jobs.JobRunner;
import in.gullak.common.log.Events;
import in.gullak.common.time.Ist;
import java.time.Clock;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
class AuthPurgeJob {
    static final String NAME = "auth-purge";
    private static final Logger log = LoggerFactory.getLogger(AuthPurgeJob.class);

    private final JobRunner runner;
    private final AuthPurgeService purge;
    private final Clock clock;

    AuthPurgeJob(JobRunner runner, AuthPurgeService purge, Clock clock) {
        this.runner = runner;
        this.purge = purge;
        this.clock = clock;
    }

    @Scheduled(cron = "0 30 3 * * *", zone = "Asia/Kolkata")
    public void scheduled() {
        run();
    }

    JobResult run() {
        return runner.run(NAME, Ist.today(clock).toString(), () -> List.of(JobRunner.GLOBAL), unit -> {
            PurgeCounts c = purge.purgeExpired(clock.instant());
            log.info("{} otpCodes={} refreshTokens={}", Events.AUTH_PURGED, c.otpCodes(), c.refreshTokens());
        });
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.db.*' --tests 'in.gullak.auth.*' --tests 'in.gullak.jobs.*'`
Expected: PASS, including Plan 1's `OtpApiTest` (API-AUTH-08b) unchanged.

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/main/resources/db/migration/afterMigrate.sql server/src/main/java/in/gullak/auth server/src/main/java/in/gullak/jobs server/src/main/java/in/gullak/common/log/Events.java server/src/test/java/in/gullak/common/db server/src/test/java/in/gullak/auth/AuthPurgeApiTest.java server/src/test/java/in/gullak/jobs
git commit -m "feat(server): updated_at trigger on every table; nightly purge of old sign-in codes and expired tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: XP levels, stages, the idempotent XP ledger and one-shot celebrations

**Owner:** backend-engineer. **Test IDs:** XP-08, XP-09, XP-10, XP-11 (new: a level-up is never celebrated twice), XP-03 (the total still excludes reversed events). **Red team:** yes (XP farming: log and delete to replay a level-up; a second award for the same reference).

**Files:**
- Create: `server/src/main/resources/db/migration/V041__game_progress.sql`
- Create: `server/src/main/java/in/gullak/gamification/GameProperties.java`, `GameConfig.java`, `Levels.java`, `Stage.java`, `LevelView.java`, `XpKinds.java`, `RefTypes.java`, `XpLedger.java`, `CelebrationKind.java`, `Celebration.java`, `CelebrationEntity.java`, `CelebrationRepository.java`, `CelebrationService.java`, `LevelTracker.java`
- Modify: `server/src/main/resources/application.yml`, `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/test/java/in/gullak/support/ApiTest.java`, `server/src/test/java/in/gullak/rules/ArchitectureTest.java`
- Test: `server/src/test/java/in/gullak/gamification/LevelsTest.java`, `StageTest.java`, `LevelTrackerApiTest.java`, `XpSchemaApiTest.java`

**Interfaces:**
- Consumes: Plan 3's `xp_events` table and `categories` table (see Cross-plan contracts); `Db.ts`, `Ist` (Plan 1).
- Produces: `Levels.levelFor(long xp) : int`, `floorFor(int level) : long`, `nextFor(int level) : long`, `percentToNext(long xp) : int`; `Stage { CLAY, PAINTED, GOLD, DIAMOND }` with `Stage.forLevel(int)`; `LevelView(long xp, int level, Stage stage, long floorXp, long nextXp, int percentToNext)`; `XpLedger.awardOnce(UUID userId, String kind, int xp, String refType, UUID refId) : boolean`, `XpLedger.total(UUID) : long`, `XpLedger.earnedOn(UUID, LocalDate) : long`; `XpKinds`, `RefTypes` constants; `CelebrationKind { STREAK_DAY, STREAK_MILESTONE, LEVEL_UP, STAGE_UP, BADGE }`; `Celebration(UUID id, CelebrationKind kind, String value, Instant createdAt)`; `CelebrationService.record(UUID, CelebrationKind, String) : boolean`, `pending(UUID) : List<Celebration>`, `ack(UUID, Collection<UUID>) : int`; `LevelTracker.sync(UUID) : LevelView` (records level-up and stage-up once), `LevelTracker.view(UUID) : LevelView` (read only); config `gullak.game.level-base`; event `game.level_up`; test helpers `seedXp(TestUser, int)`, `seedXp(TestUser, int, Instant)`, `reverseXp(UUID)`.

- [ ] **Step 1: Check Plan 3's tables before building on them**

`server/src/test/java/in/gullak/gamification/XpSchemaApiTest.java`:

```java
package in.gullak.gamification;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.support.ApiTest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The contract this plan relies on from Plan 3. A failure here means a cross-plan mismatch, not a bug in Plan 6. */
class XpSchemaApiTest extends ApiTest {
    @Test
    void xpEventsHasTheLedgerColumns() {
        List<String> cols = jdbc.sql("select column_name from information_schema.columns where table_name = 'xp_events'")
            .query(String.class).list();
        assertThat(cols).contains("id", "user_id", "kind", "xp", "ref_type", "ref_id", "day", "reversed_at", "created_at");
    }

    @Test
    void categoriesCarryTheDiscretionaryFlag() {
        Map<String, Boolean> flags = jdbc.sql("select code, discretionary from categories")
            .query((rs, n) -> Map.entry(rs.getString(1), rs.getBoolean(2))).list().stream()
            .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
        assertThat(flags).containsEntry("food_delivery", true).containsEntry("quick_commerce", true)
            .containsEntry("eating_out", true).containsEntry("shopping", true).containsEntry("groceries", false);
    }
}
```

Run: `cd server && ./gradlew test --tests 'in.gullak.gamification.XpSchemaApiTest'`
Expected: PASS. If it fails, stop: report the mismatch to the manager (Plan 3's names win; this plan's SQL in Tasks 3, 5, 7 and 11 is then changed to match).

- [ ] **Step 2: Migration and configuration**

`server/src/main/resources/db/migration/V041__game_progress.sql`:

```sql
-- At most one live award per reference: the jobs' XP is idempotent (spec 4.3). Plan 3's spend events
-- (one per transaction) already satisfy this.
create unique index xp_events_once_idx on xp_events (user_id, kind, ref_type, ref_id) where reversed_at is null;

-- The highest level a user has been celebrated for. It never goes down, so losing XP and earning it
-- back never replays a level-up.
create table game_progress (
    user_id uuid primary key references users (id) on delete cascade,
    max_level int not null default 1 check (max_level >= 1),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- One-shot moments for the app: shown until acknowledged, once per (kind, value).
create table celebrations (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    kind varchar(20) not null check (kind in ('STREAK_DAY', 'STREAK_MILESTONE', 'LEVEL_UP', 'STAGE_UP', 'BADGE')),
    value varchar(40) not null,
    created_at timestamptz not null,
    seen_at timestamptz,
    updated_at timestamptz not null default now(),
    unique (user_id, kind, value)
);
create index celebrations_pending_idx on celebrations (user_id, created_at) where seen_at is null;
```

Append to `application.yml` under `gullak:`:

```yaml
  game:
    # Level n (n >= 2) is reached at level-base × n² XP (spec 2.6: 400, 900, …, 40,000 for level 20).
    level-base: 100
```

Append to `Events.java`, before `private Events() {}`:

```java
    public static final String GAME_LEVEL_UP = "game.level_up";
```

- [ ] **Step 3: Write the failing unit tests**

`server/src/test/java/in/gullak/gamification/LevelsTest.java`:

```java
package in.gullak.gamification;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.api.Test;

class LevelsTest {
    final Levels levels = new Levels(100);

    @ParameterizedTest
    @CsvSource({"0,1", "399,1", "400,2", "899,2", "900,3", "1599,3", "1600,4", "39999,19", "40000,20", "1000000,100"})
    void thresholdsAreHundredTimesNSquared(long xp, int level) { // XP-08
        assertThat(levels.levelFor(xp)).isEqualTo(level);
    }

    @Test
    void negativeXpIsLevelOne() {
        assertThat(levels.levelFor(-5)).isEqualTo(1);
    }

    @Test
    void floorsAndNextThresholds() {
        assertThat(levels.floorFor(1)).isZero();
        assertThat(levels.nextFor(1)).isEqualTo(400);
        assertThat(levels.floorFor(3)).isEqualTo(900);
        assertThat(levels.nextFor(3)).isEqualTo(1600);
    }

    @Test
    void percentToNextMatchesTheReportCardMockup() { // "38% left to level 4" = 62% done
        assertThat(levels.percentToNext(1334)).isEqualTo(62);
        assertThat(levels.percentToNext(900)).isZero();
        assertThat(levels.percentToNext(0)).isZero();
        assertThat(levels.percentToNext(399)).isEqualTo(99);
    }

    @Test
    void theBaseIsConfiguration() {
        assertThat(new Levels(50).levelFor(200)).isEqualTo(2);
    }
}
```

`server/src/test/java/in/gullak/gamification/StageTest.java`:

```java
package in.gullak.gamification;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class StageTest {
    @ParameterizedTest
    @CsvSource({"1,CLAY", "4,CLAY", "5,PAINTED", "9,PAINTED", "10,GOLD", "19,GOLD", "20,DIAMOND", "57,DIAMOND"})
    void stagesByLevel(int level, Stage stage) { // XP-09
        assertThat(Stage.forLevel(level)).isEqualTo(stage);
    }
}
```

- [ ] **Step 4: Test helpers**

Add to `server/src/test/java/in/gullak/support/ApiTest.java`:

```java
    /** An XP event as Plan 3's ledger stores it, created now on the test clock (imports `java.time.LocalDate`, `in.gullak.common.time.Ist`). */
    protected UUID seedXp(TestUser user, int xp) {
        return seedXp(user, xp, clock.instant());
    }

    protected UUID seedXp(TestUser user, int xp, Instant at) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                insert into xp_events (id, user_id, kind, xp, ref_type, ref_id, day, created_at)
                values (?, ?, 'test_seed', ?, 'test', ?, ?, ?)
                """)
            .params(id, user.id(), xp, UUID.randomUUID(), LocalDate.ofInstant(at, Ist.ZONE), OffsetDateTime.ofInstant(at, ZoneOffset.UTC))
            .update();
        return id;
    }

    /** What deleting a spend does to its XP event (XP-03). */
    protected void reverseXp(UUID eventId) {
        jdbc.sql("update xp_events set reversed_at = ? where id = ?")
            .params(OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC), eventId)
            .update();
    }

    protected int celebrationCount(TestUser user, String kind) {
        return jdbc.sql("select count(*) from celebrations where user_id = ? and kind = ?")
            .params(user.id(), kind).query(Integer.class).single();
    }
```

- [ ] **Step 5: Write the failing integration tests**

`server/src/test/java/in/gullak/gamification/LevelTrackerApiTest.java`:

```java
package in.gullak.gamification;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class LevelTrackerApiTest extends ApiTest {
    @Autowired LevelTracker tracker;
    @Autowired XpLedger ledger;
    @Autowired CelebrationService celebrations;

    @Test
    void crossing400RecordsOneLevelUp() throws Exception { // XP-10
        TestUser u = signIn();
        seedXp(u, 399);
        assertThat(tracker.sync(u.id()).level()).isEqualTo(1);
        assertThat(celebrationCount(u, "LEVEL_UP")).isZero();
        seedXp(u, 1);
        LevelView v = tracker.sync(u.id());
        assertThat(v.level()).isEqualTo(2);
        assertThat(v.stage()).isEqualTo(Stage.CLAY);
        tracker.sync(u.id());
        assertThat(celebrationCount(u, "LEVEL_UP")).isEqualTo(1);
        assertThat(celebrations.pending(u.id())).extracting(Celebration::kind, Celebration::value)
            .containsExactly(org.assertj.core.groups.Tuple.tuple(CelebrationKind.LEVEL_UP, "2"));
    }

    @Test
    void levelUpIsNotReplayedAfterReversalAndReEarn() throws Exception { // XP-11, review focus
        TestUser u = signIn();
        seedXp(u, 300);
        UUID spendXp = seedXp(u, 100);
        tracker.sync(u.id());
        reverseXp(spendXp); // the spend is deleted
        assertThat(tracker.sync(u.id()).level()).isEqualTo(1);
        seedXp(u, 100); // logged again
        assertThat(tracker.sync(u.id()).level()).isEqualTo(2);
        assertThat(celebrationCount(u, "LEVEL_UP")).isEqualTo(1);
    }

    @Test
    void reachingLevel5IsAStageUp() throws Exception {
        TestUser u = signIn();
        seedXp(u, 2_500);
        LevelView v = tracker.sync(u.id());
        assertThat(v.level()).isEqualTo(5);
        assertThat(v.stage()).isEqualTo(Stage.PAINTED);
        assertThat(celebrations.pending(u.id())).extracting(Celebration::kind, Celebration::value).containsExactly(
            org.assertj.core.groups.Tuple.tuple(CelebrationKind.LEVEL_UP, "5"),
            org.assertj.core.groups.Tuple.tuple(CelebrationKind.STAGE_UP, "PAINTED"));
    }

    @Test
    void reversedXpIsNotCounted() throws Exception { // XP-03
        TestUser u = signIn();
        seedXp(u, 500);
        reverseXp(seedXp(u, 1_000));
        LevelView v = tracker.view(u.id());
        assertThat(v.xp()).isEqualTo(500);
        assertThat(v.level()).isEqualTo(2);
        assertThat(v.floorXp()).isEqualTo(400);
        assertThat(v.nextXp()).isEqualTo(900);
        assertThat(v.percentToNext()).isEqualTo(20);
    }

    @Test
    void awardOnceRefusesASecondAwardForTheSameReference() throws Exception {
        TestUser u = signIn();
        UUID ref = UUID.randomUUID();
        assertThat(ledger.awardOnce(u.id(), XpKinds.DAY_UNDER_BUDGET, 20, RefTypes.DAILY_CLOSE, ref)).isTrue();
        assertThat(ledger.awardOnce(u.id(), XpKinds.DAY_UNDER_BUDGET, 20, RefTypes.DAILY_CLOSE, ref)).isFalse();
        assertThat(ledger.total(u.id())).isEqualTo(20);
    }

    @Test
    void earnedOnIsTheIndianDayAndLeavesOutCloseAwards() throws Exception {
        TestUser u = signIn();
        seedXp(u, 15, Instant.parse("2026-10-23T18:29:00Z")); // 23:59 IST, 23 Oct
        seedXp(u, 5, Instant.parse("2026-10-23T18:31:00Z")); // 00:01 IST, 24 Oct
        clock.set(Instant.parse("2026-10-23T18:35:00Z"));
        ledger.awardOnce(u.id(), XpKinds.DAY_UNDER_BUDGET, 20, RefTypes.DAILY_CLOSE, UUID.randomUUID()); // made at 00:05 for the 23rd
        assertThat(ledger.earnedOn(u.id(), LocalDate.of(2026, 10, 23))).isEqualTo(15);
        assertThat(ledger.earnedOn(u.id(), LocalDate.of(2026, 10, 24))).isEqualTo(5);
    }

    @Test
    void ackHidesOnlyTheCallersRows() throws Exception {
        TestUser a = signIn();
        TestUser b = signIn();
        celebrations.record(a.id(), CelebrationKind.BADGE, "SORTED");
        celebrations.record(b.id(), CelebrationKind.BADGE, "SORTED");
        UUID bId = celebrations.pending(b.id()).getFirst().id();
        assertThat(celebrations.ack(a.id(), List.of(bId))).isZero();
        assertThat(celebrations.pending(b.id())).hasSize(1);
        assertThat(celebrations.ack(b.id(), List.of(bId))).isEqualTo(1);
        assertThat(celebrations.pending(b.id())).isEmpty();
        assertThat(celebrations.record(b.id(), CelebrationKind.BADGE, "SORTED")).isFalse();
    }

    @Test
    void oldCelebrationsAreDropped() throws Exception {
        TestUser u = signIn();
        celebrations.record(u.id(), CelebrationKind.STREAK_DAY, "2026-10-19");
        clock.set(Instant.parse("2026-10-27T08:00:00Z"));
        assertThat(celebrations.pending(u.id())).isEmpty();
    }
}
```

- [ ] **Step 6: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.gamification.*'`
Expected: compilation fails (`Levels`, `Stage`, `LevelTracker`, `XpLedger`, `CelebrationService` missing).

- [ ] **Step 7: Write the code**

`server/src/main/java/in/gullak/gamification/GameProperties.java`:

```java
package in.gullak.gamification;

import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** Spec 2.6: level thresholds are server configuration. */
@Validated
@ConfigurationProperties("gullak.game")
public record GameProperties(@Positive long levelBase) {}
```

`server/src/main/java/in/gullak/gamification/GameConfig.java`:

```java
package in.gullak.gamification;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class GameConfig {
    @Bean
    Levels levels(GameProperties props) {
        return new Levels(props.levelBase());
    }
}
```

`server/src/main/java/in/gullak/gamification/Levels.java`:

```java
package in.gullak.gamification;

/** Everyone starts at level 1; level n (n ≥ 2) is reached at base × n² XP. Pure; unit-tested. */
public final class Levels {
    private final long base;

    public Levels(long base) {
        if (base <= 0) {
            throw new IllegalArgumentException("base must be positive");
        }
        this.base = base;
    }

    public int levelFor(long xp) {
        if (xp < 4 * base) {
            return 1;
        }
        int n = (int) Math.sqrt((double) xp / base);
        while (base * (long) (n + 1) * (n + 1) <= xp) {
            n++;
        }
        while (base * (long) n * n > xp) {
            n--;
        }
        return Math.max(n, 1);
    }

    /** The XP at which {@code level} starts (0 for level 1). */
    public long floorFor(int level) {
        return level <= 1 ? 0 : base * (long) level * level;
    }

    /** The XP at which the level after {@code level} starts. */
    public long nextFor(int level) {
        return base * (long) (level + 1) * (level + 1);
    }

    /** How far through the current level, 0 to 99, rounded down. */
    public int percentToNext(long xp) {
        long safe = Math.max(0, xp);
        int level = levelFor(safe);
        long floor = floorFor(level);
        return (int) ((safe - floor) * 100 / (nextFor(level) - floor));
    }
}
```

`server/src/main/java/in/gullak/gamification/Stage.java`:

```java
package in.gullak.gamification;

/** Spec 2.6: clay pot 1–4, painted 5–9, gold 10–19, diamond 20 and up. The app mirrors this in stageFor. */
public enum Stage {
    CLAY, PAINTED, GOLD, DIAMOND;

    public static Stage forLevel(int level) {
        if (level >= 20) {
            return DIAMOND;
        }
        if (level >= 10) {
            return GOLD;
        }
        if (level >= 5) {
            return PAINTED;
        }
        return CLAY;
    }
}
```

`server/src/main/java/in/gullak/gamification/LevelView.java`:

```java
package in.gullak.gamification;

public record LevelView(long xp, int level, Stage stage, long floorXp, long nextXp, int percentToNext) {}
```

`server/src/main/java/in/gullak/gamification/XpKinds.java`:

```java
package in.gullak.gamification;

/** XP event kinds written by this plan's jobs (spec 2.6 table). Plan 3 owns the spend kind. */
public final class XpKinds {
    public static final String DAY_UNDER_BUDGET = "day_under_budget";
    public static final String SAVINGS_MET = "savings_met";
    public static final String CHALLENGE_DONE = "challenge_done";

    private XpKinds() {}

    public static String streak(int days) {
        return "streak_" + days;
    }
}
```

`server/src/main/java/in/gullak/gamification/RefTypes.java`:

```java
package in.gullak.gamification;

/** What an XP event's ref_id points at. The close-made ones are left out of "XP earned today". */
public final class RefTypes {
    public static final String DAILY_CLOSE = "daily_close";
    public static final String STREAK = "streak";
    public static final String CYCLE = "cycle";
    public static final String CHALLENGE = "challenge";

    private RefTypes() {}
}
```

`server/src/main/java/in/gullak/gamification/XpLedger.java`:

```java
package in.gullak.gamification;

import in.gullak.common.db.Db;
import in.gullak.common.log.Events;
import in.gullak.common.time.Ist;
import java.time.Clock;
import java.time.LocalDate;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Reads and idempotent writes on Plan 3's xp_events ledger. XP is a ledger, never a counter (spec 2.6):
 * totals are sums of events whose reversed_at is null.
 */
@Component
public class XpLedger {
    private static final Logger log = LoggerFactory.getLogger(XpLedger.class);

    private final JdbcClient jdbc;
    private final Clock clock;

    XpLedger(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** Writes the event unless a live one with the same (kind, refType, refId) exists. True when written. */
    public boolean awardOnce(UUID userId, String kind, int xp, String refType, UUID refId) {
        int n = jdbc.sql("""
                insert into xp_events (id, user_id, kind, xp, ref_type, ref_id, day, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                on conflict (user_id, kind, ref_type, ref_id) where reversed_at is null do nothing
                """)
            .params(UUID.randomUUID(), userId, kind, xp, refType, refId, Ist.today(clock), Db.ts(clock.instant()))
            .update();
        if (n == 1) {
            log.info("{} user={} kind={} xp={}", Events.XP_AWARDED, userId, kind, xp);
        }
        return n == 1;
    }

    public long total(UUID userId) {
        return jdbc.sql("select coalesce(sum(xp), 0) from xp_events where user_id = ? and reversed_at is null")
            .param(userId).query(Long.class).single();
    }

    /** XP from events made during this day in India, leaving out what the 00:05 close awards for the day before. */
    public long earnedOn(UUID userId, LocalDate date) {
        return jdbc.sql("""
                select coalesce(sum(xp), 0) from xp_events
                where user_id = ? and reversed_at is null and created_at >= ? and created_at < ?
                  and coalesce(ref_type, '') not in (?, ?)
                """)
            .params(userId, Db.ts(Ist.startOf(date)), Db.ts(Ist.startOf(date.plusDays(1))), RefTypes.DAILY_CLOSE, RefTypes.STREAK)
            .query(Long.class).single();
    }
}
```

`server/src/main/java/in/gullak/gamification/CelebrationKind.java`:

```java
package in.gullak.gamification;

/** Spec 2.6: the Gullak celebrates on a streak day, a milestone or a level-up; a stage is a full-screen moment. */
public enum CelebrationKind { STREAK_DAY, STREAK_MILESTONE, LEVEL_UP, STAGE_UP, BADGE }
```

`server/src/main/java/in/gullak/gamification/Celebration.java`:

```java
package in.gullak.gamification;

import java.time.Instant;
import java.util.UUID;

/** {@code value}: the date for STREAK_DAY, the days for STREAK_MILESTONE, the level, the stage, or the badge code. */
public record Celebration(UUID id, CelebrationKind kind, String value, Instant createdAt) {}
```

`server/src/main/java/in/gullak/gamification/CelebrationEntity.java`:

```java
package in.gullak.gamification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Read here; rows are written by {@link CelebrationRepository#insertIfAbsent}. */
@Entity
@Table(name = "celebrations")
class CelebrationEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 20)
    private String kind;

    @Column(nullable = false, length = 40)
    private String value;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "seen_at")
    private Instant seenAt;

    protected CelebrationEntity() {}

    Celebration toCelebration() {
        return new Celebration(id, CelebrationKind.valueOf(kind), value, createdAt);
    }
}
```

`server/src/main/java/in/gullak/gamification/CelebrationRepository.java`:

```java
package in.gullak.gamification;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CelebrationRepository extends JpaRepository<CelebrationEntity, UUID> {

    @Modifying
    @Query(value = """
            insert into celebrations (id, user_id, kind, value, created_at) values (:id, :userId, :kind, :value, :at)
            on conflict (user_id, kind, value) do nothing
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("userId") UUID userId, @Param("kind") String kind,
                       @Param("value") String value, @Param("at") Instant at);

    @Query("""
            select c from CelebrationEntity c where c.userId = :userId and c.seenAt is null and c.createdAt >= :since
            order by c.createdAt, c.id
            """)
    List<CelebrationEntity> pending(@Param("userId") UUID userId, @Param("since") Instant since, Limit limit);

    @Modifying(clearAutomatically = true)
    @Query("update CelebrationEntity c set c.seenAt = :now where c.userId = :userId and c.id in :ids and c.seenAt is null")
    int markSeen(@Param("userId") UUID userId, @Param("ids") Collection<UUID> ids, @Param("now") Instant now);
}
```

`server/src/main/java/in/gullak/gamification/CelebrationService.java`:

```java
package in.gullak.gamification;

import java.time.Clock;
import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CelebrationService {
    static final Duration SHOW_FOR = Duration.ofDays(3);
    static final int MAX_PENDING = 10;

    private final CelebrationRepository celebrations;
    private final Clock clock;

    CelebrationService(CelebrationRepository celebrations, Clock clock) {
        this.celebrations = celebrations;
        this.clock = clock;
    }

    /** True when this (kind, value) is new for the user; a repeat is ignored. */
    @Transactional
    public boolean record(UUID userId, CelebrationKind kind, String value) {
        return celebrations.insertIfAbsent(UUID.randomUUID(), userId, kind.name(), value, clock.instant()) == 1;
    }

    /** Not yet acknowledged and less than 3 days old, oldest first, at most 10. */
    @Transactional(readOnly = true)
    public List<Celebration> pending(UUID userId) {
        return celebrations.pending(userId, clock.instant().minus(SHOW_FOR), Limit.of(MAX_PENDING)).stream()
            .map(CelebrationEntity::toCelebration).toList();
    }

    /** Marks the caller's own rows seen; ids that are not theirs or already seen are ignored. */
    @Transactional
    public int ack(UUID userId, Collection<UUID> ids) {
        if (ids.isEmpty()) {
            return 0;
        }
        return celebrations.markSeen(userId, ids, clock.instant());
    }
}
```

`server/src/main/java/in/gullak/gamification/LevelTracker.java`:

```java
package in.gullak.gamification;

import in.gullak.common.log.Events;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Derives the level from the XP ledger and records a level-up (and a stage-up) the first time a level is
 * reached. The high-water mark in game_progress is locked for the comparison, so two syncs at once
 * celebrate once.
 */
@Service
public class LevelTracker {
    private static final Logger log = LoggerFactory.getLogger(LevelTracker.class);

    private final XpLedger ledger;
    private final Levels levels;
    private final CelebrationService celebrations;
    private final JdbcClient jdbc;

    LevelTracker(XpLedger ledger, Levels levels, CelebrationService celebrations, JdbcClient jdbc) {
        this.ledger = ledger;
        this.levels = levels;
        this.celebrations = celebrations;
        this.jdbc = jdbc;
    }

    @Transactional
    public LevelView sync(UUID userId) {
        long xp = ledger.total(userId);
        int level = levels.levelFor(xp);
        jdbc.sql("insert into game_progress (user_id) values (?) on conflict do nothing").param(userId).update();
        int seen = jdbc.sql("select max_level from game_progress where user_id = ? for update")
            .param(userId).query(Integer.class).single();
        if (level > seen) {
            celebrations.record(userId, CelebrationKind.LEVEL_UP, String.valueOf(level));
            Stage after = Stage.forLevel(level);
            if (after != Stage.forLevel(seen)) {
                celebrations.record(userId, CelebrationKind.STAGE_UP, after.name());
            }
            jdbc.sql("update game_progress set max_level = ? where user_id = ?").params(level, userId).update();
            log.info("{} user={} level={}", Events.GAME_LEVEL_UP, userId, level);
        }
        return view(xp, level);
    }

    @Transactional(readOnly = true)
    public LevelView view(UUID userId) {
        long xp = ledger.total(userId);
        return view(xp, levels.levelFor(xp));
    }

    private LevelView view(long xp, int level) {
        return new LevelView(xp, level, Stage.forLevel(level), levels.floorFor(level), levels.nextFor(level),
            levels.percentToNext(xp));
    }
}
```

- [ ] **Step 8: Keep gamification free of other features**

Add to `server/src/test/java/in/gullak/rules/ArchitectureTest.java`:

```java
    /**
     * Goals and imports call gamification (badges, XP), and budget shows goals, so gamification must not
     * depend on any feature or a package cycle appears. It gets budget figures as parameters instead.
     */
    @ArchTest
    static final ArchRule gamificationDependsOnlyOnCommon = noClasses()
        .that().resideInAPackage("in.gullak.gamification..")
        .should().dependOnClassesThat(JavaClass.Predicates.resideInAPackage("in.gullak..")
            .and(DescribedPredicate.not(JavaClass.Predicates.resideInAnyPackage("in.gullak.gamification..", "in.gullak.common.."))));
```

If this fails on a class Plan 3 wrote, move that dependency out of `gamification` (it is a cycle waiting to happen) and say so in the hand-back.

- [ ] **Step 9: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.gamification.*' --tests 'in.gullak.rules.*'`
Expected: PASS.

Then: `cd server && ./gradlew test`
Expected: PASS (Plan 3's XP tests, including XP-01 to XP-04, still pass with the new unique index).

- [ ] **Step 10: Commit**

```bash
git add server/src/main/resources/db/migration/V041__game_progress.sql server/src/main/resources/application.yml server/src/main/java/in/gullak/gamification server/src/main/java/in/gullak/common/log/Events.java server/src/test/java/in/gullak/gamification server/src/test/java/in/gullak/support/ApiTest.java server/src/test/java/in/gullak/rules/ArchitectureTest.java
git commit -m "feat(server): levels, stages, idempotent XP ledger, level-up and stage-up celebrations recorded once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Grades and streak rules

**Owner:** backend-engineer. **Test IDs:** JOB-03, STR-01, STR-03, STR-04, STR-05, STR-06, STR-07 (rule half). **Red team:** no (pure rules; the close that uses them is attacked in Task 6).

**Files:**
- Create: `server/src/main/resources/db/migration/V042__streaks_and_closes.sql`
- Create: `server/src/main/java/in/gullak/gamification/Grade.java`, `StreakState.java`, `StreakOutcome.java`, `StreakRules.java`, `StreakEntity.java`, `StreakRepository.java`, `StreakService.java`
- Test: `server/src/test/java/in/gullak/gamification/GradeTest.java`, `StreakRulesTest.java`, `StreakServiceApiTest.java`

**Interfaces:**
- Consumes: `Events.STREAK_UPDATED` (Plan 1).
- Produces: `Grade { A_PLUS, A, B, C, D, F }` with `Grade.of(long spentPaise, long budgetPaise)` and `label()`; `StreakState(int current, int best, int freezes, LocalDate lastCounted)` with `StreakState.EMPTY`; `StreakOutcome(StreakState next, boolean applied, boolean counted, boolean freezeUsed, boolean freezeEarned, boolean reset, Integer milestone)`; `StreakRules.apply(StreakState, LocalDate, boolean underBudget) : StreakOutcome`, `StreakRules.milestoneXp(int) : int`; `StreakService.apply(UUID, LocalDate, boolean) : StreakOutcome`, `StreakService.current(UUID) : StreakState`; tables `streaks` and `daily_closes` (the latter used in Task 6).

- [ ] **Step 1: Migration**

`server/src/main/resources/db/migration/V042__streaks_and_closes.sql`:

```sql
-- current_days and best_days (spec 4.5 calls them current and best; CURRENT is an SQL keyword).
create table streaks (
    user_id uuid primary key references users (id) on delete cascade,
    current_days int not null default 0 check (current_days >= 0),
    best_days int not null default 0 check (best_days >= 0),
    freezes int not null default 0 check (freezes between 0 and 2),
    last_counted_date date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- The daily close's idempotency record (spec 4.5): one row per user and day, written before anything else.
create table daily_closes (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    date date not null,
    budget_paise bigint not null check (budget_paise >= 0),
    spent_paise bigint not null check (spent_paise >= 0),
    grade varchar(6) not null check (grade in ('A_PLUS', 'A', 'B', 'C', 'D', 'F')),
    under_budget boolean not null,
    freeze_used boolean not null default false,
    streak_after int not null default 0,
    xp_awarded int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, date)
);
```

- [ ] **Step 2: Write the failing unit tests**

`server/src/test/java/in/gullak/gamification/GradeTest.java`:

```java
package in.gullak.gamification;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class GradeTest {
    @ParameterizedTest
    @CsvSource({
        "7900,10000,B", "4900,10000,A_PLUS", "10100,10000,C", "15100,10000,F", // JOB-03
        "0,10000,A_PLUS", "4999,10000,A_PLUS", "5000,10000,A", "6999,10000,A", "7000,10000,B",
        "10000,10000,B", "10001,10000,C", "12500,10000,C", "12501,10000,D", "15000,10000,D", "15001,10000,F",
        "46000,58000,B", "72000,59333,C"})
    void gradeByShareOfTheBudgetUsed(long spent, long budget, Grade grade) {
        assertThat(Grade.of(spent, budget)).isEqualTo(grade);
    }

    @Test
    void aZeroBudgetDay() {
        assertThat(Grade.of(0, 0)).isEqualTo(Grade.A_PLUS);
        assertThat(Grade.of(1, 0)).isEqualTo(Grade.F);
    }

    @Test
    void labels() {
        assertThat(Grade.A_PLUS.label()).isEqualTo("A+");
        assertThat(Grade.F.label()).isEqualTo("F");
    }
}
```

`server/src/test/java/in/gullak/gamification/StreakRulesTest.java`:

```java
package in.gullak.gamification;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class StreakRulesTest {
    static final LocalDate START = LocalDate.of(2026, 9, 1);

    /** Applies one close per day from START; true is a day at or under budget. */
    static List<StreakOutcome> run(boolean... days) {
        List<StreakOutcome> out = new ArrayList<>();
        StreakState s = StreakState.EMPTY;
        for (int i = 0; i < days.length; i++) {
            StreakOutcome o = StreakRules.apply(s, START.plusDays(i), days[i]);
            out.add(o);
            s = o.next();
        }
        return out;
    }

    static boolean[] under(int n) {
        boolean[] d = new boolean[n];
        java.util.Arrays.fill(d, true);
        return d;
    }

    static boolean[] concat(boolean[] a, boolean... b) {
        boolean[] r = java.util.Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, r, a.length, b.length);
        return r;
    }

    static StreakState last(List<StreakOutcome> o) {
        return o.getLast().next();
    }

    @Test
    void fiveDaysUnderIsFive() { // STR-01
        assertThat(last(run(under(5))).current()).isEqualTo(5);
    }

    @Test
    void daySevenEarnsAFreeze() { // STR-03
        List<StreakOutcome> o = run(under(7));
        assertThat(o.get(5).next().freezes()).isZero();
        assertThat(o.get(6).freezeEarned()).isTrue();
        assertThat(last(o).freezes()).isEqualTo(1);
    }

    @Test
    void freezesCapAtTwo() { // STR-04
        List<StreakOutcome> o = run(under(21));
        assertThat(o.get(13).next().freezes()).isEqualTo(2);
        assertThat(o.get(20).freezeEarned()).isFalse();
        assertThat(last(o).freezes()).isEqualTo(2);
    }

    @Test
    void aFreezeIsUsedOnTheFirstDayOver() { // STR-05
        StreakOutcome o = run(concat(under(7), false)).getLast();
        assertThat(o.freezeUsed()).isTrue();
        assertThat(o.next().current()).isEqualTo(7);
        assertThat(o.next().freezes()).isZero();
        assertThat(o.reset()).isFalse();
    }

    @Test
    void overWithNoFreezeBreaksTheStreakButKeepsTheBest() { // STR-06
        StreakOutcome o = run(concat(under(3), false)).getLast();
        assertThat(o.reset()).isTrue();
        assertThat(o.next().current()).isZero();
        assertThat(o.next().best()).isEqualTo(3);
    }

    @Test
    void milestonesAt7And30And100Once() { // STR-07
        List<Integer> milestones = run(under(100)).stream().map(StreakOutcome::milestone).filter(m -> m != null).toList();
        assertThat(milestones).containsExactly(7, 30, 100);
        assertThat(StreakRules.milestoneXp(7)).isEqualTo(100);
        assertThat(StreakRules.milestoneXp(30)).isEqualTo(500);
        assertThat(StreakRules.milestoneXp(100)).isEqualTo(2000);
    }

    @Test
    void theSameDayIsNeverAppliedTwice() {
        StreakOutcome first = StreakRules.apply(StreakState.EMPTY, START, true);
        StreakOutcome again = StreakRules.apply(first.next(), START, true);
        assertThat(again.applied()).isFalse();
        assertThat(again.next()).isEqualTo(first.next());
        assertThat(StreakRules.apply(first.next(), START.minusDays(1), true).applied()).isFalse();
    }

    @Test
    void aGapInClosesStartsAgain() {
        StreakOutcome first = run(under(4)).getLast();
        StreakOutcome after = StreakRules.apply(first.next(), START.plusDays(6), true);
        assertThat(after.next().current()).isEqualTo(1);
        assertThat(after.next().best()).isEqualTo(4);
    }

    @Test
    void anOverDayAtZeroDoesNotSpendAFreeze() {
        StreakState held = new StreakState(0, 9, 1, START);
        StreakOutcome o = StreakRules.apply(held, START.plusDays(1), false);
        assertThat(o.freezeUsed()).isFalse();
        assertThat(o.next().freezes()).isEqualTo(1);
    }
}
```

- [ ] **Step 3: Write the failing integration test**

`server/src/test/java/in/gullak/gamification/StreakServiceApiTest.java`:

```java
package in.gullak.gamification;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class StreakServiceApiTest extends ApiTest {
    static final LocalDate DAY = LocalDate.of(2026, 10, 22);

    @Autowired StreakService streaks;

    @Test
    void applyPersists() throws Exception {
        TestUser u = signIn();
        assertThat(streaks.current(u.id())).isEqualTo(StreakState.EMPTY);
        streaks.apply(u.id(), DAY, true);
        streaks.apply(u.id(), DAY.plusDays(1), true);
        assertThat(streaks.current(u.id())).isEqualTo(new StreakState(2, 2, 0, DAY.plusDays(1)));
    }

    @Test
    void twoClosesOfOneDayAtOnceCountItOnce() throws Exception {
        TestUser u = signIn();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Callable<Boolean> call = () -> streaks.apply(u.id(), DAY, true).applied();
            List<Future<Boolean>> fs = new ArrayList<>(pool.invokeAll(List.of(call, call)));
            int applied = 0;
            for (Future<Boolean> f : fs) {
                applied += f.get() ? 1 : 0;
            }
            assertThat(applied).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
        assertThat(streaks.current(u.id()).current()).isEqualTo(1);
    }
}
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.gamification.GradeTest' --tests 'in.gullak.gamification.Streak*'`
Expected: compilation fails (`Grade`, `StreakRules`, `StreakService` missing).

- [ ] **Step 5: Write the code**

`server/src/main/java/in/gullak/gamification/Grade.java`:

```java
package in.gullak.gamification;

/**
 * Spec 2.7: A+ under 50% of the day's budget, A 50–69%, B 70–100%, C 101–125%, D 126–150%, F above 150%.
 * Compared exactly in paise, so B ends at spent = budget, the same line as "under budget" for the streak.
 */
public enum Grade {
    A_PLUS("A+"), A("A"), B("B"), C("C"), D("D"), F("F");

    private final String label;

    Grade(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static Grade of(long spentPaise, long budgetPaise) {
        if (budgetPaise <= 0) {
            return spentPaise <= 0 ? A_PLUS : F;
        }
        long scaled = spentPaise * 100;
        if (scaled < 50 * budgetPaise) {
            return A_PLUS;
        }
        if (scaled < 70 * budgetPaise) {
            return A;
        }
        if (scaled <= 100 * budgetPaise) {
            return B;
        }
        if (scaled <= 125 * budgetPaise) {
            return C;
        }
        if (scaled <= 150 * budgetPaise) {
            return D;
        }
        return F;
    }
}
```

`server/src/main/java/in/gullak/gamification/StreakState.java`:

```java
package in.gullak.gamification;

import java.time.LocalDate;

public record StreakState(int current, int best, int freezes, LocalDate lastCounted) {
    public static final StreakState EMPTY = new StreakState(0, 0, 0, null);
}
```

`server/src/main/java/in/gullak/gamification/StreakOutcome.java`:

```java
package in.gullak.gamification;

/**
 * @param applied   false when the day was already applied (or is older than the last one); nothing changed
 * @param counted   the day added one to the streak
 * @param milestone 7, 30 or 100 when the streak reached it with this day, else null
 */
public record StreakOutcome(StreakState next, boolean applied, boolean counted, boolean freezeUsed,
                            boolean freezeEarned, boolean reset, Integer milestone) {}
```

`server/src/main/java/in/gullak/gamification/StreakRules.java`:

```java
package in.gullak.gamification;

import java.time.LocalDate;
import java.util.Map;

/**
 * Spec 2.6: a day counts when spent is at or under the budget at close (no-spend days count). Every 7
 * consecutive days earns a freeze, up to 2 held. A freeze is used on the first day over, keeping the count.
 * A gap between closed days starts the streak again. Pure; unit-tested.
 */
public final class StreakRules {
    public static final int MAX_FREEZES = 2;
    public static final int FREEZE_EVERY = 7;
    private static final Map<Integer, Integer> MILESTONE_XP = Map.of(7, 100, 30, 500, 100, 2000);

    private StreakRules() {}

    public static int milestoneXp(int days) {
        Integer xp = MILESTONE_XP.get(days);
        if (xp == null) {
            throw new IllegalArgumentException("not a streak milestone: " + days);
        }
        return xp;
    }

    public static StreakOutcome apply(StreakState s, LocalDate day, boolean underBudget) {
        if (s.lastCounted() != null && !day.isAfter(s.lastCounted())) {
            return new StreakOutcome(s, false, false, false, false, false, null);
        }
        int current = s.current();
        if (s.lastCounted() != null && day.isAfter(s.lastCounted().plusDays(1))) {
            current = 0;
        }
        int freezes = s.freezes();
        boolean counted = false;
        boolean used = false;
        boolean earned = false;
        boolean reset = false;
        Integer milestone = null;
        if (underBudget) {
            current++;
            counted = true;
            if (current % FREEZE_EVERY == 0 && freezes < MAX_FREEZES) {
                freezes++;
                earned = true;
            }
            if (MILESTONE_XP.containsKey(current)) {
                milestone = current;
            }
        } else if (freezes > 0 && current > 0) {
            freezes--;
            used = true;
        } else {
            reset = s.current() > 0;
            current = 0;
        }
        StreakState next = new StreakState(current, Math.max(s.best(), current), freezes, day);
        return new StreakOutcome(next, true, counted, used, earned, reset, milestone);
    }
}
```

`server/src/main/java/in/gullak/gamification/StreakEntity.java`:

```java
package in.gullak.gamification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "streaks")
class StreakEntity {
    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "current_days", nullable = false)
    private int currentDays;

    @Column(name = "best_days", nullable = false)
    private int bestDays;

    @Column(nullable = false)
    private int freezes;

    @Column(name = "last_counted_date")
    private LocalDate lastCountedDate;

    protected StreakEntity() {}

    StreakState toState() {
        return new StreakState(currentDays, bestDays, freezes, lastCountedDate);
    }

    void apply(StreakState s) {
        currentDays = s.current();
        bestDays = s.best();
        freezes = s.freezes();
        lastCountedDate = s.lastCounted();
    }
}
```

`server/src/main/java/in/gullak/gamification/StreakRepository.java`:

```java
package in.gullak.gamification;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface StreakRepository extends JpaRepository<StreakEntity, UUID> {

    @Modifying
    @Query(value = "insert into streaks (user_id) values (:userId) on conflict do nothing", nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from StreakEntity s where s.userId = :userId")
    Optional<StreakEntity> findForUpdate(@Param("userId") UUID userId);
}
```

`server/src/main/java/in/gullak/gamification/StreakService.java`:

```java
package in.gullak.gamification;

import in.gullak.common.log.Events;
import java.time.LocalDate;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StreakService {
    private static final Logger log = LoggerFactory.getLogger(StreakService.class);

    private final StreakRepository streaks;

    StreakService(StreakRepository streaks) {
        this.streaks = streaks;
    }

    /** Applies one closed day under the row lock, so two closes of one day count it once. */
    @Transactional
    public StreakOutcome apply(UUID userId, LocalDate day, boolean underBudget) {
        streaks.insertIfAbsent(userId);
        StreakEntity row = streaks.findForUpdate(userId).orElseThrow();
        StreakOutcome o = StreakRules.apply(row.toState(), day, underBudget);
        if (o.applied()) {
            row.apply(o.next());
            log.info("{} user={} current={} freezes={} freezeUsed={}", Events.STREAK_UPDATED, userId,
                o.next().current(), o.next().freezes(), o.freezeUsed());
        }
        return o;
    }

    @Transactional(readOnly = true)
    public StreakState current(UUID userId) {
        return streaks.findById(userId).map(StreakEntity::toState).orElse(StreakState.EMPTY);
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.gamification.*'`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/main/resources/db/migration/V042__streaks_and_closes.sql server/src/main/java/in/gullak/gamification server/src/test/java/in/gullak/gamification
git commit -m "feat(server): daily grade rule, streak rules with freezes and milestones, locked streak updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Badges behind Plan 4's BadgeTrigger interface

**Owner:** backend-engineer. **Test IDs:** BDG-01, BDG-02, BDG-03, BDG-04, BDG-05, BDG-06, BDG-07, BDG-08; XP-07 (Plan 4 awards the +10; Step 6 re-checks it with the Sorted badge in Plan 4's commit test). **Red team:** yes (₹1 a day for badges; a badge earned twice under a race; one user's trigger awarding another).

**Files:**
- Create: `server/src/main/resources/db/migration/V043__badges.sql`
- Create: `server/src/main/java/in/gullak/gamification/Badge.java`, `EarnedBadge.java`, `UserBadgeEntity.java`, `UserBadgeRepository.java`, `BadgeCounters.java`, `DayFacts.java`, `GameQueries.java`, `BadgeService.java`
- Modify: `server/src/main/java/in/gullak/gamification/BadgeTrigger.java` (Plan 4's interface: append `SUBSCRIPTION_SLAYER`), `server/src/main/java/in/gullak/gamification/LevelTracker.java` (Diamond Gullak), `server/src/test/java/in/gullak/support/ApiTest.java` (`seedCategorySpend`), Plan 4's commit test and Plan 5's goal completion test (one assertion each, Step 6)
- Test: `server/src/test/java/in/gullak/gamification/BadgeServiceApiTest.java`

**Interfaces:**
- Consumes: `CelebrationService.record`, `LevelTracker` (Task 3); `StreakOutcome` (Task 4); the `transactions` table (Plan 1, columns `category_code`, `direction`, `source`, `deleted_at`, `occurred_at`).
- Produces: `Badge { FIRST_LOG, WEEK_WARRIOR, NO_SWIGGY_SUNDAY, ZEPTO_FREE_WEEK, SUBSCRIPTION_SLAYER, GOAL_CRUSHER, HONEST_LOGGER, SORTED, COMEBACK_KID, DIAMOND_GULLAK }` and `Badge.challengeCode(String categoryCode)`; `BadgeService implements BadgeTrigger` (Plan 4's `fire(UUID userId, String trigger, UUID refId)`: maps the trigger to `Badge.valueOf(trigger.toUpperCase(Locale.ROOT))` and earns it); `BadgeService.earn(UUID userId, Badge badge) : boolean` (true the first time only); `BadgeTrigger.SUBSCRIPTION_SLAYER = "subscription_slayer"`; `BadgeService.earnCode(UUID, String) : boolean`, `earned(UUID) : List<EarnedBadge>`, `checkFirstLog(UUID)`, `afterClose(UUID, DayFacts, StreakOutcome)`, `counter(UUID, String) : int`; `BadgeCounters.ZEPTO_FREE`, `BadgeCounters.OVER_RUN`; `DayFacts(LocalDate date, boolean underBudget, int foodDeliverySpends, int quickCommerceSpends)`; `GameQueries.dayFacts(UUID, LocalDate, boolean) : DayFacts`, `hasLoggedSpend(UUID) : boolean`; `EarnedBadge(String code, Instant earnedAt)`; test helper `seedCategorySpend(TestUser, long paise, Instant at, String category, String merchant) : UUID`.

- [ ] **Step 1: Migration**

`server/src/main/resources/db/migration/V043__badges.sql`:

```sql
create table user_badges (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    badge_code varchar(40) not null,
    earned_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, badge_code)
);

-- Running counts for badges that need a run of days: zepto_free (closed days without quick commerce)
-- and over_run (closed days over budget in a row).
create table badge_counters (
    user_id uuid not null references users (id) on delete cascade,
    counter varchar(30) not null,
    value int not null default 0 check (value >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, counter)
);
```

- [ ] **Step 2: Test helper**

Add to `ApiTest.java`:

```java
    /** A manual debit in a category, with an optional merchant name. */
    protected UUID seedCategorySpend(TestUser user, long paise, Instant at, String category, String merchant) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                insert into transactions (id, user_id, client_id, amount_paise, direction, occurred_at,
                    merchant_name, category_code, payment_method, source, status)
                values (?, ?, ?, ?, 'debit', ?, ?, ?, 'upi', 'manual', 'pending')
                """)
            .params(id, user.id(), UUID.randomUUID(), paise, OffsetDateTime.ofInstant(at, ZoneOffset.UTC), merchant, category)
            .update();
        return id;
    }
```

- [ ] **Step 3: Write the failing tests**

`server/src/test/java/in/gullak/gamification/BadgeServiceApiTest.java`:

```java
package in.gullak.gamification;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class BadgeServiceApiTest extends ApiTest {
    static final LocalDate SAT = LocalDate.of(2026, 10, 24);
    static final LocalDate SUN = LocalDate.of(2026, 10, 25);

    @Autowired BadgeService badges;
    @Autowired GameQueries queries;
    @Autowired LevelTracker levels;

    static StreakOutcome streakAt(int current, LocalDate day) {
        return new StreakOutcome(new StreakState(current, current, 0, day), true, true, false, false, false, null);
    }

    static StreakOutcome overDay(LocalDate day) {
        return new StreakOutcome(new StreakState(0, 0, 0, day), true, false, false, false, false, null);
    }

    int rows(TestUser u, String code) {
        return jdbc.sql("select count(*) from user_badges where user_id = ? and badge_code = ?")
            .params(u.id(), code).query(Integer.class).single();
    }

    @Test
    void firstLogOnceTheFirstSpendExists() throws Exception { // BDG-01
        TestUser u = signIn();
        badges.checkFirstLog(u.id());
        assertThat(rows(u, "FIRST_LOG")).isZero();
        seedSpend(u, 100, clock.instant());
        badges.checkFirstLog(u.id());
        badges.checkFirstLog(u.id());
        assertThat(rows(u, "FIRST_LOG")).isEqualTo(1);
        assertThat(celebrationCount(u, "BADGE")).isEqualTo(1);
    }

    @Test
    void weekWarriorAtSevenAndNotAgainAtFourteen() throws Exception { // BDG-02
        TestUser u = signIn();
        badges.afterClose(u.id(), new DayFacts(SAT, true, 0, 0), streakAt(6, SAT));
        assertThat(rows(u, "WEEK_WARRIOR")).isZero();
        badges.afterClose(u.id(), new DayFacts(SAT, true, 0, 0), streakAt(7, SAT));
        badges.afterClose(u.id(), new DayFacts(SAT, true, 0, 0), streakAt(14, SAT));
        assertThat(rows(u, "WEEK_WARRIOR")).isEqualTo(1);
    }

    @Test
    void noSwiggySundayFromTheDaysSpends() throws Exception { // BDG-03
        TestUser clean = signIn();
        seedCategorySpend(clean, 18_000, Instant.parse("2026-10-25T07:00:00Z"), "eating_out", null);
        badges.afterClose(clean.id(), queries.dayFacts(clean.id(), SUN, true), streakAt(1, SUN));
        assertThat(rows(clean, "NO_SWIGGY_SUNDAY")).isEqualTo(1);

        TestUser swiggy = signIn();
        seedCategorySpend(swiggy, 28_000, Instant.parse("2026-10-25T15:10:00Z"), "food_delivery", "Swiggy");
        badges.afterClose(swiggy.id(), queries.dayFacts(swiggy.id(), SUN, true), streakAt(1, SUN));
        assertThat(rows(swiggy, "NO_SWIGGY_SUNDAY")).isZero();

        TestUser saturday = signIn();
        badges.afterClose(saturday.id(), queries.dayFacts(saturday.id(), SAT, true), streakAt(1, SAT));
        assertThat(rows(saturday, "NO_SWIGGY_SUNDAY")).isZero();
    }

    @Test
    void zeptoFreeWeekResetsOnAQuickCommerceDay() throws Exception { // BDG-04
        TestUser u = signIn();
        LocalDate d = LocalDate.of(2026, 10, 1);
        badges.afterClose(u.id(), new DayFacts(d, true, 0, 0), streakAt(1, d));
        badges.afterClose(u.id(), new DayFacts(d.plusDays(1), true, 0, 0), streakAt(2, d));
        badges.afterClose(u.id(), new DayFacts(d.plusDays(2), true, 0, 1), streakAt(3, d)); // a Zepto order on day 3
        assertThat(badges.counter(u.id(), BadgeCounters.ZEPTO_FREE)).isZero();
        for (int i = 3; i < 9; i++) {
            badges.afterClose(u.id(), new DayFacts(d.plusDays(i), true, 0, 0), streakAt(i + 1, d));
        }
        assertThat(badges.counter(u.id(), BadgeCounters.ZEPTO_FREE)).isEqualTo(6);
        assertThat(rows(u, "ZEPTO_FREE_WEEK")).isZero();
        badges.afterClose(u.id(), new DayFacts(d.plusDays(9), true, 0, 0), streakAt(10, d));
        assertThat(rows(u, "ZEPTO_FREE_WEEK")).isEqualTo(1);
    }

    @Test
    void subscriptionSlayerOnce() throws Exception { // BDG-05
        TestUser u = signIn();
        assertThat(badges.earn(u.id(), Badge.SUBSCRIPTION_SLAYER)).isTrue();
        assertThat(badges.earn(u.id(), Badge.SUBSCRIPTION_SLAYER)).isFalse();
        assertThat(rows(u, "SUBSCRIPTION_SLAYER")).isEqualTo(1);
    }

    @Test
    void plan4TriggerStringsMapToBadges() throws Exception { // BDG-05, the BadgeTrigger half
        TestUser u = signIn();
        badges.fire(u.id(), BadgeTrigger.SORTED, UUID.randomUUID());
        badges.fire(u.id(), BadgeTrigger.SORTED, UUID.randomUUID());
        badges.fire(u.id(), BadgeTrigger.GOAL_CRUSHER, UUID.randomUUID());
        assertThat(rows(u, "SORTED")).isEqualTo(1);
        assertThat(rows(u, "GOAL_CRUSHER")).isEqualTo(1);
    }

    @Test
    void comebackKidAfterThreeDaysOver() throws Exception { // BDG-06
        TestUser u = signIn();
        LocalDate d = LocalDate.of(2026, 10, 1);
        for (int i = 0; i < 3; i++) {
            badges.afterClose(u.id(), new DayFacts(d.plusDays(i), false, 0, 0), overDay(d.plusDays(i)));
        }
        badges.afterClose(u.id(), new DayFacts(d.plusDays(3), true, 0, 0), streakAt(1, d.plusDays(3)));
        assertThat(rows(u, "COMEBACK_KID")).isEqualTo(1);
        assertThat(badges.counter(u.id(), BadgeCounters.OVER_RUN)).isZero();
    }

    @Test
    void twoDaysOverIsNotAComeback() throws Exception { // BDG-06
        TestUser u = signIn();
        LocalDate d = LocalDate.of(2026, 10, 1);
        badges.afterClose(u.id(), new DayFacts(d, false, 0, 0), overDay(d));
        badges.afterClose(u.id(), new DayFacts(d.plusDays(1), false, 0, 0), overDay(d.plusDays(1)));
        badges.afterClose(u.id(), new DayFacts(d.plusDays(2), true, 0, 0), streakAt(1, d.plusDays(2)));
        assertThat(rows(u, "COMEBACK_KID")).isZero();
    }

    @Test
    void diamondGullakAtLevel20() throws Exception { // BDG-07
        TestUser u = signIn();
        seedXp(u, 39_999);
        levels.sync(u.id());
        assertThat(rows(u, "DIAMOND_GULLAK")).isZero();
        seedXp(u, 1);
        levels.sync(u.id());
        assertThat(rows(u, "DIAMOND_GULLAK")).isEqualTo(1);
    }

    @Test
    void racingTriggersMakeOneRow() throws Exception { // BDG-08
        TestUser u = signIn();
        ExecutorService pool = Executors.newFixedThreadPool(4);
        try {
            Callable<Boolean> call = () -> badges.earn(u.id(), Badge.SORTED);
            List<Future<Boolean>> fs = new ArrayList<>(pool.invokeAll(List.of(call, call, call, call)));
            int won = 0;
            for (Future<Boolean> f : fs) {
                won += f.get() ? 1 : 0;
            }
            assertThat(won).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
        assertThat(rows(u, "SORTED")).isEqualTo(1);
        assertThat(celebrationCount(u, "BADGE")).isEqualTo(1);
    }

    @Test
    void earnedListIsOnlyTheCallersOwn() throws Exception {
        TestUser a = signIn();
        TestUser b = signIn();
        badges.earn(a.id(), Badge.SORTED);
        assertThat(badges.earned(b.id())).isEmpty();
        assertThat(badges.earned(a.id())).extracting(EarnedBadge::code).containsExactly("SORTED");
    }

    @Test
    void challengeCodesAreTheirOwnFamily() {
        assertThat(Badge.challengeCode("food_delivery")).isEqualTo("CHALLENGE_FOOD_DELIVERY");
    }
}
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.gamification.BadgeServiceApiTest'`
Expected: compilation fails (`BadgeService`, `Badge`, `DayFacts`, `GameQueries` missing).

- [ ] **Step 5: Write the code**

`server/src/main/java/in/gullak/gamification/Badge.java`:

```java
package in.gullak.gamification;

import java.util.Locale;

/** Spec 2.6's ten badges. The weekly challenge's category badges use {@link #challengeCode}. */
public enum Badge {
    FIRST_LOG, WEEK_WARRIOR, NO_SWIGGY_SUNDAY, ZEPTO_FREE_WEEK, SUBSCRIPTION_SLAYER,
    GOAL_CRUSHER, HONEST_LOGGER, SORTED, COMEBACK_KID, DIAMOND_GULLAK;

    public static final String CHALLENGE_PREFIX = "CHALLENGE_";

    public static String challengeCode(String categoryCode) {
        return CHALLENGE_PREFIX + categoryCode.toUpperCase(Locale.ROOT);
    }
}
```

Plan 4 already created `server/src/main/java/in/gullak/gamification/BadgeTrigger.java` (`fire(UUID userId, String trigger, UUID refId)` with `SORTED`, `HONEST_LOGGER`, and Plan 5's `GOAL_CRUSHER`). It is the one way other features award a badge; this plan implements it and appends Plan 7's constant next to the others:

```java
    String SUBSCRIPTION_SLAYER = "subscription_slayer";
```

Every trigger string is a `Badge` name in lower case, so `BadgeService.fire` maps it with `Badge.valueOf(trigger.toUpperCase(Locale.ROOT))`.

`server/src/main/java/in/gullak/gamification/EarnedBadge.java`:

```java
package in.gullak.gamification;

import java.time.Instant;

public record EarnedBadge(String code, Instant earnedAt) {}
```

`server/src/main/java/in/gullak/gamification/UserBadgeEntity.java`:

```java
package in.gullak.gamification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Read here; rows are written by {@link UserBadgeRepository#insertIfAbsent}. */
@Entity
@Table(name = "user_badges")
class UserBadgeEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "badge_code", nullable = false, length = 40)
    private String badgeCode;

    @Column(name = "earned_at", nullable = false)
    private Instant earnedAt;

    protected UserBadgeEntity() {}

    EarnedBadge toEarned() {
        return new EarnedBadge(badgeCode, earnedAt);
    }
}
```

`server/src/main/java/in/gullak/gamification/UserBadgeRepository.java`:

```java
package in.gullak.gamification;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface UserBadgeRepository extends JpaRepository<UserBadgeEntity, UUID> {

    @Modifying
    @Query(value = """
            insert into user_badges (id, user_id, badge_code, earned_at) values (:id, :userId, :code, :at)
            on conflict (user_id, badge_code) do nothing
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("userId") UUID userId, @Param("code") String code,
                       @Param("at") Instant at);

    boolean existsByUserIdAndBadgeCode(UUID userId, String badgeCode);

    List<UserBadgeEntity> findByUserIdOrderByEarnedAtAscBadgeCodeAsc(UUID userId);
}
```

`server/src/main/java/in/gullak/gamification/BadgeCounters.java`:

```java
package in.gullak.gamification;

import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Atomic counters for run-of-days badges, one row per (user, counter). */
@Component
class BadgeCounters {
    static final String ZEPTO_FREE = "zepto_free";
    static final String OVER_RUN = "over_run";

    private final JdbcClient jdbc;

    BadgeCounters(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    int increment(UUID userId, String counter) {
        return jdbc.sql("""
                insert into badge_counters (user_id, counter, value) values (?, ?, 1)
                on conflict (user_id, counter) do update set value = badge_counters.value + 1
                returning value
                """)
            .params(userId, counter).query(Integer.class).single();
    }

    void reset(UUID userId, String counter) {
        jdbc.sql("""
                insert into badge_counters (user_id, counter, value) values (?, ?, 0)
                on conflict (user_id, counter) do update set value = 0
                """)
            .params(userId, counter).update();
    }

    int value(UUID userId, String counter) {
        return jdbc.sql("select coalesce((select value from badge_counters where user_id = ? and counter = ?), 0)")
            .params(userId, counter).query(Integer.class).single();
    }
}
```

`server/src/main/java/in/gullak/gamification/DayFacts.java`:

```java
package in.gullak.gamification;

import java.time.LocalDate;

/** What the close knows about one user's day in India, for the badges. Counts, never amounts. */
public record DayFacts(LocalDate date, boolean underBudget, int foodDeliverySpends, int quickCommerceSpends) {}
```

`server/src/main/java/in/gullak/gamification/GameQueries.java`:

```java
package in.gullak.gamification;

import in.gullak.common.db.Db;
import in.gullak.common.time.Ist;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Read-only aggregates over the transactions table for the game. Gamification reads the table rather than
 * calling the spends feature, which itself calls gamification for XP (no package cycle).
 */
@Component
class GameQueries {
    static final String FOOD_DELIVERY = "food_delivery";
    static final String QUICK_COMMERCE = "quick_commerce";

    private final JdbcClient jdbc;

    GameQueries(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    DayFacts dayFacts(UUID userId, LocalDate date, boolean underBudget) {
        return jdbc.sql("""
                select count(*) filter (where category_code = ?) as food,
                       count(*) filter (where category_code = ?) as qc
                from transactions
                where user_id = ? and direction = 'debit' and deleted_at is null
                  and occurred_at >= ? and occurred_at < ?
                """)
            .params(FOOD_DELIVERY, QUICK_COMMERCE, userId, Db.ts(Ist.startOf(date)), Db.ts(Ist.startOf(date.plusDays(1))))
            .query((rs, n) -> new DayFacts(date, underBudget, rs.getInt("food"), rs.getInt("qc")))
            .single();
    }

    /** Ever logged a spend by hand, deleted or not: the First log badge is about logging, and is never taken back. */
    boolean hasLoggedSpend(UUID userId) {
        return jdbc.sql("select exists (select 1 from transactions where user_id = ? and source = 'manual' and direction = 'debit')")
            .param(userId).query(Boolean.class).single();
    }
}
```

`server/src/main/java/in/gullak/gamification/BadgeService.java`:

```java
package in.gullak.gamification;

import in.gullak.common.log.Events;
import java.time.Clock;
import java.time.DayOfWeek;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BadgeService implements BadgeTrigger {
    private static final Logger log = LoggerFactory.getLogger(BadgeService.class);
    static final int WEEK = 7;
    static final int BAD_DAYS = 3;

    private final UserBadgeRepository badges;
    private final BadgeCounters counters;
    private final GameQueries queries;
    private final CelebrationService celebrations;
    private final Clock clock;

    BadgeService(UserBadgeRepository badges, BadgeCounters counters, GameQueries queries,
                 CelebrationService celebrations, Clock clock) {
        this.badges = badges;
        this.counters = counters;
        this.queries = queries;
        this.celebrations = celebrations;
        this.clock = clock;
    }

    /** Plan 4's hook, fired by Plans 4, 5 and 7 inside their own transactions. Idempotent; refId is not stored. */
    @Override
    @Transactional
    public void fire(UUID userId, String trigger, UUID refId) {
        earn(userId, Badge.valueOf(trigger.toUpperCase(Locale.ROOT)));
    }

    /** Idempotent: call it every time the condition holds; true only the first time. */
    @Transactional
    public boolean earn(UUID userId, Badge badge) {
        return earnCode(userId, badge.name());
    }

    /** Badges are never taken back; a second earn is a no-op that returns false. */
    @Transactional
    public boolean earnCode(UUID userId, String code) {
        if (badges.insertIfAbsent(UUID.randomUUID(), userId, code, clock.instant()) == 0) {
            return false;
        }
        celebrations.record(userId, CelebrationKind.BADGE, code);
        log.info("{} user={} badge={}", Events.BADGE_EARNED, userId, code);
        return true;
    }

    @Transactional(readOnly = true)
    public List<EarnedBadge> earned(UUID userId) {
        return badges.findByUserIdOrderByEarnedAtAscBadgeCodeAsc(userId).stream().map(UserBadgeEntity::toEarned).toList();
    }

    @Transactional
    public void checkFirstLog(UUID userId) {
        if (!badges.existsByUserIdAndBadgeCode(userId, Badge.FIRST_LOG.name()) && queries.hasLoggedSpend(userId)) {
            earn(userId, Badge.FIRST_LOG);
        }
    }

    /** The badges a closed day can earn. Called once per user and day, in date order, by the daily close. */
    @Transactional
    public void afterClose(UUID userId, DayFacts day, StreakOutcome streak) {
        if (streak.next().current() >= WEEK) {
            earn(userId, Badge.WEEK_WARRIOR);
        }
        if (day.date().getDayOfWeek() == DayOfWeek.SUNDAY && day.foodDeliverySpends() == 0) {
            earn(userId, Badge.NO_SWIGGY_SUNDAY);
        }
        if (day.quickCommerceSpends() > 0) {
            counters.reset(userId, BadgeCounters.ZEPTO_FREE);
        } else if (counters.increment(userId, BadgeCounters.ZEPTO_FREE) >= WEEK) {
            earn(userId, Badge.ZEPTO_FREE_WEEK);
        }
        if (!day.underBudget()) {
            counters.increment(userId, BadgeCounters.OVER_RUN);
        } else {
            if (counters.value(userId, BadgeCounters.OVER_RUN) >= BAD_DAYS) {
                earn(userId, Badge.COMEBACK_KID);
            }
            counters.reset(userId, BadgeCounters.OVER_RUN);
        }
    }

    @Transactional(readOnly = true)
    public int counter(UUID userId, String counter) {
        return counters.value(userId, counter);
    }
}
```

Replace `LevelTracker`'s constructor and `sync` (Task 3) so level 20 earns Diamond Gullak:

```java
    private final XpLedger ledger;
    private final Levels levels;
    private final CelebrationService celebrations;
    private final BadgeService badges;
    private final JdbcClient jdbc;

    LevelTracker(XpLedger ledger, Levels levels, CelebrationService celebrations, BadgeService badges, JdbcClient jdbc) {
        this.ledger = ledger;
        this.levels = levels;
        this.celebrations = celebrations;
        this.badges = badges;
        this.jdbc = jdbc;
    }

    @Transactional
    public LevelView sync(UUID userId) {
        long xp = ledger.total(userId);
        int level = levels.levelFor(xp);
        jdbc.sql("insert into game_progress (user_id) values (?) on conflict do nothing").param(userId).update();
        int seen = jdbc.sql("select max_level from game_progress where user_id = ? for update")
            .param(userId).query(Integer.class).single();
        if (level > seen) {
            celebrations.record(userId, CelebrationKind.LEVEL_UP, String.valueOf(level));
            Stage after = Stage.forLevel(level);
            if (after != Stage.forLevel(seen)) {
                celebrations.record(userId, CelebrationKind.STAGE_UP, after.name());
            }
            jdbc.sql("update game_progress set max_level = ? where user_id = ?").params(level, userId).update();
            log.info("{} user={} level={}", Events.GAME_LEVEL_UP, userId, level);
        }
        if (level >= 20) {
            badges.earn(userId, Badge.DIAMOND_GULLAK);
        }
        return view(xp, level);
    }
```

- [ ] **Step 6: Connect Plans 4 and 5 to the triggers**

Plans 4 and 5 are already implemented and already fire through Plan 4's `BadgeTrigger` (`ObjectProvider<BadgeTrigger>`): Plan 4's commit fires `BadgeTrigger.SORTED` and `BadgeTrigger.HONEST_LOGGER`, Plan 5's `GoalProgressService.complete` fires `BadgeTrigger.GOAL_CRUSHER`. `BadgeService` is now a production `BadgeTrigger`, so no call changes. Check that the calls sit where this plan expects them:

- Plan 4, in `CommitService` (the `POST /imports/{id}/commit` path), right after its +10 XP award for finishing the sort: `b.fire(userId, BadgeTrigger.SORTED, importId)` and, inside the branch that awards +50 XP for logging accuracy of 90% or more: `b.fire(userId, BadgeTrigger.HONEST_LOGGER, importId)`.
- Plan 5, in `GoalProgressService.complete` (sets a goal's status to done and awards +1,000 XP): `b.fire(userId, BadgeTrigger.GOAL_CRUSHER, goalId)`.

Then extend Plan 4's API-IMP-23 test and Plan 5's GOAL-19 test with one assertion each:

```java
        assertThat(jdbc.sql("select count(*) from user_badges where user_id = ? and badge_code = ?")
            .params(u.id(), "SORTED").query(Integer.class).single()).isEqualTo(1);
        assertThat(jdbc.sql("select coalesce(sum(xp), 0) from xp_events where user_id = ? and reversed_at is null and xp = 10")
            .param(u.id()).query(Long.class).single()).isEqualTo(10L); // XP-07
```

(`"GOAL_CRUSHER"` in Plan 5's test, without the XP-07 line; use each test's own user variable in place of `u`.) Plans 4 and 5's test-only `RecordingBadgeTrigger` stays: it is a second `BadgeTrigger` bean in tests and keeps their trigger assertions working. If a plan left any other stand-in for these badges (a table or a flag), delete it in the same commit.

- [ ] **Step 7: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.gamification.*' --tests 'in.gullak.ingestion.*' --tests 'in.gullak.goals.*'`
Expected: PASS.

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/main/resources/db/migration/V043__badges.sql server/src/main/java/in/gullak/gamification server/src/main/java/in/gullak/ingestion server/src/main/java/in/gullak/goals server/src/test/java/in/gullak
git commit -m "feat(server): ten badges behind Plan 4's BadgeTrigger interface; Sorted, Honest logger and Goal crusher wired

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: The daily close job

**Owner:** backend-engineer. **Test IDs:** JOB-01, JOB-02, JOB-03 (integration), XP-05, XP-06, STR-01, STR-02, STR-05, STR-07, STR-08, STR-09 (new: back-dated spend), JOB-15 (new: missed nights caught up), BDG-02 and BDG-03 (through the real close). **Red team:** yes (running the close twice; back-dated spends to extend a streak; a user created at 23:59 farming a free day; two instances racing).

**Files:**
- Create: `server/src/main/java/in/gullak/budget/DayFigures.java`, `server/src/main/java/in/gullak/gamification/ClosedDay.java`, `CloseOutcome.java`, `DailyCloseView.java`, `DailyCloseEntity.java`, `DailyCloseRepository.java`, `DailyCloseService.java`, `server/src/main/java/in/gullak/jobs/DailyCloseJob.java`
- Modify: `server/src/main/java/in/gullak/budget/BudgetService.java` (`day`), `server/src/main/java/in/gullak/profile/ProfileService.java` and `ProfileRepository.java` (`userIdsSetUpBefore`), `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/test/java/in/gullak/support/ApiTest.java` (`gameUser`, `backdateSetup`), `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`
- Test: `server/src/test/java/in/gullak/jobs/DailyCloseJobApiTest.java`

**Interfaces:**
- Consumes: `JobRunner` (Task 1); `XpLedger`, `CelebrationService`, `LevelTracker` (Task 3); `Grade`, `StreakService` (Task 4); `BadgeService.afterClose`, `GameQueries.dayFacts` (Task 5); Plan 2's `BudgetService` (`compute`, `spendable`, `CycleService.current(userId, date, profile, spendable)`).
- Produces: `BudgetService.day(UUID userId, LocalDate date) : DayFigures`; `DayFigures(LocalDate date, long budgetPaise, long spentPaise)`; `ClosedDay(UUID userId, LocalDate date, long budgetPaise, long spentPaise)`; `DailyCloseService.close(ClosedDay) : CloseOutcome`, `DailyCloseService.find(UUID, LocalDate) : Optional<DailyCloseView>`; `DailyCloseView(LocalDate date, long budgetPaise, long spentPaise, Grade grade, boolean underBudget, boolean freezeUsed, int streakAfter, int xpAwarded)`; `ProfileService.userIdsSetUpBefore(Instant cutoff) : List<UUID>`; job `daily-close` at 00:05 IST (`runDue()`, `runFor(LocalDate)`); event `day.closed`; test helpers `gameUser()`, `backdateSetup(TestUser, Instant)`, `SET_UP_AT`.

- [ ] **Step 1: Test helpers**

Add to `ApiTest.java`:

```java
    /** 1 Oct 2026, 00:00 IST: game users count as set up from the start of the October cycle. */
    protected static final Instant SET_UP_AT = Instant.parse("2026-09-30T18:30:00Z");

    /**
     * The example user, set up on 1 Oct. Jobs only close days after a user's setup, and a profile row's
     * created_at is the database's real time, so tests that close October days backdate it.
     */
    protected TestUser gameUser() throws Exception {
        TestUser u = exampleUser();
        backdateSetup(u, SET_UP_AT);
        return u;
    }

    protected void backdateSetup(TestUser user, Instant at) {
        jdbc.sql("update profiles set created_at = ? where user_id = ?")
            .params(OffsetDateTime.ofInstant(at, ZoneOffset.UTC), user.id()).update();
    }
```

- [ ] **Step 2: Write the failing tests**

`server/src/test/java/in/gullak/jobs/DailyCloseJobApiTest.java`:

```java
package in.gullak.jobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class DailyCloseJobApiTest extends ApiTest {
    static final LocalDate OCT23 = LocalDate.of(2026, 10, 23);
    static final Instant MORNING_23 = Instant.parse("2026-10-23T03:42:00Z"); // 09:12 IST
    static final Instant CLOSE_TIME = Instant.parse("2026-10-23T18:35:00Z"); // 00:05 IST, 24 Oct

    @Autowired DailyCloseJob job;

    Map<String, Object> close(TestUser u, LocalDate d) {
        return jdbc.sql("select * from daily_closes where user_id = ? and date = ?").params(u.id(), d).query().singleRow();
    }

    int closes(TestUser u) {
        return jdbc.sql("select count(*) from daily_closes where user_id = ?").param(u.id()).query(Integer.class).single();
    }

    int xpEvents(TestUser u, String kind) {
        return jdbc.sql("select count(*) from xp_events where user_id = ? and kind = ? and reversed_at is null")
            .params(u.id(), kind).query(Integer.class).single();
    }

    long xpTotal(TestUser u) {
        return jdbc.sql("select coalesce(sum(xp), 0) from xp_events where user_id = ? and reversed_at is null")
            .param(u.id()).query(Long.class).single();
    }

    int streak(TestUser u) {
        return jdbc.sql("select current_days from streaks where user_id = ?").param(u.id()).query(Integer.class).single();
    }

    int badge(TestUser u, String code) {
        return jdbc.sql("select count(*) from user_badges where user_id = ? and badge_code = ?")
            .params(u.id(), code).query(Integer.class).single();
    }

    long todaysBudget(TestUser u) throws Exception {
        String body = mvc.perform(get("/api/v1/budget/today").with(auth(u))).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(body, "$.budgetPaise")).longValue();
    }

    void runDays(LocalDate from, LocalDate to) {
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            job.runFor(d);
        }
    }

    @Test
    void runningTheCloseTwiceCountsTheDayOnce() throws Exception { // JOB-01
        TestUser u = gameUser();
        clock.set(CLOSE_TIME);
        job.runFor(OCT23);
        job.runFor(OCT23);
        assertThat(closes(u)).isEqualTo(1);
        assertThat(xpEvents(u, "day_under_budget")).isEqualTo(1);
        assertThat(streak(u)).isEqualTo(1);
    }

    @Test
    void everyUserIsGradedByTheirOwnBudget() throws Exception { // JOB-02, JOB-03
        TestUser none = gameUser();
        TestUser big = gameUser();
        TestUser steady = gameUser();
        long budget = todaysBudget(steady);
        seedSpend(steady, budget * 79 / 100, MORNING_23);
        seedSpend(big, 1_000_000, MORNING_23);
        clock.set(CLOSE_TIME);
        job.runFor(OCT23);
        assertThat(close(none, OCT23)).containsEntry("grade", "A_PLUS").containsEntry("under_budget", true);
        assertThat(close(big, OCT23)).containsEntry("grade", "F").containsEntry("under_budget", false);
        assertThat(close(steady, OCT23)).containsEntry("grade", "B").containsEntry("under_budget", true)
            .containsEntry("budget_paise", budget);
    }

    @Test
    void underBudgetEarnsTwentyAndOverDoesNot() throws Exception { // XP-05, XP-06
        TestUser under = gameUser();
        TestUser over = gameUser();
        seedSpend(over, 1_000_000, MORNING_23);
        clock.set(CLOSE_TIME);
        job.runFor(OCT23);
        assertThat(xpTotal(under)).isEqualTo(20);
        assertThat(close(under, OCT23)).containsEntry("xp_awarded", 20);
        assertThat(xpEvents(over, "day_under_budget")).isZero();
    }

    @Test
    void aDayWithNoSpendsCounts() throws Exception { // STR-02
        TestUser u = gameUser();
        clock.set(CLOSE_TIME);
        job.runFor(OCT23);
        assertThat(close(u, OCT23)).containsEntry("spent_paise", 0L).containsEntry("under_budget", true);
        assertThat(streak(u)).isEqualTo(1);
    }

    @Test
    void fiveDaysUnderIsAFiveDayStreak() throws Exception { // STR-01
        TestUser u = gameUser();
        clock.set(CLOSE_TIME);
        runDays(LocalDate.of(2026, 10, 19), OCT23);
        assertThat(streak(u)).isEqualTo(5);
    }

    @Test
    void sevenDaysEarnAFreezeThatSavesTheEighth() throws Exception { // STR-03, STR-05, STR-07, BDG-02
        TestUser u = gameUser();
        clock.set(CLOSE_TIME);
        runDays(LocalDate.of(2026, 10, 13), LocalDate.of(2026, 10, 19));
        assertThat(xpEvents(u, "streak_7")).isEqualTo(1);
        assertThat(badge(u, "WEEK_WARRIOR")).isEqualTo(1);
        seedSpend(u, 1_000_000, Instant.parse("2026-10-20T06:00:00Z"));
        job.runFor(LocalDate.of(2026, 10, 20));
        assertThat(close(u, LocalDate.of(2026, 10, 20))).containsEntry("freeze_used", true).containsEntry("streak_after", 7);
        assertThat(jdbc.sql("select freezes from streaks where user_id = ?").param(u.id()).query(Integer.class).single()).isZero();
    }

    @Test
    void aStreakMilestoneIsPaidOnceEver() throws Exception { // STR-07
        TestUser u = gameUser();
        clock.set(CLOSE_TIME);
        runDays(LocalDate.of(2026, 10, 13), LocalDate.of(2026, 10, 19));
        jdbc.sql("update streaks set current_days = 6, last_counted_date = date '2026-10-20' where user_id = ?").param(u.id()).update();
        job.runFor(LocalDate.of(2026, 10, 21));
        assertThat(streak(u)).isEqualTo(7);
        assertThat(xpEvents(u, "streak_7")).isEqualTo(1);
        assertThat(celebrationCount(u, "STREAK_MILESTONE")).isEqualTo(1);
    }

    @Test
    void theCloseAtFivePastMidnightCountsYesterday() throws Exception { // STR-08
        TestUser u = gameUser();
        seedSpend(u, 10_000, Instant.parse("2026-10-23T18:29:59Z")); // 23:59:59 IST, 23 Oct
        seedSpend(u, 20_000, Instant.parse("2026-10-23T18:30:01Z")); // 00:00:01 IST, 24 Oct
        clock.set(CLOSE_TIME);
        job.runDue();
        assertThat(close(u, OCT23)).containsEntry("spent_paise", 10_000L);
        assertThat(jdbc.sql("select count(*) from daily_closes where user_id = ? and date = date '2026-10-24'")
            .param(u.id()).query(Integer.class).single()).isZero();
    }

    @Test
    void backdatedSpendDoesNotReopenAClosedDay() throws Exception { // STR-09, review focus
        TestUser u = gameUser();
        clock.set(CLOSE_TIME);
        job.runFor(OCT23);
        seedSpend(u, 1_000_000, Instant.parse("2026-10-23T06:00:00Z")); // logged after the close, dated the 23rd
        job.runFor(OCT23);
        assertThat(close(u, OCT23)).containsEntry("spent_paise", 0L).containsEntry("grade", "A_PLUS");
        assertThat(streak(u)).isEqualTo(1);
        assertThat(xpTotal(u)).isEqualTo(20);
    }

    @Test
    void missedNightIsCaughtUpButNotBeforeSetup() throws Exception { // JOB-15, review focus
        TestUser u = exampleUser();
        backdateSetup(u, Instant.parse("2026-12-09T04:30:00Z")); // set up at 10:00 IST on 9 Dec
        clock.set(Instant.parse("2026-12-10T18:35:00Z")); // 00:05 IST, 11 Dec; nobody ran 8 or 9 Dec
        job.runDue();
        assertThat(jdbc.sql("select date from daily_closes where user_id = ? order by date").param(u.id())
            .query(LocalDate.class).list())
            .containsExactly(LocalDate.of(2026, 12, 9), LocalDate.of(2026, 12, 10));
        assertThat(streak(u)).isEqualTo(2);
    }

    @Test
    void aSundayWithoutSwiggyEarnsTheBadge() throws Exception { // BDG-03
        TestUser u = gameUser();
        seedCategorySpend(u, 18_000, Instant.parse("2026-10-25T07:00:00Z"), "eating_out", null);
        clock.set(Instant.parse("2026-10-25T18:35:00Z"));
        job.runFor(LocalDate.of(2026, 10, 25));
        assertThat(badge(u, "NO_SWIGGY_SUNDAY")).isEqualTo(1);
    }

    @Test
    void usersWhoNeverFinishedSetupAreSkipped() throws Exception {
        TestUser u = signIn();
        clock.set(CLOSE_TIME);
        job.runFor(OCT23);
        assertThat(closes(u)).isZero();
    }
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.jobs.DailyCloseJobApiTest'`
Expected: compilation fails (`DailyCloseJob`, `gameUser`).

- [ ] **Step 4: Budget figures for any day**

`server/src/main/java/in/gullak/budget/DayFigures.java`:

```java
package in.gullak.budget;

import java.time.LocalDate;

/** The day's budget and what counted against it, computed exactly as Home computes them. */
public record DayFigures(LocalDate date, long budgetPaise, long spentPaise) {}
```

Add to `server/src/main/java/in/gullak/budget/BudgetService.java` (next to `today`; it calls the same private `compute` that `today` uses, with the date in place of today, so a catch-up added by Plan 5 or a spend rule added by Plan 3 applies here too):

```java
    /** The figures for one day, as Home showed them that day. The daily close and the report card use this. */
    @Transactional
    public DayFigures day(UUID userId, LocalDate date) {
        Profile profile = profiles.get(userId);
        long fixed = fixedCosts.totalFor(userId);
        CurrentCycle current = cycles.current(userId, date, profile, spendable(profile, fixed));
        TodayResponse figures = compute(userId, profile, date, fixed, current);
        return new DayFigures(date, figures.budgetPaise(), figures.spentPaise());
    }
```

If a later plan changed `compute`'s parameters, pass the same arguments `today()` passes, with `date` where `today()` passes `Ist.today(clock)`.

- [ ] **Step 5: Users to close**

Add to `server/src/main/java/in/gullak/profile/ProfileRepository.java`:

```java
    /** Active users whose setup finished before the cutoff (the end of the day being closed). */
    @Query(value = """
            select p.user_id from profiles p join users u on u.id = p.user_id
            where u.status = 'active' and p.created_at < :cutoff
            order by p.user_id
            """, nativeQuery = true)
    List<UUID> userIdsSetUpBefore(@Param("cutoff") Instant cutoff);
```

(imports: `java.time.Instant`, `java.util.List`, `org.springframework.data.jpa.repository.Query`, `org.springframework.data.repository.query.Param`)

Add to `server/src/main/java/in/gullak/profile/ProfileService.java`:

```java
    @Transactional(readOnly = true)
    public List<UUID> userIdsSetUpBefore(Instant cutoff) {
        return profiles.userIdsSetUpBefore(cutoff);
    }
```

- [ ] **Step 6: The close**

Append to `Events.java`, before `private Events() {}`:

```java
    public static final String DAY_CLOSED = "day.closed";
```

`server/src/main/java/in/gullak/gamification/ClosedDay.java`:

```java
package in.gullak.gamification;

import java.time.LocalDate;
import java.util.UUID;

/** One user's finished day, with the budget figures the budget feature worked out for it. */
public record ClosedDay(UUID userId, LocalDate date, long budgetPaise, long spentPaise) {}
```

`server/src/main/java/in/gullak/gamification/CloseOutcome.java`:

```java
package in.gullak.gamification;

import java.time.LocalDate;

public record CloseOutcome(LocalDate date, boolean alreadyClosed, Grade grade, boolean underBudget, int streak, int xpAwarded) {
    static CloseOutcome already(LocalDate date) {
        return new CloseOutcome(date, true, null, false, 0, 0);
    }
}
```

`server/src/main/java/in/gullak/gamification/DailyCloseView.java`:

```java
package in.gullak.gamification;

import java.time.LocalDate;

public record DailyCloseView(LocalDate date, long budgetPaise, long spentPaise, Grade grade, boolean underBudget,
                             boolean freezeUsed, int streakAfter, int xpAwarded) {}
```

`server/src/main/java/in/gullak/gamification/DailyCloseEntity.java`:

```java
package in.gullak.gamification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;

/** Read here; written by the native statements in {@link DailyCloseRepository}. */
@Entity
@Table(name = "daily_closes")
class DailyCloseEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private LocalDate date;

    @Column(name = "budget_paise", nullable = false)
    private long budgetPaise;

    @Column(name = "spent_paise", nullable = false)
    private long spentPaise;

    @Column(nullable = false, length = 6)
    private String grade;

    @Column(name = "under_budget", nullable = false)
    private boolean underBudget;

    @Column(name = "freeze_used", nullable = false)
    private boolean freezeUsed;

    @Column(name = "streak_after", nullable = false)
    private int streakAfter;

    @Column(name = "xp_awarded", nullable = false)
    private int xpAwarded;

    protected DailyCloseEntity() {}

    DailyCloseView toView() {
        return new DailyCloseView(date, budgetPaise, spentPaise, Grade.valueOf(grade), underBudget, freezeUsed, streakAfter, xpAwarded);
    }
}
```

`server/src/main/java/in/gullak/gamification/DailyCloseRepository.java`:

```java
package in.gullak.gamification;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface DailyCloseRepository extends JpaRepository<DailyCloseEntity, UUID> {

    /** The idempotency gate: 0 when this user's day is already closed (or being closed by another run). */
    @Modifying
    @Query(value = """
            insert into daily_closes (id, user_id, date, budget_paise, spent_paise, grade, under_budget)
            values (:id, :userId, :date, :budget, :spent, :grade, :under)
            on conflict (user_id, date) do nothing
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("userId") UUID userId, @Param("date") LocalDate date,
                       @Param("budget") long budget, @Param("spent") long spent, @Param("grade") String grade,
                       @Param("under") boolean under);

    @Modifying
    @Query(value = "update daily_closes set streak_after = :streak, freeze_used = :freeze, xp_awarded = :xp where id = :id",
        nativeQuery = true)
    int recordOutcome(@Param("id") UUID id, @Param("streak") int streak, @Param("freeze") boolean freeze, @Param("xp") int xp);

    Optional<DailyCloseEntity> findByUserIdAndDate(UUID userId, LocalDate date);
}
```

`server/src/main/java/in/gullak/gamification/DailyCloseService.java`:

```java
package in.gullak.gamification;

import in.gullak.common.log.Events;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Closes one user's day in one transaction (spec 4.8): grade, the daily_closes row, streak and freezes,
 * +20 XP under budget, streak milestones, badges, level-ups. The insert of the row comes first, so a
 * second run for the same day stops there and changes nothing.
 */
@Service
public class DailyCloseService {
    static final int UNDER_BUDGET_XP = 20;
    private static final Logger log = LoggerFactory.getLogger(DailyCloseService.class);

    private final DailyCloseRepository closes;
    private final StreakService streaks;
    private final XpLedger ledger;
    private final CelebrationService celebrations;
    private final BadgeService badges;
    private final GameQueries queries;
    private final LevelTracker levels;

    DailyCloseService(DailyCloseRepository closes, StreakService streaks, XpLedger ledger, CelebrationService celebrations,
                      BadgeService badges, GameQueries queries, LevelTracker levels) {
        this.closes = closes;
        this.streaks = streaks;
        this.ledger = ledger;
        this.celebrations = celebrations;
        this.badges = badges;
        this.queries = queries;
        this.levels = levels;
    }

    @Transactional
    public CloseOutcome close(ClosedDay day) {
        UUID userId = day.userId();
        Grade grade = Grade.of(day.spentPaise(), day.budgetPaise());
        boolean under = day.spentPaise() <= day.budgetPaise();
        UUID closeId = UUID.randomUUID();
        if (closes.insertIfAbsent(closeId, userId, day.date(), Math.max(0, day.budgetPaise()), Math.max(0, day.spentPaise()),
                grade.name(), under) == 0) {
            return CloseOutcome.already(day.date());
        }
        StreakOutcome streak = streaks.apply(userId, day.date(), under);
        int xp = 0;
        if (under && ledger.awardOnce(userId, XpKinds.DAY_UNDER_BUDGET, UNDER_BUDGET_XP, RefTypes.DAILY_CLOSE, closeId)) {
            xp += UNDER_BUDGET_XP;
        }
        if (streak.milestone() != null) {
            int days = streak.milestone();
            int amount = StreakRules.milestoneXp(days);
            if (ledger.awardOnce(userId, XpKinds.streak(days), amount, RefTypes.STREAK, milestoneRef(userId, days))) {
                xp += amount;
                celebrations.record(userId, CelebrationKind.STREAK_MILESTONE, String.valueOf(days));
            }
        }
        if (streak.counted()) {
            celebrations.record(userId, CelebrationKind.STREAK_DAY, day.date().toString());
        }
        if (streak.applied()) {
            badges.afterClose(userId, queries.dayFacts(userId, day.date(), under), streak);
        }
        levels.sync(userId);
        int streakAfter = streak.applied() ? streak.next().current() : streaks.current(userId).current();
        closes.recordOutcome(closeId, streakAfter, streak.freezeUsed(), xp);
        log.info("{} user={} date={} grade={} under={} streak={}", Events.DAY_CLOSED, userId, day.date(), grade, under, streakAfter);
        return new CloseOutcome(day.date(), false, grade, under, streakAfter, xp);
    }

    @Transactional(readOnly = true)
    public Optional<DailyCloseView> find(UUID userId, LocalDate date) {
        return closes.findByUserIdAndDate(userId, date).map(DailyCloseEntity::toView);
    }

    /** The same reference every time a user reaches this milestone, so it is paid once ever (STR-07). */
    static UUID milestoneRef(UUID userId, int days) {
        return UUID.nameUUIDFromBytes((userId + ":streak:" + days).getBytes(StandardCharsets.UTF_8));
    }
}
```

`server/src/main/java/in/gullak/jobs/DailyCloseJob.java`:

```java
package in.gullak.jobs;

import in.gullak.budget.BudgetService;
import in.gullak.budget.DayFigures;
import in.gullak.common.jobs.JobResult;
import in.gullak.common.jobs.JobRunner;
import in.gullak.common.time.Ist;
import in.gullak.gamification.ClosedDay;
import in.gullak.gamification.DailyCloseService;
import in.gullak.profile.ProfileService;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 00:05 IST (spec 2.1): closes yesterday for every set-up user, plus either of the two days before whose run
 * never succeeded (a missed night). Each user's day is idempotent, so a re-run is harmless.
 */
@Component
class DailyCloseJob {
    static final String NAME = "daily-close";
    static final int CATCH_UP_DAYS = 2;

    private final JobRunner runner;
    private final ProfileService profiles;
    private final BudgetService budget;
    private final DailyCloseService closes;
    private final Clock clock;

    DailyCloseJob(JobRunner runner, ProfileService profiles, BudgetService budget, DailyCloseService closes, Clock clock) {
        this.runner = runner;
        this.profiles = profiles;
        this.budget = budget;
        this.closes = closes;
        this.clock = clock;
    }

    @Scheduled(cron = "0 5 0 * * *", zone = "Asia/Kolkata")
    public void scheduled() {
        runDue();
    }

    List<JobResult> runDue() {
        LocalDate yesterday = Ist.today(clock).minusDays(1);
        List<JobResult> results = new ArrayList<>();
        for (int back = CATCH_UP_DAYS; back >= 1; back--) {
            LocalDate missed = yesterday.minusDays(back);
            if (!runner.hasSucceeded(NAME, missed.toString())) {
                results.add(runFor(missed));
            }
        }
        results.add(runFor(yesterday));
        return results;
    }

    JobResult runFor(LocalDate date) {
        return runner.run(NAME, date.toString(),
            () -> profiles.userIdsSetUpBefore(Ist.startOf(date.plusDays(1))),
            userId -> {
                DayFigures f = budget.day(userId, date);
                closes.close(new ClosedDay(userId, date, f.budgetPaise(), f.spentPaise()));
            });
    }
}
```

- [ ] **Step 7: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.jobs.*' --tests 'in.gullak.budget.*'`
Expected: PASS.

- [ ] **Step 8: Update the test-cases doc**

In `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`, section 5, add after STR-08:

`| STR-09 | Back-dated spend after the close | close 23 Oct, then log a spend dated 23 Oct | the 23 Oct row, grade, streak and XP are unchanged |`

and in section 6, add after JOB-12:

`| JOB-13 | Auth purge | sign-in codes older than 2 days and refresh tokens expired over a day are deleted; a code from 23 hours ago and a used token that has not expired stay |`
`| JOB-14 | updated_at | every table with updated_at has the trigger; an update that does not set it moves it |`
`| JOB-15 | Missed nights | the close did not run for 2 nights: the next run closes them in order; days before the user's setup are never closed |`

- [ ] **Step 9: Run the whole suite and commit**

Run: `cd server && ./gradlew test`
Expected: PASS.

```bash
git add server/src/main/java/in/gullak/budget server/src/main/java/in/gullak/gamification server/src/main/java/in/gullak/jobs server/src/main/java/in/gullak/profile server/src/main/java/in/gullak/common/log/Events.java server/src/test/java/in/gullak/jobs server/src/test/java/in/gullak/support/ApiTest.java docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md
git commit -m "feat(server): daily close at 00:05 IST: grade, streak, freezes, +20 XP, milestones, badges, catch-up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Weekly challenge: selection, evaluation and the Monday job

**Owner:** backend-engineer. **Test IDs:** CHL-01, CHL-02, CHL-03, CHL-04, CHL-05 (new: rounding and the ₹50 floor), BDG-09 (new: the challenge's category badge). **Red team:** yes (₹1 spends on 7 days to unlock a trivial challenge; evaluating a week twice for double XP).

**Files:**
- Create: `server/src/main/resources/db/migration/V044__weekly_challenges.sql`
- Create: `server/src/main/java/in/gullak/gamification/ChallengePick.java`, `ChallengePicker.java`, `ChallengeView.java`, `WeeklyChallengeEntity.java`, `WeeklyChallengeRepository.java`, `ChallengeService.java`, `server/src/main/java/in/gullak/jobs/WeeklyChallengeJob.java`
- Modify: `server/src/main/java/in/gullak/gamification/GameQueries.java`, `server/src/main/java/in/gullak/common/log/Events.java`
- Test: `server/src/test/java/in/gullak/gamification/ChallengePickerTest.java`, `server/src/test/java/in/gullak/jobs/WeeklyChallengeJobApiTest.java`

**Interfaces:**
- Consumes: `XpLedger`, `LevelTracker` (Task 3); `BadgeService.earnCode`, `Badge.challengeCode` (Task 5); `ProfileService.userIdsSetUpBefore` (Task 6); `JobRunner` (Task 1); Plan 3's `categories.discretionary`.
- Produces: `ChallengePicker.pick(Map<String, Long> totals, int distinctSpendDays) : Optional<ChallengePick>`; `ChallengePick(String categoryCode, long targetPaise)`; `ChallengeService.select(UUID, LocalDate weekStart) : Optional<ChallengeView>`, `evaluate(UUID, LocalDate weekStart) : Optional<Boolean>`, `current(UUID, LocalDate today) : Optional<ChallengeView>`; `ChallengeView(LocalDate weekStart, LocalDate weekEnd, String categoryCode, String categoryName, long targetPaise, long progressPaise, boolean done, boolean evaluated)`; `GameQueries.categoryName(String) : String`; job `weekly-challenge` Monday 00:10 IST; events `challenge.set`, `challenge.done`.

- [ ] **Step 1: Migration**

`server/src/main/resources/db/migration/V044__weekly_challenges.sql`:

```sql
-- One challenge per user per week (Monday to Sunday, IST). progress_paise is written when the week is
-- evaluated; during the week the app sees a live figure.
create table weekly_challenges (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    week_start date not null check (extract(isodow from week_start) = 1),
    category_code varchar(30) not null,
    target_paise bigint not null check (target_paise > 0),
    progress_paise bigint,
    done_at timestamptz,
    evaluated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, week_start)
);
```

- [ ] **Step 2: Write the failing unit test**

`server/src/test/java/in/gullak/gamification/ChallengePickerTest.java`:

```java
package in.gullak.gamification;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

class ChallengePickerTest {
    @Test
    void topDiscretionaryCategoryAtSeventyPercentRoundedToFifty() { // CHL-01
        assertThat(ChallengePicker.pick(Map.of("food_delivery", 230_000L, "eating_out", 100_000L), 10))
            .contains(new ChallengePick("food_delivery", 80_000)); // 70% of ₹1,150 = ₹805 → ₹800
    }

    @Test
    void notEnoughDays() { // CHL-04
        assertThat(ChallengePicker.pick(Map.of("food_delivery", 230_000L), 2)).isEmpty();
        assertThat(ChallengePicker.pick(Map.of("food_delivery", 230_000L), 6)).isEmpty();
        assertThat(ChallengePicker.pick(Map.of(), 14)).isEmpty();
    }

    @Test
    void roundingIsHalfUpAndThereIsAFloor() { // CHL-05
        assertThat(ChallengePicker.pick(Map.of("shopping", 235_715L), 7)).contains(new ChallengePick("shopping", 85_000)); // ₹825 → ₹850
        assertThat(ChallengePicker.pick(Map.of("shopping", 10_000L), 7)).contains(new ChallengePick("shopping", 5_000));
        assertThat(ChallengePicker.pick(Map.of("shopping", 5_000L), 7)).isEmpty(); // ₹17.50 rounds to ₹0
    }

    @Test
    void tiesGoToTheFirstCodeAlphabetically() {
        assertThat(ChallengePicker.pick(Map.of("shopping", 100_000L, "eating_out", 100_000L), 9))
            .map(ChallengePick::categoryCode).contains("eating_out");
    }
}
```

- [ ] **Step 3: Write the failing integration tests**

`server/src/test/java/in/gullak/jobs/WeeklyChallengeJobApiTest.java`:

```java
package in.gullak.jobs;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.gamification.ChallengeService;
import in.gullak.gamification.ChallengeView;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class WeeklyChallengeJobApiTest extends ApiTest {
    static final LocalDate WEEK = LocalDate.of(2026, 10, 19); // Monday
    static final LocalDate NEXT = LocalDate.of(2026, 10, 26);

    @Autowired ChallengeService challenges;
    @Autowired WeeklyChallengeJob job;

    static Instant noonOn(LocalDate d) {
        return d.atTime(12, 0).atZone(in.gullak.common.time.Ist.ZONE).toInstant();
    }

    /** ₹230 of food delivery on each of 5–14 Oct and one ₹1,000 eating-out: ₹1,150 a week of delivery. */
    TestUser deliveryRegular() throws Exception {
        TestUser u = gameUser();
        for (int i = 0; i < 10; i++) {
            seedCategorySpend(u, 23_000, noonOn(LocalDate.of(2026, 10, 5).plusDays(i)), "food_delivery", "Swiggy");
        }
        seedCategorySpend(u, 100_000, noonOn(LocalDate.of(2026, 10, 16)), "eating_out", null);
        return u;
    }

    int xp(TestUser u) {
        return jdbc.sql("select count(*) from xp_events where user_id = ? and kind = 'challenge_done' and reversed_at is null")
            .param(u.id()).query(Integer.class).single();
    }

    int rows(TestUser u) {
        return jdbc.sql("select count(*) from weekly_challenges where user_id = ?").param(u.id()).query(Integer.class).single();
    }

    @Test
    void selectionFromTheLastTwoWeeks() throws Exception { // CHL-01
        TestUser u = deliveryRegular();
        ChallengeView c = challenges.select(u.id(), WEEK).orElseThrow();
        assertThat(c.categoryCode()).isEqualTo("food_delivery");
        assertThat(c.categoryName()).isEqualTo("Food delivery");
        assertThat(c.targetPaise()).isEqualTo(80_000);
        assertThat(c.weekEnd()).isEqualTo(LocalDate.of(2026, 10, 25));
        challenges.select(u.id(), WEEK);
        assertThat(rows(u)).isEqualTo(1);
    }

    @Test
    void doneAtOrUnderTheTarget() throws Exception { // CHL-02, BDG-09
        TestUser u = deliveryRegular();
        challenges.select(u.id(), WEEK);
        seedCategorySpend(u, 65_000, noonOn(LocalDate.of(2026, 10, 21)), "food_delivery", "Zomato");
        assertThat(challenges.evaluate(u.id(), WEEK)).contains(true);
        assertThat(challenges.evaluate(u.id(), WEEK)).isEmpty(); // already evaluated
        assertThat(xp(u)).isEqualTo(1);
        assertThat(jdbc.sql("select progress_paise from weekly_challenges where user_id = ?").param(u.id())
            .query(Long.class).single()).isEqualTo(65_000);
        assertThat(jdbc.sql("select count(*) from user_badges where user_id = ? and badge_code = 'CHALLENGE_FOOD_DELIVERY'")
            .param(u.id()).query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void overTheTargetFailsAndNextWeekIsChosenFresh() throws Exception { // CHL-03
        TestUser u = deliveryRegular();
        challenges.select(u.id(), WEEK);
        seedCategorySpend(u, 90_000, noonOn(LocalDate.of(2026, 10, 20)), "food_delivery", "Swiggy");
        for (int i = 21; i <= 24; i++) {
            seedCategorySpend(u, 100_000, noonOn(LocalDate.of(2026, 10, i)), "shopping", "Myntra");
        }
        assertThat(challenges.evaluate(u.id(), WEEK)).contains(false);
        assertThat(xp(u)).isZero();
        ChallengeView next = challenges.select(u.id(), NEXT).orElseThrow();
        assertThat(next.categoryCode()).isEqualTo("shopping");
        assertThat(next.targetPaise()).isEqualTo(140_000);
    }

    @Test
    void aNewUserGetsNoChallenge() throws Exception { // CHL-04
        TestUser u = gameUser();
        seedCategorySpend(u, 50_000, noonOn(LocalDate.of(2026, 10, 16)), "food_delivery", null);
        seedCategorySpend(u, 50_000, noonOn(LocalDate.of(2026, 10, 17)), "food_delivery", null);
        assertThat(challenges.select(u.id(), WEEK)).isEmpty();
        assertThat(rows(u)).isZero();
    }

    @Test
    void progressIsLiveDuringTheWeek() throws Exception {
        TestUser u = deliveryRegular();
        challenges.select(u.id(), WEEK);
        seedCategorySpend(u, 30_000, noonOn(LocalDate.of(2026, 10, 20)), "food_delivery", null);
        clock.set(Instant.parse("2026-10-22T08:00:00Z"));
        ChallengeView c = challenges.current(u.id(), LocalDate.of(2026, 10, 22)).orElseThrow();
        assertThat(c.progressPaise()).isEqualTo(30_000);
        assertThat(c.done()).isFalse();
        assertThat(c.evaluated()).isFalse();
    }

    @Test
    void theMondayJobEvaluatesThenSelectsAndIsIdempotent() throws Exception { // CHL-02 through the job
        TestUser u = deliveryRegular();
        challenges.select(u.id(), WEEK);
        for (int i = 20; i <= 23; i++) { // enough spend days in 12–25 Oct for next week's challenge
            seedCategorySpend(u, 10_000, noonOn(LocalDate.of(2026, 10, i)), "eating_out", null);
        }
        clock.set(Instant.parse("2026-10-25T18:40:00Z")); // 00:10 IST Monday 26 Oct
        job.runFor(NEXT);
        job.runFor(NEXT);
        assertThat(xp(u)).isEqualTo(1);
        assertThat(rows(u)).isEqualTo(2);
    }
}
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.gamification.ChallengePickerTest' --tests 'in.gullak.jobs.WeeklyChallengeJobApiTest'`
Expected: compilation fails (`ChallengePicker`, `ChallengeService`, `WeeklyChallengeJob`).

- [ ] **Step 5: Write the code**

Append to `Events.java`, before `private Events() {}`:

```java
    public static final String CHALLENGE_SET = "challenge.set";
    public static final String CHALLENGE_DONE = "challenge.done";
```

Add to `server/src/main/java/in/gullak/gamification/GameQueries.java` (imports: `java.time.Instant`, `java.util.LinkedHashMap`, `java.util.Map`):

```java
    /** Discretionary spend by category between two instants, as the budget counts it. */
    Map<String, Long> discretionaryTotals(UUID userId, Instant from, Instant to) {
        Map<String, Long> totals = new LinkedHashMap<>();
        jdbc.sql("""
                select t.category_code, sum(t.amount_paise) as total
                from transactions t join categories c on c.code = t.category_code
                where t.user_id = ? and t.direction = 'debit' and t.counts_in_budget and not t.spread_over_cycle
                  and t.deleted_at is null and c.discretionary and t.occurred_at >= ? and t.occurred_at < ?
                group by t.category_code
                """)
            .params(userId, Db.ts(from), Db.ts(to))
            .query((rs, n) -> Map.entry(rs.getString("category_code"), rs.getLong("total")))
            .list()
            .forEach(e -> totals.put(e.getKey(), e.getValue()));
        return totals;
    }

    /** Days in India with at least one logged debit. */
    int distinctSpendDays(UUID userId, Instant from, Instant to) {
        return jdbc.sql("""
                select count(distinct (occurred_at at time zone 'Asia/Kolkata')::date) from transactions
                where user_id = ? and direction = 'debit' and deleted_at is null and occurred_at >= ? and occurred_at < ?
                """)
            .params(userId, Db.ts(from), Db.ts(to)).query(Integer.class).single();
    }

    long categorySpent(UUID userId, String category, Instant from, Instant to) {
        return jdbc.sql("""
                select coalesce(sum(amount_paise), 0) from transactions
                where user_id = ? and category_code = ? and direction = 'debit' and counts_in_budget
                  and not spread_over_cycle and deleted_at is null and occurred_at >= ? and occurred_at < ?
                """)
            .params(userId, category, Db.ts(from), Db.ts(to)).query(Long.class).single();
    }

    String categoryName(String code) {
        return jdbc.sql("select coalesce((select name from categories where code = ?), ?)")
            .params(code, code).query(String.class).single();
    }
```

`server/src/main/java/in/gullak/gamification/ChallengePick.java`:

```java
package in.gullak.gamification;

public record ChallengePick(String categoryCode, long targetPaise) {}
```

`server/src/main/java/in/gullak/gamification/ChallengePicker.java`:

```java
package in.gullak.gamification;

import java.util.Comparator;
import java.util.Map;
import java.util.Optional;

/**
 * Spec 2.6: the top discretionary category of the last two weeks, target 70% of its average weekly spend,
 * rounded to ₹50 (half up). Needs spends on at least 7 days of the 14. Pure; unit-tested.
 */
public final class ChallengePicker {
    static final int MIN_SPEND_DAYS = 7;
    static final long ROUND_PAISE = 5_000;

    private ChallengePicker() {}

    public static Optional<ChallengePick> pick(Map<String, Long> totalsOverTwoWeeks, int distinctSpendDays) {
        if (distinctSpendDays < MIN_SPEND_DAYS) {
            return Optional.empty();
        }
        return totalsOverTwoWeeks.entrySet().stream()
            .filter(e -> e.getValue() != null && e.getValue() > 0)
            .max(Comparator.<Map.Entry<String, Long>>comparingLong(Map.Entry::getValue)
                .thenComparing(Map.Entry::getKey, Comparator.reverseOrder()))
            .flatMap(top -> {
                long raw = top.getValue() * 7 / 20; // 70% of (two-week total ÷ 2)
                long target = (raw + ROUND_PAISE / 2) / ROUND_PAISE * ROUND_PAISE;
                return target < ROUND_PAISE ? Optional.empty() : Optional.of(new ChallengePick(top.getKey(), target));
            });
    }
}
```

`server/src/main/java/in/gullak/gamification/ChallengeView.java`:

```java
package in.gullak.gamification;

import java.time.LocalDate;

public record ChallengeView(LocalDate weekStart, LocalDate weekEnd, String categoryCode, String categoryName,
                            long targetPaise, long progressPaise, boolean done, boolean evaluated) {}
```

`server/src/main/java/in/gullak/gamification/WeeklyChallengeEntity.java`:

```java
package in.gullak.gamification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "weekly_challenges")
class WeeklyChallengeEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "week_start", nullable = false)
    private LocalDate weekStart;

    @Column(name = "category_code", nullable = false, length = 30)
    private String categoryCode;

    @Column(name = "target_paise", nullable = false)
    private long targetPaise;

    @Column(name = "progress_paise")
    private Long progressPaise;

    @Column(name = "done_at")
    private Instant doneAt;

    @Column(name = "evaluated_at")
    private Instant evaluatedAt;

    protected WeeklyChallengeEntity() {}

    UUID getId() { return id; }
    LocalDate getWeekStart() { return weekStart; }
    String getCategoryCode() { return categoryCode; }
    long getTargetPaise() { return targetPaise; }
    Long getProgressPaise() { return progressPaise; }
    boolean isDone() { return doneAt != null; }
    boolean isEvaluated() { return evaluatedAt != null; }

    void evaluate(long spentPaise, boolean done, Instant at) {
        progressPaise = spentPaise;
        evaluatedAt = at;
        doneAt = done ? at : null;
    }
}
```

`server/src/main/java/in/gullak/gamification/WeeklyChallengeRepository.java`:

```java
package in.gullak.gamification;

import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface WeeklyChallengeRepository extends JpaRepository<WeeklyChallengeEntity, UUID> {

    @Modifying
    @Query(value = """
            insert into weekly_challenges (id, user_id, week_start, category_code, target_paise)
            values (:id, :userId, :weekStart, :category, :target)
            on conflict (user_id, week_start) do nothing
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("userId") UUID userId, @Param("weekStart") LocalDate weekStart,
                       @Param("category") String category, @Param("target") long target);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from WeeklyChallengeEntity c where c.userId = :userId and c.weekStart = :weekStart")
    Optional<WeeklyChallengeEntity> findForUpdate(@Param("userId") UUID userId, @Param("weekStart") LocalDate weekStart);

    Optional<WeeklyChallengeEntity> findByUserIdAndWeekStart(UUID userId, LocalDate weekStart);
}
```

`server/src/main/java/in/gullak/gamification/ChallengeService.java`:

```java
package in.gullak.gamification;

import in.gullak.common.log.Events;
import in.gullak.common.time.Ist;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ChallengeService {
    static final int DONE_XP = 150;
    private static final Logger log = LoggerFactory.getLogger(ChallengeService.class);

    private final WeeklyChallengeRepository challenges;
    private final GameQueries queries;
    private final XpLedger ledger;
    private final BadgeService badges;
    private final LevelTracker levels;
    private final Clock clock;

    ChallengeService(WeeklyChallengeRepository challenges, GameQueries queries, XpLedger ledger, BadgeService badges,
                     LevelTracker levels, Clock clock) {
        this.challenges = challenges;
        this.queries = queries;
        this.ledger = ledger;
        this.badges = badges;
        this.levels = levels;
        this.clock = clock;
    }

    /** Chooses this week's challenge from the 14 days before it; nothing when there is not enough data (CHL-04). */
    @Transactional
    public Optional<ChallengeView> select(UUID userId, LocalDate weekStart) {
        Instant from = Ist.startOf(weekStart.minusDays(14));
        Instant to = Ist.startOf(weekStart);
        Optional<ChallengePick> pick = ChallengePicker.pick(queries.discretionaryTotals(userId, from, to),
            queries.distinctSpendDays(userId, from, to));
        if (pick.isEmpty()) {
            return Optional.empty();
        }
        if (challenges.insertIfAbsent(UUID.randomUUID(), userId, weekStart, pick.get().categoryCode(), pick.get().targetPaise()) == 1) {
            log.info("{} user={} week={}", Events.CHALLENGE_SET, userId, weekStart);
        }
        return challenges.findByUserIdAndWeekStart(userId, weekStart).map(c -> view(userId, c, Ist.startOf(weekStart.plusDays(7))));
    }

    /** Settles a finished week once: empty when there is no challenge or it was already settled. */
    @Transactional
    public Optional<Boolean> evaluate(UUID userId, LocalDate weekStart) {
        Optional<WeeklyChallengeEntity> found = challenges.findForUpdate(userId, weekStart);
        if (found.isEmpty() || found.get().isEvaluated()) {
            return Optional.empty();
        }
        WeeklyChallengeEntity c = found.get();
        long spent = queries.categorySpent(userId, c.getCategoryCode(), Ist.startOf(weekStart), Ist.startOf(weekStart.plusDays(7)));
        boolean done = spent <= c.getTargetPaise();
        c.evaluate(spent, done, clock.instant());
        if (done) {
            ledger.awardOnce(userId, XpKinds.CHALLENGE_DONE, DONE_XP, RefTypes.CHALLENGE, c.getId());
            badges.earnCode(userId, Badge.challengeCode(c.getCategoryCode()));
            levels.sync(userId);
            log.info("{} user={} week={}", Events.CHALLENGE_DONE, userId, weekStart);
        }
        return Optional.of(done);
    }

    /** This week's challenge with progress so far. */
    @Transactional(readOnly = true)
    public Optional<ChallengeView> current(UUID userId, LocalDate today) {
        LocalDate weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        Instant until = clock.instant();
        Instant weekEnd = Ist.startOf(weekStart.plusDays(7));
        return challenges.findByUserIdAndWeekStart(userId, weekStart)
            .map(c -> view(userId, c, until.isBefore(weekEnd) ? until : weekEnd));
    }

    private ChallengeView view(UUID userId, WeeklyChallengeEntity c, Instant until) {
        long progress = c.isEvaluated() && c.getProgressPaise() != null
            ? c.getProgressPaise()
            : queries.categorySpent(userId, c.getCategoryCode(), Ist.startOf(c.getWeekStart()), until);
        return new ChallengeView(c.getWeekStart(), c.getWeekStart().plusDays(6), c.getCategoryCode(),
            queries.categoryName(c.getCategoryCode()), c.getTargetPaise(), progress, c.isDone(), c.isEvaluated());
    }
}
```

`server/src/main/java/in/gullak/jobs/WeeklyChallengeJob.java`:

```java
package in.gullak.jobs;

import in.gullak.common.jobs.JobResult;
import in.gullak.common.jobs.JobRunner;
import in.gullak.common.time.Ist;
import in.gullak.gamification.ChallengeService;
import in.gullak.profile.ProfileService;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Monday 00:10 IST, after the Sunday close: settle last week's challenge, then pick this week's. */
@Component
class WeeklyChallengeJob {
    static final String NAME = "weekly-challenge";

    private final JobRunner runner;
    private final ProfileService profiles;
    private final ChallengeService challenges;
    private final Clock clock;

    WeeklyChallengeJob(JobRunner runner, ProfileService profiles, ChallengeService challenges, Clock clock) {
        this.runner = runner;
        this.profiles = profiles;
        this.challenges = challenges;
        this.clock = clock;
    }

    @Scheduled(cron = "0 10 0 * * MON", zone = "Asia/Kolkata")
    public void scheduled() {
        runFor(Ist.today(clock).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)));
    }

    JobResult runFor(LocalDate weekStart) {
        return runner.run(NAME, weekStart.toString(),
            () -> profiles.userIdsSetUpBefore(Ist.startOf(weekStart)),
            userId -> {
                challenges.evaluate(userId, weekStart.minusWeeks(1));
                challenges.select(userId, weekStart);
            });
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.gamification.*' --tests 'in.gullak.jobs.*'`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/main/resources/db/migration/V044__weekly_challenges.sql server/src/main/java/in/gullak/gamification server/src/main/java/in/gullak/jobs server/src/main/java/in/gullak/common/log/Events.java server/src/test/java/in/gullak/gamification/ChallengePickerTest.java server/src/test/java/in/gullak/jobs/WeeklyChallengeJobApiTest.java
git commit -m "feat(server): weekly challenge chosen from the last two weeks, settled on Monday with +150 XP and a badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Cycle close and draft cleanup jobs

**Owner:** backend-engineer. **Test IDs:** JOB-08, JOB-16 (new: cycle close +500 once), LOG-03 (`cycle.closed` once). **Red team:** yes (closing a cycle twice for double XP; a cleanup cutoff off by a day).

**Files:**
- Create: `server/src/main/java/in/gullak/jobs/CycleCloser.java`, `CycleCloseOutcome.java`, `GoalsCycleCloser.java`, `CycleCloseJob.java`, `DraftDiscarder.java`, `ImportsDraftDiscarder.java`, `DraftCleanupJob.java`
- Modify: `server/src/main/java/in/gullak/budget/CycleRepository.java`, `server/src/main/java/in/gullak/budget/CycleService.java`
- Test: `server/src/test/java/in/gullak/jobs/CycleCloseJobApiTest.java`, `server/src/test/java/in/gullak/jobs/DraftCleanupJobApiTest.java`

**Interfaces:**
- Consumes: Plan 5's `CycleCloseService.close(UUID userId, UUID cycleId) : CloseOutcome` with `alreadyClosed()` and `savingsMet()`; Plan 4's `in.gullak.ingestion.imports.ImportService.discardOlderThan(int days)`; `XpLedger`, `LevelTracker` (Task 3); `JobRunner` (Task 1); Plan 2's `seedCycle(TestUser, String, String)`.
- Produces: `CycleService.usersWithEndedUnclosed(LocalDate today) : List<UUID>`, `CycleService.endedUnclosed(UUID, LocalDate) : List<UUID>` (cycle ids, oldest first); jobs `cycle-close` at 00:15 IST and `draft-cleanup` at 03:00 IST; `CycleCloser`, `DraftDiscarder` (job-local seams).

- [ ] **Step 1: Write the failing tests**

`server/src/test/java/in/gullak/jobs/CycleCloseJobApiTest.java`:

```java
package in.gullak.jobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@ExtendWith(OutputCaptureExtension.class)
class CycleCloseJobApiTest extends ApiTest {
    @MockitoBean CycleCloser closer;
    @Autowired CycleCloseJob job;

    static final LocalDate NOV1 = LocalDate.of(2026, 11, 1);

    /** Other tests' users also have ended cycles; they get a harmless answer. */
    @BeforeEach
    void anyOtherCycleIsAlreadyClosed() {
        when(closer.close(any(), any())).thenReturn(new CycleCloseOutcome(true, false));
    }

    UUID septemberCycle(TestUser u) {
        seedCycle(u, "2026-09-01", "2026-09-30");
        return jdbc.sql("select id from cycles where user_id = ? and start_date = date '2026-09-01'").param(u.id())
            .query(UUID.class).single();
    }

    int savingsXp(TestUser u) {
        return jdbc.sql("select count(*) from xp_events where user_id = ? and kind = 'savings_met' and reversed_at is null")
            .param(u.id()).query(Integer.class).single();
    }

    @Test
    void savingsMetEarnsFiveHundredOnce(CapturedOutput out) throws Exception { // JOB-16, LOG-03
        TestUser u = gameUser();
        UUID sep = septemberCycle(u);
        when(closer.close(eq(u.id()), any())).thenReturn(new CycleCloseOutcome(false, true));
        clock.set(Instant.parse("2026-10-31T18:45:00Z")); // 00:15 IST, 1 Nov: October has ended too
        job.runFor(NOV1);
        when(closer.close(eq(u.id()), any())).thenReturn(new CycleCloseOutcome(true, true));
        job.runFor(NOV1);
        assertThat(savingsXp(u)).isEqualTo(2); // September and October, each once
        assertThat(jdbc.sql("select count(*) from xp_events where user_id = ? and kind = 'savings_met' and ref_id = ?")
            .params(u.id(), sep).query(Integer.class).single()).isEqualTo(1);
        assertThat(out.getAll().lines().filter(l -> l.contains("cycle.closed user=" + u.id()) && l.contains("cycle=" + sep)).count())
            .isEqualTo(1);
    }

    @Test
    void savingsMissedEarnsNothing() throws Exception { // JOB-16
        TestUser u = gameUser();
        septemberCycle(u);
        when(closer.close(eq(u.id()), any())).thenReturn(new CycleCloseOutcome(false, false));
        job.runFor(LocalDate.of(2026, 10, 23));
        assertThat(savingsXp(u)).isZero();
    }

    @Test
    void openCyclesAreLeftAlone() throws Exception {
        TestUser u = gameUser();
        job.runFor(LocalDate.of(2026, 10, 23)); // October is still open; no September row for this user
        org.mockito.Mockito.verify(closer, org.mockito.Mockito.never()).close(eq(u.id()), any());
    }
}
```

`server/src/test/java/in/gullak/jobs/DraftCleanupJobApiTest.java`:

```java
package in.gullak.jobs;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.common.jobs.JobStatus;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** Runs against Plan 4's real ImportService, so it also checks the discardOlderThan contract. */
class DraftCleanupJobApiTest extends ApiTest {
    @Autowired DraftCleanupJob job;

    UUID draft(TestUser u, Duration age) {
        UUID id = UUID.randomUUID();
        // Plan 4's discardOlderThan measures age against the database's now(), not the test clock.
        jdbc.sql("""
                insert into statement_imports (id, user_id, bank, period_from, period_to, row_count, matched_count,
                    auto_count, fixed_count, to_sort_count, status, created_at)
                values (?, ?, 'HDFC', date '2026-09-01', date '2026-09-30', 0, 0, 0, 0, 0, 'draft',
                    now() - make_interval(hours => ?))
                """)
            .params(id, u.id(), (int) age.toHours())
            .update();
        return id;
    }

    String status(UUID id) {
        return jdbc.sql("select status from statement_imports where id = ?").param(id).query(String.class).single();
    }

    @Test
    void draftsOlderThanSevenDaysAreDiscarded() throws Exception { // JOB-08
        TestUser u = gameUser();
        UUID old = draft(u, Duration.ofDays(8));
        UUID recent = draft(u, Duration.ofDays(6));
        assertThat(job.run().status()).isEqualTo(JobStatus.SUCCEEDED);
        assertThat(status(old)).isEqualToIgnoringCase("discarded");
        assertThat(status(recent)).isEqualToIgnoringCase("draft");
    }

    @Test
    void theCutoffIsExactlySevenDays() {
        assertThat(DraftCleanupJob.KEEP_DRAFT_DAYS).isEqualTo(7);
    }
}
```

If Plan 4's `statement_imports` has further NOT NULL columns without defaults, add them to the insert with neutral values (`0`, `''`) and note it in the hand-back; if Plan 4 stores the status in upper case, the `IgnoringCase` assertions already allow it.

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.jobs.CycleCloseJobApiTest' --tests 'in.gullak.jobs.DraftCleanupJobApiTest'`
Expected: compilation fails (`CycleCloser`, `CycleCloseJob`, `DraftCleanupJob`).

- [ ] **Step 3: Ended cycles**

Add to `server/src/main/java/in/gullak/budget/CycleRepository.java`:

```java
    @Query(value = """
            select distinct c.user_id from cycles c join users u on u.id = c.user_id
            where c.end_date < :today and c.closed_at is null and u.status = 'active'
            """, nativeQuery = true)
    List<UUID> usersWithEndedUnclosed(@Param("today") LocalDate today);

    @Query(value = """
            select id from cycles where user_id = :userId and end_date < :today and closed_at is null order by start_date
            """, nativeQuery = true)
    List<UUID> endedUnclosed(@Param("userId") UUID userId, @Param("today") LocalDate today);
```

Add to `server/src/main/java/in/gullak/budget/CycleService.java` (import `java.util.List`):

```java
    @Transactional(readOnly = true)
    public List<UUID> usersWithEndedUnclosed(LocalDate today) {
        return cycles.usersWithEndedUnclosed(today);
    }

    /** The user's cycles that ended before today and are not closed, oldest first. */
    @Transactional(readOnly = true)
    public List<UUID> endedUnclosed(UUID userId, LocalDate today) {
        return cycles.endedUnclosed(userId, today);
    }
```

- [ ] **Step 4: The seams and the jobs**

`server/src/main/java/in/gullak/jobs/CycleCloseOutcome.java`:

```java
package in.gullak.jobs;

/** What closing one cycle did. {@code savingsMet}: the month's savings target held at close (spec 2.6, +500 XP). */
record CycleCloseOutcome(boolean alreadyClosed, boolean savingsMet) {}
```

`server/src/main/java/in/gullak/jobs/CycleCloser.java`:

```java
package in.gullak.jobs;

import java.util.UUID;

/** The job's view of Plan 5's cycle close; one adapter implements it. */
interface CycleCloser {
    CycleCloseOutcome close(UUID userId, UUID cycleId);
}
```

`server/src/main/java/in/gullak/jobs/GoalsCycleCloser.java`:

```java
package in.gullak.jobs;

import in.gullak.goals.CycleCloseService;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** The only place the job names Plan 5's types. If Plan 5's names differ, this mapping is what changes. */
@Component
class GoalsCycleCloser implements CycleCloser {
    private final CycleCloseService cycleClose;

    GoalsCycleCloser(CycleCloseService cycleClose) {
        this.cycleClose = cycleClose;
    }

    @Override
    public CycleCloseOutcome close(UUID userId, UUID cycleId) {
        CycleCloseService.CloseOutcome result = cycleClose.close(userId, cycleId);
        return new CycleCloseOutcome(result.alreadyClosed(), result.savingsMet());
    }
}
```

`server/src/main/java/in/gullak/jobs/CycleCloseJob.java`:

```java
package in.gullak.jobs;

import in.gullak.budget.CycleService;
import in.gullak.common.jobs.JobResult;
import in.gullak.common.jobs.JobRunner;
import in.gullak.common.log.Events;
import in.gullak.common.time.Ist;
import in.gullak.gamification.LevelTracker;
import in.gullak.gamification.RefTypes;
import in.gullak.gamification.XpKinds;
import in.gullak.gamification.XpLedger;
import java.time.Clock;
import java.time.LocalDate;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 00:15 IST, after the daily close: closes every cycle that ended (the day before payday) through Plan 5's
 * cycle close, then pays +500 XP once per cycle when the month's savings held. Plan 7 shows the summary.
 */
@Component
class CycleCloseJob {
    static final String NAME = "cycle-close";
    static final int SAVINGS_XP = 500;
    private static final Logger log = LoggerFactory.getLogger(CycleCloseJob.class);

    private final JobRunner runner;
    private final CycleService cycles;
    private final CycleCloser closer;
    private final XpLedger ledger;
    private final LevelTracker levels;
    private final Clock clock;

    CycleCloseJob(JobRunner runner, CycleService cycles, CycleCloser closer, XpLedger ledger, LevelTracker levels, Clock clock) {
        this.runner = runner;
        this.cycles = cycles;
        this.closer = closer;
        this.ledger = ledger;
        this.levels = levels;
        this.clock = clock;
    }

    @Scheduled(cron = "0 15 0 * * *", zone = "Asia/Kolkata")
    public void scheduled() {
        runFor(Ist.today(clock));
    }

    JobResult runFor(LocalDate today) {
        return runner.run(NAME, today.toString(), () -> cycles.usersWithEndedUnclosed(today), userId -> {
            for (UUID cycleId : cycles.endedUnclosed(userId, today)) {
                CycleCloseOutcome outcome = closer.close(userId, cycleId);
                if (!outcome.alreadyClosed()) {
                    log.info("{} user={} cycle={}", Events.CYCLE_CLOSED, userId, cycleId);
                }
                if (outcome.savingsMet()) {
                    ledger.awardOnce(userId, XpKinds.SAVINGS_MET, SAVINGS_XP, RefTypes.CYCLE, cycleId);
                }
            }
            levels.sync(userId);
        });
    }
}
```

Mocked in the test, the closer never sets `closed_at`, so the second run finds the same cycles; the ledger's unique reference is what keeps the +500 to once per cycle. With Plan 5's real close the second run finds nothing.

`server/src/main/java/in/gullak/jobs/DraftDiscarder.java`:

```java
package in.gullak.jobs;

/** The job's view of Plan 4's draft cleanup. */
interface DraftDiscarder {
    int discardOlderThan(int days);
}
```

`server/src/main/java/in/gullak/jobs/ImportsDraftDiscarder.java`:

```java
package in.gullak.jobs;

import in.gullak.ingestion.imports.ImportService;
import org.springframework.stereotype.Component;

@Component
class ImportsDraftDiscarder implements DraftDiscarder {
    private final ImportService imports;

    ImportsDraftDiscarder(ImportService imports) {
        this.imports = imports;
    }

    @Override
    public int discardOlderThan(int days) {
        return imports.discardOlderThan(days);
    }
}
```

`server/src/main/java/in/gullak/jobs/DraftCleanupJob.java`:

```java
package in.gullak.jobs;

import in.gullak.common.jobs.JobResult;
import in.gullak.common.jobs.JobRunner;
import in.gullak.common.log.Events;
import in.gullak.common.time.Ist;
import java.time.Clock;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Spec 2.3: a draft import older than 7 days is discarded. 03:00 IST. */
@Component
class DraftCleanupJob {
    static final String NAME = "draft-cleanup";
    static final int KEEP_DRAFT_DAYS = 7;
    private static final Logger log = LoggerFactory.getLogger(DraftCleanupJob.class);

    private final JobRunner runner;
    private final DraftDiscarder drafts;
    private final Clock clock;

    DraftCleanupJob(JobRunner runner, DraftDiscarder drafts, Clock clock) {
        this.runner = runner;
        this.drafts = drafts;
        this.clock = clock;
    }

    @Scheduled(cron = "0 0 3 * * *", zone = "Asia/Kolkata")
    public void scheduled() {
        run();
    }

    JobResult run() {
        return runner.run(NAME, Ist.today(clock).toString(), () -> List.of(JobRunner.GLOBAL), unit -> {
            int n = drafts.discardOlderThan(KEEP_DRAFT_DAYS);
            log.info("{} discarded={}", Events.IMPORT_DISCARDED, n);
        });
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.jobs.*'`
Expected: PASS.

Then: `cd server && ./gradlew test`
Expected: PASS. Plan 5's `CycleService.markClosed` already logs `cycle.closed`; remove that line from Plan 5's code in this commit so LOG-03 sees exactly one, and add the same log line to `CycleCloseService.closeEndedBefore` for cycles it closes lazily (outside this job).

- [ ] **Step 6: Commit**

```bash
git add server/src/main/java/in/gullak/budget server/src/main/java/in/gullak/jobs server/src/test/java/in/gullak/jobs
git commit -m "feat(server): cycle close job with +500 XP once per cycle; draft imports discarded after 7 days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Content lines in the database, with GullakLines as the fallback

**Owner:** backend-engineer. **Test IDs:** API-GM-05, API-GM-06, API-TDY-07 (still passes through the table). **Red team:** no (read-only, authenticated, no user text).

**Files:**
- Create: `server/src/main/resources/db/migration/V045__content_lines.sql`
- Create: `server/src/main/java/in/gullak/content/LineSlots.java`, `ReportBand.java`, `ReportLine.java`, `ContentLineEntity.java`, `ContentLineRepository.java`, `ContentLines.java`, `ContentController.java`
- Modify: `server/src/main/java/in/gullak/content/GullakLines.java` (whole file), `server/src/main/java/in/gullak/budget/BudgetService.java` (the line comes from `ContentLines`)
- Test: `server/src/test/java/in/gullak/content/ContentApiTest.java`

**Interfaces:**
- Consumes: `Personality`, `Mood`, `RupeeFormat` (Plan 1); `ValidationException`.
- Produces: table `content_lines (personality, slot, text)`; `LineSlots` (`home.happy`, `home.calm`, `home.nervous`, `home.fainted`, `report.great.title`, `report.great.body`, `report.ok.title`, `report.ok.body`, `report.over.title`, `report.over.body`); `ReportBand { GREAT, OK, OVER }`; `ReportLine(String title, String body)`; `ContentLines.all(Personality) : Map<String, String>`, `template(Personality, String) : String`, `homeLine(Personality, Mood, long leftPaise, long overPaise) : String`, `reportLine(Personality, ReportBand, String goalName) : ReportLine`, `refresh()`; `GullakLines.template(Personality, String)`, `GullakLines.templates(Personality)`, `GullakLines.fill(String, long, long)`; endpoint `GET /api/v1/content/lines?personality=` → `{personality, lines: {slot: template}}`.

- [ ] **Step 1: Write the failing tests**

`server/src/test/java/in/gullak/content/ContentApiTest.java`:

```java
package in.gullak.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.profile.Personality;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class ContentApiTest extends ApiTest {
    @Autowired ContentLines lines;

    @Test
    void savageSet() throws Exception { // API-GM-05
        TestUser u = signIn();
        mvc.perform(get("/api/v1/content/lines").param("personality", "SAVAGE").with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.personality").value("SAVAGE"))
            .andExpect(jsonPath("$.lines['home.happy']").value("{left} left. Hide it before Swiggy smells it."))
            .andExpect(jsonPath("$.lines['report.ok.title']").value("Barely"));
    }

    @Test
    void personalityIsCaseInsensitive() throws Exception { // API-GM-05 as written ("savage")
        TestUser u = signIn();
        mvc.perform(get("/api/v1/content/lines").param("personality", "savage").with(auth(u)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.personality").value("SAVAGE"));
    }

    @Test
    void unknownPersonality() throws Exception { // API-GM-06
        TestUser u = signIn();
        mvc.perform(get("/api/v1/content/lines").param("personality", "pirate").with(auth(u)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"))
            .andExpect(jsonPath("$.fields[0].field").value("personality"));
        mvc.perform(get("/api/v1/content/lines").with(auth(u))).andExpect(status().isBadRequest());
    }

    @Test
    void needsSignIn() throws Exception {
        mvc.perform(get("/api/v1/content/lines").param("personality", "CHILL")).andExpect(status().isUnauthorized());
    }

    @Test
    void theSeedMatchesTheFallback() {
        lines.refresh();
        for (Personality p : Personality.values()) {
            assertThat(lines.all(p)).isEqualTo(GullakLines.templates(p));
        }
    }

    @Test
    void everyPersonalityHasEverySlot() {
        for (Personality p : Personality.values()) {
            assertThat(GullakLines.templates(p).keySet()).containsExactlyInAnyOrderElementsOf(LineSlots.ALL);
            GullakLines.templates(p).values().forEach(t -> assertThat(t).isNotBlank().hasSizeLessThanOrEqualTo(200));
        }
    }

    @Test
    void anEditedLineReachesHomeWithoutARelease() throws Exception {
        TestUser u = exampleUser();
        String original = lines.template(Personality.CHILL, LineSlots.HOME_HAPPY);
        try {
            jdbc.sql("update content_lines set text = ? where personality = 'CHILL' and slot = 'home.happy'")
                .param("{left} to go. Edited line").update();
            lines.refresh();
            mvc.perform(get("/api/v1/budget/today").with(auth(u))).andExpect(jsonPath("$.line").value("₹1,666 to go. Edited line"));
        } finally {
            jdbc.sql("update content_lines set text = ? where personality = 'CHILL' and slot = 'home.happy'").param(original).update();
            lines.refresh();
        }
    }

    @Test
    void aMissingRowFallsBackToTheStaticLine() throws Exception {
        String original = lines.template(Personality.MOM, LineSlots.HOME_CALM);
        try {
            jdbc.sql("delete from content_lines where personality = 'MOM' and slot = 'home.calm'").update();
            lines.refresh();
            assertThat(lines.template(Personality.MOM, LineSlots.HOME_CALM)).isEqualTo(GullakLines.template(Personality.MOM, LineSlots.HOME_CALM));
        } finally {
            jdbc.sql("insert into content_lines (personality, slot, text) values ('MOM', 'home.calm', ?) on conflict do nothing")
                .param(original).update();
            lines.refresh();
        }
    }

    @Test
    void reportLinesFillTheGoal() {
        assertThat(lines.reportLine(Personality.CHILL, ReportBand.OK, null))
            .isEqualTo(new ReportLine("Easy day tomorrow?", "Cook at home and your goal gets a day closer"));
        assertThat(lines.reportLine(Personality.CHILL, ReportBand.OK, "the Goa trip").body())
            .isEqualTo("Cook at home and the Goa trip gets a day closer");
        assertThat(lines.reportLine(Personality.SAVAGE, ReportBand.OVER, "Goa").body())
            .isEqualTo("Swiggy knows your address by heart. Fix it tomorrow.");
    }

    @Test
    void homeLinesFillAmounts() {
        assertThat(lines.homeLine(Personality.CHILL, Mood.FAINTED, 0, 12_700)).isEqualTo("Over by ₹127. Happens. Tomorrow’s a fresh start.");
        assertThat(Map.copyOf(lines.all(Personality.HYPE))).containsKey(LineSlots.REPORT_GREAT_BODY);
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.content.*'`
Expected: compilation fails (`ContentLines`, `LineSlots`, `ReportBand`).

- [ ] **Step 3: Migration with the seed**

`server/src/main/resources/db/migration/V045__content_lines.sql`:

```sql
-- Gullak's lines per personality (spec 2.6: templates stored on the server so new ones ship without an
-- app release). {left} and {over} are rupee amounts; {goal} is the user's furthest goal or "your goal".
-- GullakLines holds the same text as the fallback for a missing row.
create table content_lines (
    id uuid primary key default gen_random_uuid(),
    personality varchar(16) not null check (personality in ('CHILL', 'SAVAGE', 'MOM', 'HYPE')),
    slot varchar(40) not null,
    text varchar(200) not null check (length(trim(text)) > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (personality, slot)
);

insert into content_lines (personality, slot, text) values
    ('CHILL', 'home.happy', '{left} left for today. Nice and steady.'),
    ('CHILL', 'home.calm', '{left} left. Easy does it.'),
    ('CHILL', 'home.nervous', 'Only {left} left today. Maybe skip the extra chai.'),
    ('CHILL', 'home.fainted', 'Over by {over}. Happens. Tomorrow’s a fresh start.'),
    ('CHILL', 'report.great.title', 'Nice and easy'),
    ('CHILL', 'report.great.body', 'Days like this add up, and {goal} says thanks'),
    ('CHILL', 'report.ok.title', 'Easy day tomorrow?'),
    ('CHILL', 'report.ok.body', 'Cook at home and {goal} gets a day closer'),
    ('CHILL', 'report.over.title', 'Happens'),
    ('CHILL', 'report.over.body', 'Tomorrow’s a fresh start, just a little tighter'),
    ('SAVAGE', 'home.happy', '{left} left. Hide it before Swiggy smells it.'),
    ('SAVAGE', 'home.calm', '{left} left. Don’t get ideas.'),
    ('SAVAGE', 'home.nervous', '{left} left. Put the phone down.'),
    ('SAVAGE', 'home.fainted', 'Over by {over}. Swiggy again? I’m going to lie down.'),
    ('SAVAGE', 'report.great.title', 'Who are you?'),
    ('SAVAGE', 'report.great.body', 'Under budget. I’m checking if you have a fever.'),
    ('SAVAGE', 'report.ok.title', 'Barely'),
    ('SAVAGE', 'report.ok.body', 'You survived. Don’t make cutting it close a habit.'),
    ('SAVAGE', 'report.over.title', 'Again?'),
    ('SAVAGE', 'report.over.body', 'Swiggy knows your address by heart. Fix it tomorrow.'),
    ('MOM', 'home.happy', '{left} left, beta. Ghar ka khana tonight, okay?'),
    ('MOM', 'home.calm', '{left} left. Eat something proper, beta.'),
    ('MOM', 'home.nervous', 'Only {left} left? Beta, what did you buy?'),
    ('MOM', 'home.fainted', 'Over by {over}? Beta, ghar pe khana nahi hai kya?'),
    ('MOM', 'report.great.title', 'Shabash, beta'),
    ('MOM', 'report.great.body', 'See? Ghar ka khana works.'),
    ('MOM', 'report.ok.title', 'Theek hai'),
    ('MOM', 'report.ok.body', 'Not bad, beta. Tomorrow, no outside food.'),
    ('MOM', 'report.over.title', 'Beta…'),
    ('MOM', 'report.over.body', 'What did you buy? Come, eat something and sleep.'),
    ('HYPE', 'home.happy', '{left} to play with today. Look at you go.'),
    ('HYPE', 'home.calm', '{left} left and you’re cruising'),
    ('HYPE', 'home.nervous', '{left} left. You’ve got this, finish strong.'),
    ('HYPE', 'home.fainted', 'Over by {over}, but you logged it all. That’s growth.'),
    ('HYPE', 'report.great.title', 'Legend'),
    ('HYPE', 'report.great.body', 'Under budget and glowing. You’re pulling {goal} closer.'),
    ('HYPE', 'report.ok.title', 'Solid'),
    ('HYPE', 'report.ok.body', 'You stayed in the lines, and that’s how {goal} happens'),
    ('HYPE', 'report.over.title', 'Still counts'),
    ('HYPE', 'report.over.body', 'You logged it all, and that’s growth. Bounce back tomorrow.');
```

- [ ] **Step 4: The fallback map and the slots**

`server/src/main/java/in/gullak/content/LineSlots.java`:

```java
package in.gullak.content;

import java.util.List;

public final class LineSlots {
    public static final String HOME_HAPPY = "home.happy";
    public static final String HOME_CALM = "home.calm";
    public static final String HOME_NERVOUS = "home.nervous";
    public static final String HOME_FAINTED = "home.fainted";
    public static final String REPORT_GREAT_TITLE = "report.great.title";
    public static final String REPORT_GREAT_BODY = "report.great.body";
    public static final String REPORT_OK_TITLE = "report.ok.title";
    public static final String REPORT_OK_BODY = "report.ok.body";
    public static final String REPORT_OVER_TITLE = "report.over.title";
    public static final String REPORT_OVER_BODY = "report.over.body";

    public static final List<String> ALL = List.of(HOME_HAPPY, HOME_CALM, HOME_NERVOUS, HOME_FAINTED,
        REPORT_GREAT_TITLE, REPORT_GREAT_BODY, REPORT_OK_TITLE, REPORT_OK_BODY, REPORT_OVER_TITLE, REPORT_OVER_BODY);

    private LineSlots() {}

    public static String home(Mood mood) {
        return switch (mood) {
            case HAPPY -> HOME_HAPPY;
            case CALM -> HOME_CALM;
            case NERVOUS -> HOME_NERVOUS;
            case FAINTED -> HOME_FAINTED;
        };
    }

    public static String reportTitle(ReportBand band) {
        return "report." + band.slotName() + ".title";
    }

    public static String reportBody(ReportBand band) {
        return "report." + band.slotName() + ".body";
    }
}
```

`server/src/main/java/in/gullak/content/ReportBand.java`:

```java
package in.gullak.content;

import java.util.Locale;

/** The report card's line follows the grade: GREAT for A+ and A, OK for B, OVER for C, D and F. */
public enum ReportBand {
    GREAT, OK, OVER;

    String slotName() {
        return name().toLowerCase(Locale.ROOT);
    }
}
```

`server/src/main/java/in/gullak/content/ReportLine.java`:

```java
package in.gullak.content;

public record ReportLine(String title, String body) {}
```

Replace `server/src/main/java/in/gullak/content/GullakLines.java` with (Home strings unchanged from Plan 1; report strings match the seed):

```java
package in.gullak.content;

import in.gullak.common.money.RupeeFormat;
import in.gullak.profile.Personality;
import java.util.EnumMap;
import java.util.Map;

/**
 * The built-in copy of every Gullak line. The live copy is the content_lines table (ContentLines); this map
 * is its fallback for any missing row, so the Gullak is never silent.
 */
public final class GullakLines {
    private static final Map<Personality, Map<String, String>> TEMPLATES = new EnumMap<>(Personality.class);

    static {
        TEMPLATES.put(Personality.CHILL, Map.of(
            LineSlots.HOME_HAPPY, "{left} left for today. Nice and steady.",
            LineSlots.HOME_CALM, "{left} left. Easy does it.",
            LineSlots.HOME_NERVOUS, "Only {left} left today. Maybe skip the extra chai.",
            LineSlots.HOME_FAINTED, "Over by {over}. Happens. Tomorrow’s a fresh start.",
            LineSlots.REPORT_GREAT_TITLE, "Nice and easy",
            LineSlots.REPORT_GREAT_BODY, "Days like this add up, and {goal} says thanks",
            LineSlots.REPORT_OK_TITLE, "Easy day tomorrow?",
            LineSlots.REPORT_OK_BODY, "Cook at home and {goal} gets a day closer",
            LineSlots.REPORT_OVER_TITLE, "Happens",
            LineSlots.REPORT_OVER_BODY, "Tomorrow’s a fresh start, just a little tighter"));
        TEMPLATES.put(Personality.SAVAGE, Map.of(
            LineSlots.HOME_HAPPY, "{left} left. Hide it before Swiggy smells it.",
            LineSlots.HOME_CALM, "{left} left. Don’t get ideas.",
            LineSlots.HOME_NERVOUS, "{left} left. Put the phone down.",
            LineSlots.HOME_FAINTED, "Over by {over}. Swiggy again? I’m going to lie down.",
            LineSlots.REPORT_GREAT_TITLE, "Who are you?",
            LineSlots.REPORT_GREAT_BODY, "Under budget. I’m checking if you have a fever.",
            LineSlots.REPORT_OK_TITLE, "Barely",
            LineSlots.REPORT_OK_BODY, "You survived. Don’t make cutting it close a habit.",
            LineSlots.REPORT_OVER_TITLE, "Again?",
            LineSlots.REPORT_OVER_BODY, "Swiggy knows your address by heart. Fix it tomorrow."));
        TEMPLATES.put(Personality.MOM, Map.of(
            LineSlots.HOME_HAPPY, "{left} left, beta. Ghar ka khana tonight, okay?",
            LineSlots.HOME_CALM, "{left} left. Eat something proper, beta.",
            LineSlots.HOME_NERVOUS, "Only {left} left? Beta, what did you buy?",
            LineSlots.HOME_FAINTED, "Over by {over}? Beta, ghar pe khana nahi hai kya?",
            LineSlots.REPORT_GREAT_TITLE, "Shabash, beta",
            LineSlots.REPORT_GREAT_BODY, "See? Ghar ka khana works.",
            LineSlots.REPORT_OK_TITLE, "Theek hai",
            LineSlots.REPORT_OK_BODY, "Not bad, beta. Tomorrow, no outside food.",
            LineSlots.REPORT_OVER_TITLE, "Beta…",
            LineSlots.REPORT_OVER_BODY, "What did you buy? Come, eat something and sleep."));
        TEMPLATES.put(Personality.HYPE, Map.of(
            LineSlots.HOME_HAPPY, "{left} to play with today. Look at you go.",
            LineSlots.HOME_CALM, "{left} left and you’re cruising",
            LineSlots.HOME_NERVOUS, "{left} left. You’ve got this, finish strong.",
            LineSlots.HOME_FAINTED, "Over by {over}, but you logged it all. That’s growth.",
            LineSlots.REPORT_GREAT_TITLE, "Legend",
            LineSlots.REPORT_GREAT_BODY, "Under budget and glowing. You’re pulling {goal} closer.",
            LineSlots.REPORT_OK_TITLE, "Solid",
            LineSlots.REPORT_OK_BODY, "You stayed in the lines, and that’s how {goal} happens",
            LineSlots.REPORT_OVER_TITLE, "Still counts",
            LineSlots.REPORT_OVER_BODY, "You logged it all, and that’s growth. Bounce back tomorrow."));
    }

    private GullakLines() {}

    /**
     * The built-in Home line. Kept for callers and tests from Plan 1; the server itself goes through ContentLines.
     *
     * @param leftPaise what is left of today's budget
     * @param overPaise the full overspend to show: today's plus any pool deficit
     */
    public static String line(Personality personality, Mood mood, long leftPaise, long overPaise) {
        return fill(template(personality, LineSlots.home(mood)), leftPaise, overPaise);
    }

    public static String template(Personality personality, String slot) {
        String t = TEMPLATES.get(personality).get(slot);
        if (t == null) {
            throw new IllegalArgumentException("no built-in line for slot " + slot);
        }
        return t;
    }

    public static Map<String, String> templates(Personality personality) {
        return TEMPLATES.get(personality);
    }

    public static String fill(String template, long leftPaise, long overPaise) {
        return template.replace("{left}", RupeeFormat.format(leftPaise)).replace("{over}", RupeeFormat.format(overPaise));
    }
}
```

- [ ] **Step 5: The table, cached**

`server/src/main/java/in/gullak/content/ContentLineEntity.java`:

```java
package in.gullak.content;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

/** Read-only in the app; lines are edited in the database. */
@Entity
@Table(name = "content_lines")
class ContentLineEntity {
    @Id
    private UUID id;

    @Column(nullable = false, length = 16)
    private String personality;

    @Column(nullable = false, length = 40)
    private String slot;

    @Column(nullable = false, length = 200)
    private String text;

    protected ContentLineEntity() {}

    String getPersonality() { return personality; }
    String getSlot() { return slot; }
    String getText() { return text; }
}
```

`server/src/main/java/in/gullak/content/ContentLineRepository.java`:

```java
package in.gullak.content;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface ContentLineRepository extends JpaRepository<ContentLineEntity, UUID> {}
```

`server/src/main/java/in/gullak/content/ContentLines.java`:

```java
package in.gullak.content;

import in.gullak.profile.Personality;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/** The live Gullak lines: the content_lines table over the built-in GullakLines, re-read every 5 minutes. */
@Service
public class ContentLines {
    static final Duration TTL = Duration.ofMinutes(5);
    static final String NO_GOAL = "your goal";
    private static final Set<String> PERSONALITIES =
        Arrays.stream(Personality.values()).map(Enum::name).collect(Collectors.toUnmodifiableSet());

    private record Snapshot(Map<Personality, Map<String, String>> rows, Instant loadedAt) {}

    private final ContentLineRepository repository;
    private final Clock clock;
    private volatile Snapshot snapshot;

    ContentLines(ContentLineRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    /** Every slot for a personality: the table's text where a row exists, the built-in text otherwise. */
    public Map<String, String> all(Personality personality) {
        Map<String, String> merged = new TreeMap<>(GullakLines.templates(personality));
        merged.putAll(rows(personality));
        return merged;
    }

    public String template(Personality personality, String slot) {
        String fromTable = rows(personality).get(slot);
        return fromTable != null ? fromTable : GullakLines.template(personality, slot);
    }

    public String homeLine(Personality personality, Mood mood, long leftPaise, long overPaise) {
        return GullakLines.fill(template(personality, LineSlots.home(mood)), leftPaise, overPaise);
    }

    public ReportLine reportLine(Personality personality, ReportBand band, String goalName) {
        String goal = goalName == null || goalName.isBlank() ? NO_GOAL : goalName;
        return new ReportLine(template(personality, LineSlots.reportTitle(band)).replace("{goal}", goal),
            template(personality, LineSlots.reportBody(band)).replace("{goal}", goal));
    }

    /** Re-reads the table now (tests, or after an edit). */
    public void refresh() {
        snapshot = load();
    }

    private Map<String, String> rows(Personality personality) {
        Snapshot s = snapshot;
        Instant now = clock.instant();
        if (s == null || now.isAfter(s.loadedAt().plus(TTL)) || now.isBefore(s.loadedAt())) {
            s = load();
            snapshot = s;
        }
        return s.rows().getOrDefault(personality, Map.of());
    }

    private Snapshot load() {
        Map<Personality, Map<String, String>> rows = new EnumMap<>(Personality.class);
        for (ContentLineEntity e : repository.findAll()) {
            if (PERSONALITIES.contains(e.getPersonality()) && e.getText() != null && !e.getText().isBlank()) {
                rows.computeIfAbsent(Personality.valueOf(e.getPersonality()), k -> new HashMap<>()).put(e.getSlot(), e.getText());
            }
        }
        return new Snapshot(rows, clock.instant());
    }
}
```

`server/src/main/java/in/gullak/content/ContentController.java`:

```java
package in.gullak.content;

import in.gullak.common.error.ValidationException;
import in.gullak.profile.Personality;
import java.util.Locale;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/content")
class ContentController {
    record LinesResponse(Personality personality, Map<String, String> lines) {}

    private final ContentLines lines;

    ContentController(ContentLines lines) {
        this.lines = lines;
    }

    /** The templates for one personality (API-GM-05). Placeholders are left for the app to fill. */
    @GetMapping("/lines")
    LinesResponse lines(@RequestParam String personality) {
        Personality p = parse(personality);
        return new LinesResponse(p, lines.all(p));
    }

    private static Personality parse(String raw) {
        String name = raw.trim().toUpperCase(Locale.ROOT);
        for (Personality p : Personality.values()) {
            if (p.name().equals(name)) {
                return p;
            }
        }
        throw new ValidationException("personality", "Pick one of CHILL, SAVAGE, MOM or HYPE");
    }
}
```

- [ ] **Step 6: Home's line comes from the table**

In `server/src/main/java/in/gullak/budget/BudgetService.java`, add `ContentLines lines` as a constructor parameter and field (`private final ContentLines lines;`, `this.lines = lines;`), and in `compute` replace the expression

```java
GullakLines.line(profile.personality(), b.mood(), b.leftPaise(), b.totalOverPaise())
```

with

```java
lines.homeLine(profile.personality(), b.mood(), b.leftPaise(), b.totalOverPaise())
```

Remove the now-unused `GullakLines` import from `BudgetService`.

- [ ] **Step 7: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.content.*' --tests 'in.gullak.budget.*'`
Expected: PASS (Plan 1's `GullakLinesTest` and `TodayApiTest` unchanged and green).

- [ ] **Step 8: Commit**

```bash
git add server/src/main/resources/db/migration/V045__content_lines.sql server/src/main/java/in/gullak/content server/src/main/java/in/gullak/budget/BudgetService.java server/src/test/java/in/gullak/content
git commit -m "feat(server): Gullak lines in content_lines with the static map as fallback; GET /content/lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: GET /me/progress, the game strip on /budget/today and acknowledging celebrations

**Owner:** backend-engineer. **Test IDs:** API-GM-01, API-GM-07 (new: acknowledge celebrations), API-TDY-09 (new: `game` on Home), BDG-01 (through Home), API-X-01 (progress and ack never cross users). **Red team:** yes (celebrate flags replayed; acknowledging another user's ids; reading another user's progress).

**Files:**
- Create: `server/src/main/java/in/gullak/common/game/HomeGame.java`, `HomeCelebration.java`, `HomeGameSource.java`
- Create: `server/src/main/java/in/gullak/gamification/FurthestGoal.java`, `FurthestGoalSource.java`, `GameStatusService.java`, `ProgressResponse.java`, `ProgressService.java`, `ProgressController.java`, `CelebrationController.java`
- Create: `server/src/main/java/in/gullak/goals/FurthestGoalQuery.java`
- Modify: `server/src/main/java/in/gullak/budget/TodayResponse.java`, `server/src/main/java/in/gullak/budget/BudgetService.java`
- Test: `server/src/test/java/in/gullak/gamification/ProgressApiTest.java`, `server/src/test/java/in/gullak/budget/TodayGameApiTest.java`

**Interfaces:**
- Consumes: `LevelTracker`, `CelebrationService` (Task 3); `StreakService` (Task 4); `BadgeService`, `GameQueries` (Task 5); `ChallengeService.current` (Task 7); Plan 5's `goals` and `goal_contributions` tables.
- Produces: `HomeGame(int streak, int level, String stage, List<HomeCelebration> celebrate)` with `HomeGame.NONE`; `HomeCelebration(UUID id, String kind, String value)`; `HomeGameSource.forHome(UUID) : HomeGame`; `TodayResponse.game` and `TodayResponse.withGame(HomeGame)`; `FurthestGoalSource.furthest(UUID) : Optional<FurthestGoal>`; `FurthestGoal(String name, int percent)`; `GET /api/v1/me/progress` → `ProgressResponse`; `POST /api/v1/me/celebrations/ack {ids: [uuid, …]}` (1–20 ids) → 204.

`GET /api/v1/me/progress` body:

```json
{"xp":500,"level":2,"stage":"CLAY","levelFloorXp":400,"nextLevelXp":900,"toNextLevelPercent":20,
 "streak":{"current":3,"best":3,"freezes":0},
 "badges":[{"code":"FIRST_LOG","earned":false,"earnedOn":null,"progress":null,"target":null}, …10 in catalogue order],
 "challengeBadges":[{"categoryCode":"food_delivery","categoryName":"Food delivery","earnedOn":"2026-10-26"}],
 "furthestGoal":{"name":"Emergency fund","percent":40},
 "challenge":{"weekStart":"2026-10-19","weekEnd":"2026-10-25","categoryCode":"food_delivery","categoryName":"Food delivery",
              "targetPaise":80000,"progressPaise":30000,"done":false,"evaluated":false}}
```

`game` on `GET /api/v1/budget/today`: `{"streak":5,"level":3,"stage":"CLAY","celebrate":[{"id":"…","kind":"LEVEL_UP","value":"3"}]}`.

- [ ] **Step 1: Write the failing tests**

`server/src/test/java/in/gullak/budget/TodayGameApiTest.java`:

```java
package in.gullak.budget;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class TodayGameApiTest extends ApiTest {
    ResultActions today(TestUser u) throws Exception {
        return mvc.perform(get("/api/v1/budget/today").with(auth(u)));
    }

    List<String> celebrationIds(TestUser u) throws Exception {
        return JsonPath.read(today(u).andReturn().getResponse().getContentAsString(), "$.game.celebrate[*].id");
    }

    ResultActions ack(TestUser u, String json) throws Exception {
        return mvc.perform(post("/api/v1/me/celebrations/ack").with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    static String idsJson(List<String> ids) {
        return ids.stream().map(i -> "\"" + i + "\"").collect(Collectors.joining(",", "{\"ids\":[", "]}"));
    }

    @Test
    void homeCarriesStreakLevelStageAndCelebrations() throws Exception { // API-TDY-09
        TestUser u = exampleUser();
        seedXp(u, 400);
        jdbc.sql("insert into streaks (user_id, current_days, best_days) values (?, 5, 5)").param(u.id()).update();
        today(u)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.game.streak").value(5))
            .andExpect(jsonPath("$.game.level").value(2))
            .andExpect(jsonPath("$.game.stage").value("CLAY"))
            .andExpect(jsonPath("$.game.celebrate[0].kind").value("LEVEL_UP"))
            .andExpect(jsonPath("$.game.celebrate[0].value").value("2"))
            .andExpect(jsonPath("$.budgetPaise").value(166_666));
    }

    @Test
    void theFirstSpendEarnsFirstLogOnHome() throws Exception { // BDG-01 through Home
        TestUser u = exampleUser();
        seedSpend(u, 25_000, clock.instant());
        today(u).andExpect(jsonPath("$.game.celebrate[*].value").value(Matchers.hasItem("FIRST_LOG")));
    }

    @Test
    void ackedCelebrationsNeverComeBack() throws Exception { // API-GM-07, review focus
        TestUser u = exampleUser();
        seedXp(u, 400);
        List<String> ids = celebrationIds(u);
        ack(u, idsJson(ids)).andExpect(status().isNoContent());
        today(u).andExpect(jsonPath("$.game.celebrate").isEmpty());
        ack(u, idsJson(ids)).andExpect(status().isNoContent()); // a replayed ack is harmless
        today(u).andExpect(jsonPath("$.game.celebrate").isEmpty());
    }

    @Test
    void ackWithAnotherUsersIdChangesNothing() throws Exception { // API-GM-07, API-X-01, review focus
        TestUser a = exampleUser();
        TestUser b = exampleUser();
        seedXp(a, 400);
        List<String> aIds = celebrationIds(a);
        ack(b, idsJson(aIds)).andExpect(status().isNoContent());
        today(a).andExpect(jsonPath("$.game.celebrate.length()").value(aIds.size()));
    }

    @Test
    void ackValidatesItsBody() throws Exception { // API-GM-07
        TestUser u = exampleUser();
        ack(u, "{\"ids\":[]}").andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        ack(u, idsJson(IntStream.range(0, 21).mapToObj(i -> UUID.randomUUID().toString()).toList()))
            .andExpect(status().isBadRequest());
        ack(u, "{\"ids\":[\"not-a-uuid\"]}").andExpect(status().isBadRequest());
        ack(u, "{}").andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/me/celebrations/ack").contentType(MediaType.APPLICATION_JSON).content("{\"ids\":[]}"))
            .andExpect(status().isUnauthorized());
    }
}
```

`server/src/test/java/in/gullak/gamification/ProgressApiTest.java`:

```java
package in.gullak.gamification;

import static org.hamcrest.Matchers.contains;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class ProgressApiTest extends ApiTest {
    @Autowired StreakService streaks;
    @Autowired BadgeService badges;

    UUID octoberCycle(TestUser u) {
        return jdbc.sql("select id from cycles where user_id = ? and start_date = date '2026-10-01'").param(u.id())
            .query(UUID.class).single();
    }

    /** Plan 5's tables, seeded directly. Match the value case Plan 5's check constraints use. */
    void goal(TestUser u, String name, long target, long saved) {
        UUID goalId = UUID.randomUUID();
        jdbc.sql("""
                insert into goals (id, user_id, name, type, target_paise, deadline, mode, status, created_cycle_id, created_on)
                values (?, ?, ?, 'DEADLINE', ?, date '2027-03-31', 'FLEXIBLE', 'ACTIVE', ?, date '2026-10-01')
                """)
            .params(goalId, u.id(), name, target, octoberCycle(u)).update();
        jdbc.sql("""
                insert into goal_contributions (id, goal_id, user_id, cycle_id, amount_paise, kind)
                values (?, ?, ?, ?, ?, 'MANUAL')
                """)
            .params(UUID.randomUUID(), goalId, u.id(), octoberCycle(u), saved).update();
    }

    @Test
    void progressIsTheCallersLedgerStreakBadgesAndChallenge() throws Exception { // API-GM-01
        TestUser u = gameUser();
        seedXp(u, 500);
        reverseXp(seedXp(u, 1_000));
        for (int d = 20; d <= 22; d++) {
            streaks.apply(u.id(), LocalDate.of(2026, 10, d), true);
        }
        badges.earn(u.id(), Badge.SORTED);
        jdbc.sql("""
                insert into weekly_challenges (id, user_id, week_start, category_code, target_paise)
                values (?, ?, date '2026-10-19', 'food_delivery', 80000)
                """).params(UUID.randomUUID(), u.id()).update();
        seedCategorySpend(u, 30_000, Instant.parse("2026-10-20T06:30:00Z"), "food_delivery", "Swiggy");

        mvc.perform(get("/api/v1/me/progress").with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.xp").value(500))
            .andExpect(jsonPath("$.level").value(2))
            .andExpect(jsonPath("$.stage").value("CLAY"))
            .andExpect(jsonPath("$.levelFloorXp").value(400))
            .andExpect(jsonPath("$.nextLevelXp").value(900))
            .andExpect(jsonPath("$.toNextLevelPercent").value(20))
            .andExpect(jsonPath("$.streak.current").value(3))
            .andExpect(jsonPath("$.streak.freezes").value(0))
            .andExpect(jsonPath("$.badges.length()").value(10))
            .andExpect(jsonPath("$.badges[0].code").value("FIRST_LOG"))
            .andExpect(jsonPath("$.badges[?(@.code == 'SORTED')].earned").value(contains(true)))
            .andExpect(jsonPath("$.badges[?(@.code == 'SORTED')].earnedOn").value(contains("2026-10-23")))
            .andExpect(jsonPath("$.badges[?(@.code == 'WEEK_WARRIOR')].progress").value(contains(3)))
            .andExpect(jsonPath("$.badges[?(@.code == 'WEEK_WARRIOR')].target").value(contains(7)))
            .andExpect(jsonPath("$.badges[?(@.code == 'DIAMOND_GULLAK')].progress").value(contains(2)))
            .andExpect(jsonPath("$.challenge.categoryCode").value("food_delivery"))
            .andExpect(jsonPath("$.challenge.categoryName").value("Food delivery"))
            .andExpect(jsonPath("$.challenge.targetPaise").value(80_000))
            .andExpect(jsonPath("$.challenge.progressPaise").value(30_000))
            .andExpect(jsonPath("$.challengeBadges").isEmpty());
    }

    @Test
    void goalCrusherShowsTheFurthestGoal() throws Exception { // ux finding: furthest goal, not the first
        TestUser u = gameUser();
        goal(u, "Goa trip", 3_000_000, 1_020_000); // 34%
        goal(u, "Emergency fund", 5_000_000, 2_000_000); // 40%
        mvc.perform(get("/api/v1/me/progress").with(auth(u)))
            .andExpect(jsonPath("$.furthestGoal.name").value("Emergency fund"))
            .andExpect(jsonPath("$.furthestGoal.percent").value(40))
            .andExpect(jsonPath("$.badges[?(@.code == 'GOAL_CRUSHER')].progress").value(contains(40)))
            .andExpect(jsonPath("$.badges[?(@.code == 'GOAL_CRUSHER')].target").value(contains(100)));
    }

    @Test
    void anotherUsersProgressNeverShows() throws Exception { // API-X-01
        TestUser a = gameUser();
        TestUser b = gameUser();
        seedXp(a, 5_000);
        badges.earn(a.id(), Badge.SORTED);
        mvc.perform(get("/api/v1/me/progress").with(auth(b)))
            .andExpect(jsonPath("$.xp").value(0))
            .andExpect(jsonPath("$.badges[?(@.earned == true)]").isEmpty())
            .andExpect(jsonPath("$.furthestGoal").isEmpty())
            .andExpect(jsonPath("$.challenge").isEmpty());
    }

    @Test
    void needsSignIn() throws Exception {
        mvc.perform(get("/api/v1/me/progress")).andExpect(status().isUnauthorized());
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.budget.TodayGameApiTest' --tests 'in.gullak.gamification.ProgressApiTest'`
Expected: FAIL (no `game` field; `/me/progress` and `/me/celebrations/ack` are 404).

- [ ] **Step 3: The seam between budget and gamification**

`server/src/main/java/in/gullak/common/game/HomeCelebration.java`:

```java
package in.gullak.common.game;

import java.util.UUID;

/** One pending celebration for the app to play once and acknowledge. */
public record HomeCelebration(UUID id, String kind, String value) {}
```

`server/src/main/java/in/gullak/common/game/HomeGame.java`:

```java
package in.gullak.common.game;

import java.util.List;

/** Home's game strip: the flame pill, the level pill, the Gullak's stage and the celebrations to play. */
public record HomeGame(int streak, int level, String stage, List<HomeCelebration> celebrate) {
    public static final HomeGame NONE = new HomeGame(0, 1, "CLAY", List.of());
}
```

`server/src/main/java/in/gullak/common/game/HomeGameSource.java`:

```java
package in.gullak.common.game;

import java.util.UUID;

/**
 * Implemented by gamification, used by budget for GET /budget/today. Lives in common so neither feature
 * depends on the other (gamification is called by goals, which budget shows).
 */
public interface HomeGameSource {
    HomeGame forHome(UUID userId);
}
```

Replace `server/src/main/java/in/gullak/budget/TodayResponse.java` with the version below. It shows the Plan 1 and Plan 2 components; if Plans 3 or 5 added components (for example `catchUp`), keep them in their place before `game`, and pass them through in both the short constructor and `withGame`:

```java
package in.gullak.budget;

import in.gullak.common.game.HomeGame;
import in.gullak.content.Mood;
import java.time.LocalDate;

public record TodayResponse(
    LocalDate date,
    long budgetPaise,
    long spentPaise,
    long leftPaise,
    long overPaise,
    long poolOverPaise,
    Mood mood,
    String line,
    int daysLeft,
    LocalDate cycleStart,
    LocalDate cycleEnd,
    HomeGame game) {

    /** Construction sites that compute figures only; today() adds the game strip with {@link #withGame}. */
    public TodayResponse(LocalDate date, long budgetPaise, long spentPaise, long leftPaise, long overPaise,
                         long poolOverPaise, Mood mood, String line, int daysLeft, LocalDate cycleStart, LocalDate cycleEnd) {
        this(date, budgetPaise, spentPaise, leftPaise, overPaise, poolOverPaise, mood, line, daysLeft, cycleStart, cycleEnd,
            HomeGame.NONE);
    }

    public TodayResponse withGame(HomeGame game) {
        return new TodayResponse(date, budgetPaise, spentPaise, leftPaise, overPaise, poolOverPaise, mood, line, daysLeft,
            cycleStart, cycleEnd, game);
    }
}
```

In `BudgetService`, add `HomeGameSource game` as a constructor parameter and field, and end both `today` and `setFirstCyclePool` with the game strip (the rest of each method is unchanged):

```java
    @Transactional
    public TodayResponse today(UUID userId) {
        Profile profile = profiles.get(userId);
        LocalDate today = Ist.today(clock);
        long fixed = fixedCosts.totalFor(userId);
        CurrentCycle current = cycles.current(userId, today, profile, spendable(profile, fixed));
        return compute(userId, profile, today, fixed, current).withGame(game.forHome(userId));
    }
```

and in `setFirstCyclePool`, `return compute(...).withGame(game.forHome(userId));`. If a later plan reshaped `today()`, keep its body and apply `.withGame(game.forHome(userId))` to the value it returns.

- [ ] **Step 4: Gamification's side**

`server/src/main/java/in/gullak/gamification/FurthestGoal.java`:

```java
package in.gullak.gamification;

/** The goal closest to done, for Goal crusher's progress (ux finding: the furthest goal, not the first). */
public record FurthestGoal(String name, int percent) {}
```

`server/src/main/java/in/gullak/gamification/FurthestGoalSource.java`:

```java
package in.gullak.gamification;

import java.util.Optional;
import java.util.UUID;

/** Implemented by the goals feature; absent until goals exist, in which case progress shows no goal. */
public interface FurthestGoalSource {
    Optional<FurthestGoal> furthest(UUID userId);
}
```

`server/src/main/java/in/gullak/gamification/GameStatusService.java`:

```java
package in.gullak.gamification;

import in.gullak.common.game.HomeCelebration;
import in.gullak.common.game.HomeGame;
import in.gullak.common.game.HomeGameSource;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Home's game strip. Also where XP written by other features (Plan 3's spends) turns into a level-up and a
 * first spend into First log, because Home refetches right after a spend.
 */
@Service
class GameStatusService implements HomeGameSource {
    private final BadgeService badges;
    private final LevelTracker levels;
    private final StreakService streaks;
    private final CelebrationService celebrations;

    GameStatusService(BadgeService badges, LevelTracker levels, StreakService streaks, CelebrationService celebrations) {
        this.badges = badges;
        this.levels = levels;
        this.streaks = streaks;
        this.celebrations = celebrations;
    }

    @Override
    @Transactional
    public HomeGame forHome(UUID userId) {
        badges.checkFirstLog(userId);
        LevelView level = levels.sync(userId);
        StreakState streak = streaks.current(userId);
        List<HomeCelebration> celebrate = celebrations.pending(userId).stream()
            .map(c -> new HomeCelebration(c.id(), c.kind().name(), c.value())).toList();
        return new HomeGame(streak.current(), level.level(), level.stage().name(), celebrate);
    }
}
```

`server/src/main/java/in/gullak/gamification/ProgressResponse.java`:

```java
package in.gullak.gamification;

import java.time.LocalDate;
import java.util.List;

public record ProgressResponse(
    long xp,
    int level,
    Stage stage,
    long levelFloorXp,
    long nextLevelXp,
    int toNextLevelPercent,
    StreakView streak,
    List<BadgeView> badges,
    List<ChallengeBadgeView> challengeBadges,
    FurthestGoal furthestGoal,
    ChallengeView challenge) {

    public record StreakView(int current, int best, int freezes) {}

    /** {@code progress}/{@code target} only for a badge not yet earned that has a count to show. */
    public record BadgeView(Badge code, boolean earned, LocalDate earnedOn, Integer progress, Integer target) {}

    public record ChallengeBadgeView(String categoryCode, String categoryName, LocalDate earnedOn) {}
}
```

`server/src/main/java/in/gullak/gamification/ProgressService.java`:

```java
package in.gullak.gamification;

import in.gullak.common.time.Ist;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProgressService {
    private final LevelTracker levels;
    private final StreakService streaks;
    private final BadgeService badges;
    private final ChallengeService challenges;
    private final GameQueries queries;
    private final ObjectProvider<FurthestGoalSource> goals;
    private final Clock clock;

    ProgressService(LevelTracker levels, StreakService streaks, BadgeService badges, ChallengeService challenges,
                    GameQueries queries, ObjectProvider<FurthestGoalSource> goals, Clock clock) {
        this.levels = levels;
        this.streaks = streaks;
        this.badges = badges;
        this.challenges = challenges;
        this.queries = queries;
        this.goals = goals;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public ProgressResponse progress(UUID userId) {
        LevelView level = levels.view(userId);
        StreakState streak = streaks.current(userId);
        Map<String, Instant> earned = new HashMap<>();
        badges.earned(userId).forEach(b -> earned.put(b.code(), b.earnedAt()));
        FurthestGoalSource source = goals.getIfAvailable();
        Optional<FurthestGoal> furthest = source == null ? Optional.empty() : source.furthest(userId);
        int zeptoFree = badges.counter(userId, BadgeCounters.ZEPTO_FREE);

        List<ProgressResponse.BadgeView> list = Arrays.stream(Badge.values()).map(b -> {
            Instant at = earned.get(b.name());
            if (at != null) {
                return new ProgressResponse.BadgeView(b, true, LocalDate.ofInstant(at, Ist.ZONE), null, null);
            }
            return switch (b) {
                case WEEK_WARRIOR -> new ProgressResponse.BadgeView(b, false, null, Math.min(streak.current(), 7), 7);
                case ZEPTO_FREE_WEEK -> new ProgressResponse.BadgeView(b, false, null, Math.min(zeptoFree, 7), 7);
                case DIAMOND_GULLAK -> new ProgressResponse.BadgeView(b, false, null, Math.min(level.level(), 20), 20);
                case GOAL_CRUSHER -> furthest
                    .map(g -> new ProgressResponse.BadgeView(b, false, null, g.percent(), 100))
                    .orElseGet(() -> new ProgressResponse.BadgeView(b, false, null, null, null));
                default -> new ProgressResponse.BadgeView(b, false, null, null, null);
            };
        }).toList();

        List<ProgressResponse.ChallengeBadgeView> challengeBadges = earned.entrySet().stream()
            .filter(e -> e.getKey().startsWith(Badge.CHALLENGE_PREFIX))
            .sorted(Map.Entry.comparingByValue())
            .map(e -> {
                String code = e.getKey().substring(Badge.CHALLENGE_PREFIX.length()).toLowerCase(Locale.ROOT);
                return new ProgressResponse.ChallengeBadgeView(code, queries.categoryName(code), LocalDate.ofInstant(e.getValue(), Ist.ZONE));
            }).toList();

        return new ProgressResponse(level.xp(), level.level(), level.stage(), level.floorXp(), level.nextXp(),
            level.percentToNext(), new ProgressResponse.StreakView(streak.current(), streak.best(), streak.freezes()),
            list, challengeBadges, furthest.orElse(null), challenges.current(userId, Ist.today(clock)).orElse(null));
    }
}
```

`server/src/main/java/in/gullak/gamification/ProgressController.java`:

```java
package in.gullak.gamification;

import in.gullak.common.web.CurrentUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ProgressController {
    private final ProgressService progress;

    ProgressController(ProgressService progress) {
        this.progress = progress;
    }

    @GetMapping("/api/v1/me/progress")
    ProgressResponse progress(@AuthenticationPrincipal Jwt jwt) {
        return progress.progress(CurrentUser.id(jwt));
    }
}
```

`server/src/main/java/in/gullak/gamification/CelebrationController.java`:

```java
package in.gullak.gamification;

import in.gullak.common.web.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
class CelebrationController {
    record AckRequest(@NotNull @Size(min = 1, max = 20) List<@NotNull UUID> ids) {}

    private final CelebrationService celebrations;

    CelebrationController(CelebrationService celebrations) {
        this.celebrations = celebrations;
    }

    /** Marks the caller's celebrations as played. Ids that are not theirs are ignored; a repeat is a no-op. */
    @PostMapping("/api/v1/me/celebrations/ack")
    ResponseEntity<Void> ack(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody AckRequest body) {
        celebrations.ack(CurrentUser.id(jwt), body.ids());
        return ResponseEntity.noContent().build();
    }
}
```

- [ ] **Step 5: The goals adapter**

`server/src/main/java/in/gullak/goals/FurthestGoalQuery.java`:

```java
package in.gullak.goals;

import in.gullak.gamification.FurthestGoal;
import in.gullak.gamification.FurthestGoalSource;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * The active or paused goal with the largest share of its target saved. "Saved" is the sum of the goal's
 * contributions, the same figure GET /goals shows; if Plan 5 defines saved differently, use its query here.
 */
@Component
class FurthestGoalQuery implements FurthestGoalSource {
    private final JdbcClient jdbc;

    FurthestGoalQuery(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<FurthestGoal> furthest(UUID userId) {
        return jdbc.sql("""
                select g.name, g.target_paise, coalesce(sum(c.amount_paise), 0) as saved
                from goals g left join goal_contributions c on c.goal_id = g.id and c.kind <> 'CONFIRMED_TRANSFER'
                where g.user_id = ? and g.type = 'DEADLINE' and g.status in ('ACTIVE', 'PAUSED')
                group by g.id, g.name, g.target_paise
                order by coalesce(sum(c.amount_paise), 0) * 10000 / g.target_paise desc, g.name
                limit 1
                """)
            .param(userId)
            .query((rs, n) -> {
                long target = rs.getLong("target_paise");
                long saved = rs.getLong("saved");
                return new FurthestGoal(rs.getString("name"), (int) Math.min(100, Math.max(0, saved * 100 / target)));
            })
            .optional();
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.budget.*' --tests 'in.gullak.gamification.*' --tests 'in.gullak.rules.*'`
Expected: PASS (Plan 1's and Plan 2's `TodayApiTest` cases still pass: they read fields that did not change).

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/main/java/in/gullak/common/game server/src/main/java/in/gullak/gamification server/src/main/java/in/gullak/goals/FurthestGoalQuery.java server/src/main/java/in/gullak/budget server/src/test/java/in/gullak/budget/TodayGameApiTest.java server/src/test/java/in/gullak/gamification/ProgressApiTest.java
git commit -m "feat(server): GET /me/progress, game strip on /budget/today, acknowledged one-shot celebrations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: GET /report-card, docs and a redaction sweep of the game endpoints

**Owner:** backend-engineer. **Test IDs:** API-GM-02, API-GM-03, API-GM-04, API-GM-08 (new: report card isolation), LOG-05 (game endpoints). **Red team:** yes (a report card for tomorrow, for before sign-up, for another user; merchant text or amounts in logs).

**Files:**
- Create: `server/src/main/java/in/gullak/report/ReportCardResponse.java`, `ReportQueries.java`, `ReportCardService.java`, `ReportCardController.java`
- Modify: `server/src/main/java/in/gullak/profile/ProfileEntity.java` and `ProfileService.java` (`setUpOn`), `README.md`, `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`
- Test: `server/src/test/java/in/gullak/report/ReportCardApiTest.java`, `server/src/test/java/in/gullak/security/GameLogRedactionApiTest.java`

**Interfaces:**
- Consumes: `BudgetService.day` (Task 6); `DailyCloseService.find`, `Grade` (Tasks 4, 6); `StreakService.current`; `LevelTracker.view`, `XpLedger.earnedOn` (Task 3); `ContentLines.reportLine`, `ReportBand` (Task 9); `FurthestGoalSource` (Task 10).
- Produces: `GET /api/v1/report-card?date=YYYY-MM-DD` (date optional, defaults to today in India) → `ReportCardResponse`; `ProfileService.setUpOn(UUID) : LocalDate`.

Body:

```json
{"date":"2026-10-23","live":true,"stage":"CLAY",
 "grade":{"grade":"A_PLUS","budgetPaise":166666,"spentPaise":46000,"percentUsed":27,"underBudget":true},
 "spend":{"biggest":{"amountPaise":28000,"merchant":"Swiggy","categoryName":"Food delivery","occurredAt":"2026-10-23T15:10:00Z"},
          "topCategory":{"code":"food_delivery","name":"Food delivery","sharePercent":60}},
 "streak":{"current":0,"freezeUsed":false,"reset":false,"xpEarned":0,"xp":0,"level":1,"levelFloorXp":0,"nextLevelXp":400,"toNextLevelPercent":0},
 "line":{"title":"Nice and easy","body":"Days like this add up, and your goal says thanks"}}
```

- [ ] **Step 1: Write the failing tests**

`server/src/test/java/in/gullak/report/ReportCardApiTest.java`:

```java
package in.gullak.report;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.budget.BudgetService;
import in.gullak.budget.DayFigures;
import in.gullak.gamification.ClosedDay;
import in.gullak.gamification.DailyCloseService;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.ResultActions;

class ReportCardApiTest extends ApiTest {
    static final Instant NIGHT_23 = Instant.parse("2026-10-23T16:30:00Z"); // 22:00 IST
    static final LocalDate OCT22 = LocalDate.of(2026, 10, 22);

    @Autowired BudgetService budget;
    @Autowired DailyCloseService closes;

    ResultActions card(TestUser u, String date) throws Exception {
        var req = get("/api/v1/report-card").with(auth(u));
        return mvc.perform(date == null ? req : req.param("date", date));
    }

    void closeDay(TestUser u, LocalDate d) {
        DayFigures f = budget.day(u.id(), d);
        closes.close(new ClosedDay(u.id(), d, f.budgetPaise(), f.spentPaise()));
    }

    @Test
    void tonightsCardIsTheDaySoFar() throws Exception { // API-GM-02
        TestUser u = gameUser();
        seedCategorySpend(u, 18_000, Instant.parse("2026-10-23T03:42:00Z"), "eating_out", "Third Wave Coffee");
        seedCategorySpend(u, 28_000, Instant.parse("2026-10-23T15:10:00Z"), "food_delivery", "Swiggy"); // 8:40 pm
        clock.set(NIGHT_23);
        card(u, null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.date").value("2026-10-23"))
            .andExpect(jsonPath("$.live").value(true))
            .andExpect(jsonPath("$.stage").value("CLAY"))
            .andExpect(jsonPath("$.grade.grade").value("A_PLUS"))
            .andExpect(jsonPath("$.grade.budgetPaise").value(166_666))
            .andExpect(jsonPath("$.grade.spentPaise").value(46_000))
            .andExpect(jsonPath("$.grade.percentUsed").value(27))
            .andExpect(jsonPath("$.grade.underBudget").value(true))
            .andExpect(jsonPath("$.spend.biggest.amountPaise").value(28_000))
            .andExpect(jsonPath("$.spend.biggest.merchant").value("Swiggy"))
            .andExpect(jsonPath("$.spend.biggest.categoryName").value("Food delivery"))
            .andExpect(jsonPath("$.spend.biggest.occurredAt").value("2026-10-23T15:10:00Z"))
            .andExpect(jsonPath("$.spend.topCategory.code").value("food_delivery"))
            .andExpect(jsonPath("$.spend.topCategory.sharePercent").value(60))
            .andExpect(jsonPath("$.streak.current").value(0))
            .andExpect(jsonPath("$.streak.nextLevelXp").value(400))
            .andExpect(jsonPath("$.line.title").value("Nice and easy"))
            .andExpect(jsonPath("$.line.body").value("Days like this add up, and your goal says thanks"));
    }

    @Test
    void aClosedDayReadsItsClose() throws Exception { // API-GM-02
        TestUser over = gameUser();
        TestUser under = gameUser();
        seedSpend(over, 1_000_000, Instant.parse("2026-10-22T06:00:00Z"));
        clock.set(Instant.parse("2026-10-22T18:35:00Z"));
        closeDay(over, OCT22);
        closeDay(under, OCT22);
        clock.set(NIGHT_23);
        card(over, "2026-10-22")
            .andExpect(jsonPath("$.live").value(false))
            .andExpect(jsonPath("$.grade.grade").value("F"))
            .andExpect(jsonPath("$.grade.underBudget").value(false))
            .andExpect(jsonPath("$.streak.reset").value(true))
            .andExpect(jsonPath("$.line.title").value("Happens"));
        card(under, "2026-10-22")
            .andExpect(jsonPath("$.streak.current").value(1))
            .andExpect(jsonPath("$.streak.xpEarned").value(20))
            .andExpect(jsonPath("$.spend.biggest").value(nullValue()))
            .andExpect(jsonPath("$.spend.topCategory").value(nullValue()));
    }

    @Test
    void tomorrowIsRefused() throws Exception { // API-GM-03
        TestUser u = gameUser();
        card(u, "2026-10-24")
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"))
            .andExpect(jsonPath("$.fields[0].field").value("date"));
    }

    @Test
    void beforeTheAccountIsNotFound() throws Exception { // API-GM-04
        TestUser u = gameUser(); // set up on 1 Oct
        card(u, "2026-09-30").andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        card(u, "2026-10-01").andExpect(status().isOk());
    }

    @Test
    void aBadDateIsRefused() throws Exception {
        TestUser u = gameUser();
        card(u, "23-10-2026").andExpect(status().isBadRequest());
        card(u, "2026-02-30").andExpect(status().isBadRequest());
    }

    @Test
    void anotherUsersSpendsNeverShow() throws Exception { // API-GM-08
        TestUser a = gameUser();
        TestUser b = gameUser();
        seedCategorySpend(a, 28_000, Instant.parse("2026-10-23T05:00:00Z"), "food_delivery", "Swiggy");
        card(b, null)
            .andExpect(jsonPath("$.spend.biggest").value(nullValue()))
            .andExpect(jsonPath("$.grade.spentPaise").value(0));
    }

    @Test
    void beforeSetupIsSetupIncomplete() throws Exception {
        TestUser u = signIn();
        card(u, null).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SETUP_INCOMPLETE"));
    }

    @Test
    void needsSignIn() throws Exception {
        mvc.perform(get("/api/v1/report-card")).andExpect(status().isUnauthorized());
    }
}
```

`server/src/test/java/in/gullak/security/GameLogRedactionApiTest.java`:

```java
package in.gullak.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.budget.BudgetService;
import in.gullak.budget.DayFigures;
import in.gullak.gamification.ClosedDay;
import in.gullak.gamification.DailyCloseService;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;

@ExtendWith(OutputCaptureExtension.class)
class GameLogRedactionApiTest extends ApiTest {
    static final long SPEND = 4_321_987;
    static final String MERCHANT = "Quokka Momo Corner";

    @Autowired BudgetService budget;
    @Autowired DailyCloseService closes;

    @Test
    void theGameNeverLogsAmountsOrMerchants(CapturedOutput out) throws Exception { // LOG-05
        TestUser u = gameUser();
        seedCategorySpend(u, SPEND, Instant.parse("2026-10-22T06:00:00Z"), "food_delivery", MERCHANT);
        clock.set(Instant.parse("2026-10-22T18:35:00Z"));
        DayFigures f = budget.day(u.id(), LocalDate.of(2026, 10, 22));
        closes.close(new ClosedDay(u.id(), LocalDate.of(2026, 10, 22), f.budgetPaise(), f.spentPaise()));
        clock.set(Instant.parse("2026-10-23T16:30:00Z"));
        mvc.perform(get("/api/v1/budget/today").with(auth(u))).andExpect(status().isOk());
        mvc.perform(get("/api/v1/me/progress").with(auth(u))).andExpect(status().isOk());
        mvc.perform(get("/api/v1/report-card").param("date", "2026-10-22").with(auth(u))).andExpect(status().isOk());
        mvc.perform(get("/api/v1/content/lines").param("personality", "MOM").with(auth(u))).andExpect(status().isOk());
        mvc.perform(post("/api/v1/me/celebrations/ack").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"ids\":[\"" + java.util.UUID.randomUUID() + "\"]}")).andExpect(status().isNoContent());
        String log = out.getAll();
        assertThat(log).contains("day.closed user=" + u.id());
        assertThat(log).doesNotContain(String.valueOf(SPEND), "43,219", MERCHANT, u.email(), u.accessToken());
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.report.*' --tests 'in.gullak.security.GameLogRedactionApiTest'`
Expected: FAIL (`/report-card` is 404).

- [ ] **Step 3: When the user set up**

In `server/src/main/java/in/gullak/profile/ProfileEntity.java`, add (read-only; the database default fills it on insert):

```java
    @Column(name = "created_at", insertable = false, updatable = false)
    private Instant createdAt;

    Instant getCreatedAt() { return createdAt; }
```

Add to `ProfileService.java` (imports `in.gullak.common.time.Ist`, `java.time.LocalDate`):

```java
    /** The first day in India with a report card: the day setup finished. */
    @Transactional(readOnly = true)
    public LocalDate setUpOn(UUID userId) {
        return profiles.findById(userId)
            .map(e -> LocalDate.ofInstant(e.getCreatedAt(), Ist.ZONE))
            .orElseThrow(() -> new GullakException(ErrorCode.SETUP_INCOMPLETE, HttpStatus.CONFLICT, "Finish setup first"));
    }
```

- [ ] **Step 4: The report card**

`server/src/main/java/in/gullak/report/ReportCardResponse.java`:

```java
package in.gullak.report;

import in.gullak.gamification.Grade;
import in.gullak.gamification.Stage;
import java.time.Instant;
import java.time.LocalDate;

/** The four night cards (spec 2.7). The app writes the sentences; amounts are paise. */
public record ReportCardResponse(LocalDate date, boolean live, Stage stage, GradeCard grade, SpendCard spend,
                                 StreakCard streak, LineCard line) {

    public record GradeCard(Grade grade, long budgetPaise, long spentPaise, int percentUsed, boolean underBudget) {}

    /** Both null on a day with no spends. */
    public record SpendCard(Biggest biggest, TopCategory topCategory) {}

    public record Biggest(long amountPaise, String merchant, String categoryName, Instant occurredAt) {}

    public record TopCategory(String code, String name, int sharePercent) {}

    public record StreakCard(int current, boolean freezeUsed, boolean reset, long xpEarned, long xp, int level,
                             long levelFloorXp, long nextLevelXp, int toNextLevelPercent) {}

    public record LineCard(String title, String body) {}
}
```

`server/src/main/java/in/gullak/report/ReportQueries.java`:

```java
package in.gullak.report;

import in.gullak.common.db.Db;
import in.gullak.common.time.Ist;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** The day's spends as the budget counts them (debits in the budget, not spread, not deleted). */
@Component
class ReportQueries {
    private static final String DAY = """
            t.user_id = ? and t.direction = 'debit' and t.counts_in_budget and not t.spread_over_cycle
              and t.deleted_at is null and t.occurred_at >= ? and t.occurred_at < ?
            """;

    private final JdbcClient jdbc;

    ReportQueries(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Optional<ReportCardResponse.Biggest> biggest(UUID userId, LocalDate date) {
        return jdbc.sql("""
                select t.amount_paise, t.merchant_name, coalesce(c.name, t.category_code) as category_name, t.occurred_at
                from transactions t left join categories c on c.code = t.category_code
                where %s
                order by t.amount_paise desc, t.occurred_at
                limit 1
                """.formatted(DAY))
            .params(userId, Db.ts(Ist.startOf(date)), Db.ts(Ist.startOf(date.plusDays(1))))
            .query((rs, n) -> new ReportCardResponse.Biggest(rs.getLong("amount_paise"), rs.getString("merchant_name"),
                rs.getString("category_name"), rs.getObject("occurred_at", OffsetDateTime.class).toInstant()))
            .optional();
    }

    Optional<ReportCardResponse.TopCategory> topCategory(UUID userId, LocalDate date) {
        return jdbc.sql("""
                select t.category_code, coalesce(max(c.name), t.category_code) as name, sum(t.amount_paise) as total,
                       sum(sum(t.amount_paise)) over () as day_total
                from transactions t left join categories c on c.code = t.category_code
                where %s
                group by t.category_code
                order by total desc, t.category_code
                limit 1
                """.formatted(DAY))
            .params(userId, Db.ts(Ist.startOf(date)), Db.ts(Ist.startOf(date.plusDays(1))))
            .query((rs, n) -> new ReportCardResponse.TopCategory(rs.getString("category_code"), rs.getString("name"),
                (int) (rs.getLong("total") * 100 / rs.getLong("day_total"))))
            .optional();
    }
}
```

(`DAY` is a constant of this class, never input; values are bound parameters.)

`server/src/main/java/in/gullak/report/ReportCardService.java`:

```java
package in.gullak.report;

import in.gullak.budget.BudgetService;
import in.gullak.budget.DayFigures;
import in.gullak.common.error.NotFoundException;
import in.gullak.common.error.ValidationException;
import in.gullak.common.time.Ist;
import in.gullak.content.ContentLines;
import in.gullak.content.ReportBand;
import in.gullak.content.ReportLine;
import in.gullak.gamification.DailyCloseService;
import in.gullak.gamification.DailyCloseView;
import in.gullak.gamification.FurthestGoal;
import in.gullak.gamification.FurthestGoalSource;
import in.gullak.gamification.Grade;
import in.gullak.gamification.LevelTracker;
import in.gullak.gamification.LevelView;
import in.gullak.gamification.StreakService;
import in.gullak.gamification.XpLedger;
import in.gullak.profile.Profile;
import in.gullak.profile.ProfileService;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ReportCardService {
    private final ProfileService profiles;
    private final BudgetService budget;
    private final DailyCloseService closes;
    private final StreakService streaks;
    private final LevelTracker levels;
    private final XpLedger ledger;
    private final ContentLines lines;
    private final ReportQueries queries;
    private final ObjectProvider<FurthestGoalSource> goals;
    private final Clock clock;

    ReportCardService(ProfileService profiles, BudgetService budget, DailyCloseService closes, StreakService streaks,
                      LevelTracker levels, XpLedger ledger, ContentLines lines, ReportQueries queries,
                      ObjectProvider<FurthestGoalSource> goals, Clock clock) {
        this.profiles = profiles;
        this.budget = budget;
        this.closes = closes;
        this.streaks = streaks;
        this.levels = levels;
        this.ledger = ledger;
        this.lines = lines;
        this.queries = queries;
        this.goals = goals;
        this.clock = clock;
    }

    /** Read-write because today's live figures may open the cycle, as Home does. */
    @Transactional
    public ReportCardResponse card(UUID userId, LocalDate requested) {
        LocalDate today = Ist.today(clock);
        LocalDate date = requested == null ? today : requested;
        if (date.isAfter(today)) {
            throw new ValidationException("date", "Pick today or an earlier day");
        }
        Profile profile = profiles.get(userId);
        if (date.isBefore(profiles.setUpOn(userId))) {
            throw new NotFoundException("Report card");
        }
        Optional<DailyCloseView> close = date.isBefore(today) ? closes.find(userId, date) : Optional.empty();
        long budgetPaise;
        long spentPaise;
        int streak;
        boolean freezeUsed = false;
        boolean reset = false;
        long xpEarned = ledger.earnedOn(userId, date);
        if (close.isPresent()) {
            DailyCloseView c = close.get();
            budgetPaise = c.budgetPaise();
            spentPaise = c.spentPaise();
            streak = c.streakAfter();
            freezeUsed = c.freezeUsed();
            reset = !c.underBudget() && !c.freezeUsed();
            xpEarned += c.xpAwarded();
        } else {
            DayFigures f = budget.day(userId, date);
            budgetPaise = f.budgetPaise();
            spentPaise = f.spentPaise();
            streak = streaks.current(userId).current();
        }
        Grade grade = Grade.of(spentPaise, budgetPaise);
        LevelView level = levels.view(userId);
        FurthestGoalSource source = goals.getIfAvailable();
        String goalName = source == null ? null : source.furthest(userId).map(FurthestGoal::name).orElse(null);
        ReportLine line = lines.reportLine(profile.personality(), band(grade), goalName);
        return new ReportCardResponse(date, close.isEmpty(), level.stage(),
            new ReportCardResponse.GradeCard(grade, budgetPaise, spentPaise, percentUsed(spentPaise, budgetPaise), spentPaise <= budgetPaise),
            new ReportCardResponse.SpendCard(queries.biggest(userId, date).orElse(null), queries.topCategory(userId, date).orElse(null)),
            new ReportCardResponse.StreakCard(streak, freezeUsed, reset, xpEarned, level.xp(), level.level(), level.floorXp(),
                level.nextXp(), level.percentToNext()),
            new ReportCardResponse.LineCard(line.title(), line.body()));
    }

    static ReportBand band(Grade grade) {
        return switch (grade) {
            case A_PLUS, A -> ReportBand.GREAT;
            case B -> ReportBand.OK;
            case C, D, F -> ReportBand.OVER;
        };
    }

    static int percentUsed(long spent, long budget) {
        if (budget <= 0) {
            return spent > 0 ? 999 : 0;
        }
        return (int) Math.min(999, spent * 100 / budget);
    }
}
```

`server/src/main/java/in/gullak/report/ReportCardController.java`:

```java
package in.gullak.report;

import in.gullak.common.web.CurrentUser;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ReportCardController {
    private final ReportCardService cards;

    ReportCardController(ReportCardService cards) {
        this.cards = cards;
    }

    @GetMapping("/api/v1/report-card")
    ReportCardResponse card(@AuthenticationPrincipal Jwt jwt,
                            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return cards.card(CurrentUser.id(jwt), date);
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.report.*' --tests 'in.gullak.security.*' --tests 'in.gullak.rules.*'`
Expected: PASS.

- [ ] **Step 6: Docs**

In `README.md`, add to the server API table (rename the heading to "API so far" if it still says "(Plan 1)"):

```markdown
| GET | /api/v1/me/progress | XP (reversed events excluded), level, stage, streak, freezes, the 10 badges with progress, challenge badges, furthest goal, this week's challenge |
| GET | /api/v1/report-card?date | the four night cards; `date` defaults to today in India; tomorrow is 400, before setup 404 |
| GET | /api/v1/content/lines?personality | the Gullak's line templates for a personality (any case) |
| POST | /api/v1/me/celebrations/ack | `{ids}` (1–20) → 204; the caller's celebrations stop appearing in `game.celebrate` |
```

and note under `GET /api/v1/budget/today` that the body now carries `game: {streak, level, stage, celebrate}`. Add to the configuration table:

```markdown
| `gullak.jobs.enabled` | `true` | scheduled jobs run (tests set false) |
| `gullak.jobs.attempts` | `3` | tries per user before a job counts the user as failed and alerts |
| `gullak.jobs.backoff` | `2s` | wait before a retry (doubles on the third try) |
| `gullak.jobs.lease` | `30m` | how long a running instance holds a job |
| `gullak.game.level-base` | `100` | level n starts at level-base × n² XP |
```

and a "Jobs" paragraph: daily close 00:05 IST, weekly challenge Monday 00:10, cycle close 00:15, draft cleanup 03:00, auth purge 03:30; each logs `job.started` and `job.finished`, a failing user is retried 3 times and logged `job.failed`, and any failed run writes `job.alert` at ERROR.

In `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`:

- section 5, after XP-10: `| XP-11 | Level-up not replayed | cross 400, delete a spend (back to 300), log again | one level_up only |`
- section 5, after BDG-08: `| BDG-09 | Challenge badge | challenge done for Food delivery | CHALLENGE_FOOD_DELIVERY once, shown under "Challenges won", not counted in the 10 |`
- section 5, after CHL-04: `| CHL-05 | Rounding | two-week total ₹2,357.15 in Shopping | target ₹850 (₹825 rounds half up); a target under ₹50 means no challenge |`
- section 6, after JOB-15: `| JOB-16 | Cycle close | an ended cycle with savings met: +500 XP once, cycle.closed logged once; run twice changes nothing |`
- section 7.3, after API-TDY-08: `| API-TDY-09 | Game strip | GET /budget/today | game {streak, level, stage, celebrate} |`
- section 7.8: API-GM-05 request reads `GET /content/lines?personality=SAVAGE` (any case accepted), and add after API-GM-06: `| API-GM-07 | Acknowledge celebrations | POST /me/celebrations/ack {ids} | 204; they no longer appear on /budget/today; another user's ids change nothing; 0 or 21 ids 400 |` and `| API-GM-08 | Report card isolation | another user has spends today | none of theirs appear |`

- [ ] **Step 7: Run everything and commit**

Run: `cd server && ./gradlew test`
Expected: PASS.

```bash
git add server/src/main/java/in/gullak/report server/src/main/java/in/gullak/profile server/src/test/java/in/gullak/report server/src/test/java/in/gullak/security/GameLogRedactionApiTest.java README.md docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md
git commit -m "feat(server): GET /report-card with four cards, live for today, from the close for past days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: App: game API, Home's streak and level pills, celebrations and the stage-up moment

**Owner:** app-engineer. **Test IDs:** APP-14 (celebrate and stage triggers), APP-29 (new controls), ERR-13 (stage-up has no data to fail; pills hide when `game` is missing). **Red team:** yes (celebrations replayed after a refetch or a remount; a crafted `stage` param on the stage-up route).

**Files:**
- Create: `app/src/features/game/api.ts`, `hooks.ts`, `celebrations.ts`, `celebrations.test.tsx`
- Create: `app/src/features/game/components/game-pills.tsx`, `game-pills.test.tsx`, `share-frame.tsx`
- Create: `app/src/features/game/screens/stage-up-screen.tsx`, `stage-up.test.tsx`
- Create: `app/src/lib/share-image.ts`, `app/src/lib/share-image.test.ts`, `app/app/stage-up.tsx`
- Create: `app/src/features/home/home-game.test.tsx`
- Modify: `app/jest.setup.ts`, `app/src/features/budget/api.ts` (`Today.game`), `app/src/features/home/hero.tsx`, `app/src/features/home/home-screen.tsx`, `app/src/features/home/home.test.tsx` (router mock), `app/app/_layout.tsx`, `app/src/features/gullak/lines.ts`, `app/src/features/profile/components/personality-picker.tsx`, `app/package.json`

**Interfaces:**
- Consumes: `GET /budget/today` `game`, `POST /me/celebrations/ack`, `GET /me/progress`, `GET /report-card`, `GET /content/lines` (Tasks 9–11); Plan 2's `api`, `Gullak`, `GullakEvent`, `Stage`, `stageLabels`, `Screen`, `Button`, `Text`, `Icon`, `useToday`, `Today`, `log`.
- Produces: `gameApi.{progress, reportCard, ackCelebrations, lines}`; types `TodayGame`, `Celebration`, `CelebrationKind`, `ServerStage`, `Progress`, `BadgeCode`, `BadgeProgress`, `Challenge`, `Grade`, `ReportCard`; `fromServerStage(value: string | undefined) : Stage | null`; `progressKey`, `reportCardKey(date)`, `useProgress()`, `useReportCard(date?)`, `useLineTemplates(personality)`; `useCelebrations(game, deps) : GullakEvent | undefined`; `GamePills`; `ShareFrame`, `SHARE_WIDTH`, `SHARE_HEIGHT`; `shareImage(ref, deps?) : Promise<ShareResult>`; `ShareResult = "shared" | "unavailable" | "failed"`; route `/stage-up?stage&level`.

- [ ] **Step 1: Install the two share packages**

```bash
cd app && npx expo install react-native-view-shot expo-sharing
```

Both are MIT-licensed (check `npm view react-native-view-shot license` and `npm view expo-sharing license` print `MIT`, and that `npm audit --omit=dev` reports no critical issue); `expo install` pins the versions that match the SDK. Commit `package.json` and the lockfile with this task.

- [ ] **Step 2: The game API and hooks**

`app/src/features/game/api.ts`:

```ts
import type { Personality } from "@/features/profile/api";
import type { Stage } from "@/features/gullak/stage";
import { api } from "@/lib/client";

export type ServerStage = "CLAY" | "PAINTED" | "GOLD" | "DIAMOND";
export type CelebrationKind = "STREAK_DAY" | "STREAK_MILESTONE" | "LEVEL_UP" | "STAGE_UP" | "BADGE";
export type Celebration = { id: string; kind: CelebrationKind; value: string };
export type TodayGame = { streak: number; level: number; stage: ServerStage; celebrate: Celebration[] };

export type BadgeCode =
  | "FIRST_LOG"
  | "WEEK_WARRIOR"
  | "NO_SWIGGY_SUNDAY"
  | "ZEPTO_FREE_WEEK"
  | "SUBSCRIPTION_SLAYER"
  | "GOAL_CRUSHER"
  | "HONEST_LOGGER"
  | "SORTED"
  | "COMEBACK_KID"
  | "DIAMOND_GULLAK";

export type BadgeProgress = { code: BadgeCode; earned: boolean; earnedOn: string | null; progress: number | null; target: number | null };

export type Challenge = {
  weekStart: string;
  weekEnd: string;
  categoryCode: string;
  categoryName: string;
  targetPaise: number;
  progressPaise: number;
  done: boolean;
  evaluated: boolean;
};

export type Progress = {
  xp: number;
  level: number;
  stage: ServerStage;
  levelFloorXp: number;
  nextLevelXp: number;
  toNextLevelPercent: number;
  streak: { current: number; best: number; freezes: number };
  badges: BadgeProgress[];
  challengeBadges: { categoryCode: string; categoryName: string; earnedOn: string }[];
  furthestGoal: { name: string; percent: number } | null;
  challenge: Challenge | null;
};

export type Grade = "A_PLUS" | "A" | "B" | "C" | "D" | "F";

export type ReportCard = {
  date: string;
  live: boolean;
  stage: ServerStage;
  grade: { grade: Grade; budgetPaise: number; spentPaise: number; percentUsed: number; underBudget: boolean };
  spend: {
    biggest: { amountPaise: number; merchant: string | null; categoryName: string; occurredAt: string } | null;
    topCategory: { code: string; name: string; sharePercent: number } | null;
  };
  streak: {
    current: number;
    freezeUsed: boolean;
    reset: boolean;
    xpEarned: number;
    xp: number;
    level: number;
    levelFloorXp: number;
    nextLevelXp: number;
    toNextLevelPercent: number;
  };
  line: { title: string; body: string };
};

export type LineTemplates = { personality: Personality; lines: Record<string, string> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const gameApi = {
  progress: () => api.get<Progress>("/me/progress"),
  reportCard: (date?: string) => api.get<ReportCard>(date && ISO_DATE.test(date) ? `/report-card?date=${date}` : "/report-card"),
  ackCelebrations: (ids: string[]) => api.post<void>("/me/celebrations/ack", { ids }),
  lines: (personality: Personality) => api.get<LineTemplates>(`/content/lines?personality=${personality}`),
};

const stages: Record<ServerStage, Stage> = { CLAY: "clay", PAINTED: "painted", GOLD: "gold", DIAMOND: "diamond" };

/** A server stage name (from JSON or a route param) to the Gullak's stage; anything else is null. */
export function fromServerStage(value: string | undefined): Stage | null {
  if (value === undefined) return null;
  return Object.prototype.hasOwnProperty.call(stages, value) ? stages[value as ServerStage] : null;
}
```

`app/src/features/game/hooks.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import type { Personality } from "@/features/profile/api";
import { gameApi, type LineTemplates, type Progress, type ReportCard } from "./api";

export const progressKey = ["progress"] as const;
export const reportCardKey = (date: string | undefined) => ["report-card", date ?? "today"] as const;

export function useProgress() {
  return useQuery<Progress>({ queryKey: progressKey, queryFn: gameApi.progress, staleTime: 60_000 });
}

export function useReportCard(date?: string) {
  return useQuery<ReportCard>({ queryKey: reportCardKey(date), queryFn: () => gameApi.reportCard(date), staleTime: 30_000 });
}

/** The server's line templates (spec 2.6: lines ship without an app release). */
export function useLineTemplates(personality: Personality) {
  return useQuery<LineTemplates>({ queryKey: ["lines", personality], queryFn: () => gameApi.lines(personality), staleTime: 60 * 60_000 });
}
```

In `app/src/features/budget/api.ts`, import `TodayGame` and add the field (optional: a cache persisted before this release has none):

```ts
import type { TodayGame } from "@/features/game/api";
```

```ts
  /** Absent only in a response cached before Plan 6. */
  game?: TodayGame;
```

- [ ] **Step 3: Write the failing tests**

`app/src/features/game/celebrations.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import type { TodayGame } from "./api";
import { useCelebrations, type CelebrationDeps } from "./celebrations";

jest.mock("@/lib/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/log", () => ({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
import { log } from "@/lib/log";

const levelUp: TodayGame = { streak: 0, level: 2, stage: "CLAY", celebrate: [{ id: "c1", kind: "LEVEL_UP", value: "2" }] };

function setup(deps: CelebrationDeps, initial: TodayGame | undefined) {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(({ game }: { game: TodayGame | undefined }) => useCelebrations(game, deps), { wrapper, initialProps: { game: initial } });
}

describe("useCelebrations (APP-14)", () => {
  it("fires one celebrate event and acknowledges once", async () => {
    const deps = { ack: jest.fn(() => Promise.resolve()), openStageUp: jest.fn() };
    const { result, rerender } = setup(deps, levelUp);
    await waitFor(() => expect(result.current).toEqual({ kind: "celebrate", key: 1 }));
    expect(deps.ack).toHaveBeenCalledWith(["c1"]);
    rerender({ game: { ...levelUp, celebrate: [...levelUp.celebrate] } }); // a refetch returns the same row
    expect(result.current).toEqual({ kind: "celebrate", key: 1 });
    expect(deps.ack).toHaveBeenCalledTimes(1);
    expect(deps.openStageUp).not.toHaveBeenCalled();
  });

  it("a new celebration replays the jump", async () => {
    const deps = { ack: jest.fn(() => Promise.resolve()), openStageUp: jest.fn() };
    const { result, rerender } = setup(deps, levelUp);
    await waitFor(() => expect(result.current?.key).toBe(1));
    rerender({ game: { ...levelUp, celebrate: [{ id: "c2", kind: "STREAK_DAY", value: "2026-10-23" }] } });
    await waitFor(() => expect(result.current?.key).toBe(2));
    expect(deps.ack).toHaveBeenLastCalledWith(["c2"]);
  });

  it("a stage-up opens the full-screen moment with the level", async () => {
    const deps = { ack: jest.fn(() => Promise.resolve()), openStageUp: jest.fn() };
    setup(deps, {
      streak: 3,
      level: 10,
      stage: "GOLD",
      celebrate: [
        { id: "a", kind: "LEVEL_UP", value: "10" },
        { id: "b", kind: "STAGE_UP", value: "GOLD" },
      ],
    });
    await waitFor(() => expect(deps.openStageUp).toHaveBeenCalledWith("GOLD", "10"));
  });

  it("nothing to celebrate does nothing", () => {
    const deps = { ack: jest.fn(() => Promise.resolve()), openStageUp: jest.fn() };
    const { result } = setup(deps, { streak: 0, level: 1, stage: "CLAY", celebrate: [] });
    expect(result.current).toBeUndefined();
    expect(deps.ack).not.toHaveBeenCalled();
  });

  it("a failed acknowledgement is logged without the ids and never throws", async () => {
    const deps = { ack: jest.fn(() => Promise.reject(new Error("offline"))), openStageUp: jest.fn() };
    setup(deps, levelUp);
    await act(async () => undefined);
    await waitFor(() => expect(log.warn).toHaveBeenCalledWith("celebrations.ack_failed", { count: 1 }));
  });
});
```

`app/src/features/game/components/game-pills.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import React from "react";
import { GamePills } from "./game-pills";

describe("GamePills", () => {
  it("shows the flame pill and the level as on the mockup", () => {
    render(<GamePills streak={5} level={3} />);
    expect(screen.getByText("5 days")).toBeTruthy();
    expect(screen.getByLabelText("Streak: 5 days")).toBeTruthy();
    expect(screen.getByText("Level 3")).toBeTruthy();
    expect(screen.getByTestId("icon-flame")).toBeTruthy();
  });

  it("one day is singular", () => {
    render(<GamePills streak={1} level={1} />);
    expect(screen.getByText("1 day")).toBeTruthy();
  });

  it("no streak hides the flame pill", () => {
    render(<GamePills streak={0} level={1} />);
    expect(screen.queryByTestId("icon-flame")).toBeNull();
    expect(screen.getByText("Level 1")).toBeTruthy();
  });
});
```

`app/src/lib/share-image.test.ts`:

```ts
import { shareImage } from "./share-image";

jest.mock("./log", () => ({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
import { log } from "./log";

const ref = { current: {} as never };

describe("shareImage", () => {
  it("captures 1080×1920 and opens the share sheet", async () => {
    const capture = jest.fn(() => Promise.resolve("file:///tmp/gullak.png"));
    const share = jest.fn(() => Promise.resolve());
    await expect(shareImage(ref, { capture, isAvailable: () => Promise.resolve(true), share })).resolves.toBe("shared");
    expect(capture).toHaveBeenCalledWith(ref, { format: "png", quality: 1, width: 1080, height: 1920, result: "tmpfile" });
    expect(share).toHaveBeenCalledWith("file:///tmp/gullak.png", { mimeType: "image/png", UTI: "public.png", dialogTitle: "Share" });
  });

  it("no share sheet on this device", async () => {
    const capture = jest.fn();
    await expect(shareImage(ref, { capture, isAvailable: () => Promise.resolve(false), share: jest.fn() })).resolves.toBe("unavailable");
    expect(capture).not.toHaveBeenCalled();
  });

  it("a failed capture is reported by kind only", async () => {
    const capture = jest.fn(() => Promise.reject(new TypeError("snapshot failed at /data/user/0/secret")));
    await expect(shareImage(ref, { capture, isAvailable: () => Promise.resolve(true), share: jest.fn() })).resolves.toBe("failed");
    expect(log.warn).toHaveBeenCalledWith("share.image_failed", { reason: "TypeError" });
  });

  it("an unmounted view fails without trying", async () => {
    await expect(shareImage({ current: null }, { capture: jest.fn(), isAvailable: () => Promise.resolve(true), share: jest.fn() })).resolves.toBe("failed");
  });
});
```

`app/src/features/game/screens/stage-up.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { StageUpScreen } from "./stage-up-screen";

describe("Stage-up moment (spec 2.6)", () => {
  it("names the stage and the level", () => {
    render(<StageUpScreen stage="gold" level={10} onDone={jest.fn()} share={jest.fn()} />);
    expect(screen.getByText("Your Gullak turned gold")).toBeTruthy();
    expect(screen.getByText("Level 10. Keep the streak going.")).toBeTruthy();
  });

  it("without a level the line is one sentence", () => {
    render(<StageUpScreen stage="painted" onDone={jest.fn()} share={jest.fn()} />);
    expect(screen.getByText("Your Gullak got painted")).toBeTruthy();
    expect(screen.getByText("Keep the streak going")).toBeTruthy();
  });

  it("shares an image and says so", async () => {
    const share = jest.fn(() => Promise.resolve("shared" as const));
    render(<StageUpScreen stage="diamond" level={20} onDone={jest.fn()} share={share} />);
    fireEvent.press(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(screen.getByText("Image ready in your share sheet")).toBeTruthy());
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("a failed share says what to do", async () => {
    render(<StageUpScreen stage="gold" level={10} onDone={jest.fn()} share={() => Promise.resolve("failed" as const)} />);
    fireEvent.press(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(screen.getByText("Couldn’t make the image. Try again")).toBeTruthy());
  });

  it("Done leaves", () => {
    const onDone = jest.fn();
    render(<StageUpScreen stage="gold" level={10} onDone={onDone} share={jest.fn()} />);
    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });
});
```

`app/src/features/home/home-game.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import type { Today } from "@/features/budget/api";
import { HomeScreen } from "./home-screen";

const push = jest.fn();
jest.mock("@/lib/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("expo-router", () => ({ Redirect: () => null, useRouter: () => ({ push }) }));
jest.mock("@/features/budget/api", () => ({ budgetApi: { getToday: jest.fn(), setFirstCycle: jest.fn() } }));
jest.mock("@/features/game/api", () => ({
  ...jest.requireActual("@/features/game/api"),
  gameApi: { ackCelebrations: jest.fn(() => Promise.resolve()), progress: jest.fn(), reportCard: jest.fn(), lines: jest.fn() },
}));
jest.mock("@/lib/kv", () => ({ kv: { get: jest.fn(() => Promise.resolve("1")), set: jest.fn(() => Promise.resolve()), remove: jest.fn(() => Promise.resolve()) } }));
import { budgetApi } from "@/features/budget/api";
import { gameApi } from "@/features/game/api";

const day: Today = {
  date: "2026-10-23",
  budgetPaise: 59300,
  spentPaise: 18000,
  leftPaise: 41300,
  overPaise: 0,
  poolOverPaise: 0,
  mood: "HAPPY",
  line: "₹413 left for today. Nice and steady.",
  daysLeft: 9,
  cycleStart: "2026-10-01",
  cycleEnd: "2026-10-31",
  game: { streak: 5, level: 3, stage: "GOLD", celebrate: [{ id: "s1", kind: "STAGE_UP", value: "GOLD" }, { id: "l1", kind: "LEVEL_UP", value: "10" }] },
};

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HomeScreen now={new Date("2026-10-23T08:00:00Z")} />
    </QueryClientProvider>,
  );
}

describe("Home game strip (APP-14)", () => {
  it("shows the pills, plays the celebration once and opens the stage-up moment", async () => {
    (budgetApi.getToday as jest.Mock).mockResolvedValue(day);
    renderHome();
    expect(await screen.findByLabelText("Streak: 5 days")).toBeTruthy();
    expect(screen.getByText("Level 3")).toBeTruthy();
    await waitFor(() => expect(gameApi.ackCelebrations).toHaveBeenCalledWith(["s1", "l1"]));
    expect(push).toHaveBeenCalledWith({ pathname: "/stage-up", params: { stage: "GOLD", level: "10" } });
  });

  it("a response without game shows no pills", async () => {
    const old: Today = { ...day, game: undefined };
    (budgetApi.getToday as jest.Mock).mockResolvedValue(old);
    renderHome();
    expect(await screen.findByText("₹413")).toBeTruthy();
    expect(screen.queryByText(/^Level/)).toBeNull();
  });
});
```

In Plan 2's `app/src/features/home/home.test.tsx`, change the router mock line to `jest.mock("expo-router", () => ({ Redirect: () => null, useRouter: () => ({ push: jest.fn() }) }));` (Home now uses the router) and add `jest.mock("@/features/game/api", () => ({ ...jest.requireActual("@/features/game/api"), gameApi: { ackCelebrations: jest.fn(() => Promise.resolve()) } }));` with `jest.mock("@/lib/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));` next to its other mocks.

Append to `app/jest.setup.ts` (native modules have no Jest implementation):

```ts
jest.mock("react-native-view-shot", () => ({ captureRef: jest.fn(() => Promise.resolve("file:///tmp/share.png")) }));
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(() => Promise.resolve(true)), shareAsync: jest.fn(() => Promise.resolve()) }));
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd app && npx jest src/features/game src/lib/share-image src/features/home`
Expected: FAIL (modules missing).

- [ ] **Step 5: Write the code**

`app/src/lib/share-image.ts`:

```ts
import * as Sharing from "expo-sharing";
import type { RefObject } from "react";
import type { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { log } from "./log";

export type ShareResult = "shared" | "unavailable" | "failed";

type CaptureOptions = { format: "png"; quality: number; width: number; height: number; result: "tmpfile" };

export type ShareDeps = {
  capture: (ref: RefObject<View | null>, options: CaptureOptions) => Promise<string>;
  isAvailable: () => Promise<boolean>;
  share: (uri: string, options: { mimeType: string; UTI: string; dialogTitle: string }) => Promise<void>;
};

const realDeps: ShareDeps = {
  capture: (ref, options) => captureRef(ref, options),
  isAvailable: () => Sharing.isAvailableAsync(),
  share: (uri, options) => Sharing.shareAsync(uri, options),
};

/** Spec 2.7: a 1080×1920 image (Instagram story size) of the view, handed to the OS share sheet. */
export async function shareImage(ref: RefObject<View | null>, deps: ShareDeps = realDeps): Promise<ShareResult> {
  if (!ref.current) return "failed";
  if (!(await deps.isAvailable())) return "unavailable";
  try {
    const uri = await deps.capture(ref, { format: "png", quality: 1, width: 1080, height: 1920, result: "tmpfile" });
    await deps.share(uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: "Share" });
    log.info("share.image", { ok: true });
    return "shared";
  } catch (e) {
    log.warn("share.image_failed", { reason: e instanceof Error ? e.name : "unknown" });
    return "failed";
  }
}
```

`app/src/features/game/components/share-frame.tsx`:

```tsx
import React, { forwardRef } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { colors, spacing } from "@/theme";

/** 9:16; captured at 1080×1920. */
export const SHARE_WIDTH = 360;
export const SHARE_HEIGHT = 640;

/**
 * The image that gets shared, drawn behind the screen (capture draws the view itself, so being covered does
 * not matter). Hidden from screen readers and touches. No rupee amounts go in here (Decisions).
 */
export const ShareFrame = forwardRef<View, { tone: "dark" | "light"; children: React.ReactNode }>(function ShareFrame({ tone, children }, ref) {
  const dark = tone === "dark";
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", top: 0, left: 0, zIndex: -1 }}>
      <View
        ref={ref}
        collapsable={false}
        style={{ width: SHARE_WIDTH, height: SHARE_HEIGHT, backgroundColor: dark ? colors.dark : colors.ground, padding: spacing.xl, alignItems: "center", justifyContent: "center", gap: spacing.lg }}
      >
        {children}
        <Text variant="label" color={dark ? colors.darkMuted : colors.muted}>
          Gullak
        </Text>
      </View>
    </View>
  );
});
```

`app/src/features/game/components/game-pills.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors, fonts, radius, spacing } from "@/theme";

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** Home's header pills (Main mockup): "🔥 5 days" on gold tint, "Level 3" on white. Information, not controls. */
export function GamePills({ streak, level }: { streak: number; level: number }) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      {streak > 0 ? (
        <View
          accessible
          accessibilityLabel={`Streak: ${days(streak)}`}
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, height: 32, paddingHorizontal: spacing.cm, borderRadius: radius.full, backgroundColor: colors.warnTint }}
        >
          <Icon name="flame" size={16} color={colors.flame} />
          <Text variant="label" color={colors.warnInk} style={{ fontFamily: fonts.ui700 }}>
            {days(streak)}
          </Text>
        </View>
      ) : null}
      <View
        accessible
        accessibilityLabel={`Level ${level}`}
        style={{ justifyContent: "center", height: 32, paddingHorizontal: spacing.cm, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
      >
        <Text variant="label" style={{ fontFamily: fonts.ui700 }}>{`Level ${level}`}</Text>
      </View>
    </View>
  );
}
```

`app/src/features/game/celebrations.ts`:

```ts
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { GullakEvent } from "@/features/gullak/gullak";
import { log } from "@/lib/log";
import type { TodayGame } from "./api";
import { progressKey } from "./hooks";

export type CelebrationDeps = {
  ack: (ids: string[]) => Promise<void>;
  openStageUp: (stage: string, level: string | undefined) => void;
};

/**
 * Plays the server's one-shot celebrations (spec 2.6: a streak day, a milestone, a level-up, a badge): one
 * Gullak jump per batch, the stage-up moment when a stage was reached, then acknowledges them so neither a
 * refetch nor a second phone plays them again. Ids already played in this session are never replayed.
 */
export function useCelebrations(game: TodayGame | undefined, deps: CelebrationDeps): GullakEvent | undefined {
  const played = useRef(new Set<string>());
  const count = useRef(0);
  const [event, setEvent] = useState<GullakEvent | undefined>(undefined);
  const queryClient = useQueryClient();
  const celebrate = game?.celebrate;

  useEffect(() => {
    const fresh = (celebrate ?? []).filter((c) => !played.current.has(c.id));
    if (fresh.length === 0) return;
    fresh.forEach((c) => played.current.add(c.id));
    count.current += 1;
    setEvent({ kind: "celebrate", key: count.current });
    const stageUp = fresh.find((c) => c.kind === "STAGE_UP");
    if (stageUp) deps.openStageUp(stageUp.value, fresh.find((c) => c.kind === "LEVEL_UP")?.value);
    void deps.ack(fresh.map((c) => c.id)).then(
      () => queryClient.invalidateQueries({ queryKey: progressKey }),
      () => log.warn("celebrations.ack_failed", { count: fresh.length }),
    );
  }, [celebrate, deps, queryClient]);

  return event;
}
```

`app/src/features/game/screens/stage-up-screen.tsx`:

```tsx
import React, { useRef, useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { Gullak, type GullakEvent } from "@/features/gullak/gullak";
import type { Stage } from "@/features/gullak/stage";
import { shareImage, type ShareResult } from "@/lib/share-image";
import { colors, spacing } from "@/theme";
import { ShareFrame } from "../components/share-frame";

const headline: Record<Stage, string> = {
  clay: "Your Gullak is a clay pot",
  painted: "Your Gullak got painted",
  gold: "Your Gullak turned gold",
  diamond: "Your Gullak is diamond now",
};

const shareMessage: Record<ShareResult, string> = {
  shared: "Image ready in your share sheet",
  unavailable: "Sharing isn’t available on this phone",
  failed: "Couldn’t make the image. Try again",
};

const JUMP: GullakEvent = { kind: "celebrate", key: 1 };

export type StageUpProps = {
  stage: Stage;
  level?: number;
  onDone: () => void;
  share?: (ref: React.RefObject<View | null>) => Promise<ShareResult>;
};

/** Spec 2.6: reaching a stage is a full-screen moment with a share button. Rare, so it gets the jump and confetti. */
export function StageUpScreen({ stage, level, onDone, share = shareImage }: StageUpProps) {
  const frame = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const line = level ? `Level ${level}. Keep the streak going.` : "Keep the streak going";

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <ShareFrame ref={frame} tone="light">
        <Gullak mood="celebrating" stage={stage} size={220} reduceMotion />
        <Text variant="heading" align="center">
          {headline[stage]}
        </Text>
        <Text variant="body" align="center">
          {line}
        </Text>
      </ShareFrame>
      <Screen
        testID="stage-up"
        contentStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg }}
        footer={
          <View style={{ gap: spacing.sm }}>
            {result ? (
              <Text variant="label" align="center" accessibilityLiveRegion="polite" color={result === "shared" ? colors.good : colors.bad}>
                {shareMessage[result]}
              </Text>
            ) : null}
            <Button
              title="Share"
              variant="secondary"
              icon={<Icon name="share" size={20} />}
              loading={busy}
              onPress={() => {
                setBusy(true);
                void share(frame).then((r) => {
                  setResult(r);
                  setBusy(false);
                });
              }}
            />
            <Button title="Done" onPress={onDone} />
          </View>
        }
      >
        <Gullak mood="celebrating" stage={stage} size={240} event={JUMP} />
        <Text variant="heading" align="center" accessibilityRole="header">
          {headline[stage]}
        </Text>
        <Text variant="bodyMuted" align="center">
          {line}
        </Text>
      </Screen>
    </View>
  );
}
```

`app/app/stage-up.tsx`:

```tsx
import { Redirect, router, useLocalSearchParams } from "expo-router";
import React from "react";
import { fromServerStage } from "@/features/game/api";
import { StageUpScreen } from "@/features/game/screens/stage-up-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function StageUpRoute() {
  const params = useLocalSearchParams<{ stage?: string; level?: string }>();
  const stage = fromServerStage(params.stage);
  const level = params.level && /^\d{1,3}$/.test(params.level) ? Number(params.level) : undefined;
  if (!stage) return <Redirect href="/(tabs)" />;
  return <StageUpScreen stage={stage} level={level} onDone={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} />;
}
```

In `app/src/features/home/hero.tsx`, give `Hero` the stage and the event (imports: `type GullakEvent` from `@/features/gullak/gullak`, `type Stage` from `@/features/gullak/stage`):

```tsx
export function Hero({ today, firstRun, stage = "clay", event }: { today: Today; firstRun: boolean; stage?: Stage; event?: GullakEvent }) {
```

and replace `<Gullak mood={mood} stage="clay" size={160} />` with:

```tsx
        <Gullak mood={mood} stage={stage} size={160} event={event} />
```

If Plan 3 already passes an `event` to `Hero` for the coin drop, keep one prop: hold the latest event of either kind in one `useState<GullakEvent>` in `HomeScreen` with a single counter for `key`, set it from both the quick-add result and `useCelebrations`, and pass that.

In `app/src/features/home/home-screen.tsx` (imports: `useMemo` from React, `useRouter` from `expo-router`, `gameApi`, `fromServerStage` from `@/features/game/api`, `useCelebrations`, `type CelebrationDeps` from `@/features/game/celebrations`, `GamePills` from `@/features/game/components/game-pills`), add after `const today = useToday();`:

```tsx
  const router = useRouter();
  const celebrationDeps = useMemo<CelebrationDeps>(
    () => ({
      ack: (ids) => gameApi.ackCelebrations(ids),
      openStageUp: (stage, level) => router.push({ pathname: "/stage-up", params: level ? { stage, level } : { stage } }),
    }),
    [router],
  );
  const celebrateEvent = useCelebrations(today.data?.game, celebrationDeps);
```

replace the header row (the `View` holding `formatDay(date)` and the greeting) with the mockup's header:

```tsx
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ gap: spacing.xs }}>
          <Text variant="labelMuted">{formatDay(date)}</Text>
          <Text variant="title" accessibilityRole="header">
            {firstRun ? "Day one" : greeting(now)}
          </Text>
        </View>
        {data?.game ? <GamePills streak={data.game.streak} level={data.game.level} /> : null}
      </View>
```

and pass the stage and the event to the hero:

```tsx
          <Hero today={data} firstRun={firstRun} stage={(data.game ? fromServerStage(data.game.stage) : null) ?? "clay"} event={celebrateEvent} />
```

In `app/app/_layout.tsx`, register the moment inside the signed-in group of `Navigation`:

```tsx
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="stage-up" options={{ presentation: "fullScreenModal", animation: "fade" }} />
      </Stack.Protected>
```

(keep any screens Plans 3–5 added to that group).

- [ ] **Step 6: Setup preview uses the server's lines**

Replace `sampleLine` in `app/src/features/gullak/lines.ts` with:

```ts
/** The Home "happy" line for the setup preview: the server's template when loaded, the built-in one until then. */
export function sampleLine(personality: Personality, leftPaise: number, template?: string): string {
  return (template ?? happy[personality]).replace("{left}", formatRupees(leftPaise));
}
```

In `app/src/features/profile/components/personality-picker.tsx`, import `useLineTemplates` from `@/features/game/hooks`, add `const templates = useLineTemplates(value);` at the top of `PersonalityPicker`, and change the line to `{sampleLine(value, dayBudgetPaise, templates.data?.lines["home.happy"])}`. The picker's existing tests wrap it in a `QueryClientProvider`; if they do not, wrap them (the query fails quietly to the built-in line).

- [ ] **Step 7: Run the tests**

Run: `cd app && npx jest && npm run lint && npm run typecheck`
Expected: PASS.

Look at it on a device: give a test account 2,500 XP on the local server (`insert into xp_events …` as in `seedXp`), open Home: the Gullak jumps once, the stage-up moment opens with the painted Gullak, Share opens the OS sheet with a 1080×1920 image, Done returns Home, and reopening the app does not replay it. With Reduce Motion on, the Gullak is still and the moment fades in.

- [ ] **Step 8: Commit**

```bash
git add app/package.json app/package-lock.json app/jest.setup.ts app/src/features/game app/src/lib/share-image.ts app/src/lib/share-image.test.ts app/app/stage-up.tsx app/app/_layout.tsx app/src/features/budget/api.ts app/src/features/home app/src/features/gullak/lines.ts app/src/features/profile/components/personality-picker.tsx
git commit -m "feat(app): streak and level pills, one-shot celebrations, stage-up moment with share

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: App: the night report card, sharing, the grade rule and the notification deep link

**Owner:** app-engineer. **Test IDs:** APP-16, APP-17, E2E-07, ERR-13 (report card), APP-29 (report card controls). **Red team:** yes (a notification payload that tries to open another screen or a web URL; the share image carrying amounts; a crafted `date` param).

**Files:**
- Create: `app/src/features/game/report-card/cards.ts`, `cards.test.ts`, `xp-bar.tsx`, `grade-rule.tsx`, `report-card-screen.tsx`, `report-card.test.tsx`
- Create: `app/src/lib/notification-routes.ts`, `app/src/lib/notification-routes.test.ts`, `app/app/report-card.tsx`, `app/e2e/report-card.yaml`
- Modify: `app/src/lib/dates.ts` (`formatTime`), `app/src/lib/dates.test.ts`, `app/src/lib/notifications.ts` (night deep link), `app/src/lib/notifications.test.ts`, `app/app/_layout.tsx`, `app/e2e/README.md`, `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`
- Test: as above

**Interfaces:**
- Consumes: `useReportCard`, `ReportCard`, `Grade`, `fromServerStage`, `ShareFrame`, `shareImage` (Task 12); Plan 2's `Gullak`, `Mood`, `Skeleton`, `ErrorState`, `Text`, `Icon`, `formatRupees`, `formatDay`, `todayIst`, `describeError`, `messageFor`, `notificationCopy`, `scheduleDaily`, `notificationsSupported`.
- Produces: `buildCards(rc: ReportCard, today: string) : CardView[]`; `gradeLabel`, `gradeRules`; `xpCaption(rc) : string`; `ReportCardScreen({ date?, onClose, share?, today? })`; `formatTime(iso) : string`; `REPORT_CARD_URL = "gullak://report-card"` (in `lib/notifications.ts`); `routeForNotification(data) : "/report-card" | null`; `useNotificationRoutes(enabled, api?, navigate?)`; route `/report-card?date`.

- [ ] **Step 1: Write the failing tests**

Add to `app/src/lib/dates.test.ts`:

```ts
import { formatTime } from "./dates";

describe("formatTime", () => {
  it("is the time in India, 12-hour, lower-case", () => {
    expect(formatTime("2026-10-23T15:10:00Z")).toBe("8:40 pm");
    expect(formatTime("2026-10-23T03:42:00Z")).toBe("9:12 am");
    expect(formatTime("2026-10-23T18:30:00Z")).toBe("12:00 am");
    expect(formatTime("2026-10-23T06:30:00Z")).toBe("12:00 pm");
  });
});
```

`app/src/features/game/report-card/cards.test.ts`:

```ts
import type { ReportCard } from "../api";
import { buildCards, xpCaption } from "./cards";

const mockup: ReportCard = {
  date: "2026-10-22",
  live: false,
  stage: "CLAY",
  grade: { grade: "B", budgetPaise: 58000, spentPaise: 46000, percentUsed: 79, underBudget: true },
  spend: {
    biggest: { amountPaise: 28000, merchant: "Swiggy", categoryName: "Food delivery", occurredAt: "2026-10-22T15:10:00Z" },
    topCategory: { code: "food_delivery", name: "Food delivery", sharePercent: 61 },
  },
  streak: { current: 5, freezeUsed: false, reset: false, xpEarned: 20, xp: 1334, level: 3, levelFloorXp: 900, nextLevelXp: 1600, toNextLevelPercent: 62 },
  line: { title: "Easy day tomorrow?", body: "Cook at home and the Goa trip gets a day closer" },
};

describe("report card copy (ReportCard mockup)", () => {
  it("matches the mockup's four cards", () => {
    const [grade, spend, streak, line] = buildCards(mockup, "2026-10-22");
    expect(grade).toMatchObject({ kicker: "Today’s grade", big: "B", mood: "calm", line: "₹460 spent of ₹580. The other ₹120 rolls into the rest of the cycle." });
    expect(spend).toMatchObject({ kicker: "Biggest spend", big: "₹280", mood: "nervous", line: "Swiggy at 8:40 pm. Food delivery was 61% of the day." });
    expect(streak).toMatchObject({ kicker: "Streak", big: "5 days", mood: "celebrating", line: "+20 XP for finishing under budget" });
    expect(line).toMatchObject({ kicker: "Gullak says", big: "“Easy day tomorrow?”", mood: "happy", line: "Cook at home and the Goa trip gets a day closer" });
    expect(xpCaption(mockup)).toBe("38% left to level 4");
  });

  it("a past day is not called today", () => {
    expect(buildCards(mockup, "2026-10-23")[0]?.kicker).toBe("The day’s grade");
  });

  it("over budget", () => {
    const over = { ...mockup, grade: { grade: "C" as const, budgetPaise: 59300, spentPaise: 72000, percentUsed: 121, underBudget: false }, streak: { ...mockup.streak, xpEarned: 0, reset: true } };
    const [grade, , streak] = buildCards(over, "2026-10-22");
    expect(grade?.line).toBe("₹720 spent of ₹593. The extra ₹127 comes out of the rest of the cycle.");
    expect(grade?.mood).toBe("nervous");
    expect(streak?.line).toBe("The streak starts again tomorrow");
    expect(streak?.mood).toBe("calm");
  });

  it("a freeze saved the streak", () => {
    const frozen = { ...mockup, grade: { ...mockup.grade, grade: "D" as const, underBudget: false }, streak: { ...mockup.streak, freezeUsed: true, xpEarned: 0 } };
    expect(buildCards(frozen, "2026-10-22")[2]?.line).toBe("A freeze kept your streak going");
  });

  it("a day with no spends", () => {
    const none = { ...mockup, grade: { ...mockup.grade, grade: "A_PLUS" as const, spentPaise: 0 }, spend: { biggest: null, topCategory: null } };
    const [grade, spend] = buildCards(none, "2026-10-22");
    expect(grade?.line).toBe("Nothing spent of ₹580. The whole ₹580 rolls into the rest of the cycle.");
    expect(spend).toMatchObject({ big: "₹0", line: "No spends today. The Gullak is impressed.", mood: "happy" });
  });

  it("tonight's card while the day is still going", () => {
    const live = { ...mockup, live: true, streak: { ...mockup.streak, xpEarned: 15 } };
    expect(buildCards(live, "2026-10-22")[2]?.line).toBe("+15 XP so far. Finish under budget for +20 more.");
    const liveNoXp = { ...live, streak: { ...live.streak, xpEarned: 0 } };
    expect(buildCards(liveNoXp, "2026-10-22")[2]?.line).toBe("Finish under budget for +20 XP");
  });

  it("a merchant-less spend uses the category", () => {
    const anon = { ...mockup, spend: { ...mockup.spend, biggest: { ...mockup.spend.biggest!, merchant: null } } };
    expect(buildCards(anon, "2026-10-22")[1]?.line).toBe("Food delivery at 8:40 pm. Food delivery was 61% of the day.");
  });

  it("right on budget and a ₹0 day", () => {
    const exact = { ...mockup, grade: { ...mockup.grade, spentPaise: 58000 } };
    expect(buildCards(exact, "2026-10-22")[0]?.line).toBe("₹580 spent of ₹580. Right on budget.");
    const zero = { ...mockup, grade: { grade: "A_PLUS" as const, budgetPaise: 0, spentPaise: 0, percentUsed: 0, underBudget: true } };
    expect(buildCards(zero, "2026-10-22")[0]?.line).toBe("Nothing spent on a ₹0 day. Exactly right.");
  });

  it("one day of streak is singular", () => {
    expect(buildCards({ ...mockup, streak: { ...mockup.streak, current: 1 } }, "2026-10-22")[2]?.big).toBe("1 day");
  });
});
```

`app/src/features/game/report-card/report-card.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import React from "react";
import type { ReportCard } from "../api";
import { ReportCardScreen } from "./report-card-screen";

jest.mock("@/lib/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../api", () => ({ ...jest.requireActual("../api"), gameApi: { reportCard: jest.fn() } }));
import { gameApi } from "../api";

const card: ReportCard = {
  date: "2026-10-22",
  live: false,
  stage: "CLAY",
  grade: { grade: "B", budgetPaise: 58000, spentPaise: 46000, percentUsed: 79, underBudget: true },
  spend: {
    biggest: { amountPaise: 28000, merchant: "Swiggy", categoryName: "Food delivery", occurredAt: "2026-10-22T15:10:00Z" },
    topCategory: { code: "food_delivery", name: "Food delivery", sharePercent: 61 },
  },
  streak: { current: 5, freezeUsed: false, reset: false, xpEarned: 20, xp: 1334, level: 3, levelFloorXp: 900, nextLevelXp: 1600, toNextLevelPercent: 62 },
  line: { title: "Easy day tomorrow?", body: "Cook at home and the Goa trip gets a day closer" },
};

function renderCard(props: Partial<React.ComponentProps<typeof ReportCardScreen>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = jest.fn();
  render(
    <QueryClientProvider client={qc}>
      <ReportCardScreen onClose={onClose} today="2026-10-22" share={jest.fn(() => Promise.resolve("shared" as const))} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => (gameApi.reportCard as jest.Mock).mockResolvedValue(card));

describe("Night report card (APP-16)", () => {
  it("opens on the grade with the date and Skip", async () => {
    const { onClose } = renderCard();
    expect(screen.getByTestId("report-card-loading")).toBeTruthy();
    expect(await screen.findByText("Today’s grade")).toBeTruthy();
    expect(screen.getByText("Night report · Thu, 22 Oct")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Report card" })).toHaveAccessibilityValue({ now: 1, min: 1, max: 4 });
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Skip" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Next and Back move one card and clamp; Done closes on card 4", async () => {
    const { onClose } = renderCard();
    await screen.findByText("Today’s grade");
    fireEvent.press(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Biggest spend")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Today’s grade")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Next" }));
    fireEvent.press(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("38% left to level 4")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Gullak says")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Share calls the share sheet with the image and says so", async () => {
    const share = jest.fn(() => Promise.resolve("shared" as const));
    renderCard({ share });
    await screen.findByText("Today’s grade");
    for (let i = 0; i < 3; i++) fireEvent.press(screen.getByRole("button", { name: "Next" }));
    fireEvent.press(screen.getByRole("button", { name: "Share as image" }));
    await waitFor(() => expect(screen.getByText("Image ready in your share sheet")).toBeTruthy());
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("the share image carries no rupee amounts", async () => {
    renderCard();
    await screen.findByText("Today’s grade");
    const frame = screen.getByTestId("share-frame-content", { includeHiddenElements: true });
    expect(within(frame).queryAllByText(/₹/, { includeHiddenElements: true })).toHaveLength(0);
    expect(within(frame).getByText("5-day streak", { includeHiddenElements: true })).toBeTruthy();
  });

  it("the close button leaves from any card", async () => {
    const { onClose } = renderCard();
    await screen.findByText("Today’s grade");
    fireEvent.press(screen.getByRole("button", { name: "Close report card" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("a failed load shows the error with Retry", async () => {
    (gameApi.reportCard as jest.Mock).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(card);
    renderCard();
    fireEvent.press(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Today’s grade")).toBeTruthy();
  });

  it("asks for the date it was given", async () => {
    renderCard({ date: "2026-10-21" });
    await screen.findByText("The day’s grade");
    expect(gameApi.reportCard).toHaveBeenCalledWith("2026-10-21");
  });
});

describe("Grade explanation (APP-17)", () => {
  it("tapping the grade shows the rule", async () => {
    renderCard();
    await screen.findByText("Today’s grade");
    expect(screen.queryByText("How grades work")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Grade B. How grades work" }));
    expect(screen.getByText("How grades work")).toBeTruthy();
    expect(screen.getByText("A+ under 50% of the day’s budget")).toBeTruthy();
    expect(screen.getByText("B 70 to 100%")).toBeTruthy();
    expect(screen.getByText("F above 150%")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Grade B. How grades work" }));
    expect(screen.queryByText("How grades work")).toBeNull();
  });
});
```

`app/src/lib/notification-routes.test.ts`:

```ts
import { openFromNotification, routeForNotification, type NotificationResponse } from "./notification-routes";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("./log", () => ({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

function response(data: unknown, date = 1_761_234_000_000, identifier = "gullak.night"): NotificationResponse {
  return { notification: { date, request: { identifier, content: { data } } } };
}

describe("notification deep links (E2E-07)", () => {
  it("the night message opens the report card", () => {
    expect(routeForNotification({ url: "gullak://report-card" })).toBe("/report-card");
  });

  it("unknownNotificationUrlsAreIgnored", () => { // review focus
    for (const data of [{ url: "gullak://me" }, { url: "https://evil.example" }, { url: "/report-card/../me" }, { url: 42 }, null, "gullak://report-card", { url: "constructor" }, { url: "__proto__" }]) {
      expect(routeForNotification(data)).toBeNull();
    }
  });

  it("one tap opens once, a later day's tap opens again", () => {
    const navigate = jest.fn();
    expect(openFromNotification(response({ url: "gullak://report-card" }), navigate)).toBe(true);
    expect(openFromNotification(response({ url: "gullak://report-card" }), navigate)).toBe(false);
    expect(openFromNotification(response({ url: "gullak://report-card" }, 1_761_320_400_000), navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith("/report-card");
  });
});
```

Add to `app/src/lib/notifications.test.ts` (the fake `NotificationsApi` there records `scheduleNotificationAsync` calls; if Plan 2's existing assertion on the night request compares the whole object, add the `data` field to it):

```ts
it("the night message carries the report card link", async () => {
  const calls: { identifier: string; content: { data?: Record<string, string> } }[] = [];
  const fake = {
    getPermissionsAsync: () => Promise.resolve({ granted: true }),
    requestPermissionsAsync: () => Promise.resolve({ granted: true }),
    getAllScheduledNotificationsAsync: () => Promise.resolve([]),
    cancelScheduledNotificationAsync: () => Promise.resolve(),
    scheduleNotificationAsync: (req: { identifier: string; content: { data?: Record<string, string> } }) => {
      calls.push(req);
      return Promise.resolve(req.identifier);
    },
  };
  await scheduleDaily({ morningTime: "08:00", nightTime: "22:00", personality: "CHILL" }, fake);
  expect(calls.find((c) => c.identifier === "gullak.night")?.content.data).toEqual({ url: "gullak://report-card" });
  expect(calls.find((c) => c.identifier === "gullak.morning")?.content.data).toBeUndefined();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx jest src/features/game/report-card src/lib/notification-routes src/lib/notifications src/lib/dates`
Expected: FAIL (modules and `formatTime` missing; the night message has no `data`).

- [ ] **Step 3: Dates and the deep link**

Add to `app/src/lib/dates.ts`:

```ts
const clockTime = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });

/** "2026-10-23T15:10:00Z" → "8:40 pm" in India. */
export function formatTime(iso: string): string {
  const parts = clockTime.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
}
```

If Plan 3 already added a time formatter with the same output (Home's spend rows show "9:12 am"), use that one here and skip this addition.

In `app/src/lib/notifications.ts`: add the link constant, let the request carry `data`, and attach it to the night message (morning stays as it is):

```ts
/** The night message's deep link (spec 2.7). The only URL the app opens from a notification. */
export const REPORT_CARD_URL = "gullak://report-card";
```

```ts
  scheduleNotificationAsync(request: {
    identifier: string;
    content: { title: string; body: string; data?: Record<string, string> };
    trigger: { type: "daily"; hour: number; minute: number };
  }): Promise<string>;
```

and in `scheduleDaily` replace the night line with:

```ts
  await api.scheduleNotificationAsync({
    identifier: "gullak.night",
    content: { ...copy.night, data: { url: REPORT_CARD_URL } },
    trigger: { type: "daily", ...parse(opts.nightTime) },
  });
```

`app/src/lib/notification-routes.ts`:

```ts
import { router } from "expo-router";
import { useEffect } from "react";
import { log } from "./log";
import { REPORT_CARD_URL, notificationsSupported } from "./notifications";

type Route = "/report-card";

/** Exact links only. A push payload can never steer the app anywhere else (no prefixes, no web URLs). */
const ROUTES = new Map<string, Route>([[REPORT_CARD_URL, "/report-card"]]);

export type NotificationResponse = { notification: { date: number; request: { identifier: string; content: { data?: unknown } } } };

export type ResponseApi = {
  lastResponse(): Promise<NotificationResponse | null>;
  onResponse(listener: (r: NotificationResponse) => void): { remove(): void };
};

export function routeForNotification(data: unknown): Route | null {
  if (typeof data !== "object" || data === null) return null;
  const url = (data as { url?: unknown }).url;
  if (typeof url !== "string") return null;
  return ROUTES.get(url) ?? null;
}

const opened = new Set<string>();

/** Opens the screen for a tapped notification once; the cold-start response and the listener may both report it. */
export function openFromNotification(r: NotificationResponse, navigate: (href: Route) => void): boolean {
  const key = `${r.notification.request.identifier}:${r.notification.date}`;
  if (opened.has(key)) return false;
  const route = routeForNotification(r.notification.request.content.data);
  if (!route) {
    log.warn("notification.unknown_link", {});
    return false;
  }
  opened.add(key);
  log.info("notification.opened", { route });
  navigate(route);
  return true;
}

function realApi(): ResponseApi {
  // Imported lazily so the web build never loads expo-notifications (it is phone-only).
  const N = require("expo-notifications") as typeof import("expo-notifications");
  return {
    lastResponse: () => N.getLastNotificationResponseAsync(),
    onResponse: (listener) => N.addNotificationResponseReceivedListener(listener),
  };
}

/** Taps on the night message open the report card, whether the app was closed or running (E2E-07). */
function pushRoute(href: Route): void {
  router.push(href);
}

export function useNotificationRoutes(enabled: boolean, api: () => ResponseApi = realApi, navigate: (href: Route) => void = pushRoute): void {
  useEffect(() => {
    if (!enabled || !notificationsSupported) return;
    const n = api();
    let alive = true;
    void n.lastResponse().then((r) => {
      if (alive && r) openFromNotification(r, navigate);
    });
    const sub = n.onResponse((r) => openFromNotification(r, navigate));
    return () => {
      alive = false;
      sub.remove();
    };
  }, [enabled, api, navigate]);
}
```

If the SDK in use marks `getLastNotificationResponseAsync` deprecated, use `getLastNotificationResponse()` wrapped in `Promise.resolve(...)`; nothing else changes. Both defaults are module-level functions, so the effect subscribes once per sign-in.

- [ ] **Step 4: The cards**

`app/src/features/game/report-card/cards.ts`:

```ts
import type { Mood } from "@/features/gullak/moods";
import { formatTime } from "@/lib/dates";
import { formatRupees } from "@/lib/money";
import type { Grade, ReportCard } from "../api";

export const gradeLabel: Record<Grade, string> = { A_PLUS: "A+", A: "A", B: "B", C: "C", D: "D", F: "F" };

const gradeMood: Record<Grade, Mood> = { A_PLUS: "happy", A: "happy", B: "calm", C: "nervous", D: "fainted", F: "fainted" };

/** Spec 2.7's rule, shown when the grade is tapped (APP-17, ux finding 15). */
export const gradeRules: string[] = [
  "A+ under 50% of the day’s budget",
  "A 50 to 69%",
  "B 70 to 100%",
  "C 101 to 125%",
  "D 126 to 150%",
  "F above 150%",
];

export type CardKind = "grade" | "spend" | "streak" | "line";
export type CardView = { kind: CardKind; kicker: string; big: string; line: string; mood: Mood };

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

function gradeLine(rc: ReportCard): string {
  const { budgetPaise: budget, spentPaise: spent } = rc.grade;
  const b = formatRupees(budget);
  const s = formatRupees(spent);
  if (budget <= 0) return spent <= 0 ? "Nothing spent on a ₹0 day. Exactly right." : `${s} spent on a ₹0 day. It comes out of the rest of the cycle.`;
  if (spent <= 0) return `Nothing spent of ${b}. The whole ${b} rolls into the rest of the cycle.`;
  if (spent < budget) return `${s} spent of ${b}. The other ${formatRupees(budget - spent)} rolls into the rest of the cycle.`;
  if (spent === budget) return `${s} spent of ${b}. Right on budget.`;
  return `${s} spent of ${b}. The extra ${formatRupees(spent - budget)} comes out of the rest of the cycle.`;
}

function spendCard(rc: ReportCard, isToday: boolean): CardView {
  const biggest = rc.spend.biggest;
  if (!biggest) {
    return { kind: "spend", kicker: "Biggest spend", big: "₹0", line: `No spends ${isToday ? "today" : "that day"}. The Gullak is impressed.`, mood: "happy" };
  }
  const who = biggest.merchant?.trim() || biggest.categoryName;
  const top = rc.spend.topCategory;
  const line = top ? `${who} at ${formatTime(biggest.occurredAt)}. ${top.name} was ${top.sharePercent}% of the day.` : `${who} at ${formatTime(biggest.occurredAt)}`;
  return { kind: "spend", kicker: "Biggest spend", big: formatRupees(biggest.amountPaise), line, mood: "nervous" };
}

function streakLine(rc: ReportCard): string {
  const xp = rc.streak.xpEarned;
  const under = rc.grade.underBudget;
  if (rc.live) {
    if (under) return xp > 0 ? `+${xp} XP so far. Finish under budget for +20 more.` : "Finish under budget for +20 XP";
    return xp > 0 ? `+${xp} XP so far. Tomorrow’s a fresh start.` : "Over budget so far. Tomorrow’s a fresh start.";
  }
  if (under) return xp === 20 ? "+20 XP for finishing under budget" : `+${xp} XP, 20 of them for finishing under budget`;
  if (rc.streak.freezeUsed) return "A freeze kept your streak going";
  return "The streak starts again tomorrow";
}

export function buildCards(rc: ReportCard, today: string): CardView[] {
  const isToday = rc.date === today;
  return [
    { kind: "grade", kicker: isToday ? "Today’s grade" : "The day’s grade", big: gradeLabel[rc.grade.grade], line: gradeLine(rc), mood: gradeMood[rc.grade.grade] },
    spendCard(rc, isToday),
    { kind: "streak", kicker: "Streak", big: days(rc.streak.current), line: streakLine(rc), mood: rc.grade.underBudget ? "celebrating" : "calm" },
    { kind: "line", kicker: "Gullak says", big: `“${rc.line.title}”`, line: rc.line.body, mood: "happy" },
  ];
}

/** "38% left to level 4" under the XP bar. */
export function xpCaption(rc: ReportCard): string {
  return `${100 - rc.streak.toNextLevelPercent}% left to level ${rc.streak.level + 1}`;
}
```

`app/src/features/game/report-card/xp-bar.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { colors, spacing } from "@/theme";

/** Gold on the dark XP track (design.md: XP bars on dark only; the fill and the text carry the value). */
export function XpBar({ percent, caption, nextLevel }: { percent: number; caption: string; nextLevel: number }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <View style={{ width: "100%", maxWidth: 280, gap: spacing.sm }}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Progress to level ${nextLevel}`}
        accessibilityValue={{ now: value, min: 0, max: 100 }}
        style={{ height: 10, borderRadius: 5, backgroundColor: colors.xpTrack, overflow: "hidden" }}
      >
        <View style={{ width: `${value}%`, height: "100%", backgroundColor: colors.gold }} />
      </View>
      <Text variant="label" color={colors.darkMuted} align="center">
        {caption}
      </Text>
    </View>
  );
}
```

`app/src/features/game/report-card/grade-rule.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { colors, radius, spacing } from "@/theme";
import { gradeRules } from "./cards";

/** Inline, not a toast: it is read, not acted on (APP-28). */
export function GradeRule() {
  return (
    <View accessibilityLiveRegion="polite" style={{ alignSelf: "stretch", gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.darkRaised }}>
      <Text variant="bodyStrong" color={colors.darkText}>
        How grades work
      </Text>
      {gradeRules.map((r) => (
        <Text key={r} variant="label" color={colors.darkMuted}>
          {r}
        </Text>
      ))}
    </View>
  );
}
```

`app/src/features/game/report-card/report-card-screen.tsx`:

```tsx
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { ErrorState } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { Gullak } from "@/features/gullak/gullak";
import { describeError } from "@/lib/api-errors";
import { formatDay, todayIst } from "@/lib/dates";
import { messageFor } from "@/lib/errors";
import { shareImage, type ShareResult } from "@/lib/share-image";
import { colors, fonts, radius, spacing, touchTarget } from "@/theme";
import { fromServerStage } from "../api";
import { ShareFrame } from "../components/share-frame";
import { useReportCard } from "../hooks";
import { buildCards, gradeLabel, xpCaption } from "./cards";
import { GradeRule } from "./grade-rule";
import { XpBar } from "./xp-bar";

const LAST = 3;

const shareLabel: Record<ShareResult, string> = {
  shared: "Image ready in your share sheet",
  unavailable: "Sharing isn’t available on this phone",
  failed: "Couldn’t make the image. Try again",
};

/** Where a flick was heading (expo-animation recipe): a fast short swipe still turns the card. */
function project(velocity: number): number {
  "worklet";
  return ((velocity / 1000) * 0.998) / (1 - 0.998);
}

function DarkButton({ title, onPress, filled }: { title: string; onPress: () => void; filled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 52,
        borderRadius: radius.lg,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: filled ? 0 : 1,
        borderColor: colors.darkControl,
        backgroundColor: filled ? colors.darkText : "transparent",
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Text variant={filled ? "bodyStrong" : "body"} color={filled ? colors.dark : colors.darkText}>
        {title}
      </Text>
    </Pressable>
  );
}

export type ReportCardProps = {
  date?: string;
  onClose: () => void;
  share?: (ref: React.RefObject<View | null>) => Promise<ShareResult>;
  /** Test override for "today" in India. */
  today?: string;
};

/** Spec 2.7: four swipeable dark cards, Skip on card 1, Back and Next clamp, Done and Share on card 4. */
export function ReportCardScreen({ date, onClose, share = shareImage, today }: ReportCardProps) {
  const insets = useSafeAreaInsets();
  const report = useReportCard(date);
  const [index, setIndex] = useState(0);
  const [showRule, setShowRule] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<ShareResult | null>(null);
  const frame = useRef<View>(null);
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);

  const go = useCallback((delta: number) => {
    setIndex((i) => Math.max(0, Math.min(LAST, i + delta)));
    setShowRule(false);
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        .onUpdate((e) => {
          if (!reduced) x.set(e.translationX);
        })
        .onEnd((e) => {
          const heading = e.translationX + project(e.velocityX);
          const delta = heading < -width / 4 ? 1 : heading > width / 4 ? -1 : 0;
          if (delta !== 0) scheduleOnRN(go, delta);
          x.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: e.velocityX }));
        }),
    [go, reduced, width, x],
  );
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  const rc = report.data;
  const cards = rc ? buildCards(rc, today ?? todayIst()) : [];
  const card = cards[index];
  const stage = (rc ? fromServerStage(rc.stage) : null) ?? "clay";

  return (
    <View style={{ flex: 1, backgroundColor: colors.dark, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg, paddingHorizontal: spacing.lg, gap: spacing.lg }}>
      {rc ? (
        <ShareFrame ref={frame} tone="dark">
          <View testID="share-frame-content" style={{ alignItems: "center", gap: spacing.md }}>
            <Text variant="label" color={colors.darkMuted}>{`Night report · ${formatDay(rc.date)}`}</Text>
            <Gullak mood={cards[0]?.mood ?? "happy"} stage={stage} size={200} reduceMotion />
            <Text variant="display" color={colors.darkText}>
              {gradeLabel[rc.grade.grade]}
            </Text>
            <Text variant="title" color={colors.darkText} align="center">{`${rc.streak.current}-day streak`}</Text>
            <Text variant="body" color={colors.darkText} align="center">{`“${rc.line.title}”`}</Text>
          </View>
        </ShareFrame>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm }}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Report card"
          accessibilityValue={{ now: index + 1, min: 1, max: 4 }}
          style={{ flex: 1, flexDirection: "row", gap: spacing.xs }}
        >
          {[0, 1, 2, 3].map((k) => (
            <View key={k} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: k <= index ? colors.darkText : colors.darkControl }} />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close report card"
          onPress={onClose}
          style={{ width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.darkRaised }}
        >
          <Icon name="x" size={20} color={colors.darkText} />
        </Pressable>
      </View>

      {!rc && report.isLoading ? (
        <View testID="report-card-loading" style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md }}>
          <Skeleton width={160} height={160} round />
          <Skeleton width="60%" height={24} />
        </View>
      ) : !rc || !card ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ErrorState body={describeError(report.error, messageFor)} onRetry={() => void report.refetch()} />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Icon name="moon" size={16} color={colors.darkMuted} />
            <Text variant="label" color={colors.darkMuted}>{`Night report · ${formatDay(rc.date)}`}</Text>
          </View>

          <GestureDetector gesture={pan}>
            <Animated.View accessibilityLiveRegion="polite" style={[{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg }, cardStyle]}>
              <Animated.View key={index} entering={reduced ? undefined : FadeIn.duration(200)} style={{ alignItems: "center", gap: spacing.lg, alignSelf: "stretch" }}>
                <Gullak mood={card.mood} stage={stage} size={160} />
                <Text variant="bodyStrong" color={colors.darkMuted} style={{ fontFamily: fonts.ui500 }}>
                  {card.kicker}
                </Text>
                {card.kind === "grade" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Grade ${card.big}. How grades work`}
                    onPress={() => setShowRule((v) => !v)}
                    style={{ minWidth: touchTarget, minHeight: touchTarget, alignItems: "center", justifyContent: "center" }}
                  >
                    <Text variant="display" color={colors.darkText} style={{ fontVariant: ["tabular-nums"] }}>
                      {card.big}
                    </Text>
                  </Pressable>
                ) : (
                  <Text variant={card.big.length > 8 ? "hero" : "display"} color={colors.darkText} align="center" style={{ fontVariant: ["tabular-nums"] }}>
                    {card.big}
                  </Text>
                )}
                <Text variant="title" color={colors.darkText} align="center" style={{ maxWidth: 300, fontFamily: fonts.ui400, lineHeight: 29 }}>
                  {card.line}
                </Text>
                {card.kind === "grade" && showRule ? <GradeRule /> : null}
                {card.kind === "streak" ? <XpBar percent={rc.streak.toNextLevelPercent} caption={xpCaption(rc)} nextLevel={rc.streak.level + 1} /> : null}
                {card.kind === "line" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={shared ? shareLabel[shared] : "Share as image"}
                    disabled={sharing}
                    onPress={() => {
                      setSharing(true);
                      void share(frame).then((r) => {
                        setShared(r);
                        setSharing(false);
                      });
                    }}
                    style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touchTarget, paddingHorizontal: spacing.md, borderRadius: touchTarget / 2, borderWidth: 1, borderColor: colors.darkControl }}
                  >
                    <Icon name="share" size={16} color={colors.darkText} />
                    <Text variant="label" color={colors.darkText} style={{ fontFamily: fonts.ui700 }}>
                      {shared ? shareLabel[shared] : "Share as image"}
                    </Text>
                  </Pressable>
                ) : null}
              </Animated.View>
            </Animated.View>
          </GestureDetector>

          <View style={{ flexDirection: "row", gap: spacing.cm }}>
            {index === 0 ? <DarkButton title="Skip" onPress={onClose} /> : <DarkButton title="Back" onPress={() => go(-1)} />}
            {index < LAST ? <DarkButton title="Next" filled onPress={() => go(1)} /> : <DarkButton title="Done" filled onPress={onClose} />}
          </View>
        </>
      )}
    </View>
  );
}
```

(The share frame shows the grade, the streak and the Gullak's title; no rupee amount goes into it, which the test pins.)

`app/app/report-card.tsx`:

```tsx
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { ReportCardScreen } from "@/features/game/report-card/report-card-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function ReportCardRoute() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const valid = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  return <ReportCardScreen date={valid} onClose={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} />;
}
```

In `app/app/_layout.tsx`, replace `Navigation` with (keeping any screens Plans 3–5 registered):

```tsx
function Navigation() {
  const { status } = useSession();
  useNotificationRoutes(status === "signedIn");
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="login" />
        <Stack.Screen name="login-code" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="stage-up" options={{ presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen name="report-card" options={{ presentation: "fullScreenModal", contentStyle: { backgroundColor: colors.dark } }} />
      </Stack.Protected>
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}
```

Import `useNotificationRoutes` from `@/lib/notification-routes` at the top of the file. A notification tapped while signed out opens the app at login; the report card is behind the signed-in guard.

- [ ] **Step 5: The end-to-end flow**

`app/e2e/report-card.yaml`:

```yaml
appId: in.gullak.app
---
# E2E-07. Signs up through setup.yaml, then opens the night message's deep link the way a tap on the
# notification does. A real tap on the system notification is on the manual checklist (Maestro cannot
# tap a system notification reliably on every emulator).
- runFlow: setup.yaml
- openLink: gullak://report-card
- assertVisible: "Today’s grade"
- tapOn:
    text: "Grade .*\\. How grades work"
- assertVisible: "How grades work"
- tapOn: "Next"
- assertVisible: "Biggest spend"
- tapOn: "Next"
- assertVisible: "Streak"
- tapOn: "Next"
- assertVisible: "Gullak says"
- tapOn: "Share as image"
- back
- assertVisible: "Image ready in your share sheet"
- tapOn: "Done"
- assertVisible: "Level 1"
```

Add to `app/e2e/README.md`: `maestro test -e GULLAK_API=http://10.0.2.2:8080/api/v1 e2e/report-card.yaml` (E2E-07), and to the manual checklist note: "At the night time, tap the real notification: the report card opens on card 1; share the image into Instagram stories and check it fills the story frame".

In `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md` section 9, reword APP-14 to: `| APP-14 | Gullak animations | coin drop fires on add; faint on fainted; one celebrate jump when /budget/today carries new celebrations, acknowledged once; a STAGE_UP opens the stage-up moment |`, and section 10 E2E-07 to: `| E2E-07 | Report card | open the night message's link (gullak://report-card) → grade rule → 4 cards → share; a real notification tap on the manual checklist |`.

- [ ] **Step 6: Run the tests**

Run: `cd app && npx jest && npm run lint && npm run typecheck`
Expected: PASS.

On a device: open `gullak://report-card` with `npx uri-scheme open gullak://report-card --android`, swipe the cards both ways (a short flick turns the card; at card 1 a right swipe springs back), tap the grade, share the image and check it is 1080×1920 with no rupee amounts. Turn on Reduce Motion: the cards switch without sliding.

- [ ] **Step 7: Commit**

```bash
git add app/src/features/game/report-card app/src/lib/dates.ts app/src/lib/dates.test.ts app/src/lib/notifications.ts app/src/lib/notifications.test.ts app/src/lib/notification-routes.ts app/src/lib/notification-routes.test.ts app/app/report-card.tsx app/app/_layout.tsx app/e2e docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md
git commit -m "feat(app): night report card with swipe, grade rule, share image and the notification deep link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 14: App: the Badges screen and its entry from Me

**Owner:** app-engineer. **Test IDs:** BDG (display of all ten, "N of 10 earned"), BDG-09 (Challenges won), ERR-13 (Badges), APP-29 (Badges controls), ux finding "Goal crusher shows the furthest goal". **Red team:** no (read-only screen of the caller's own progress).

**Files:**
- Create: `app/src/features/game/badges/badge-catalog.ts`, `badges-screen.tsx`, `badges.test.tsx`, `app/app/badges.tsx`
- Modify: `app/src/features/profile/screens/me-screen.tsx`, `app/app/(tabs)/me.tsx`, `app/app/_layout.tsx`

**Interfaces:**
- Consumes: `useProgress`, `Progress`, `BadgeCode`, `BadgeProgress` (Task 12); Plan 2's `Screen`, `Text`, `Icon`, `IconName`, `ProgressBar`, `Skeleton`, `EmptyState`, `ErrorState`, `Button`, `formatDayMonth`, `describeError`, `messageFor`, `MeScreen`.
- Produces: `badgeCatalog : Record<BadgeCode, { name, how, icon }>`; `badgeProgressText(badge, progress) : string`; `BadgesScreen({ onBack })`; route `/badges`; `MeScreen` prop `onOpenBadges?: () => void`.

- [ ] **Step 1: Write the failing tests**

`app/src/features/game/badges/badges.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import type { BadgeCode, Progress } from "../api";
import { BadgesScreen } from "./badges-screen";

jest.mock("@/lib/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../api", () => ({ ...jest.requireActual("../api"), gameApi: { progress: jest.fn() } }));
import { gameApi } from "../api";

const earned = (code: BadgeCode, on: string) => ({ code, earned: true, earnedOn: on, progress: null, target: null });
const locked = (code: BadgeCode, progress: number | null = null, target: number | null = null) => ({ code, earned: false, earnedOn: null, progress, target });

/** The Badges mockup: 6 of 10, Goal crusher on the furthest goal (ux finding). */
const mockup: Progress = {
  xp: 1334,
  level: 3,
  stage: "CLAY",
  levelFloorXp: 900,
  nextLevelXp: 1600,
  toNextLevelPercent: 62,
  streak: { current: 5, best: 8, freezes: 1 },
  badges: [
    earned("FIRST_LOG", "2026-09-02"),
    earned("WEEK_WARRIOR", "2026-09-08"),
    earned("NO_SWIGGY_SUNDAY", "2026-10-04"),
    locked("ZEPTO_FREE_WEEK", 0, 7),
    earned("SUBSCRIPTION_SLAYER", "2026-10-18"),
    locked("GOAL_CRUSHER", 40, 100),
    earned("HONEST_LOGGER", "2026-10-12"),
    earned("SORTED", "2026-10-12"),
    locked("COMEBACK_KID"),
    locked("DIAMOND_GULLAK", 3, 20),
  ],
  challengeBadges: [],
  furthestGoal: { name: "Emergency fund", percent: 40 },
  challenge: null,
};

function renderBadges() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onBack = jest.fn();
  render(
    <QueryClientProvider client={qc}>
      <BadgesScreen onBack={onBack} />
    </QueryClientProvider>,
  );
  return { onBack };
}

describe("Badges (Badges mockup)", () => {
  it("counts and lists earned badges with their dates", async () => {
    (gameApi.progress as jest.Mock).mockResolvedValue(mockup);
    renderBadges();
    expect(screen.getByTestId("badges-loading")).toBeTruthy();
    expect(await screen.findByText("6 of 10 earned")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Badges earned" })).toHaveAccessibilityValue({ now: 60 });
    expect(screen.getByText("First log")).toBeTruthy();
    expect(screen.getByText("2 Sep")).toBeTruthy();
    expect(screen.getByText("Subscription slayer")).toBeTruthy();
  });

  it("shows how to earn the rest and the progress so far", async () => {
    (gameApi.progress as jest.Mock).mockResolvedValue(mockup);
    renderBadges();
    await screen.findByText("Still to earn");
    expect(screen.getByText("No quick commerce for 7 days")).toBeTruthy();
    expect(screen.getByText("0 of 7 days")).toBeTruthy();
    expect(screen.getByText("Emergency fund 40%")).toBeTruthy();
    expect(screen.getByText("Under budget after 3 bad days")).toBeTruthy();
    expect(screen.getByText("Level 3")).toBeTruthy();
    expect(screen.getByLabelText("Comeback kid. Under budget after 3 bad days. Not started")).toBeTruthy();
  });

  it("challenge badges are their own list and not in the count", async () => {
    (gameApi.progress as jest.Mock).mockResolvedValue({ ...mockup, challengeBadges: [{ categoryCode: "food_delivery", categoryName: "Food delivery", earnedOn: "2026-10-26" }] });
    renderBadges();
    expect(await screen.findByText("Challenges won")).toBeTruthy();
    expect(screen.getByText("Food delivery")).toBeTruthy();
    expect(screen.getByText("Weekly challenge · 26 Oct")).toBeTruthy();
    expect(screen.getByText("6 of 10 earned")).toBeTruthy();
  });

  it("no badges yet", async () => {
    (gameApi.progress as jest.Mock).mockResolvedValue({ ...mockup, badges: mockup.badges.map((b) => ({ ...b, earned: false, earnedOn: null })) });
    renderBadges();
    expect(await screen.findByText("0 of 10 earned")).toBeTruthy();
    expect(screen.getByText("No badges yet. Log a spend to earn your first.")).toBeTruthy();
    expect(screen.queryByText("Challenges won")).toBeNull();
  });

  it("a failed load retries", async () => {
    (gameApi.progress as jest.Mock).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(mockup);
    renderBadges();
    fireEvent.press(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("6 of 10 earned")).toBeTruthy();
  });

  it("Back returns to Me", async () => {
    (gameApi.progress as jest.Mock).mockResolvedValue(mockup);
    const { onBack } = renderBadges();
    fireEvent.press(await screen.findByRole("button", { name: "Back to Me" }));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx jest src/features/game/badges`
Expected: FAIL (`./badges-screen` missing).

- [ ] **Step 3: Write the code**

`app/src/features/game/badges/badge-catalog.ts`:

```ts
import type { IconName } from "@/components/ui/icon";
import type { BadgeCode, BadgeProgress, Progress } from "../api";

/** Names and "how" lines from the Badges mockup; the rest written in its voice. Order follows the server. */
export const badgeCatalog: Record<BadgeCode, { name: string; how: string; icon: IconName }> = {
  FIRST_LOG: { name: "First log", how: "Log your first spend", icon: "plus" },
  WEEK_WARRIOR: { name: "Week warrior", how: "Stay under budget 7 days in a row", icon: "flame" },
  NO_SWIGGY_SUNDAY: { name: "No-Swiggy Sunday", how: "A Sunday with no food delivery", icon: "food" },
  ZEPTO_FREE_WEEK: { name: "Zepto-free week", how: "No quick commerce for 7 days", icon: "cart" },
  SUBSCRIPTION_SLAYER: { name: "Subscription slayer", how: "Cancel a subscription you don’t use", icon: "tv" },
  GOAL_CRUSHER: { name: "Goal crusher", how: "Finish any goal", icon: "trophy" },
  HONEST_LOGGER: { name: "Honest logger", how: "Log 90% of what your bank shows", icon: "target" },
  SORTED: { name: "Sorted", how: "Sort your first statement", icon: "check" },
  COMEBACK_KID: { name: "Comeback kid", how: "Under budget after 3 bad days", icon: "up" },
  DIAMOND_GULLAK: { name: "Diamond Gullak", how: "Reach level 20", icon: "sun" },
};

export const NO_PROGRESS = "—";

/** The right-hand figure on a locked row: "0 of 7 days", "Level 3", "Emergency fund 40%" or "—". */
export function badgeProgressText(badge: BadgeProgress, progress: Progress): string {
  switch (badge.code) {
    case "WEEK_WARRIOR":
    case "ZEPTO_FREE_WEEK":
      return badge.progress !== null && badge.target !== null ? `${badge.progress} of ${badge.target} days` : NO_PROGRESS;
    case "DIAMOND_GULLAK":
      return `Level ${progress.level}`;
    case "GOAL_CRUSHER":
      return progress.furthestGoal ? `${progress.furthestGoal.name} ${progress.furthestGoal.percent}%` : NO_PROGRESS;
    case "FIRST_LOG":
    case "NO_SWIGGY_SUNDAY":
    case "SUBSCRIPTION_SLAYER":
    case "HONEST_LOGGER":
    case "SORTED":
    case "COMEBACK_KID":
      return NO_PROGRESS;
  }
}
```

`app/src/features/game/badges/badges-screen.tsx`:

```tsx
import React from "react";
import { Pressable, View } from "react-native";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { formatDayMonth } from "@/lib/dates";
import { messageFor } from "@/lib/errors";
import { colors, radius, spacing } from "@/theme";
import { useProgress } from "../hooks";
import { NO_PROGRESS, badgeCatalog, badgeProgressText } from "./badge-catalog";

const TOTAL = 10;

export function BadgesScreen({ onBack }: { onBack: () => void }) {
  const progress = useProgress();
  const data = progress.data;

  return (
    <Screen testID="badges">
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm, height: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Me"
          onPress={onBack}
          style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.control }}
        >
          <Icon name="left" size={20} />
        </Pressable>
        <Text variant="title" accessibilityRole="header">
          Badges
        </Text>
      </View>

      {!data && progress.isLoading ? (
        <View testID="badges-loading" style={{ gap: spacing.md }}>
          <Skeleton height={34} width="50%" />
          <Skeleton height={8} />
          <Skeleton height={120} />
          <Skeleton height={200} />
        </View>
      ) : !data ? (
        <ErrorState body={describeError(progress.error, messageFor)} onRetry={() => void progress.refetch()} />
      ) : (
        <BadgeLists progress={data} />
      )}
    </Screen>
  );
}

function BadgeLists({ progress }: { progress: NonNullable<ReturnType<typeof useProgress>["data"]> }) {
  const earned = progress.badges.filter((b) => b.earned);
  const locked = progress.badges.filter((b) => !b.earned);
  return (
    <>
      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{`${earned.length} of ${TOTAL} earned`}</Text>
        <ProgressBar value={(earned.length * 100) / TOTAL} label="Badges earned" />
      </View>

      <Text variant="label" color={colors.muted} style={{ fontWeight: "700" }}>
        Earned
      </Text>
      {earned.length === 0 ? (
        <EmptyState title="No badges yet. Log a spend to earn your first." />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {earned.map((b) => {
            const c = badgeCatalog[b.code];
            return (
              <View
                key={b.code}
                accessible
                accessibilityLabel={`${c.name}, earned ${b.earnedOn ? formatDayMonth(b.earnedOn) : ""}`}
                style={{ flexBasis: "31%", flexGrow: 1, alignItems: "center", gap: spacing.sm, paddingVertical: spacing.cm, paddingHorizontal: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
              >
                <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.warnTint }}>
                  <Icon name={c.icon} size={24} color={colors.warnInk} />
                </View>
                <Text variant="label" align="center" style={{ fontWeight: "700" }}>
                  {c.name}
                </Text>
                <Text variant="caption">{b.earnedOn ? formatDayMonth(b.earnedOn) : ""}</Text>
              </View>
            );
          })}
        </View>
      )}

      {locked.length > 0 ? (
        <>
          <Text variant="label" color={colors.muted} style={{ fontWeight: "700" }}>
            Still to earn
          </Text>
          <View style={{ gap: spacing.sm }}>
            {locked.map((b) => {
              const c = badgeCatalog[b.code];
              const figure = badgeProgressText(b, progress);
              return (
                <View
                  key={b.code}
                  accessible
                  accessibilityLabel={`${c.name}. ${c.how}. ${figure === NO_PROGRESS ? "Not started" : figure}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm, minHeight: 52, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: colors.control }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.sand }}>
                    <Icon name="lock" size={18} color={colors.muted} />
                  </View>
                  <View style={{ flex: 1, gap: spacing.xs }}>
                    <Text variant="label" style={{ fontWeight: "700" }}>
                      {c.name}
                    </Text>
                    <Text variant="caption">{c.how}</Text>
                  </View>
                  <Text variant="caption" color={colors.ink} numberOfLines={1} style={{ fontWeight: "700", maxWidth: 140 }}>
                    {figure}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {progress.challengeBadges.length > 0 ? (
        <>
          <Text variant="label" color={colors.muted} style={{ fontWeight: "700" }}>
            Challenges won
          </Text>
          <View style={{ gap: spacing.sm }}>
            {progress.challengeBadges.map((c) => (
              <View
                key={`${c.categoryCode}-${c.earnedOn}`}
                accessible
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm, minHeight: 52, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.warnTint }}>
                  <Icon name="trophy" size={18} color={colors.warnInk} />
                </View>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text variant="label" style={{ fontWeight: "700" }}>
                    {c.categoryName}
                  </Text>
                  <Text variant="caption">{`Weekly challenge · ${formatDayMonth(c.earnedOn)}`}</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}
```

If Plan 2's `Text` rejects `fontWeight` because the bold weight is a separate font family, use `style={{ fontFamily: fonts.ui700 }}` (import `fonts` from `@/theme`) in those five places instead.

`app/app/badges.tsx`:

```tsx
import { router } from "expo-router";
import React from "react";
import { BadgesScreen } from "@/features/game/badges/badges-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function BadgesRoute() {
  return <BadgesScreen onBack={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/me"))} />;
}
```

In `app/app/_layout.tsx`, add `<Stack.Screen name="badges" />` to the signed-in group of `Navigation`, after `report-card`.

In `app/src/features/profile/screens/me-screen.tsx`, add the prop and a row above the sign-out controls:

```tsx
export function MeScreen({ email, profile, signOut, onOpenBadges }: { email: string | null; profile: Profile | null | undefined; signOut: () => Promise<void>; onOpenBadges?: () => void }) {
```

```tsx
      {onOpenBadges ? <Button title="Badges" variant="secondary" icon={<Icon name="trophy" size={20} />} onPress={onOpenBadges} /> : null}
```

(import `Icon` from `@/components/ui/icon`). In `app/app/(tabs)/me.tsx`, pass `onOpenBadges={() => router.push("/badges")}` (import `router` from `expo-router`). Plan 8 rebuilds Me and keeps this row.

- [ ] **Step 4: Run the tests**

Run: `cd app && npx jest && npm run lint && npm run typecheck`
Expected: PASS.

On a device: Me → Badges shows the count, the earned grid in three columns at 390 px width, the locked list with dashed borders, Back returns to Me; at 200% text size the rows grow and nothing is cut except a long goal name (one line, ellipsis).

- [ ] **Step 5: Commit**

```bash
git add app/src/features/game/badges app/app/badges.tsx app/app/_layout.tsx app/src/features/profile/screens/me-screen.tsx "app/app/(tabs)/me.tsx"
git commit -m "feat(app): Badges screen with progress, furthest goal and challenges won; entry from Me

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
