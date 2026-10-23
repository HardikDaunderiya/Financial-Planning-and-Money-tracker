# Plan 7: Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show people where the cycle's money went and where it is heading: cycle insights with the month-end forecast, spending by category with a drill-down, subscription detection with "Still using?", the forecast on Home, and a cycle summary at close with the choice of where the leftover goes.

**Architecture:** A new `insights` feature package on the server holds pure calculators (`ForecastCalculator`, `SubscriptionDetector`), the `subscriptions` table, `JdbcClient` aggregates over Plan 3's `transactions` and `categories`, and three controllers (`/insights/*`, `/subscriptions/*`, `/budget/cycles/{id}/*`). `insights` depends on `budget`, `ingestion`, `gamification` and `goals`; nothing depends on `insights` except Plan 6's `jobs`. Two seams in `common` keep the package graph acyclic: `common.insights.HomeInsightsSource` (implemented by `insights`, read by `budget` for the `forecast` and `justClosed` fields of `GET /budget/today`) and the `common.events.ImportCommitted` Spring event (published by Plan 4's commit, heard by `insights` to run detection). In the app, `features/insights` holds the client, hooks, copy builders and the Insights tab, category drill-down and cycle summary screens; Home gains the forecast line and a "cycle just closed" card.

**Tech Stack:** Server: Java 21, Spring Boot 4.1.1, Spring Data JPA, `JdbcClient`, Flyway (V050–V059 block), PostgreSQL 17, Testcontainers, JUnit 5, AssertJ, MockMvc, ArchUnit. App: Expo SDK (Plan 2's version), Expo Router, TypeScript strict, TanStack Query v5 (persisted cache from Plan 2), Jest with React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-23-gullak-v1-design.md` sections 2.1 (leftover choice), 2.7 (forecast and off-track rule), 2.8 (insights), 3.1 (Insights), 3.2 #4 (category drill-down) and #12 (cycle summary), 4.5 (`subscriptions`, `cycles`), 4.6 (Insights and Today rows), 4.7, 4.10, 4.11; test cases in `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md` (7.3, 7.7, 7.10, 9, 12); rules in `docs/engineering-standards.md` and `.claude/design.md`. Mockup copy is quoted verbatim from the design canvas boards `Insights` (`Insights.dc.html`) and `Main` (`Main.dc.html`, the Home forecast line).

**Builds on:** Plan 1 (implemented; `server/src/main/java/in/gullak/**` is authoritative), Plan 2 (written; its code blocks are the app contract: `api`, `Screen`, `Text`, `Button`, `RadioCard`, `ProgressBar`, `Skeleton`, `EmptyState`, `ErrorState`, `Toast`, `Icon`, `formatRupees`, `formatDayMonth`, `formatDay`, `relativeTime`, `todayIst`, `kv`, `useToday`, `todayKey`, `describeError`, `messageFor`, `HomeScreen`, `Hero`), Plan 3 (`ingestion.TransactionService.categoryTotals(UUID, LocalDate, LocalDate) : List<CategoryTotal>`, `CategoryTotal(String category, long spentPaise, int count)`, `CategoryService.get(String) : Category` (404 when unknown), `Category(code, name, sortOrder, discretionary)`, category codes including `quick_commerce`, `food_delivery`, `upi_to_people`, `subscriptions`, the `transactions.credit_kind` column, the `ALLOWED_FEATURE_DEPENDENCIES` allow-list in `ArchitectureTest`, the `/spend/[id]` app route), Plan 4 (`ingestion.imports.CommitService` commit path, `transactions.merchant_name` as the clean display name, the `/upload` app route, `app/app/upload/index.tsx`), Plan 5 (`budget.CycleRecord`, `CycleService.find/covering`, `BudgetService.currentCycle/poolAtClose`, `CurrentCycle`, `TodayResponse.tomorrowPaise/catchUp`, `goals.CycleCloseService.closeEndedBefore/applyChoice`, `goals.LeftoverChoice {SAVINGS, ROLLOVER, CARRY, TAKE}`, `ConflictException(ErrorCode, String)`, test helpers `cycleIdStarting`, `budgetToday`) and Plan 6 (`BadgeService` implementing Plan 4's `gamification.BadgeTrigger.fire(UUID, String, UUID)`, `BadgeTrigger.SUBSCRIPTION_SLAYER`, `BadgeService.earned(UUID) : List<EarnedBadge>`, `DailyCloseService.find(UUID, LocalDate) : Optional<DailyCloseView>`, `Grade {A_PLUS, A, B, C, D, F}`, `common.jobs.JobRunner.run`, `JobResult`, the `jobs` package, `TodayResponse.game`, test helper `seedCategorySpend(TestUser, long, Instant, String, String) : UUID`, the app's `badgeCatalog` and `BadgeCode`). Where an earlier plan shipped a different name, the executor adapts the call site and records it in the hand-back; where this plan edits a file an earlier plan also edited, keep their additions and apply only the changes shown.

## Global Constraints

- Migrations for this plan use V050–V059; if an earlier plan was executed with more migrations than planned, renumber to the next free number in this block. This plan uses V050.
- Money is `long` paise on the server and whole-number paise (`number`) in the app. No `double`, `float` or `BigDecimal` near money. The forecast divides with integer floor division and rounds only for display, to the nearest ₹100 (10,000 paise), half up.
- Day boundaries are `Asia/Kolkata` (`Ist.today(clock)`, `Ist.startOf(date)`); a transaction's day is `(occurred_at at time zone 'Asia/Kolkata')::date`.
- Every query on user data filters by the user id from the JWT. Another user's cycle or subscription returns 404 `NOT_FOUND`, never 403. No endpoint accepts a user id.
- Responses carry `merchant_name` only (the clean display name). `merchant_raw_enc`, statement descriptions and UPI handles are never selected by any query in this plan.
- Error bodies are `{code, message}`; `ErrorCode` is append-only (new codes before `INTERNAL`). This plan appends `CYCLE_OPEN` and `ALREADY_CHOSEN`, regenerates `app/src/lib/error-codes.ts` with `cd app && npm run gen:errors`, and adds both messages to `app/src/lib/errors.ts` in the same task.
- Never log amounts, merchant names, category totals, emails or tokens. Business events use `Events` constants with ids and counts only.
- Server: constructor injection; records at service boundaries; package-private `*Entity` and `*Repository` in `in.gullak.insights`; controllers never touch repositories, entities or `JdbcClient`; `JdbcClient` only for aggregates and the `on conflict` upsert; `ddl-auto: validate`; migrations only in the block `V050`–`V059`.
- Package graph: `insights` may depend on `common`, `budget`, `ingestion`, `gamification`, `goals`. `budget`, `ingestion`, `goals` and `gamification` never import `insights`. `jobs` may import `insights`. The ArchUnit slice rule and Plan 3's allow-list stay green.
- App: routes only under `app/app/`; features never call `fetch`; money only through `lib/money.ts`; dates only through `lib/dates.ts`; every screen renders loading, error (with Retry) and empty states and shows cached data with "Updated 2 hours ago" when offline; every control is at least 44×44 with a label; tokens only from `src/theme/`.
- Charts follow the `dataviz` skill: single-series bars in muted `#6E5E54` (`colors.muted`), 8px thick, 4px rounded data end, square at the baseline, no gridlines, no legend (one series), the value as a direct text label in ink at the row end, and the row list itself is the accessible table view (each row's label says name, amount and count). Contrast of the fill: 6.19:1 on surface, 5.76:1 on ground.
- Copy follows `.claude/design.md`: sentence case; a single sentence has no full stop; two or more sentences take a full stop after each; ₹ with Indian grouping; dates as "Fri, 23 Oct" (day-month only, "31 Oct", where the mockup has it).
- Each task's owner is named; after the owner hands back, `qa-engineer` runs, then `red-team` where the task says so, then `manager` reviews (`docs/team.md`). The server suite (`cd server && ./gradlew test`) and the app suite (`cd app && npm test && npm run lint && npm run typecheck`) stay green after every task.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Two "Roll into this cycle" taps racing on the same closed cycle: one answers 200, the other 409 `ALREADY_CHOSEN` (not 422 or 500), and the next pool grows once. Pinned in Task 8 (`parallelChoicesRecordOne`).
- A Netflix charge typed by hand as "netflix " and a statement line named "Netflix" a month apart are one merchant for detection. Pinned in Task 2 (`merchantNamesMatchIgnoringCaseAndSpaces`).
- A user cancels Netflix, then a new Netflix charge arrives on next month's statement: the subscription asks "Still using?" again instead of staying cancelled and out of the forecast. Pinned in Task 3 (`aChargeAfterCancellingAsksAgain`).
- The forecast on day 1 or 2 of a cycle (one coffee times 31) is not shown on Home and never makes the user off track. Pinned in Task 1 (`theFirstTwoDaysAreEarly`) and Task 7 (`noForecastOnHomeInTheFirstTwoDays`).
- Opening the summary or choosing for a cycle that ended last night, before any job closed it, closes it on the spot instead of answering `CYCLE_OPEN`. Pinned in Task 8 (`anEndedCycleIsClosedOnTheSpot`).

## Decisions made in this plan

| Decision | Why | Cost if wrong |
|---|---|---|
| Forecast = (spent to date − subscription charges this cycle) ÷ days elapsed × cycle days, floored, + subscription charges this cycle + live, not-cancelled subscriptions due after today and by cycle end. Days elapsed count today; spent to date includes today | Spec 2.7's pace formula, with subscriptions taken out of the pace so a ₹649 charge on day 3 is not multiplied by 10, and put back once each; "Cancelled removes it from the forecast" (2.8) needs a subscription term. The spec's example (₹9,840 over 23 of 31 days → ₹13,300) only matches with today included. Without subscriptions it is exactly 2.7's formula | a user with many subscriptions sees a slightly different number from a hand calculation |
| Figures for display are rounded to ₹100, half up: forecast spend; extra saved = spendable − rounded spend; forecast save = savings + extra. Off track compares the unrounded forecast with spendable | The sentence must add up ("₹13,300 … ₹21,700, ₹1,700 more"), and Plan 8's push must say the same numbers | none |
| The forecast is "early" on the first 2 days of a cycle: Home hides it, Insights says "Your forecast appears on day 3", and `offTrack` is false | Day 1's coffee × 31 is noise and would push an off-track alert on payday | a genuinely bad first two days are not flagged until day 3 |
| `offTrack(userId)` is decided as of yesterday (the day the daily close just closed), on the cycle covering yesterday; it covers the spending half of spec 2.7. The goal half (a deadline goal projected short) is Plan 5's `CatchUp` with situation `BEHIND`, which Plan 8 ORs in | The close runs at 00:05, when today has no spends; goals own goal projections | Plan 8 must call both |
| `GET /budget/today` gains `forecast` (`spendPaise`, `extraSavedPaise`, `offTrack`, or null when early or nothing spent) and `justClosed` (the previous cycle when it is closed, its leftover not yet chosen, and today is within the first 7 days of the new cycle) through `common.insights.HomeInsightsSource`, injected into `BudgetService` with `ObjectProvider` | `budget` cannot import `insights` (insights reads budget); the `ObjectProvider` breaks the constructor cycle the same way Plan 5's `BudgetAdjustment` does | none |
| Detection: same merchant (name lower-cased, trimmed, inner spaces collapsed), debits that count in the budget, not deleted, not `upi_to_people`, from the last 400 days; a later charge within 2% of an earlier one (`|a − b| × 100 ≤ 2 × max(a, b)`) 25–35 days later is monthly, 360–370 days later is yearly; monthly wins when both fit. One subscription per (merchant, period): amount and last seen from the latest qualifying charge, first seen from the earliest charge within 2% of that amount | Spec 2.8's rule; personal UPI payments repeat (rent to a flatmate) but are not subscriptions; fixed costs and linked statement halves are already `counts_in_budget = false` | a merchant with two plans at nearly the same price shows as one |
| Detection runs after an import commits (Spring `ImportCommitted` event published by Plan 4's `CommitService`, heard after the commit in its own transaction), and nightly at 02:30 IST for every user with a transaction created in the last 2 days (Plan 6's `JobRunner`, job `subscription-scan`) | Statements bring most repeat charges; the nightly run catches hand-logged ones. After-commit means a detection failure can never undo an import | a hand-logged second Netflix charge is detected the next morning, not at once |
| A subscription is live (listed and in the forecast) until 10 days after its next expected charge (monthly: last seen + 1 month; yearly: + 1 year) | A subscription that stopped charging should leave the screen by itself | a charge that comes 11 days late drops off until it arrives |
| "Still using?" state: `ASKING` when never answered, or answered "Using it" in an earlier cycle; `USING` when answered "Using it" in the current cycle; `CANCELLED` after "Cancelled". A charge dated after the cancellation clears the answer, so it asks again | API-SUB-05 ("not asked again this cycle; asked next cycle"); a cancelled subscription that keeps charging is the one the user most needs to see | none |
| "Cancelled" calls `BadgeTrigger.fire(userId, BadgeTrigger.SUBSCRIPTION_SLAYER, subscriptionId)` (Plan 4's interface, implemented by Plan 6) every time; the trigger is idempotent, so the badge comes once. Answers can be changed; badges are never taken back (Plan 6) | Spec 2.8 "the first time" | a user can earn the badge by tapping Cancelled on something they still use |
| Cycle summary: spent and spendable from `BudgetService.figures`; saved = profile savings + extra saved − any shortfall taken from savings; extra saved = the positive leftover unless rolled over; grade counts from `DailyCloseService.find` for each closed day; top three categories from Plan 3's `categoryTotals`; badges whose `earnedAt` falls in the cycle (IST). Open cycles return `closed: false`, figures so far, no leftover and a `forecast` | Spec 2.8's list; reading through the owning services keeps package boundaries; at most 31 primary-key reads | savings changed mid-history show today's savings for an old cycle |
| `POST /budget/cycles/{id}/leftover {choice}` accepts `SAVINGS`, `ROLLOVER` (money left) and `CARRY`, `TAKE` (overspent), as Plan 5 defines them. It first closes any cycle that ended before today (Plan 5's `closeEndedBefore`), then answers 409 `CYCLE_OPEN` or 409 `ALREADY_CHOSEN` itself, then calls Plan 5's `applyChoice`; a race that Plan 5 reports as 422 is re-read and mapped to `ALREADY_CHOSEN`. The service method is not `@Transactional`, so Plan 5's rolled-back transaction never poisons an outer one. A choice that does not fit the leftover's sign stays 422 `NOT_POSSIBLE`. JSON values are the Java constant names (`"ROLLOVER"`), as in Plan 1 | Spec 2.1 and API-CYC-04–07; Plan 5 owns the write path | none |
| The cycle summary endpoints live in `insights` under `/api/v1/budget/cycles`, not in `budget` | `budget` cannot depend on `goals` or `gamification` | none |
| The category drill-down groups merchants by lower-cased, trimmed name and shows up to 500 spends newest first; refunds appear as their own rows and lower the merchant's total, so totals match the Insights list | Spec 3.2 #4; Plan 3's category totals subtract refunds | a category with more than 500 spends in one cycle shows the newest 500 (totals stay right) |
| Order counts: `ORDERS` for `food_delivery` and `quick_commerce`, `PAYMENTS` for `upi_to_people` (the mockup's "3 payments"), none for the rest | Spec 2.8 names delivery and quick commerce; the mockup adds UPI to people | none |
| The Home "cycle just closed" card opens the summary. It shows while `justClosed` is present; for a zero leftover (nothing to choose) it hides once the summary has been opened (`kv` flag `cycle-summary-seen.<id>`) | One place to make the choice without adding a cycles list | a user who dismisses nothing sees the card for up to 7 days |
| The chart tokens (`chart.barThickness` 8, `chart.barEndRadius` 4, `chart.fill` = muted) go in a new `src/theme/chart.ts` | The dataviz mark spec needs a 4px data-end radius that `.claude/design.md`'s radii (8/12/16) do not have, and literals outside the theme fail review | none |
| New test IDs: API-INS-05 (forecast subscription term and early days), API-SUB-09 (detection on import commit and nightly), API-SUB-10 (a charge after cancelling asks again), API-CYC-08 (parallel choices), API-TDY-10 (`justClosed` on Home), APP-40 to APP-44 (app screens; Plan 3 owns APP-31, Plan 4 APP-32–33, Plan 5 APP-34–36 and Plan 8 APP-45–48). Rewording: API-TDY-01 (forecast arrives in Plan 7), API-INS-01 (the forecast formula with subscriptions), API-CYC-04 (`"ROLLOVER"`), API-SUB-05 (`"USING"`), API-SUB-06 (`"CANCELLED"`) | Every behaviour in this plan has an ID | none |

## File structure

```
server/src/main/resources/db/migration/
  V050__subscriptions.sql                                        Task 3
server/src/main/java/in/gullak/
  common/events/ImportCommitted.java                             Task 3
  common/insights/HomeForecast.java, JustClosed.java, HomeInsights.java, HomeInsightsSource.java   Task 7
  common/error/ErrorCode.java (append CYCLE_OPEN, ALREADY_CHOSEN)                                 Task 8
  common/log/Events.java (append SUBSCRIPTION_DETECTED, SUBSCRIPTION_ANSWERED)                    Task 3
  budget/CycleFigures.java, BudgetService.java (figures)                                          Task 5
  budget/TodayResponse.java, BudgetService.java (today)                                           Task 7
  ingestion/imports/CommitService.java (publish ImportCommitted)                                  Task 3
  insights/
    Forecast.java, ForecastInput.java, ForecastCalculator.java                                    Task 1
    SubscriptionPeriod.java, Charge.java, DetectedSubscription.java, MerchantKeys.java,
      SubscriptionDetector.java                                                                   Task 2
    ChargeRepository.java, SubscriptionUpsertRepository.java, SubscriptionService.java,
      ImportCommittedListener.java                                                                Task 3
    SubscriptionAnswer.java, SubscriptionState.java, Subscription.java, SubscriptionList.java,
      AnswerRequest.java, SubscriptionEntity.java, SubscriptionRepository.java,
      SubscriptionController.java (SubscriptionService edited)                                    Task 4
    SubscriptionLoad.java, CountKind.java, CategoryRow.java, CycleInsights.java,
      InsightsService.java, InsightsController.java (SubscriptionService edited)                 Task 5
    CategorySpend.java, MerchantTotal.java, CategoryInsights.java, CategorySpendRepository.java
      (InsightsService, InsightsController edited)                                                Task 6
    HomeInsightsService.java                                                                      Task 7
    TopCategory.java, BadgeEarned.java, CycleSummary.java, LeftoverRequest.java,
      CycleSummaryService.java, CycleSummaryController.java                                       Task 8
  jobs/SubscriptionScanJob.java                                                                   Task 3
server/src/test/java/in/gullak/
  insights/ForecastCalculatorTest.java                                                            Task 1
  insights/SubscriptionDetectorTest.java                                                          Task 2
  insights/SubscriptionDetectionApiTest.java, jobs/SubscriptionScanJobApiTest.java               Task 3
  insights/SubscriptionApiTest.java                                                               Task 4
  insights/CycleInsightsApiTest.java                                                              Task 5
  insights/CategoryInsightsApiTest.java                                                           Task 6
  budget/TodayInsightsApiTest.java                                                                Task 7
  insights/CycleSummaryApiTest.java                                                               Task 8
  security/InsightsIsolationApiTest.java, security/InsightsLogRedactionApiTest.java              Task 9
  support/ApiTest.java (istNoon, seedMerchantSpend, getJson)                                      Task 3
  rules/ArchitectureTest.java (allow-list: insights in Task 1, jobs → insights in Task 3)          Tasks 1, 3
app/
  app/(tabs)/insights.tsx (replaced)                                                              Task 11
  app/insights/category/[code].tsx                                                                Task 12
  app/cycle/[id].tsx                                                                              Task 13
  app/_layout.tsx (two Stack.Screen entries)                                                      Tasks 12, 13
  src/theme/chart.ts, src/theme/index.ts                                                          Task 10
  src/lib/dates.ts, dates.test.ts (formatMonthOf)                                                 Task 10
  src/lib/errors.ts, error-codes.ts (generated)                                                   Task 8
  src/features/insights/api.ts, keys.ts, hooks.ts, copy.ts, copy.test.ts, hooks.test.tsx         Task 10
  src/features/insights/components/value-bar.tsx, back-header.tsx, value-bar.test.tsx            Task 10
  src/features/insights/components/cycle-card.tsx, category-list.tsx, subscription-list.tsx,
    screens/insights-screen.tsx, insights-screen.test.tsx                                         Task 11
  src/features/insights/screens/category-screen.tsx, category-screen.test.tsx                    Task 12
  src/features/insights/screens/cycle-summary-screen.tsx, cycle-summary.test.tsx                 Task 13
  src/features/budget/api.ts (Today: forecast, justClosed)                                        Task 14
  src/features/home/forecast-note.tsx, just-closed-card.tsx, home-insights.test.tsx,
    hero.tsx, home-screen.tsx (edited)                                                            Task 14
README.md, docs/engineering-standards.md, docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md,
docs/superpowers/plans/README.md                                                                  Task 9
```

## Task overview

| # | Task | Owner | Test IDs | Red team |
|---|---|---|---|---|
| 1 | Forecast calculator | backend-engineer | API-INS-01 (maths), API-INS-05 (maths) | no |
| 2 | Subscription detector | backend-engineer | API-SUB-01–04 (rules) | no |
| 3 | Subscriptions table, detection on commit and nightly | backend-engineer | API-SUB-01–04, API-SUB-09, API-SUB-10 | yes |
| 4 | Subscriptions API: list, answer, Subscription slayer | backend-engineer | API-SUB-05–08 | yes |
| 5 | Cycle figures and `GET /insights/cycle` with the forecast | backend-engineer | API-INS-01, API-INS-02, API-INS-05, API-SUB-06 (forecast half) | yes |
| 6 | Category drill-down `GET /insights/category/{code}` | backend-engineer | API-INS-03, API-INS-04 | yes |
| 7 | Forecast and just-closed cycle on `GET /budget/today`; `offTrack` | backend-engineer | API-TDY-01 (forecast), API-TDY-10 | no |
| 8 | Cycle summary and the leftover choice | backend-engineer | API-CYC-01–08 | yes |
| 9 | Isolation and redaction sweep, docs and test-case edits | qa-engineer | API-X-01 (insights), LOG-05 (insights), SEC-01 (insights) | yes |
| 10 | App: insights client, hooks, copy, chart tokens | app-engineer | APP-01 (regression), APP-40 (copy) | no |
| 11 | App: Insights tab | app-engineer | APP-40, APP-41, ERR-13 (Insights), E2E-04 (Insights half) | no |
| 12 | App: category drill-down | app-engineer | APP-42, ERR-13 (drill-down) | no |
| 13 | App: cycle summary and leftover choice | app-engineer | APP-43, ERR-13 (summary) | yes |
| 14 | App: Home forecast line and just-closed card | app-engineer | APP-44, APP-11 (regression) | no |

---
## Server

### Task 1: Forecast calculator

**Owner:** backend-engineer. **Test IDs:** API-INS-01 (the maths half), API-INS-05 (the maths half: subscription term and early days). **Red team:** no (pure function, no I/O).

**Files:**
- Create: `server/src/main/java/in/gullak/insights/Forecast.java`, `ForecastInput.java`, `ForecastCalculator.java`
- Modify: `server/src/test/java/in/gullak/rules/ArchitectureTest.java` (allow-list entry for `insights`)
- Test: `server/src/test/java/in/gullak/insights/ForecastCalculatorTest.java`

**Interfaces:**
- Consumes: nothing (pure); Plan 3's `ALLOWED_FEATURE_DEPENDENCIES`.
- Produces (public, `in.gullak.insights`):
  - `record ForecastInput(LocalDate cycleStart, LocalDate cycleEnd, LocalDate through, long spendablePaise, long spentToDatePaise, long plannedSavingsPaise, long subscriptionChargesPaise, long subscriptionsDuePaise)`
  - `record Forecast(LocalDate cycleEnd, int daysElapsed, int cycleDays, long spentPaise, long spendablePaise, long spendPaise, long plannedSavingsPaise, long extraSavedPaise, long savePaise, boolean early, boolean offTrack)`; JSON: `{"cycleEnd":"2026-10-31","daysElapsed":23,"cycleDays":31,"spentPaise":984000,"spendablePaise":1500000,"spendPaise":1330000,"plannedSavingsPaise":2000000,"extraSavedPaise":170000,"savePaise":2170000,"early":false,"offTrack":false}`
  - `ForecastCalculator.compute(ForecastInput) : Forecast`, `ForecastCalculator.roundToHundred(long paise) : long`, `ForecastCalculator.EARLY_DAYS = 3`

- [ ] **Step 1: Write the failing test**

`server/src/test/java/in/gullak/insights/ForecastCalculatorTest.java`:

```java
package in.gullak.insights;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class ForecastCalculatorTest {
    static final LocalDate START = LocalDate.parse("2026-10-01");
    static final LocalDate END = LocalDate.parse("2026-10-31");
    static final long SPENDABLE = 1_500_000;
    static final long SAVINGS = 2_000_000;

    static ForecastInput input(String through, long spent, long charged, long due) {
        return new ForecastInput(START, END, LocalDate.parse(through), SPENDABLE, spent, SAVINGS, charged, due);
    }

    @Test
    void theSpecExampleDay() { // API-INS-01: ₹9,840 over 23 of 31 days → ₹13,300, save ₹21,700, ₹1,700 more
        Forecast f = ForecastCalculator.compute(input("2026-10-23", 984_000, 0, 0));
        assertThat(f.daysElapsed()).isEqualTo(23);
        assertThat(f.cycleDays()).isEqualTo(31);
        assertThat(f.spendPaise()).isEqualTo(1_330_000L);
        assertThat(f.extraSavedPaise()).isEqualTo(170_000L);
        assertThat(f.savePaise()).isEqualTo(2_170_000L);
        assertThat(f.spentPaise()).isEqualTo(984_000L);
        assertThat(f.spendablePaise()).isEqualTo(SPENDABLE);
        assertThat(f.plannedSavingsPaise()).isEqualTo(SAVINGS);
        assertThat(f.cycleEnd()).isEqualTo(END);
        assertThat(f.early()).isFalse();
        assertThat(f.offTrack()).isFalse();
    }

    @Test
    void overspendingPaceIsOffTrack() { // ₹12,000 by day 20 → ₹18,600, ₹3,600 short
        Forecast f = ForecastCalculator.compute(input("2026-10-20", 1_200_000, 0, 0));
        assertThat(f.spendPaise()).isEqualTo(1_860_000L);
        assertThat(f.extraSavedPaise()).isEqualTo(-360_000L);
        assertThat(f.savePaise()).isEqualTo(1_640_000L);
        assertThat(f.offTrack()).isTrue();
    }

    @Test
    void subscriptionChargesAreTakenOutOfThePaceAndAddedOnce() { // API-INS-05
        // ₹9,840 spent includes Netflix ₹649: (9,840 − 649) × 31 ÷ 23 = 12,387.86 → + 649 = 13,036.86 → ₹13,000
        Forecast f = ForecastCalculator.compute(input("2026-10-23", 984_000, 64_900, 0));
        assertThat(f.spendPaise()).isEqualTo(1_300_000L);
        assertThat(f.extraSavedPaise()).isEqualTo(200_000L);
    }

    @Test
    void aSubscriptionDueBeforeCycleEndIsAdded() { // API-INS-05: Spotify ₹119 due 29 Oct → ₹13,155.86 → ₹13,200
        Forecast f = ForecastCalculator.compute(input("2026-10-23", 984_000, 64_900, 11_900));
        assertThat(f.spendPaise()).isEqualTo(1_320_000L);
    }

    @Test
    void theFirstTwoDaysAreEarly() { // Review Focus: day 1 and 2 never off track
        Forecast day1 = ForecastCalculator.compute(input("2026-10-01", 50_000, 0, 0));
        assertThat(day1.early()).isTrue();
        assertThat(day1.spendPaise()).isEqualTo(1_550_000L);
        assertThat(day1.offTrack()).isFalse();
        assertThat(ForecastCalculator.compute(input("2026-10-02", 100_000, 0, 0)).early()).isTrue();
        Forecast day3 = ForecastCalculator.compute(input("2026-10-03", 150_000, 0, 0));
        assertThat(day3.early()).isFalse();
        assertThat(day3.offTrack()).isTrue();
    }

    @Test
    void onTheLastDayTheForecastIsWhatWasSpent() {
        Forecast f = ForecastCalculator.compute(input("2026-10-31", 1_330_000, 64_900, 0));
        assertThat(f.spendPaise()).isEqualTo(1_330_000L);
        assertThat(f.extraSavedPaise()).isEqualTo(170_000L);
    }

    @Test
    void refundsBiggerThanSpendsNeverMakeANegativePace() {
        Forecast f = ForecastCalculator.compute(input("2026-10-10", -5_000, 0, 0));
        assertThat(f.spendPaise()).isZero();
        assertThat(f.extraSavedPaise()).isEqualTo(SPENDABLE);
        Forecast g = ForecastCalculator.compute(input("2026-10-10", 30_000, 64_900, 0));
        assertThat(g.spendPaise()).isEqualTo(60_000L); // pace 0 + the ₹649 charge → ₹649 → ₹600
    }

    @Test
    void throughBeforeTheStartCountsNoDays() {
        Forecast f = ForecastCalculator.compute(input("2026-09-30", 0, 0, 11_900));
        assertThat(f.daysElapsed()).isZero();
        assertThat(f.early()).isTrue();
        assertThat(f.spendPaise()).isEqualTo(10_000L);
    }

    @Test
    void roundsToTheNearestHundredRupeesHalfUp() {
        assertThat(ForecastCalculator.roundToHundred(4_999)).isZero();
        assertThat(ForecastCalculator.roundToHundred(5_000)).isEqualTo(10_000L);
        assertThat(ForecastCalculator.roundToHundred(1_326_260)).isEqualTo(1_330_000L);
        assertThat(ForecastCalculator.roundToHundred(0)).isZero();
    }

    @Test
    void aBigPaceDoesNotOverflow() {
        Forecast f = ForecastCalculator.compute(new ForecastInput(START, END, LocalDate.parse("2026-10-01"),
            SPENDABLE, 999_999_900L * 1_000, SAVINGS, 0, 0));
        assertThat(f.spendPaise()).isPositive();
    }
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.ForecastCalculatorTest'`
Expected: FAIL, compilation errors (`ForecastInput`, `Forecast`, `ForecastCalculator` do not exist).

- [ ] **Step 3: Write the code**

`server/src/main/java/in/gullak/insights/ForecastInput.java`:

```java
package in.gullak.insights;

import java.time.LocalDate;

/**
 * Everything the forecast needs, in paise. {@code through} is the last day counted (today, or the cycle's last
 * day); {@code spentToDatePaise} is what the budget counts as spent from the cycle start through that day;
 * {@code subscriptionChargesPaise} is the part of it that live subscriptions charged; {@code subscriptionsDuePaise}
 * is what live, not-cancelled subscriptions are expected to charge after {@code through} and by the cycle end.
 */
public record ForecastInput(
    LocalDate cycleStart,
    LocalDate cycleEnd,
    LocalDate through,
    long spendablePaise,
    long spentToDatePaise,
    long plannedSavingsPaise,
    long subscriptionChargesPaise,
    long subscriptionsDuePaise) {}
```

`server/src/main/java/in/gullak/insights/Forecast.java`:

```java
package in.gullak.insights;

import java.time.LocalDate;

/**
 * The month-end forecast (spec 2.7, 2.8). {@code spendPaise} is rounded to ₹100; {@code extraSavedPaise} is
 * spendable minus that (negative when short); {@code savePaise} is planned savings plus extra. {@code early} is
 * true on the first two days of a cycle, when the pace is noise; {@code offTrack} compares the unrounded forecast
 * with spendable and is never true while early.
 */
public record Forecast(
    LocalDate cycleEnd,
    int daysElapsed,
    int cycleDays,
    long spentPaise,
    long spendablePaise,
    long spendPaise,
    long plannedSavingsPaise,
    long extraSavedPaise,
    long savePaise,
    boolean early,
    boolean offTrack) {}
```

`server/src/main/java/in/gullak/insights/ForecastCalculator.java`:

```java
package in.gullak.insights;

import java.math.BigInteger;
import java.time.temporal.ChronoUnit;

/**
 * Spec 2.7: forecast cycle spend = spent to date ÷ days elapsed × cycle days. Subscription charges are taken out
 * of the pace and added back once, and live subscriptions still due this cycle are added, so a monthly charge is
 * never multiplied and "Cancelled" removes the expected charge (spec 2.8).
 */
public final class ForecastCalculator {
    /** The forecast is shown and can make a user off track from the third day of a cycle. */
    public static final int EARLY_DAYS = 3;
    private static final long HUNDRED_RUPEES = 10_000;

    private ForecastCalculator() {}

    public static Forecast compute(ForecastInput in) {
        int cycleDays = (int) ChronoUnit.DAYS.between(in.cycleStart(), in.cycleEnd()) + 1;
        int elapsed = in.through().isBefore(in.cycleStart())
            ? 0
            : (int) ChronoUnit.DAYS.between(in.cycleStart(), in.through()) + 1;
        long charged = Math.max(0, in.subscriptionChargesPaise());
        long pace = Math.max(0, in.spentToDatePaise() - charged);
        long projected = elapsed == 0 ? 0 : scale(pace, cycleDays, elapsed);
        long exact = projected + charged + Math.max(0, in.subscriptionsDuePaise());
        long spend = roundToHundred(exact);
        long extra = in.spendablePaise() - spend;
        boolean early = elapsed < EARLY_DAYS;
        return new Forecast(in.cycleEnd(), elapsed, cycleDays, in.spentToDatePaise(), in.spendablePaise(), spend,
            in.plannedSavingsPaise(), extra, in.plannedSavingsPaise() + extra, early, !early && exact > in.spendablePaise());
    }

    /** Nearest ₹100, half up; only for display figures. */
    public static long roundToHundred(long paise) {
        return Math.floorDiv(paise + HUNDRED_RUPEES / 2, HUNDRED_RUPEES) * HUNDRED_RUPEES;
    }

    /** pace × cycleDays ÷ elapsed, floored, without overflowing for absurd inputs. */
    private static long scale(long pace, int cycleDays, int elapsed) {
        BigInteger v = BigInteger.valueOf(pace).multiply(BigInteger.valueOf(cycleDays)).divide(BigInteger.valueOf(elapsed));
        return v.bitLength() < 63 ? v.longValue() : Long.MAX_VALUE / 2;
    }
}
```

`BigInteger` here is an overflow guard on a count, not money arithmetic in floating point; the result is floored exactly like `long` division.

- [ ] **Step 4: Allow the new package**

Plan 3's `featuresDependOnlyOnAllowedFeatures` fails for any class in a top-level package without an allow-list entry, so `insights` gets its entry now. In `server/src/test/java/in/gullak/rules/ArchitectureTest.java`: if `ALLOWED_FEATURE_DEPENDENCIES` is built with `Map.of(...)`, it is at its 10-pair limit once Plans 5 and 6 added `goals`, `jobs` and `report`, so first change `Map.of(` to `Map.ofEntries(` and wrap each existing pair `"x", Set.of(...)` as `Map.entry("x", Set.of(...))`, keeping every existing set exactly as it is. Then add:

```java
        Map.entry("insights", Set.of("common", "budget", "ingestion", "gamification", "goals")),
```

The resulting map, for the entries Plan 3 wrote, reads (later plans' entries keep their own sets between them):

```java
    static final Map<String, Set<String>> ALLOWED_FEATURE_DEPENDENCIES = Map.ofEntries(
        Map.entry("common", Set.of()),
        Map.entry("auth", Set.of("common")),
        Map.entry("profile", Set.of("common")),
        Map.entry("content", Set.of("common", "profile")),
        Map.entry("budget", Set.of("common", "profile", "content")),
        Map.entry("gamification", Set.of("common")),
        Map.entry("ingestion", Set.of("common", "gamification")),
        Map.entry("insights", Set.of("common", "budget", "ingestion", "gamification", "goals")));
```

- [ ] **Step 5: Run it to see it pass**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.ForecastCalculatorTest' --tests 'in.gullak.rules.*'`
Expected: PASS (10 forecast tests and the rules).

- [ ] **Step 6: Commit**

```bash
git add server/src/main/java/in/gullak/insights server/src/test/java/in/gullak/insights server/src/test/java/in/gullak/rules/ArchitectureTest.java
git commit -m "feat(insights): forecast calculator with subscriptions out of the pace and early days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Subscription detector

**Owner:** backend-engineer. **Test IDs:** API-SUB-01, 02, 03, 04 (the rule half; the API half is Task 3). **Red team:** no (pure function).

**Files:**
- Create: `server/src/main/java/in/gullak/insights/SubscriptionPeriod.java`, `Charge.java`, `DetectedSubscription.java`, `MerchantKeys.java`, `SubscriptionDetector.java`
- Test: `server/src/test/java/in/gullak/insights/SubscriptionDetectorTest.java`

**Interfaces:**
- Consumes: nothing.
- Produces (public, `in.gullak.insights`):
  - `enum SubscriptionPeriod { MONTHLY, YEARLY }` with `next(LocalDate lastCharge) : LocalDate`, `fits(long days) : boolean`, `liveUntil(LocalDate lastSeen) : LocalDate` (next charge + 10 days)
  - `record Charge(String merchantName, LocalDate date, long amountPaise)` with `key()`
  - `record DetectedSubscription(String merchantKey, String merchantName, SubscriptionPeriod period, long amountPaise, LocalDate firstSeen, LocalDate lastSeen)`
  - `MerchantKeys.key(String name) : String` (null for null or blank)
  - `SubscriptionDetector.detect(List<Charge>) : List<DetectedSubscription>`, `SubscriptionDetector.sameAmount(long a, long b) : boolean`

- [ ] **Step 1: Write the failing test**

`server/src/test/java/in/gullak/insights/SubscriptionDetectorTest.java`:

```java
package in.gullak.insights;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class SubscriptionDetectorTest {
    static Charge c(String merchant, String date, long paise) {
        return new Charge(merchant, LocalDate.parse(date), paise);
    }

    @Test
    void monthlyNetflix() { // API-SUB-01: ₹649 on 3 Sep and 3 Oct
        List<DetectedSubscription> found = SubscriptionDetector.detect(List.of(
            c("Netflix", "2026-09-03", 64_900), c("Netflix", "2026-10-03", 64_900)));
        assertThat(found).containsExactly(new DetectedSubscription("netflix", "Netflix", SubscriptionPeriod.MONTHLY,
            64_900, LocalDate.parse("2026-09-03"), LocalDate.parse("2026-10-03")));
    }

    @Test
    void tenDaysApartIsNotASubscription() { // API-SUB-02
        assertThat(SubscriptionDetector.detect(List.of(c("Zepto", "2026-10-01", 64_900), c("Zepto", "2026-10-11", 64_900))))
            .isEmpty();
    }

    @Test
    void sevenPercentDriftIsNotTheSameAmount() { // API-SUB-03: ₹649 then ₹699
        assertThat(SubscriptionDetector.detect(List.of(c("Netflix", "2026-09-03", 64_900), c("Netflix", "2026-10-03", 69_900))))
            .isEmpty();
    }

    @Test
    void twoPercentIsTheEdge() {
        assertThat(SubscriptionDetector.sameAmount(10_000, 10_200)).isTrue();
        assertThat(SubscriptionDetector.sameAmount(10_200, 10_000)).isTrue();
        assertThat(SubscriptionDetector.sameAmount(10_000, 10_205)).isFalse();
    }

    @Test
    void yearly() { // API-SUB-04: 365 days apart
        List<DetectedSubscription> found = SubscriptionDetector.detect(List.of(
            c("Amazon Prime", "2025-10-03", 149_900), c("Amazon Prime", "2026-10-03", 149_900)));
        assertThat(found).hasSize(1);
        assertThat(found.getFirst().period()).isEqualTo(SubscriptionPeriod.YEARLY);
    }

    @Test
    void gapEdges() {
        assertThat(SubscriptionPeriod.MONTHLY.fits(24)).isFalse();
        assertThat(SubscriptionPeriod.MONTHLY.fits(25)).isTrue();
        assertThat(SubscriptionPeriod.MONTHLY.fits(35)).isTrue();
        assertThat(SubscriptionPeriod.MONTHLY.fits(36)).isFalse();
        assertThat(SubscriptionPeriod.YEARLY.fits(359)).isFalse();
        assertThat(SubscriptionPeriod.YEARLY.fits(360)).isTrue();
        assertThat(SubscriptionPeriod.YEARLY.fits(370)).isTrue();
        assertThat(SubscriptionPeriod.YEARLY.fits(371)).isFalse();
    }

    @Test
    void merchantNamesMatchIgnoringCaseAndSpaces() { // Review Focus
        List<DetectedSubscription> found = SubscriptionDetector.detect(List.of(
            c(" netflix ", "2026-09-03", 64_900), c("NETFLIX", "2026-10-03", 64_900)));
        assertThat(found).hasSize(1);
        assertThat(found.getFirst().merchantKey()).isEqualTo("netflix");
        assertThat(found.getFirst().merchantName()).isEqualTo("NETFLIX"); // the latest charge's spelling
        assertThat(MerchantKeys.key("  Third   Wave  ")).isEqualTo("third wave");
        assertThat(MerchantKeys.key("   ")).isNull();
        assertThat(MerchantKeys.key(null)).isNull();
    }

    @Test
    void monthlyWinsWhenBothFitAndUsesTheLatestPrice() {
        List<DetectedSubscription> found = SubscriptionDetector.detect(List.of(
            c("Spotify", "2025-10-05", 11_900), c("Spotify", "2026-08-05", 11_900),
            c("Spotify", "2026-09-05", 11_900), c("Spotify", "2026-10-05", 11_900)));
        assertThat(found).hasSize(1);
        assertThat(found.getFirst().period()).isEqualTo(SubscriptionPeriod.MONTHLY);
        assertThat(found.getFirst().firstSeen()).isEqualTo(LocalDate.parse("2025-10-05"));
        assertThat(found.getFirst().lastSeen()).isEqualTo(LocalDate.parse("2026-10-05"));
    }

    @Test
    void aPriceRiseStartsFromTheNewPrice() {
        List<DetectedSubscription> found = SubscriptionDetector.detect(List.of(
            c("Netflix", "2026-07-03", 49_900), c("Netflix", "2026-08-03", 49_900),
            c("Netflix", "2026-09-03", 64_900), c("Netflix", "2026-10-03", 64_900)));
        assertThat(found).hasSize(1);
        assertThat(found.getFirst().amountPaise()).isEqualTo(64_900L);
        assertThat(found.getFirst().firstSeen()).isEqualTo(LocalDate.parse("2026-09-03"));
    }

    @Test
    void aOneOffAfterTheLastSubscriptionChargeKeepsTheSubscription() {
        List<DetectedSubscription> found = SubscriptionDetector.detect(List.of(
            c("Amazon", "2026-09-10", 29_900), c("Amazon", "2026-10-10", 29_900), c("Amazon", "2026-10-15", 1_25_000)));
        assertThat(found).hasSize(1);
        assertThat(found.getFirst().amountPaise()).isEqualTo(29_900L);
        assertThat(found.getFirst().lastSeen()).isEqualTo(LocalDate.parse("2026-10-10"));
    }

    @Test
    void merchantsAreSeparateAndBlankNamesAreIgnored() {
        List<DetectedSubscription> found = SubscriptionDetector.detect(List.of(
            c("Netflix", "2026-09-03", 64_900), c("Hotstar", "2026-10-03", 64_900),
            c(null, "2026-09-01", 50_000), c("", "2026-10-01", 50_000)));
        assertThat(found).isEmpty();
    }

    @Test
    void nextChargeAndLiveWindow() {
        assertThat(SubscriptionPeriod.MONTHLY.next(LocalDate.parse("2026-01-31"))).isEqualTo(LocalDate.parse("2026-02-28"));
        assertThat(SubscriptionPeriod.YEARLY.next(LocalDate.parse("2025-10-03"))).isEqualTo(LocalDate.parse("2026-10-03"));
        assertThat(SubscriptionPeriod.MONTHLY.liveUntil(LocalDate.parse("2026-10-03"))).isEqualTo(LocalDate.parse("2026-11-13"));
    }
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.SubscriptionDetectorTest'`
Expected: FAIL, compilation errors (`Charge`, `SubscriptionDetector` and the rest do not exist).

- [ ] **Step 3: Write the code**

`server/src/main/java/in/gullak/insights/SubscriptionPeriod.java`:

```java
package in.gullak.insights;

import java.time.LocalDate;

/** Spec 2.8: 25 to 35 days apart is monthly, 360 to 370 is yearly. */
public enum SubscriptionPeriod {
    MONTHLY(25, 35),
    YEARLY(360, 370);

    /** A subscription stays listed until this many days after its next expected charge. */
    static final int GRACE_DAYS = 10;

    private final int minDays;
    private final int maxDays;

    SubscriptionPeriod(int minDays, int maxDays) {
        this.minDays = minDays;
        this.maxDays = maxDays;
    }

    public boolean fits(long days) {
        return days >= minDays && days <= maxDays;
    }

    public LocalDate next(LocalDate lastCharge) {
        return this == MONTHLY ? lastCharge.plusMonths(1) : lastCharge.plusYears(1);
    }

    public LocalDate liveUntil(LocalDate lastSeen) {
        return next(lastSeen).plusDays(GRACE_DAYS);
    }
}
```

`server/src/main/java/in/gullak/insights/MerchantKeys.java`:

```java
package in.gullak.insights;

import java.util.Locale;

/** One merchant whatever the spelling: lower case, trimmed, inner runs of spaces collapsed. */
public final class MerchantKeys {
    private MerchantKeys() {}

    public static String key(String name) {
        if (name == null) {
            return null;
        }
        String k = name.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        return k.isEmpty() ? null : k;
    }
}
```

`server/src/main/java/in/gullak/insights/Charge.java`:

```java
package in.gullak.insights;

import java.time.LocalDate;

/** One debit that counts in the budget, as detection sees it. {@code date} is the IST day. */
public record Charge(String merchantName, LocalDate date, long amountPaise) {
    public String key() {
        return MerchantKeys.key(merchantName);
    }
}
```

`server/src/main/java/in/gullak/insights/DetectedSubscription.java`:

```java
package in.gullak.insights;

import java.time.LocalDate;

public record DetectedSubscription(
    String merchantKey,
    String merchantName,
    SubscriptionPeriod period,
    long amountPaise,
    LocalDate firstSeen,
    LocalDate lastSeen) {}
```

`server/src/main/java/in/gullak/insights/SubscriptionDetector.java`:

```java
package in.gullak.insights;

import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Spec 2.8: a merchant with the same amount (within 2%) two or more times, 25 to 35 days apart (monthly) or
 * 360 to 370 (yearly). Per merchant, the latest charge that pairs with an earlier one sets the amount and last
 * seen; first seen is the earliest charge within 2% of that amount. Monthly wins when both periods fit.
 */
public final class SubscriptionDetector {
    private SubscriptionDetector() {}

    /** |a − b| is at most 2% of the larger amount. */
    public static boolean sameAmount(long a, long b) {
        return Math.abs(a - b) * 100 <= 2 * Math.max(a, b);
    }

    public static List<DetectedSubscription> detect(List<Charge> charges) {
        Map<String, List<Charge>> byMerchant = new LinkedHashMap<>();
        for (Charge c : charges) {
            String key = c.key();
            if (key != null && c.amountPaise() > 0) {
                byMerchant.computeIfAbsent(key, k -> new ArrayList<>()).add(c);
            }
        }
        List<DetectedSubscription> found = new ArrayList<>();
        for (Map.Entry<String, List<Charge>> e : byMerchant.entrySet()) {
            List<Charge> sorted = e.getValue().stream()
                .sorted(Comparator.comparing(Charge::date).thenComparingLong(Charge::amountPaise)).toList();
            Optional<DetectedSubscription> monthly = latestPair(e.getKey(), sorted, SubscriptionPeriod.MONTHLY);
            if (monthly.isPresent()) {
                found.add(monthly.get());
            } else {
                latestPair(e.getKey(), sorted, SubscriptionPeriod.YEARLY).ifPresent(found::add);
            }
        }
        return found;
    }

    private static Optional<DetectedSubscription> latestPair(String key, List<Charge> sorted, SubscriptionPeriod period) {
        for (int j = sorted.size() - 1; j > 0; j--) {
            Charge later = sorted.get(j);
            for (int i = j - 1; i >= 0; i--) {
                Charge earlier = sorted.get(i);
                long days = ChronoUnit.DAYS.between(earlier.date(), later.date());
                if (period.fits(days) && sameAmount(earlier.amountPaise(), later.amountPaise())) {
                    Charge first = sorted.stream()
                        .filter(c -> sameAmount(c.amountPaise(), later.amountPaise()))
                        .findFirst().orElse(earlier);
                    return Optional.of(new DetectedSubscription(key, later.merchantName().strip(), period,
                        later.amountPaise(), first.date(), later.date()));
                }
            }
        }
        return Optional.empty();
    }
}
```

`aPriceRiseStartsFromTheNewPrice` passes because `first` is the earliest charge within 2% of ₹649, which is 3 Sep (the ₹499 months do not qualify).

- [ ] **Step 4: Run it to see it pass**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.SubscriptionDetectorTest'`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/in/gullak/insights server/src/test/java/in/gullak/insights
git commit -m "feat(insights): subscription detector (2%, 25-35 and 360-370 days, one merchant per spelling)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Subscriptions table, detection after an import commits and every night

**Owner:** backend-engineer. **Test IDs:** API-SUB-01, 02, 03, 04 (over the database), API-SUB-09 (new: detection runs after an import commits and in the nightly job), API-SUB-10 (new: a charge after cancelling asks again). **Red team:** yes (another user's charges leaking into a subscription; a rolled-back import triggering detection; merchant names in logs).

**Files:**
- Create: `server/src/main/resources/db/migration/V050__subscriptions.sql`
- Create: `server/src/main/java/in/gullak/common/events/ImportCommitted.java`
- Create: `server/src/main/java/in/gullak/insights/ChargeRepository.java`, `SubscriptionUpsertRepository.java`, `SubscriptionService.java`, `ImportCommittedListener.java`
- Create: `server/src/main/java/in/gullak/jobs/SubscriptionScanJob.java`
- Modify: `server/src/main/java/in/gullak/common/log/Events.java` (append two constants), `server/src/main/java/in/gullak/ingestion/imports/CommitService.java` (publish the event), `server/src/test/java/in/gullak/support/ApiTest.java` (helpers), `server/src/test/java/in/gullak/rules/ArchitectureTest.java` (`jobs` may use `insights`)
- Test: `server/src/test/java/in/gullak/insights/SubscriptionDetectionApiTest.java`, `server/src/test/java/in/gullak/jobs/SubscriptionScanJobApiTest.java`

**Interfaces:**
- Consumes: Task 2's `SubscriptionDetector`, `Charge`, `DetectedSubscription`; Plan 6's `JobRunner.run(String job, String runKey, Supplier<List<UUID>> units, Consumer<UUID> work) : JobResult` and `seedCategorySpend`; Plan 4's `CommitService` commit method; Plan 1's `Ist`, `Db`, `Events`.
- Produces:
  - table `subscriptions (id, user_id, merchant_key, merchant_name, amount_paise, period, first_seen, last_seen, answer, answered_at, asked_cycle_id, created_at, updated_at)`, unique `(user_id, merchant_key, period)`
  - `in.gullak.common.events.ImportCommitted(UUID userId, UUID importId)` (Plan 4 publishes it inside the commit transaction)
  - `SubscriptionService.detect(UUID userId) : int` (idempotent upsert of what the detector finds), `SubscriptionService.usersToScan(Instant since) : List<UUID>`
  - `ChargeRepository.debits(UUID, Instant fromInclusive, Instant toExclusive) : List<Charge>` (package-private; Task 5 reuses it)
  - job `subscription-scan` at 02:30 IST (`SubscriptionScanJob.runFor(LocalDate)`)
  - events `Events.SUBSCRIPTION_DETECTED` (`subscription.detected`), `Events.SUBSCRIPTION_ANSWERED` (`subscription.answered`)
  - test helpers in `ApiTest`: `istNoon(String date) : Instant`, `seedMerchantSpend(TestUser, long paise, String date, String category, String merchant) : UUID`, `getJson(TestUser, String path) : String`

- [ ] **Step 1: Write the failing tests**

Add these helpers to `server/src/test/java/in/gullak/support/ApiTest.java` (imports `in.gullak.common.time.Ist`, `java.time.LocalDate`, `static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get`):

```java
    /** 12:00 IST on the given day, so a seeded spend sits in the middle of its IST day. */
    protected static Instant istNoon(String date) {
        return LocalDate.parse(date).atTime(12, 0).atZone(Ist.ZONE).toInstant();
    }

    /** Plan 6's seedCategorySpend at noon IST on {@code date}. */
    protected UUID seedMerchantSpend(TestUser user, long paise, String date, String category, String merchant) {
        return seedCategorySpend(user, paise, istNoon(date), category, merchant);
    }

    protected String getJson(TestUser user, String path) throws Exception {
        return mvc.perform(get(path).with(auth(user)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
    }
```

`server/src/test/java/in/gullak/insights/SubscriptionDetectionApiTest.java`:

```java
package in.gullak.insights;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.common.events.ImportCommitted;
import in.gullak.common.time.Ist;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class SubscriptionDetectionApiTest extends ApiTest {
    @Autowired SubscriptionService subscriptions;
    @Autowired ApplicationEventPublisher events;
    @Autowired PlatformTransactionManager txm;

    List<Map<String, Object>> rows(TestUser u) {
        return jdbc.sql("""
                select merchant_key, merchant_name, amount_paise, period, first_seen, last_seen, answer
                from subscriptions where user_id = ? order by merchant_key, period
                """).param(u.id()).query().listOfRows();
    }

    @Test
    void detectsMonthlyNetflix() throws Exception { // API-SUB-01
        TestUser u = exampleUser();
        seedMerchantSpend(u, 64_900, "2026-09-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 64_900, "2026-10-03", "subscriptions", "Netflix");
        assertThat(subscriptions.detect(u.id())).isEqualTo(1);
        List<Map<String, Object>> r = rows(u);
        assertThat(r).hasSize(1);
        assertThat(r.getFirst()).containsEntry("merchant_key", "netflix").containsEntry("merchant_name", "Netflix")
            .containsEntry("amount_paise", 64_900L).containsEntry("period", "MONTHLY");
        assertThat(r.getFirst().get("first_seen").toString()).isEqualTo("2026-09-03");
        assertThat(r.getFirst().get("last_seen").toString()).isEqualTo("2026-10-03");
        assertThat(r.getFirst().get("answer")).isNull();
    }

    @Test
    void tenDaysApartIsNotOne() throws Exception { // API-SUB-02
        TestUser u = exampleUser();
        seedMerchantSpend(u, 64_900, "2026-10-01", "shopping", "Myntra");
        seedMerchantSpend(u, 64_900, "2026-10-11", "shopping", "Myntra");
        assertThat(subscriptions.detect(u.id())).isZero();
        assertThat(rows(u)).isEmpty();
    }

    @Test
    void amountDriftIsNotOne() throws Exception { // API-SUB-03
        TestUser u = exampleUser();
        seedMerchantSpend(u, 64_900, "2026-09-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 69_900, "2026-10-03", "subscriptions", "Netflix");
        assertThat(subscriptions.detect(u.id())).isZero();
    }

    @Test
    void detectsYearly() throws Exception { // API-SUB-04
        TestUser u = exampleUser();
        seedMerchantSpend(u, 149_900, "2025-10-03", "subscriptions", "Amazon Prime");
        seedMerchantSpend(u, 149_900, "2026-10-03", "subscriptions", "Amazon Prime");
        subscriptions.detect(u.id());
        assertThat(rows(u)).singleElement().satisfies(r -> assertThat(r).containsEntry("period", "YEARLY"));
    }

    @Test
    void runningTwiceKeepsOneRow() throws Exception {
        TestUser u = exampleUser();
        seedMerchantSpend(u, 64_900, "2026-09-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 64_900, "2026-10-03", "subscriptions", "Netflix");
        subscriptions.detect(u.id());
        subscriptions.detect(u.id());
        assertThat(rows(u)).hasSize(1);
    }

    @Test
    void personalUpiDeletedAndLinkedHalvesAreIgnored() throws Exception {
        TestUser u = exampleUser();
        seedMerchantSpend(u, 500_000, "2026-09-05", "upi_to_people", "priya.s");
        seedMerchantSpend(u, 500_000, "2026-10-05", "upi_to_people", "priya.s");
        UUID gone = seedMerchantSpend(u, 11_900, "2026-09-05", "subscriptions", "Spotify");
        seedMerchantSpend(u, 11_900, "2026-10-05", "subscriptions", "Spotify");
        jdbc.sql("update transactions set deleted_at = now() where id = ?").param(gone).update();
        UUID linked = seedMerchantSpend(u, 29_900, "2026-09-07", "subscriptions", "YouTube");
        seedMerchantSpend(u, 29_900, "2026-10-07", "subscriptions", "YouTube");
        jdbc.sql("update transactions set counts_in_budget = false where id = ?").param(linked).update();
        assertThat(subscriptions.detect(u.id())).isZero();
    }

    @Test
    void otherUsersChargesNeverMix() throws Exception {
        TestUser a = exampleUser();
        TestUser b = exampleUser();
        seedMerchantSpend(a, 64_900, "2026-09-03", "subscriptions", "Netflix");
        seedMerchantSpend(b, 64_900, "2026-10-03", "subscriptions", "Netflix");
        assertThat(subscriptions.detect(a.id())).isZero();
        assertThat(subscriptions.detect(b.id())).isZero();
    }

    @Test
    void aChargeAfterCancellingAsksAgain() throws Exception { // API-SUB-10, Review Focus
        TestUser u = exampleUser();
        seedMerchantSpend(u, 64_900, "2026-09-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 64_900, "2026-10-03", "subscriptions", "Netflix");
        subscriptions.detect(u.id());
        jdbc.sql("update subscriptions set answer = 'CANCELLED', answered_at = ? where user_id = ?")
            .params(java.time.OffsetDateTime.parse("2026-10-20T10:00:00Z"), u.id()).update();
        subscriptions.detect(u.id()); // nothing new: stays cancelled
        assertThat(rows(u).getFirst().get("answer")).isEqualTo("CANCELLED");
        seedMerchantSpend(u, 64_900, "2026-11-03", "subscriptions", "Netflix");
        clock.set(Instant.parse("2026-11-04T04:00:00Z"));
        subscriptions.detect(u.id());
        assertThat(rows(u).getFirst().get("answer")).isNull();
        assertThat(rows(u).getFirst().get("last_seen").toString()).isEqualTo("2026-11-03");
    }

    @Test
    void anOlderChargeFoundLaterDoesNotUndoACancel() throws Exception {
        TestUser u = exampleUser();
        seedMerchantSpend(u, 64_900, "2026-08-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 64_900, "2026-09-03", "subscriptions", "Netflix");
        subscriptions.detect(u.id());
        jdbc.sql("update subscriptions set answer = 'CANCELLED', answered_at = ? where user_id = ?")
            .params(java.time.OffsetDateTime.parse("2026-10-20T10:00:00Z"), u.id()).update();
        seedMerchantSpend(u, 64_900, "2026-10-03", "subscriptions", "Netflix"); // charged before the cancel
        subscriptions.detect(u.id());
        assertThat(rows(u).getFirst().get("answer")).isEqualTo("CANCELLED");
        assertThat(rows(u).getFirst().get("last_seen").toString()).isEqualTo("2026-10-03");
    }

    @Test
    void detectionRunsAfterAnImportCommits() throws Exception { // API-SUB-09
        TestUser u = exampleUser();
        seedMerchantSpend(u, 64_900, "2026-09-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 64_900, "2026-10-03", "subscriptions", "Netflix");
        new TransactionTemplate(txm).executeWithoutResult(s -> events.publishEvent(new ImportCommitted(u.id(), UUID.randomUUID())));
        assertThat(rows(u)).hasSize(1);
    }

    @Test
    void aRolledBackImportDetectsNothing() throws Exception { // API-SUB-09
        TestUser u = exampleUser();
        seedMerchantSpend(u, 64_900, "2026-09-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 64_900, "2026-10-03", "subscriptions", "Netflix");
        new TransactionTemplate(txm).executeWithoutResult(s -> {
            events.publishEvent(new ImportCommitted(u.id(), UUID.randomUUID()));
            s.setRollbackOnly();
        });
        assertThat(rows(u)).isEmpty();
    }

    @Test
    void usersToScanAreThoseWithRecentSpends() throws Exception {
        TestUser recent = exampleUser();
        TestUser quiet = exampleUser();
        seedMerchantSpend(recent, 10_000, "2026-10-22", "eating_out", "Chai");
        seedMerchantSpend(quiet, 10_000, "2026-09-22", "eating_out", "Chai");
        List<UUID> users = subscriptions.usersToScan(Ist.startOf(LocalDate.parse("2026-10-21")));
        assertThat(users).contains(recent.id()).doesNotContain(quiet.id());
    }
}
```

`server/src/test/java/in/gullak/jobs/SubscriptionScanJobApiTest.java`:

```java
package in.gullak.jobs;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class SubscriptionScanJobApiTest extends ApiTest {
    @Autowired SubscriptionScanJob job;

    long subscriptionsOf(TestUser u) {
        return jdbc.sql("select count(*) from subscriptions where user_id = ?").param(u.id()).query(Long.class).single();
    }

    @Test
    void theNightlyScanFindsSubscriptionsForUsersWithRecentSpends() throws Exception { // API-SUB-09
        TestUser active = exampleUser();
        seedMerchantSpend(active, 11_900, "2026-09-22", "subscriptions", "Spotify");
        seedMerchantSpend(active, 11_900, "2026-10-22", "subscriptions", "Spotify");
        TestUser quiet = exampleUser();
        seedMerchantSpend(quiet, 11_900, "2026-08-10", "subscriptions", "Spotify");
        seedMerchantSpend(quiet, 11_900, "2026-09-10", "subscriptions", "Spotify");
        job.runFor(LocalDate.parse("2026-10-23"));
        assertThat(subscriptionsOf(active)).isEqualTo(1);
        assertThat(subscriptionsOf(quiet)).isZero(); // no spend in the last 2 days: left for its next commit or spend
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.SubscriptionDetectionApiTest' --tests 'in.gullak.jobs.SubscriptionScanJobApiTest'`
Expected: FAIL, compilation errors (`SubscriptionService`, `ImportCommitted`, `SubscriptionScanJob` do not exist).

- [ ] **Step 3: Migration and the event**

`server/src/main/resources/db/migration/V050__subscriptions.sql`:

```sql
-- Spec 2.8 and 4.5: repeating charges found in a user's spends. Detection upserts by (user, merchant, period);
-- the user's answer to "Still using?" lives on the same row. merchant_name is the clean display name copied from
-- transactions.merchant_name; raw statement text never reaches this table.
create table subscriptions (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    merchant_key varchar(80) not null,
    merchant_name varchar(80) not null,
    amount_paise bigint not null check (amount_paise > 0),
    period varchar(8) not null check (period in ('MONTHLY', 'YEARLY')),
    first_seen date not null,
    last_seen date not null check (last_seen >= first_seen),
    answer varchar(10) check (answer in ('USING', 'CANCELLED')),
    answered_at timestamptz,
    asked_cycle_id uuid references cycles (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, merchant_key, period)
);
create index subscriptions_user_idx on subscriptions (user_id);
```

`server/src/main/java/in/gullak/common/events/ImportCommitted.java`:

```java
package in.gullak.common.events;

import java.util.UUID;

/**
 * Published by the statement import (Plan 4) inside the commit transaction; heard after that transaction commits
 * by features that react to new transactions (subscription detection). Lives in common so ingestion never
 * depends on its listeners.
 */
public record ImportCommitted(UUID userId, UUID importId) {}
```

Append to `server/src/main/java/in/gullak/common/log/Events.java`, after the last constant:

```java
    public static final String SUBSCRIPTION_DETECTED = "subscription.detected";
    public static final String SUBSCRIPTION_ANSWERED = "subscription.answered";
```

- [ ] **Step 4: Detection**

`server/src/main/java/in/gullak/insights/ChargeRepository.java`:

```java
package in.gullak.insights;

import in.gullak.common.db.Db;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Debits that count in the budget, for subscription detection and the forecast's subscription term. Selects the
 * clean merchant_name only; merchant_raw_enc is never read here. Personal UPI payments are not subscriptions.
 */
@Repository
class ChargeRepository {
    private final JdbcClient jdbc;

    ChargeRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    List<Charge> debits(UUID userId, Instant fromInclusive, Instant toExclusive) {
        return jdbc.sql("""
                select merchant_name, (occurred_at at time zone 'Asia/Kolkata')::date as day, amount_paise
                from transactions
                where user_id = ? and direction = 'debit' and deleted_at is null and counts_in_budget
                  and merchant_name is not null and category_code <> 'upi_to_people'
                  and occurred_at >= ? and occurred_at < ?
                order by occurred_at, id
                """)
            .params(userId, Db.ts(fromInclusive), Db.ts(toExclusive))
            .query((rs, n) -> new Charge(rs.getString(1), rs.getObject(2, LocalDate.class), rs.getLong(3)))
            .list();
    }

    List<UUID> usersWithDebitsSince(Instant since) {
        return jdbc.sql("""
                select distinct user_id from transactions
                where direction = 'debit' and deleted_at is null and occurred_at >= ?
                """)
            .param(Db.ts(since))
            .query(UUID.class)
            .list();
    }
}
```

`server/src/main/java/in/gullak/insights/SubscriptionUpsertRepository.java`:

```java
package in.gullak.insights;

import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * One row per (user, merchant, period), written with on conflict so two detections at once never duplicate.
 * A charge dated after a "Cancelled" answer clears the answer: the subscription is back and asks again.
 */
@Repository
class SubscriptionUpsertRepository {
    private final JdbcClient jdbc;

    SubscriptionUpsertRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void upsert(UUID userId, DetectedSubscription d) {
        jdbc.sql("""
                insert into subscriptions (id, user_id, merchant_key, merchant_name, amount_paise, period, first_seen, last_seen)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                on conflict (user_id, merchant_key, period) do update set
                    merchant_name = excluded.merchant_name,
                    amount_paise = excluded.amount_paise,
                    first_seen = least(subscriptions.first_seen, excluded.first_seen),
                    last_seen = greatest(subscriptions.last_seen, excluded.last_seen),
                    answer = case
                        when subscriptions.answer = 'CANCELLED'
                             and excluded.last_seen > (subscriptions.answered_at at time zone 'Asia/Kolkata')::date
                        then null else subscriptions.answer end,
                    answered_at = case
                        when subscriptions.answer = 'CANCELLED'
                             and excluded.last_seen > (subscriptions.answered_at at time zone 'Asia/Kolkata')::date
                        then null else subscriptions.answered_at end,
                    updated_at = now()
                """)
            .params(UUID.randomUUID(), userId, d.merchantKey(), d.merchantName(), d.amountPaise(), d.period().name(),
                d.firstSeen(), d.lastSeen())
            .update();
    }
}
```

`server/src/main/java/in/gullak/insights/SubscriptionService.java`:

```java
package in.gullak.insights;

import in.gullak.common.log.Events;
import in.gullak.common.time.Ist;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Subscriptions (spec 2.8): detection here; listing and answers are added in Task 4. */
@Service
public class SubscriptionService {
    /** A yearly charge needs the same date last year plus the 370-day edge. */
    static final int LOOKBACK_DAYS = 400;
    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

    private final ChargeRepository charges;
    private final SubscriptionUpsertRepository upserts;
    private final Clock clock;

    SubscriptionService(ChargeRepository charges, SubscriptionUpsertRepository upserts, Clock clock) {
        this.charges = charges;
        this.upserts = upserts;
        this.clock = clock;
    }

    /** Finds the user's repeating charges and records them; idempotent. Returns how many it found. */
    @Transactional
    public int detect(UUID userId) {
        LocalDate today = Ist.today(clock);
        List<DetectedSubscription> found = SubscriptionDetector.detect(
            charges.debits(userId, Ist.startOf(today.minusDays(LOOKBACK_DAYS)), Ist.startOf(today.plusDays(2))));
        for (DetectedSubscription d : found) {
            upserts.upsert(userId, d);
        }
        if (!found.isEmpty()) {
            log.info("{} user={} count={}", Events.SUBSCRIPTION_DETECTED, userId, found.size());
        }
        return found.size();
    }

    /** Users with a debit on or after {@code since}: the nightly scan's units. */
    @Transactional(readOnly = true)
    public List<UUID> usersToScan(Instant since) {
        return charges.usersWithDebitsSince(since);
    }
}
```

`server/src/main/java/in/gullak/insights/ImportCommittedListener.java`:

```java
package in.gullak.insights;

import in.gullak.common.events.ImportCommitted;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Runs detection once an import's transaction has committed, in a transaction of its own, so a detection failure
 * can never undo the import (Spring logs a failure in an after-commit listener; the nightly scan retries it).
 * A rolled-back import never reaches here.
 */
@Component
class ImportCommittedListener {
    private final SubscriptionService subscriptions;

    ImportCommittedListener(SubscriptionService subscriptions) {
        this.subscriptions = subscriptions;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onCommitted(ImportCommitted event) {
        subscriptions.detect(event.userId());
    }
}
```

`server/src/main/java/in/gullak/jobs/SubscriptionScanJob.java`:

```java
package in.gullak.jobs;

import in.gullak.common.jobs.JobResult;
import in.gullak.common.jobs.JobRunner;
import in.gullak.common.time.Ist;
import in.gullak.insights.SubscriptionService;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 02:30 IST: subscription detection for everyone who spent in the last two days (hand-logged repeat charges). */
@Component
class SubscriptionScanJob {
    static final String NAME = "subscription-scan";

    private final JobRunner runner;
    private final SubscriptionService subscriptions;
    private final Clock clock;

    SubscriptionScanJob(JobRunner runner, SubscriptionService subscriptions, Clock clock) {
        this.runner = runner;
        this.subscriptions = subscriptions;
        this.clock = clock;
    }

    @Scheduled(cron = "0 30 2 * * *", zone = "Asia/Kolkata")
    public void scheduled() {
        runFor(Ist.today(clock));
    }

    JobResult runFor(LocalDate today) {
        Instant since = Ist.startOf(today.minusDays(2));
        return runner.run(NAME, today.toString(), () -> subscriptions.usersToScan(since), subscriptions::detect);
    }
}
```

- [ ] **Step 5: Publish from the import commit and allow the new package**

In Plan 4's `server/src/main/java/in/gullak/ingestion/imports/CommitService.java`, add the constructor parameter `ApplicationEventPublisher events` (import `org.springframework.context.ApplicationEventPublisher` and `in.gullak.common.events.ImportCommitted`), store it in a field, and in the public commit method, on the line after the import row's status becomes `committed` (the same transaction), add:

```java
        events.publishEvent(new ImportCommitted(userId, importId));
```

using that method's own user-id and import-id variables. Plan 4's `CommitApiTest` must still pass unchanged.

In `server/src/test/java/in/gullak/rules/ArchitectureTest.java`, add `"insights"` to the set of the `jobs` entry (Plan 6), keeping its other members, because `SubscriptionScanJob` lives in `jobs`.

- [ ] **Step 6: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.*' --tests 'in.gullak.jobs.SubscriptionScanJobApiTest' --tests 'in.gullak.rules.*' --tests 'in.gullak.ingestion.imports.CommitApiTest'`
Expected: PASS (12 detection tests, 1 job test, the rules, Plan 4's commit tests).

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/main/resources/db/migration/V050__subscriptions.sql server/src/main/java/in/gullak/common/events server/src/main/java/in/gullak/common/log/Events.java server/src/main/java/in/gullak/insights server/src/main/java/in/gullak/jobs/SubscriptionScanJob.java server/src/main/java/in/gullak/ingestion/imports/CommitService.java server/src/test/java/in/gullak/insights server/src/test/java/in/gullak/jobs/SubscriptionScanJobApiTest.java server/src/test/java/in/gullak/support/ApiTest.java server/src/test/java/in/gullak/rules/ArchitectureTest.java
git commit -m "feat(insights): subscriptions table, detection after an import commits and nightly

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Subscriptions API: list, "Still using?" answers and Subscription slayer

**Owner:** backend-engineer. **Test IDs:** API-SUB-05, API-SUB-06 (answer and badge half; the forecast half is Task 5), API-SUB-07, API-SUB-08, API-X-01 (subscriptions). **Red team:** yes (answering another user's subscription; replaying "Cancelled" for repeated badges or XP; enum and body abuse; merchant text beyond `merchant_name`).

**Files:**
- Create: `server/src/main/java/in/gullak/insights/SubscriptionAnswer.java`, `SubscriptionState.java`, `Subscription.java`, `SubscriptionList.java`, `AnswerRequest.java`, `SubscriptionEntity.java`, `SubscriptionRepository.java`, `SubscriptionController.java`
- Modify: `server/src/main/java/in/gullak/insights/SubscriptionService.java` (whole file below)
- Test: `server/src/test/java/in/gullak/insights/SubscriptionApiTest.java`

**Interfaces:**
- Consumes: Task 3's `SubscriptionService.detect`, the `subscriptions` table; Plan 5's `BudgetService.currentCycle(UUID) : CurrentCycle` with `id()`; Plan 4's `BadgeTrigger.fire(UUID userId, String trigger, UUID refId)` (implemented by Plan 6's `BadgeService`) and Plan 6's constant `BadgeTrigger.SUBSCRIPTION_SLAYER`.
- Produces:
  - `GET /api/v1/subscriptions` → `{"items":[{"id":"…","merchant":"Netflix","amountPaise":64900,"period":"MONTHLY","since":"2026-09-03","lastSeen":"2026-10-03","state":"ASKING"}]}`, live subscriptions only, largest amount first
  - `POST /api/v1/subscriptions/{id}/answer {"answer":"USING"|"CANCELLED"}` → 200 with the subscription; 400 `VALIDATION` for any other value or a missing answer; 404 for another user's id
  - `enum SubscriptionAnswer { USING, CANCELLED }`, `enum SubscriptionState { ASKING, USING, CANCELLED }`, `record Subscription(UUID id, String merchant, long amountPaise, SubscriptionPeriod period, LocalDate since, LocalDate lastSeen, SubscriptionState state)`
  - `SubscriptionService.list(UUID) : List<Subscription>`, `SubscriptionService.answer(UUID userId, UUID id, SubscriptionAnswer) : Subscription`; package-private `SubscriptionService.live(UUID userId, LocalDate today) : List<SubscriptionEntity>` (Task 5)
  - test helper in this test class only: `netflixAndSpotify(TestUser)` (Netflix ₹649 on 3 Sep and 3 Oct; Spotify ₹119 on 29 Aug and 28 Sep), reused by copy in Task 5

- [ ] **Step 1: Write the failing test**

`server/src/test/java/in/gullak/insights/SubscriptionApiTest.java`:

```java
package in.gullak.insights;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class SubscriptionApiTest extends ApiTest {
    @Autowired SubscriptionService subscriptions;

    TestUser netflixAndSpotify() throws Exception {
        TestUser u = exampleUser();
        seedMerchantSpend(u, 64_900, "2026-09-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 64_900, "2026-10-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 11_900, "2026-08-29", "subscriptions", "Spotify");
        seedMerchantSpend(u, 11_900, "2026-09-28", "subscriptions", "Spotify");
        subscriptions.detect(u.id());
        return u;
    }

    String idOf(TestUser u, String merchant) {
        return jdbc.sql("select id from subscriptions where user_id = ? and merchant_name = ?")
            .params(u.id(), merchant).query(UUID.class).single().toString();
    }

    ResultActions answer(TestUser u, String id, String body) throws Exception {
        return mvc.perform(post("/api/v1/subscriptions/" + id + "/answer").with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    long slayers(TestUser u) {
        return jdbc.sql("select count(*) from user_badges where user_id = ? and badge_code = 'SUBSCRIPTION_SLAYER'")
            .param(u.id()).query(Long.class).single();
    }

    @Test
    void listsLiveSubscriptionsLargestFirst() throws Exception {
        TestUser u = netflixAndSpotify();
        String body = mvc.perform(get("/api/v1/subscriptions").with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items.length()").value(2))
            .andExpect(jsonPath("$.items[0].merchant").value("Netflix"))
            .andExpect(jsonPath("$.items[0].amountPaise").value(64_900))
            .andExpect(jsonPath("$.items[0].period").value("MONTHLY"))
            .andExpect(jsonPath("$.items[0].since").value("2026-09-03"))
            .andExpect(jsonPath("$.items[0].lastSeen").value("2026-10-03"))
            .andExpect(jsonPath("$.items[0].state").value("ASKING"))
            .andExpect(jsonPath("$.items[1].merchant").value("Spotify"))
            .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("merchantKey").doesNotContain("raw").doesNotContain("userId");
    }

    @Test
    void usingIsNotAskedAgainThisCycleButIsNext() throws Exception { // API-SUB-05
        TestUser u = netflixAndSpotify();
        String netflix = idOf(u, "Netflix");
        answer(u, netflix, "{\"answer\":\"USING\"}").andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("USING"));
        mvc.perform(get("/api/v1/subscriptions").with(auth(u))).andExpect(jsonPath("$.items[0].state").value("USING"));
        clock.set(Instant.parse("2026-11-02T04:00:00Z"));
        mvc.perform(get("/api/v1/subscriptions").with(auth(u))).andExpect(jsonPath("$.items[0].state").value("ASKING"));
    }

    @Test
    void cancelledEarnsSubscriptionSlayerOnce() throws Exception { // API-SUB-06 (badge half)
        TestUser u = netflixAndSpotify();
        answer(u, idOf(u, "Netflix"), "{\"answer\":\"CANCELLED\"}").andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("CANCELLED"));
        assertThat(slayers(u)).isEqualTo(1);
        answer(u, idOf(u, "Spotify"), "{\"answer\":\"CANCELLED\"}").andExpect(status().isOk());
        answer(u, idOf(u, "Netflix"), "{\"answer\":\"CANCELLED\"}").andExpect(status().isOk());
        assertThat(slayers(u)).isEqualTo(1);
        assertThat(jdbc.sql("select answer from subscriptions where user_id = ? and merchant_name = 'Netflix'")
            .param(u.id()).query(String.class).single()).isEqualTo("CANCELLED");
    }

    @Test
    void anAnswerCanBeChanged() throws Exception {
        TestUser u = netflixAndSpotify();
        String netflix = idOf(u, "Netflix");
        answer(u, netflix, "{\"answer\":\"CANCELLED\"}").andExpect(status().isOk());
        answer(u, netflix, "{\"answer\":\"USING\"}").andExpect(status().isOk()).andExpect(jsonPath("$.state").value("USING"));
        assertThat(slayers(u)).isEqualTo(1); // badges are never taken back
    }

    @Test
    void badAnswersAreRefused() throws Exception { // API-SUB-07
        TestUser u = netflixAndSpotify();
        String netflix = idOf(u, "Netflix");
        answer(u, netflix, "{\"answer\":\"dunno\"}").andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
        answer(u, netflix, "{}").andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        answer(u, netflix, "{\"answer\":7}").andExpect(status().isBadRequest());
        answer(u, "not-a-uuid", "{\"answer\":\"USING\"}").andExpect(status().isBadRequest());
        assertThat(jdbc.sql("select answer from subscriptions where id = ?::uuid").param(netflix)
            .query(String.class).optional()).isEmpty();
    }

    @Test
    void anotherUsersSubscriptionIsNotFound() throws Exception { // API-SUB-08, API-X-01
        TestUser owner = netflixAndSpotify();
        TestUser other = exampleUser();
        String netflix = idOf(owner, "Netflix");
        answer(other, netflix, "{\"answer\":\"CANCELLED\"}").andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        answer(other, UUID.randomUUID().toString(), "{\"answer\":\"USING\"}").andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/subscriptions").with(auth(other))).andExpect(jsonPath("$.items.length()").value(0));
        assertThat(slayers(other)).isZero();
        mvc.perform(get("/api/v1/subscriptions").with(auth(owner))).andExpect(jsonPath("$.items[0].state").value("ASKING"));
    }

    @Test
    void aSubscriptionThatStoppedChargingDropsOff() throws Exception {
        TestUser u = netflixAndSpotify();
        clock.set(Instant.parse("2026-11-14T04:00:00Z")); // Netflix live until 13 Nov, Spotify until 7 Nov
        mvc.perform(get("/api/v1/subscriptions").with(auth(u))).andExpect(jsonPath("$.items.length()").value(0));
    }

    @Test
    void needsSignIn() throws Exception {
        mvc.perform(get("/api/v1/subscriptions")).andExpect(status().isUnauthorized());
        String body = mvc.perform(post("/api/v1/subscriptions/" + UUID.randomUUID() + "/answer")
                .contentType(MediaType.APPLICATION_JSON).content("{\"answer\":\"USING\"}"))
            .andExpect(status().isUnauthorized()).andReturn().getResponse().getContentAsString();
        assertThat((String) JsonPath.read(body, "$.code")).isEqualTo("UNAUTHENTICATED");
    }
}
```

`badAnswersAreRefused` checks that the row's `answer` is still null: `optional()` on a null single column is empty.

- [ ] **Step 2: Run it to see it fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.SubscriptionApiTest'`
Expected: FAIL, compilation errors (`SubscriptionAnswer` and the endpoint do not exist).

- [ ] **Step 3: Write the code**

`server/src/main/java/in/gullak/insights/SubscriptionAnswer.java`:

```java
package in.gullak.insights;

/** The two buttons under "Still using?": "Using it" and "Cancelled". */
public enum SubscriptionAnswer { USING, CANCELLED }
```

`server/src/main/java/in/gullak/insights/SubscriptionState.java`:

```java
package in.gullak.insights;

/** ASKING shows "Still using?"; USING shows "Kept" for the rest of the cycle; CANCELLED shows "Marked as cancelled". */
public enum SubscriptionState { ASKING, USING, CANCELLED }
```

`server/src/main/java/in/gullak/insights/Subscription.java`:

```java
package in.gullak.insights;

import java.time.LocalDate;
import java.util.UUID;

/** {@code merchant} is the clean display name (transactions.merchant_name), never statement text. */
public record Subscription(
    UUID id,
    String merchant,
    long amountPaise,
    SubscriptionPeriod period,
    LocalDate since,
    LocalDate lastSeen,
    SubscriptionState state) {}
```

`server/src/main/java/in/gullak/insights/SubscriptionList.java`:

```java
package in.gullak.insights;

import java.util.List;

public record SubscriptionList(List<Subscription> items) {}
```

`server/src/main/java/in/gullak/insights/AnswerRequest.java`:

```java
package in.gullak.insights;

import jakarta.validation.constraints.NotNull;

/** Any value other than USING or CANCELLED fails to deserialise and becomes 400 VALIDATION. */
public record AnswerRequest(@NotNull SubscriptionAnswer answer) {}
```

`server/src/main/java/in/gullak/insights/SubscriptionEntity.java`:

```java
package in.gullak.insights;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

/** Rows are inserted and refreshed by SubscriptionUpsertRepository; this entity reads them and records answers. */
@Entity
@Table(name = "subscriptions")
class SubscriptionEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "merchant_key", nullable = false, length = 80)
    private String merchantKey;

    @Column(name = "merchant_name", nullable = false, length = 80)
    private String merchantName;

    @Column(name = "amount_paise", nullable = false)
    private long amountPaise;

    @Enumerated(EnumType.STRING)
    @Column(name = "period", nullable = false, length = 8)
    private SubscriptionPeriod period;

    @Column(name = "first_seen", nullable = false)
    private LocalDate firstSeen;

    @Column(name = "last_seen", nullable = false)
    private LocalDate lastSeen;

    @Enumerated(EnumType.STRING)
    @Column(name = "answer", length = 10)
    private SubscriptionAnswer answer;

    @Column(name = "answered_at")
    private Instant answeredAt;

    @Column(name = "asked_cycle_id")
    private UUID askedCycleId;

    protected SubscriptionEntity() {}

    UUID getId() { return id; }
    String getMerchantKey() { return merchantKey; }
    long getAmountPaise() { return amountPaise; }
    SubscriptionPeriod getPeriod() { return period; }
    LocalDate getLastSeen() { return lastSeen; }
    String getMerchantName() { return merchantName; }

    boolean cancelled() {
        return answer == SubscriptionAnswer.CANCELLED;
    }

    /** Listed and counted in the forecast until 10 days after the next expected charge. */
    boolean liveOn(LocalDate today) {
        return !today.isAfter(period.liveUntil(lastSeen));
    }

    void answer(SubscriptionAnswer value, Instant at, UUID currentCycleId) {
        this.answer = value;
        this.answeredAt = at;
        this.askedCycleId = currentCycleId;
    }

    SubscriptionState state(UUID currentCycleId) {
        if (answer == SubscriptionAnswer.CANCELLED) {
            return SubscriptionState.CANCELLED;
        }
        if (answer == SubscriptionAnswer.USING && Objects.equals(askedCycleId, currentCycleId)) {
            return SubscriptionState.USING;
        }
        return SubscriptionState.ASKING;
    }

    Subscription toRecord(UUID currentCycleId) {
        return new Subscription(id, merchantName, amountPaise, period, firstSeen, lastSeen, state(currentCycleId));
    }
}
```

`server/src/main/java/in/gullak/insights/SubscriptionRepository.java`:

```java
package in.gullak.insights;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface SubscriptionRepository extends JpaRepository<SubscriptionEntity, UUID> {
    Optional<SubscriptionEntity> findByIdAndUserId(UUID id, UUID userId);

    List<SubscriptionEntity> findByUserId(UUID userId);
}
```

`server/src/main/java/in/gullak/insights/SubscriptionService.java` (replaces Task 3's file; `detect` and `usersToScan` are unchanged):

```java
package in.gullak.insights;

import in.gullak.budget.BudgetService;
import in.gullak.common.error.NotFoundException;
import in.gullak.common.log.Events;
import in.gullak.common.time.Ist;
import in.gullak.gamification.BadgeTrigger;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Subscriptions (spec 2.8): detection, the list on Insights, and "Still using?" answers. */
@Service
public class SubscriptionService {
    /** A yearly charge needs the same date last year plus the 370-day edge. */
    static final int LOOKBACK_DAYS = 400;
    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

    private final ChargeRepository charges;
    private final SubscriptionUpsertRepository upserts;
    private final SubscriptionRepository repo;
    private final BudgetService budget;
    private final ObjectProvider<BadgeTrigger> badges;
    private final Clock clock;

    SubscriptionService(ChargeRepository charges, SubscriptionUpsertRepository upserts, SubscriptionRepository repo,
                        BudgetService budget, ObjectProvider<BadgeTrigger> badges, Clock clock) {
        this.charges = charges;
        this.upserts = upserts;
        this.repo = repo;
        this.budget = budget;
        this.badges = badges;
        this.clock = clock;
    }

    /** Finds the user's repeating charges and records them; idempotent. Returns how many it found. */
    @Transactional
    public int detect(UUID userId) {
        LocalDate today = Ist.today(clock);
        List<DetectedSubscription> found = SubscriptionDetector.detect(
            charges.debits(userId, Ist.startOf(today.minusDays(LOOKBACK_DAYS)), Ist.startOf(today.plusDays(2))));
        for (DetectedSubscription d : found) {
            upserts.upsert(userId, d);
        }
        if (!found.isEmpty()) {
            log.info("{} user={} count={}", Events.SUBSCRIPTION_DETECTED, userId, found.size());
        }
        return found.size();
    }

    /** Users with a debit on or after {@code since}: the nightly scan's units. */
    @Transactional(readOnly = true)
    public List<UUID> usersToScan(Instant since) {
        return charges.usersWithDebitsSince(since);
    }

    /** Live subscriptions, largest first. Read-write because naming the current cycle may open it. */
    @Transactional
    public List<Subscription> list(UUID userId) {
        UUID cycleId = budget.currentCycle(userId).id();
        return live(userId, Ist.today(clock)).stream()
            .sorted(Comparator.comparingLong(SubscriptionEntity::getAmountPaise).reversed()
                .thenComparing(SubscriptionEntity::getMerchantName))
            .map(s -> s.toRecord(cycleId))
            .toList();
    }

    /** "Using it" or "Cancelled". Cancelled earns Subscription slayer the first time (the trigger is idempotent). */
    @Transactional
    public Subscription answer(UUID userId, UUID id, SubscriptionAnswer answer) {
        SubscriptionEntity s = repo.findByIdAndUserId(id, userId).orElseThrow(() -> new NotFoundException("Subscription"));
        UUID cycleId = budget.currentCycle(userId).id();
        s.answer(answer, clock.instant(), cycleId);
        if (answer == SubscriptionAnswer.CANCELLED) {
            badges.orderedStream().forEach(b -> b.fire(userId, BadgeTrigger.SUBSCRIPTION_SLAYER, id));
        }
        log.info("{} user={} subscription={} answer={}", Events.SUBSCRIPTION_ANSWERED, userId, id, answer);
        return s.toRecord(cycleId);
    }

    /** The user's subscriptions that are still live on {@code today}, cancelled ones included. */
    List<SubscriptionEntity> live(UUID userId, LocalDate today) {
        return repo.findByUserId(userId).stream().filter(s -> s.liveOn(today)).toList();
    }
}
```

`server/src/main/java/in/gullak/insights/SubscriptionController.java`:

```java
package in.gullak.insights;

import in.gullak.common.web.CurrentUser;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/subscriptions")
class SubscriptionController {
    private final SubscriptionService subscriptions;

    SubscriptionController(SubscriptionService subscriptions) {
        this.subscriptions = subscriptions;
    }

    @GetMapping
    SubscriptionList list(@AuthenticationPrincipal Jwt jwt) {
        return new SubscriptionList(subscriptions.list(CurrentUser.id(jwt)));
    }

    @PostMapping("/{id}/answer")
    Subscription answer(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody AnswerRequest body) {
        return subscriptions.answer(CurrentUser.id(jwt), id, body.answer());
    }
}
```

The log line carries ids and the answer only, never the merchant or amount.

- [ ] **Step 4: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.*'`
Expected: PASS (`SubscriptionApiTest` 8 tests and every earlier insights test).

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/in/gullak/insights server/src/test/java/in/gullak/insights/SubscriptionApiTest.java
git commit -m "feat(insights): subscriptions list and Still using? answers with Subscription slayer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Cycle figures and `GET /insights/cycle` with the forecast

**Owner:** backend-engineer. **Test IDs:** API-INS-01, API-INS-02, API-INS-05 (new: the forecast's subscription term over the API and early days), API-SUB-06 (forecast half: a cancelled subscription leaves the forecast), API-X-01 (cycle insights). **Red team:** yes (another user's `cycleId`; a malformed `cycleId`; figures that disagree with Home).

**Files:**
- Create: `server/src/main/java/in/gullak/budget/CycleFigures.java`
- Modify: `server/src/main/java/in/gullak/budget/BudgetService.java` (add `figures` and `spentBetween`)
- Create: `server/src/main/java/in/gullak/insights/SubscriptionLoad.java`, `CountKind.java`, `CategoryRow.java`, `CycleInsights.java`, `InsightsService.java`, `InsightsController.java`
- Modify: `server/src/main/java/in/gullak/insights/SubscriptionService.java` (add `load`)
- Test: `server/src/test/java/in/gullak/insights/CycleInsightsApiTest.java`

**Interfaces:**
- Consumes: Plan 5's `CycleService.find(UUID, UUID) : Optional<CycleRecord>`, `CycleService.covering(UUID, LocalDate) : Optional<CycleRecord>`, `CycleRecord(id, cycle, poolOverridePaise, closedAt, leftoverPaise, leftoverChoice, carriedPaise)`, `BudgetService.poolAtClose`, `BudgetService.currentCycle(UUID).id()`; Plan 3's `TransactionService.categoryTotals(UUID, LocalDate, LocalDate) : List<CategoryTotal>`, `CategoryService.get(String) : Category`; Tasks 1–4.
- Produces:
  - `record CycleFigures(UUID cycleId, LocalDate start, LocalDate end, LocalDate through, long spendablePaise, long spentPaise, long savingsPaise, boolean closed, Long leftoverPaise, String leftoverChoice)` in `budget`; `BudgetService.figures(UUID userId, UUID cycleId, LocalDate asOf) : CycleFigures` (404 for another user's cycle; `through` = `asOf` capped at the cycle end; spendable includes the first-cycle override, carry, extra income and catch-up changes exactly as `poolAtClose` counts them)
  - `InsightsService.forecast(UUID userId, UUID cycleId) : Forecast` (as of today), `InsightsService.offTrack(UUID userId) : boolean` (as of yesterday; Plan 8's off-track push reads it after the daily close), `InsightsService.cycle(UUID userId, UUID cycleIdOrNull) : CycleInsights`
  - `GET /api/v1/insights/cycle[?cycleId=uuid]` →
    `{"cycleId":"…","cycleStart":"2026-10-01","cycleEnd":"2026-10-31","day":23,"days":31,"closed":false,"spentPaise":984000,"spendablePaise":1500000,"forecast":{…Forecast…},"categories":[{"code":"quick_commerce","name":"Quick commerce","spentPaise":246000,"count":23,"countKind":"ORDERS"},…]}` (`forecast` null for a closed or ended cycle)
  - `enum CountKind { ORDERS, PAYMENTS, NONE }` with `of(String code)`; `record SubscriptionLoad(long chargedPaise, long duePaise)`; package-private `SubscriptionService.load(UUID userId, LocalDate start, LocalDate through, LocalDate end) : SubscriptionLoad`

- [ ] **Step 1: Write the failing test**

`server/src/test/java/in/gullak/insights/CycleInsightsApiTest.java`:

```java
package in.gullak.insights;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

class CycleInsightsApiTest extends ApiTest {
    @Autowired SubscriptionService subscriptions;
    @Autowired InsightsService insights;

    /** The Insights mockup's month: ₹9,660 before today and ₹180 today, ₹9,840 in six categories. */
    void mockupMonth(TestUser u) {
        for (int d = 1; d <= 21; d++) {
            seedMerchantSpend(u, 11_000, String.format("2026-10-%02d", d), "quick_commerce", d % 2 == 0 ? "Blinkit" : "Zepto");
        }
        seedMerchantSpend(u, 12_000, "2026-10-22", "quick_commerce", "Zepto");
        seedMerchantSpend(u, 3_000, "2026-10-23", "quick_commerce", "Zepto");
        for (int d = 1; d <= 10; d++) {
            seedMerchantSpend(u, 19_000, String.format("2026-10-%02d", d * 2), "food_delivery", "Swiggy");
        }
        seedMerchantSpend(u, 17_000, "2026-10-21", "food_delivery", "Zomato");
        seedMerchantSpend(u, 188_800, "2026-10-09", "shopping", "Myntra");
        seedMerchantSpend(u, 50_000, "2026-10-05", "upi_to_people", "priya.s");
        seedMerchantSpend(u, 50_000, "2026-10-12", "upi_to_people", "rahul.k");
        seedMerchantSpend(u, 61_000, "2026-10-19", "upi_to_people", "priya.s");
        seedMerchantSpend(u, 89_400, "2026-10-12", "eating_out", "Toit");
        seedMerchantSpend(u, 15_000, "2026-10-23", "eating_out", "Third Wave Coffee");
        seedMerchantSpend(u, 64_900, "2026-10-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 11_900, "2026-10-05", "subscriptions", "Hotstar");
    }

    @Test
    void theMockupMonth() throws Exception { // API-INS-01
        TestUser u = exampleUser();
        mockupMonth(u);
        mvc.perform(get("/api/v1/insights/cycle").with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.cycleStart").value("2026-10-01"))
            .andExpect(jsonPath("$.cycleEnd").value("2026-10-31"))
            .andExpect(jsonPath("$.day").value(23))
            .andExpect(jsonPath("$.days").value(31))
            .andExpect(jsonPath("$.closed").value(false))
            .andExpect(jsonPath("$.spentPaise").value(984_000))
            .andExpect(jsonPath("$.spendablePaise").value(1_500_000))
            .andExpect(jsonPath("$.forecast.spendPaise").value(1_330_000))
            .andExpect(jsonPath("$.forecast.extraSavedPaise").value(170_000))
            .andExpect(jsonPath("$.forecast.savePaise").value(2_170_000))
            .andExpect(jsonPath("$.forecast.early").value(false))
            .andExpect(jsonPath("$.forecast.offTrack").value(false))
            .andExpect(jsonPath("$.categories.length()").value(6))
            .andExpect(jsonPath("$.categories[0].code").value("quick_commerce"))
            .andExpect(jsonPath("$.categories[0].name").value("Quick commerce"))
            .andExpect(jsonPath("$.categories[0].spentPaise").value(246_000))
            .andExpect(jsonPath("$.categories[0].count").value(23))
            .andExpect(jsonPath("$.categories[0].countKind").value("ORDERS"))
            .andExpect(jsonPath("$.categories[1].code").value("food_delivery"))
            .andExpect(jsonPath("$.categories[1].count").value(11))
            .andExpect(jsonPath("$.categories[1].countKind").value("ORDERS"))
            .andExpect(jsonPath("$.categories[2].code").value("shopping"))
            .andExpect(jsonPath("$.categories[2].countKind").value("NONE"))
            .andExpect(jsonPath("$.categories[3].code").value("upi_to_people"))
            .andExpect(jsonPath("$.categories[3].count").value(3))
            .andExpect(jsonPath("$.categories[3].countKind").value("PAYMENTS"))
            .andExpect(jsonPath("$.categories[4].spentPaise").value(104_400))
            .andExpect(jsonPath("$.categories[5].spentPaise").value(76_800));
    }

    @Test
    void categoriesAddUpToSpentAndHomeAgrees() throws Exception { // API-INS-01: categories sum to spent
        TestUser u = exampleUser();
        mockupMonth(u);
        String body = getJson(u, "/api/v1/insights/cycle");
        java.util.List<Integer> amounts = com.jayway.jsonpath.JsonPath.read(body, "$.categories[*].spentPaise");
        assertThat(amounts.stream().mapToLong(Integer::longValue).sum()).isEqualTo(984_000L);
        String today = getJson(u, "/api/v1/budget/today");
        long homeSpentToday = ((Number) com.jayway.jsonpath.JsonPath.read(today, "$.spentPaise")).longValue();
        assertThat(homeSpentToday).isEqualTo(18_000L);
    }

    @Test
    void anotherUsersCycleIsNotFound() throws Exception { // API-INS-02, API-X-01
        TestUser owner = exampleUser();
        mockupMonth(owner);
        budgetToday(owner).andExpect(status().isOk()); // opens October for this user
        UUID oct = cycleIdStarting(owner, "2026-10-01");
        TestUser other = exampleUser();
        mvc.perform(get("/api/v1/insights/cycle").param("cycleId", oct.toString()).with(auth(other)))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(get("/api/v1/insights/cycle").param("cycleId", UUID.randomUUID().toString()).with(auth(owner)))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/insights/cycle").param("cycleId", "' OR 1=1 --").with(auth(owner)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    @Test
    void aClosedCycleHasNoForecast() throws Exception {
        TestUser u = exampleUser();
        mockupMonth(u);
        budgetToday(u).andExpect(status().isOk()); // opens October for this user
        UUID oct = cycleIdStarting(u, "2026-10-01");
        clock.set(Instant.parse("2026-11-02T04:00:00Z"));
        budgetToday(u).andExpect(status().isOk()); // opens November and closes October (Plan 5)
        mvc.perform(get("/api/v1/insights/cycle").param("cycleId", oct.toString()).with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.closed").value(true))
            .andExpect(jsonPath("$.day").value(31))
            .andExpect(jsonPath("$.spentPaise").value(984_000))
            .andExpect(jsonPath("$.forecast").doesNotExist());
        mvc.perform(get("/api/v1/insights/cycle").with(auth(u)))
            .andExpect(jsonPath("$.cycleStart").value("2026-11-01"))
            .andExpect(jsonPath("$.day").value(2))
            .andExpect(jsonPath("$.categories.length()").value(0))
            .andExpect(jsonPath("$.forecast.early").value(true));
    }

    @Test
    void subscriptionsShapeTheForecast() throws Exception { // API-INS-05, API-SUB-06 (forecast half)
        TestUser u = exampleUser();
        mockupMonth(u);
        seedMerchantSpend(u, 64_900, "2026-09-03", "subscriptions", "Netflix");
        seedMerchantSpend(u, 11_900, "2026-08-29", "subscriptions", "Spotify");
        seedMerchantSpend(u, 11_900, "2026-09-28", "subscriptions", "Spotify");
        subscriptions.detect(u.id());
        // Netflix ₹649 charged 3 Oct (out of the pace, added once); Spotify ₹119 due 28 Oct (added)
        mvc.perform(get("/api/v1/insights/cycle").with(auth(u)))
            .andExpect(jsonPath("$.forecast.spendPaise").value(1_320_000));
        UUID spotify = jdbc.sql("select id from subscriptions where user_id = ? and merchant_key = 'spotify'")
            .param(u.id()).query(UUID.class).single();
        mvc.perform(post("/api/v1/subscriptions/" + spotify + "/answer").with(auth(u))
                .contentType(MediaType.APPLICATION_JSON).content("{\"answer\":\"CANCELLED\"}"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/v1/insights/cycle").with(auth(u)))
            .andExpect(jsonPath("$.forecast.spendPaise").value(1_300_000))
            .andExpect(jsonPath("$.forecast.extraSavedPaise").value(200_000));
    }

    @Test
    void theFirstTwoDaysAreEarly() throws Exception { // API-INS-05
        TestUser u = exampleUser();
        seedMerchantSpend(u, 50_000, "2026-11-01", "eating_out", "Toit");
        clock.set(Instant.parse("2026-11-01T08:00:00Z"));
        mvc.perform(get("/api/v1/insights/cycle").with(auth(u)))
            .andExpect(jsonPath("$.forecast.early").value(true))
            .andExpect(jsonPath("$.forecast.offTrack").value(false));
    }

    @Test
    void offTrackIsDecidedOnYesterday() throws Exception { // spec 2.7, read by Plan 8
        TestUser u = exampleUser();
        seedMerchantSpend(u, 1_200_000, "2026-10-10", "shopping", "Croma");
        budgetToday(u).andExpect(status().isOk());
        assertThat(insights.offTrack(u.id())).isTrue(); // ₹12,000 by 22 Oct → ₹16,909 > ₹15,000
        TestUser calm = exampleUser();
        mockupMonth(calm);
        budgetToday(calm).andExpect(status().isOk());
        assertThat(insights.offTrack(calm.id())).isFalse();
        TestUser nobody = signIn();
        assertThat(insights.offTrack(nobody.id())).isFalse(); // no cycle covers yesterday
    }

    @Test
    void needsSignIn() throws Exception {
        mvc.perform(get("/api/v1/insights/cycle")).andExpect(status().isUnauthorized());
    }
}
```

`offTrackIsDecidedOnYesterday`: through 22 Oct, 22 days elapsed: 1,200,000 × 31 ÷ 22 = 1,690,909 > 1,500,000. The calm user: ₹9,660 by 22 Oct → 9,660 × 31 ÷ 22 = ₹13,612 < ₹15,000.

- [ ] **Step 2: Run it to see it fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.CycleInsightsApiTest'`
Expected: FAIL, compilation errors (`InsightsService` does not exist) or 404 on `/api/v1/insights/cycle`.

- [ ] **Step 3: Cycle figures in `budget`**

`server/src/main/java/in/gullak/budget/CycleFigures.java`:

```java
package in.gullak.budget;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One cycle's money as the budget counts it, for insights and the cycle summary (Plan 7). {@code spendablePaise}
 * is the whole cycle's pool before spending: the first-cycle override or the formula, plus extra income, carry and
 * catch-up changes. {@code spentPaise} is what the budget counts as spent from {@code start} through {@code through}.
 */
public record CycleFigures(
    UUID cycleId,
    LocalDate start,
    LocalDate end,
    LocalDate through,
    long spendablePaise,
    long spentPaise,
    long savingsPaise,
    boolean closed,
    Long leftoverPaise,
    String leftoverChoice) {}
```

In `server/src/main/java/in/gullak/budget/BudgetService.java`, add these two methods after `poolAtClose` (the rest of the class is unchanged). `spentBetween` must use exactly the aggregate call that `poolAtClose` uses for the cycle's spent; it is shown here as Plan 5 wrote it (`totals.spent(...)`). If Plan 3 or 5 changed that call, use the same call in both places so the leftover always equals spendable minus spent:

```java
    /** Plan 7: a cycle's spendable and its spent from the start through {@code asOf} (capped at the cycle end). */
    @Transactional(readOnly = true)
    public CycleFigures figures(UUID userId, UUID cycleId, LocalDate asOf) {
        CycleRecord c = cycles.find(userId, cycleId).orElseThrow(() -> new NotFoundException("Cycle"));
        LocalDate start = c.cycle().start();
        LocalDate end = c.cycle().end();
        LocalDate through = asOf.isAfter(end) ? end : asOf;
        long spendable = poolAtClose(userId, cycleId) + spentBetween(userId, start, end);
        long spent = through.isBefore(start) ? 0 : spentBetween(userId, start, through);
        return new CycleFigures(cycleId, start, end, through, spendable, spent, profiles.get(userId).savingsPaise(),
            c.closedAt() != null, c.leftoverPaise(), c.leftoverChoice());
    }

    /** Spent from the start of {@code from} to the end of {@code toInclusive}, the way poolAtClose counts it. */
    private long spentBetween(UUID userId, LocalDate from, LocalDate toInclusive) {
        return totals.spent(userId, Ist.startOf(from), Ist.startOf(toInclusive.plusDays(1)));
    }
```

- [ ] **Step 4: Insights**

`server/src/main/java/in/gullak/insights/SubscriptionLoad.java`:

```java
package in.gullak.insights;

/** The forecast's subscription term: charged this cycle so far, and still due this cycle (not cancelled). */
public record SubscriptionLoad(long chargedPaise, long duePaise) {
    public static final SubscriptionLoad NONE = new SubscriptionLoad(0, 0);
}
```

Add to `server/src/main/java/in/gullak/insights/SubscriptionService.java` (imports `in.gullak.common.time.Ist` and `java.time.LocalDate` are already there):

```java
    /**
     * For the forecast: what live subscriptions charged from {@code start} through {@code through} (matched by
     * merchant and the 2% rule), and what the ones not cancelled are expected to charge after {@code through} and by
     * {@code end}. A cancelled subscription's past charge still counts; its next one does not (spec 2.8).
     */
    @Transactional(readOnly = true)
    SubscriptionLoad load(UUID userId, LocalDate start, LocalDate through, LocalDate end) {
        List<SubscriptionEntity> subs = live(userId, through);
        if (subs.isEmpty() || through.isBefore(start)) {
            return SubscriptionLoad.NONE;
        }
        List<Charge> inCycle = charges.debits(userId, Ist.startOf(start), Ist.startOf(through.plusDays(1)));
        long charged = 0;
        long due = 0;
        for (SubscriptionEntity s : subs) {
            LocalDate latest = s.getLastSeen();
            for (Charge c : inCycle) {
                if (s.getMerchantKey().equals(c.key()) && SubscriptionDetector.sameAmount(c.amountPaise(), s.getAmountPaise())) {
                    charged += c.amountPaise();
                    if (c.date().isAfter(latest)) {
                        latest = c.date();
                    }
                }
            }
            LocalDate next = s.getPeriod().next(latest);
            if (!s.cancelled() && next.isAfter(through) && !next.isAfter(end)) {
                due += s.getAmountPaise();
            }
        }
        return new SubscriptionLoad(charged, due);
    }
```

`server/src/main/java/in/gullak/insights/CountKind.java`:

```java
package in.gullak.insights;

/** Spec 2.8: order counts for delivery and quick commerce; the mockup also counts UPI payments to people. */
public enum CountKind {
    ORDERS, PAYMENTS, NONE;

    public static CountKind of(String categoryCode) {
        return switch (categoryCode) {
            case "food_delivery", "quick_commerce" -> ORDERS;
            case "upi_to_people" -> PAYMENTS;
            default -> NONE;
        };
    }
}
```

`server/src/main/java/in/gullak/insights/CategoryRow.java`:

```java
package in.gullak.insights;

/** One row of "Spending by category": debits minus refunds, the number of debits, and how to name that number. */
public record CategoryRow(String code, String name, long spentPaise, int count, CountKind countKind) {}
```

`server/src/main/java/in/gullak/insights/CycleInsights.java`:

```java
package in.gullak.insights;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** The Insights tab (spec 2.8). {@code day} is the days counted so far; {@code forecast} is null once the cycle ended. */
public record CycleInsights(
    UUID cycleId,
    LocalDate cycleStart,
    LocalDate cycleEnd,
    int day,
    int days,
    boolean closed,
    long spentPaise,
    long spendablePaise,
    Forecast forecast,
    List<CategoryRow> categories) {}
```

`server/src/main/java/in/gullak/insights/InsightsService.java`:

```java
package in.gullak.insights;

import in.gullak.budget.BudgetService;
import in.gullak.budget.CycleFigures;
import in.gullak.budget.CycleService;
import in.gullak.common.time.Ist;
import in.gullak.ingestion.CategoryService;
import in.gullak.ingestion.TransactionService;
import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Cycle insights and the forecast (spec 2.7, 2.8). Plan 8's off-track push reads {@link #offTrack}. */
@Service
public class InsightsService {
    private final BudgetService budget;
    private final CycleService cycles;
    private final TransactionService transactions;
    private final CategoryService categories;
    private final SubscriptionService subscriptions;
    private final Clock clock;

    InsightsService(BudgetService budget, CycleService cycles, TransactionService transactions, CategoryService categories,
                    SubscriptionService subscriptions, Clock clock) {
        this.budget = budget;
        this.cycles = cycles;
        this.transactions = transactions;
        this.categories = categories;
        this.subscriptions = subscriptions;
        this.clock = clock;
    }

    /** The cycle's forecast as of today. 404 for another user's cycle. */
    @Transactional(readOnly = true)
    public Forecast forecast(UUID userId, UUID cycleId) {
        return forecastFrom(userId, budget.figures(userId, cycleId, Ist.today(clock)));
    }

    /**
     * Spec 2.7's spending half: decided at the daily close, so it counts the days through yesterday on the cycle
     * that covers yesterday. False when no cycle covers yesterday or the forecast is still early.
     */
    @Transactional(readOnly = true)
    public boolean offTrack(UUID userId) {
        LocalDate yesterday = Ist.today(clock).minusDays(1);
        return cycles.covering(userId, yesterday)
            .map(c -> forecastFrom(userId, budget.figures(userId, c.id(), yesterday)).offTrack())
            .orElse(false);
    }

    /** The Insights tab for one cycle, or the current one. Read-write because naming the current cycle may open it. */
    @Transactional
    public CycleInsights cycle(UUID userId, UUID cycleIdOrNull) {
        UUID cycleId = cycleIdOrNull != null ? cycleIdOrNull : budget.currentCycle(userId).id();
        LocalDate today = Ist.today(clock);
        CycleFigures f = budget.figures(userId, cycleId, today);
        boolean started = !f.through().isBefore(f.start());
        Forecast forecast = f.closed() || today.isAfter(f.end()) ? null : forecastFrom(userId, f);
        List<CategoryRow> rows = started ? rows(userId, f.start(), f.through()) : List.of();
        int day = started ? days(f.start(), f.through()) : 0;
        return new CycleInsights(cycleId, f.start(), f.end(), day, days(f.start(), f.end()), f.closed(), f.spentPaise(),
            f.spendablePaise(), forecast, rows);
    }

    List<CategoryRow> rows(UUID userId, LocalDate from, LocalDate to) {
        return transactions.categoryTotals(userId, from, to).stream()
            .map(t -> new CategoryRow(t.category(), categories.get(t.category()).name(), t.spentPaise(), t.count(),
                CountKind.of(t.category())))
            .toList();
    }

    private Forecast forecastFrom(UUID userId, CycleFigures f) {
        SubscriptionLoad load = subscriptions.load(userId, f.start(), f.through(), f.end());
        return ForecastCalculator.compute(new ForecastInput(f.start(), f.end(), f.through(), f.spendablePaise(),
            f.spentPaise(), f.savingsPaise(), load.chargedPaise(), load.duePaise()));
    }

    private static int days(LocalDate from, LocalDate toInclusive) {
        return (int) ChronoUnit.DAYS.between(from, toInclusive) + 1;
    }
}
```

`server/src/main/java/in/gullak/insights/InsightsController.java`:

```java
package in.gullak.insights;

import in.gullak.common.web.CurrentUser;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/insights")
class InsightsController {
    private final InsightsService insights;

    InsightsController(InsightsService insights) {
        this.insights = insights;
    }

    @GetMapping("/cycle")
    CycleInsights cycle(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) UUID cycleId) {
        return insights.cycle(CurrentUser.id(jwt), cycleId);
    }
}
```

A malformed `cycleId` fails conversion to `UUID` and Plan 1's handler answers 400 `VALIDATION`; the text never reaches SQL.

- [ ] **Step 5: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.*' --tests 'in.gullak.budget.*'`
Expected: PASS (`CycleInsightsApiTest` 8 tests; Plan 1, 2 and 5 budget tests unchanged).

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/main/java/in/gullak/budget/CycleFigures.java server/src/main/java/in/gullak/budget/BudgetService.java server/src/main/java/in/gullak/insights server/src/test/java/in/gullak/insights/CycleInsightsApiTest.java
git commit -m "feat(insights): GET /insights/cycle with categories largest first and the forecast; offTrack for Plan 8

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Category drill-down `GET /insights/category/{code}`

**Owner:** backend-engineer. **Test IDs:** API-INS-03, API-INS-04, API-X-01 (category drill-down), API-X-07 (the path variable). **Red team:** yes (another user's spends through a guessed `cycleId`; SQL in the path; raw statement text in the response).

**Files:**
- Create: `server/src/main/java/in/gullak/insights/CategorySpend.java`, `MerchantTotal.java`, `CategoryInsights.java`, `CategorySpendRepository.java`
- Modify: `server/src/main/java/in/gullak/insights/InsightsService.java` (constructor and `category`), `InsightsController.java` (`category`)
- Test: `server/src/test/java/in/gullak/insights/CategoryInsightsApiTest.java`

**Interfaces:**
- Consumes: Task 5's `InsightsService`, `BudgetService.figures`, `CountKind`; Plan 3's `CategoryService.get(String) : Category` (404 `NOT_FOUND` when the code is unknown).
- Produces:
  - `GET /api/v1/insights/category/{code}[?cycleId=uuid]` →
    `{"cycleId":"…","cycleStart":"2026-10-01","cycleEnd":"2026-10-31","code":"quick_commerce","name":"Quick commerce","spentPaise":68000,"count":5,"countKind":"ORDERS","merchants":[{"merchant":"Blinkit","spentPaise":40000,"count":2},{"merchant":"Zepto","spentPaise":28000,"count":3}],"spends":[{"id":"…","kind":"SPEND","amountPaise":11000,"occurredAt":"2026-10-22T06:30:00Z","merchant":"Zepto","paymentMethod":"UPI"},…]}`
  - `InsightsService.category(UUID userId, String code, UUID cycleIdOrNull) : CategoryInsights`; `record CategorySpend(UUID id, CategorySpend.Kind kind, long amountPaise, Instant occurredAt, String merchant, String paymentMethod)` with `enum Kind { SPEND, REFUND }`; `record MerchantTotal(String merchant, long spentPaise, int count)` (`merchant` null when the spends had no name)

- [ ] **Step 1: Write the failing test**

`server/src/test/java/in/gullak/insights/CategoryInsightsApiTest.java`:

```java
package in.gullak.insights;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class CategoryInsightsApiTest extends ApiTest {
    void quickCommerce(TestUser u) {
        seedMerchantSpend(u, 11_000, "2026-10-02", "quick_commerce", "Zepto");
        seedMerchantSpend(u, 11_000, "2026-10-12", "quick_commerce", "zepto ");
        seedMerchantSpend(u, 11_000, "2026-10-22", "quick_commerce", "Zepto");
        seedMerchantSpend(u, 20_000, "2026-10-05", "quick_commerce", "Blinkit");
        seedMerchantSpend(u, 20_000, "2026-10-15", "quick_commerce", "Blinkit");
        jdbc.sql("""
                insert into transactions (id, user_id, amount_paise, direction, credit_kind, occurred_at, merchant_name,
                    category_code, payment_method, source, status)
                values (?, ?, 5000, 'credit', 'refund', ?, 'Zepto', 'quick_commerce', 'upi', 'manual', 'pending')
                """)
            .params(UUID.randomUUID(), u.id(), OffsetDateTime.ofInstant(istNoon("2026-10-13"), ZoneOffset.UTC)).update();
        UUID deleted = seedMerchantSpend(u, 99_000, "2026-10-14", "quick_commerce", "Zepto");
        jdbc.sql("update transactions set deleted_at = now() where id = ?").param(deleted).update();
        seedMerchantSpend(u, 50_000, "2026-10-14", "food_delivery", "Swiggy");
        UUID statement = seedMerchantSpend(u, 7_000, "2026-10-16", "quick_commerce", "Instamart");
        jdbc.sql("update transactions set merchant_raw_enc = ?, counts_in_budget = false where id = ?")
            .params(new byte[] {1, 2, 3}, statement).update();
    }

    @Test
    void theSpendsWithMerchantTotals() throws Exception { // API-INS-03
        TestUser u = exampleUser();
        quickCommerce(u);
        String body = mvc.perform(get("/api/v1/insights/category/quick_commerce").with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value("quick_commerce"))
            .andExpect(jsonPath("$.name").value("Quick commerce"))
            .andExpect(jsonPath("$.cycleStart").value("2026-10-01"))
            .andExpect(jsonPath("$.spentPaise").value(68_000))
            .andExpect(jsonPath("$.count").value(5))
            .andExpect(jsonPath("$.countKind").value("ORDERS"))
            .andExpect(jsonPath("$.merchants.length()").value(2))
            .andExpect(jsonPath("$.merchants[0].merchant").value("Blinkit"))
            .andExpect(jsonPath("$.merchants[0].spentPaise").value(40_000))
            .andExpect(jsonPath("$.merchants[0].count").value(2))
            .andExpect(jsonPath("$.merchants[1].spentPaise").value(28_000))
            .andExpect(jsonPath("$.merchants[1].count").value(3))
            .andExpect(jsonPath("$.spends.length()").value(6))
            .andExpect(jsonPath("$.spends[0].merchant").value("Zepto"))
            .andExpect(jsonPath("$.spends[0].occurredAt").value("2026-10-22T06:30:00Z"))
            .andExpect(jsonPath("$.spends[0].kind").value("SPEND"))
            .andExpect(jsonPath("$.spends[0].paymentMethod").value("UPI"))
            .andExpect(jsonPath("$.spends[?(@.kind == 'REFUND')].amountPaise").value(5_000))
            .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("Instamart").doesNotContain("Swiggy").doesNotContain("raw");
    }

    @Test
    void itMatchesTheInsightsRow() throws Exception {
        TestUser u = exampleUser();
        quickCommerce(u);
        mvc.perform(get("/api/v1/insights/cycle").with(auth(u)))
            .andExpect(jsonPath("$.categories[?(@.code == 'quick_commerce')].spentPaise").value(68_000))
            .andExpect(jsonPath("$.categories[?(@.code == 'quick_commerce')].count").value(5));
    }

    @Test
    void anEmptyCategoryAnswersWithNoSpends() throws Exception {
        TestUser u = exampleUser();
        mvc.perform(get("/api/v1/insights/category/health").with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.spentPaise").value(0))
            .andExpect(jsonPath("$.count").value(0))
            .andExpect(jsonPath("$.countKind").value("NONE"))
            .andExpect(jsonPath("$.merchants.length()").value(0))
            .andExpect(jsonPath("$.spends.length()").value(0));
    }

    @Test
    void unnamedSpendsGroupTogether() throws Exception {
        TestUser u = exampleUser();
        seedMerchantSpend(u, 10_000, "2026-10-02", "other", null);
        seedMerchantSpend(u, 10_000, "2026-10-03", "other", "  ");
        mvc.perform(get("/api/v1/insights/category/other").with(auth(u)))
            .andExpect(jsonPath("$.merchants.length()").value(1))
            .andExpect(jsonPath("$.merchants[0].merchant").doesNotExist())
            .andExpect(jsonPath("$.merchants[0].count").value(2));
    }

    @Test
    void anUnknownCategoryIsNotFound() throws Exception { // API-INS-04
        TestUser u = exampleUser();
        mvc.perform(get("/api/v1/insights/category/crypto").with(auth(u)))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(get("/api/v1/insights/category/quick_commerce' OR 1=1 --").with(auth(u)))
            .andExpect(status().isNotFound());
    }

    @Test
    void anotherUsersCycleIsNotFound() throws Exception { // API-X-01
        TestUser owner = exampleUser();
        quickCommerce(owner);
        budgetToday(owner).andExpect(status().isOk()); // opens October for this user
        UUID oct = cycleIdStarting(owner, "2026-10-01");
        TestUser other = exampleUser();
        mvc.perform(get("/api/v1/insights/category/quick_commerce").param("cycleId", oct.toString()).with(auth(other)))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/insights/category/quick_commerce").with(auth(other)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.spends.length()").value(0));
    }
}
```

`seedMerchantSpend(u, …, null)` inserts a null `merchant_name` (Plan 6's helper binds it as given).

- [ ] **Step 2: Run it to see it fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.CategoryInsightsApiTest'`
Expected: FAIL (404 `NOT_FOUND` from the unknown route on the happy path, or compilation errors once the test references are added).

- [ ] **Step 3: Write the code**

`server/src/main/java/in/gullak/insights/CategorySpend.java`:

```java
package in.gullak.insights;

import java.time.Instant;
import java.util.UUID;

/** One row of the drill-down. {@code merchant} is the clean display name; {@code paymentMethod} is UPI, CARD, CASH or UNKNOWN. */
public record CategorySpend(UUID id, Kind kind, long amountPaise, Instant occurredAt, String merchant, String paymentMethod) {
    public enum Kind { SPEND, REFUND }
}
```

`server/src/main/java/in/gullak/insights/MerchantTotal.java`:

```java
package in.gullak.insights;

/** Debits minus refunds for one merchant in the category; {@code count} is the number of debits. */
public record MerchantTotal(String merchant, long spentPaise, int count) {}
```

`server/src/main/java/in/gullak/insights/CategoryInsights.java`:

```java
package in.gullak.insights;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Spec 3.2 #4: the spends in one category this cycle, with totals by merchant. */
public record CategoryInsights(
    UUID cycleId,
    LocalDate cycleStart,
    LocalDate cycleEnd,
    String code,
    String name,
    long spentPaise,
    int count,
    CountKind countKind,
    List<MerchantTotal> merchants,
    List<CategorySpend> spends) {}
```

`server/src/main/java/in/gullak/insights/CategorySpendRepository.java`:

```java
package in.gullak.insights;

import in.gullak.common.db.Db;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * The drill-down's two aggregates, with the same filter as Plan 3's category totals (debits that count in the
 * budget, refunds subtracted). Only merchant_name is selected; merchant_raw_enc never leaves this table.
 */
@Repository
class CategorySpendRepository {
    private static final String WHERE = """
        where user_id = ? and category_code = ? and deleted_at is null and counts_in_budget
          and (direction = 'debit' or credit_kind = 'refund')
          and occurred_at >= ? and occurred_at < ?
        """;

    private final JdbcClient jdbc;

    CategorySpendRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    List<CategorySpend> spends(UUID userId, String code, Instant from, Instant to, int limit) {
        return jdbc.sql("select id, direction, amount_paise, occurred_at, merchant_name, upper(payment_method) from transactions "
                + WHERE + " order by occurred_at desc, id desc limit ?")
            .params(userId, code, Db.ts(from), Db.ts(to), limit)
            .query((rs, n) -> new CategorySpend(
                rs.getObject(1, UUID.class),
                "debit".equals(rs.getString(2)) ? CategorySpend.Kind.SPEND : CategorySpend.Kind.REFUND,
                rs.getLong(3),
                rs.getObject(4, OffsetDateTime.class).toInstant(),
                blankToNull(rs.getString(5)),
                rs.getString(6)))
            .list();
    }

    List<MerchantTotal> merchants(UUID userId, String code, Instant from, Instant to) {
        return jdbc.sql("""
                select min(btrim(merchant_name)) as name,
                       sum(case when direction = 'debit' then amount_paise else -amount_paise end) as spent,
                       count(*) filter (where direction = 'debit') as debits
                from transactions
                """ + WHERE + """
                group by lower(regexp_replace(btrim(coalesce(merchant_name, '')), '\\s+', ' ', 'g'))
                order by spent desc, name nulls last
                """)
            .params(userId, code, Db.ts(from), Db.ts(to))
            .query((rs, n) -> new MerchantTotal(blankToNull(rs.getString(1)), rs.getLong(2), rs.getInt(3)))
            .list();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }
}
```

In the merchants query, `min(btrim(merchant_name))` picks one spelling for a merchant typed several ways ("Zepto", "zepto "); which one depends on the database collation, so tests assert totals, not that spelling. A group of unnamed spends has the empty key and a null name. The deleted ₹990 spend is left out of both queries; `spentPaise` 68000 proves it.

In `server/src/main/java/in/gullak/insights/InsightsService.java`, add the field and constructor parameter `CategorySpendRepository spends` and the import `in.gullak.ingestion.Category` and `java.time.Instant`. The constructor becomes:

```java
    private final CategorySpendRepository spends;

    InsightsService(BudgetService budget, CycleService cycles, TransactionService transactions, CategoryService categories,
                    SubscriptionService subscriptions, CategorySpendRepository spends, Clock clock) {
        this.budget = budget;
        this.cycles = cycles;
        this.transactions = transactions;
        this.categories = categories;
        this.subscriptions = subscriptions;
        this.spends = spends;
        this.clock = clock;
    }
```

and add this method after `cycle`:

```java
    /** At most this many spends are listed; the totals always cover every spend. */
    static final int MAX_SPENDS = 500;

    /** The drill-down for one category. 404 for an unknown code or another user's cycle. */
    @Transactional
    public CategoryInsights category(UUID userId, String code, UUID cycleIdOrNull) {
        Category category = categories.get(code);
        UUID cycleId = cycleIdOrNull != null ? cycleIdOrNull : budget.currentCycle(userId).id();
        CycleFigures f = budget.figures(userId, cycleId, Ist.today(clock));
        if (f.through().isBefore(f.start())) {
            return new CategoryInsights(cycleId, f.start(), f.end(), category.code(), category.name(), 0, 0,
                CountKind.of(category.code()), List.of(), List.of());
        }
        Instant from = Ist.startOf(f.start());
        Instant to = Ist.startOf(f.through().plusDays(1));
        List<MerchantTotal> merchants = spends.merchants(userId, category.code(), from, to);
        long spent = merchants.stream().mapToLong(MerchantTotal::spentPaise).sum();
        int count = merchants.stream().mapToInt(MerchantTotal::count).sum();
        return new CategoryInsights(cycleId, f.start(), f.end(), category.code(), category.name(), spent, count,
            CountKind.of(category.code()), merchants, spends.spends(userId, category.code(), from, to, MAX_SPENDS));
    }
```

In `server/src/main/java/in/gullak/insights/InsightsController.java`, add the import `org.springframework.web.bind.annotation.PathVariable` and:

```java
    @GetMapping("/category/{code}")
    CategoryInsights category(@AuthenticationPrincipal Jwt jwt, @PathVariable String code,
                              @RequestParam(required = false) UUID cycleId) {
        return insights.category(CurrentUser.id(jwt), code, cycleId);
    }
```

The code is checked against the categories table by `CategoryService.get` before any query uses it, and every query binds it as a parameter.

- [ ] **Step 4: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.*'`
Expected: PASS (`CategoryInsightsApiTest` 6 tests and the earlier ones).

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/in/gullak/insights server/src/test/java/in/gullak/insights/CategoryInsightsApiTest.java
git commit -m "feat(insights): category drill-down with merchant totals and refunds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Forecast and just-closed cycle on `GET /budget/today`

**Owner:** backend-engineer. **Test IDs:** API-TDY-01 (the forecast half: "₹1,700 extra saved at this pace"), API-TDY-10 (new: `justClosed` for the first 7 days of a cycle while the leftover is unchosen), API-TDY-01 to 08 (regression). **Red team:** no (no new endpoint; the fields reuse Task 5's service, and Task 9 sweeps isolation).

**Files:**
- Create: `server/src/main/java/in/gullak/common/insights/HomeForecast.java`, `JustClosed.java`, `HomeInsights.java`, `HomeInsightsSource.java`
- Create: `server/src/main/java/in/gullak/insights/HomeInsightsService.java`
- Modify: `server/src/main/java/in/gullak/budget/TodayResponse.java` (two components and `withInsights`), `server/src/main/java/in/gullak/budget/BudgetService.java` (constructor, `today`, `setFirstCyclePool`, `homeInsights`)
- Test: `server/src/test/java/in/gullak/budget/TodayInsightsApiTest.java`

**Interfaces:**
- Consumes: Task 5's `InsightsService.forecast(UUID, UUID) : Forecast`; Plan 5's `CycleService.covering`, `CycleRecord`, `BudgetService.open` (private `Opened(profile, today, fixed, current)`), `TodayResponse.tomorrowPaise`, `catchUp`; Plan 6's `TodayResponse.game`, `withGame`, `HomeGameSource`.
- Produces:
  - `common.insights.HomeForecast(long spendPaise, long extraSavedPaise, boolean offTrack)`, `common.insights.JustClosed(UUID cycleId, LocalDate cycleStart, LocalDate cycleEnd, long leftoverPaise)`, `common.insights.HomeInsights(HomeForecast forecast, JustClosed justClosed)` with `NONE`, `common.insights.HomeInsightsSource.forHome(UUID userId, UUID cycleId, LocalDate cycleStart, LocalDate today) : HomeInsights`
  - `TodayResponse.forecast` and `TodayResponse.justClosed` (both nullable), `TodayResponse.withInsights(HomeInsights)`. JSON additions on `GET /api/v1/budget/today`: `"forecast":{"spendPaise":1330000,"extraSavedPaise":170000,"offTrack":false}` (null in the first two days of a cycle or before anything is spent) and `"justClosed":{"cycleId":"…","cycleStart":"2026-10-01","cycleEnd":"2026-10-31","leftoverPaise":170000}` (null otherwise)

- [ ] **Step 1: Write the failing test**

`server/src/test/java/in/gullak/budget/TodayInsightsApiTest.java`:

```java
package in.gullak.budget;

import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.goals.CycleCloseService;
import in.gullak.goals.LeftoverChoice;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class TodayInsightsApiTest extends ApiTest {
    static final Instant EARLIER_THIS_CYCLE = Instant.parse("2026-10-10T06:00:00Z");
    static final Instant TODAY_COFFEE = Instant.parse("2026-10-23T04:00:00Z");

    @Autowired CycleCloseService closer;

    @Test
    void theExampleDayHasTheForecast() throws Exception { // API-TDY-01: "₹1,700 extra saved at this pace"
        TestUser u = exampleUser();
        seedSpend(u, 966_000, EARLIER_THIS_CYCLE);
        seedSpend(u, 18_000, TODAY_COFFEE);
        budgetToday(u)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.budgetPaise").value(59_300))
            .andExpect(jsonPath("$.leftPaise").value(41_300))
            .andExpect(jsonPath("$.forecast.spendPaise").value(1_330_000))
            .andExpect(jsonPath("$.forecast.extraSavedPaise").value(170_000))
            .andExpect(jsonPath("$.forecast.offTrack").value(false))
            .andExpect(jsonPath("$.justClosed").doesNotExist());
    }

    @Test
    void overspendingShowsOffTrack() throws Exception {
        TestUser u = exampleUser();
        seedSpend(u, 1_400_000, EARLIER_THIS_CYCLE);
        budgetToday(u)
            .andExpect(jsonPath("$.forecast.extraSavedPaise").value(-390_000)) // 14,000 × 31 ÷ 23 = 18,869 → ₹18,900
            .andExpect(jsonPath("$.forecast.offTrack").value(true));
    }

    @Test
    void noForecastOnHomeInTheFirstTwoDays() throws Exception { // Review Focus
        TestUser u = exampleUser();
        seedSpend(u, 50_000, Instant.parse("2026-11-01T06:00:00Z"));
        clock.set(Instant.parse("2026-11-02T06:00:00Z"));
        budgetToday(u).andExpect(status().isOk()).andExpect(jsonPath("$.forecast").doesNotExist());
        clock.set(Instant.parse("2026-11-03T06:00:00Z"));
        budgetToday(u).andExpect(jsonPath("$.forecast.spendPaise").exists());
    }

    @Test
    void noForecastBeforeAnythingIsSpent() throws Exception {
        TestUser u = exampleUser();
        budgetToday(u).andExpect(jsonPath("$.forecast").doesNotExist());
    }

    @Test
    void theClosedCycleShowsForAWeekUntilChosen() throws Exception { // API-TDY-10
        TestUser u = exampleUser();
        seedSpend(u, 1_330_000, EARLIER_THIS_CYCLE);
        budgetToday(u).andExpect(status().isOk()); // opens October for this user
        UUID oct = cycleIdStarting(u, "2026-10-01");
        clock.set(Instant.parse("2026-11-01T04:00:00Z"));
        budgetToday(u)
            .andExpect(jsonPath("$.justClosed.cycleId").value(oct.toString()))
            .andExpect(jsonPath("$.justClosed.cycleStart").value("2026-10-01"))
            .andExpect(jsonPath("$.justClosed.cycleEnd").value("2026-10-31"))
            .andExpect(jsonPath("$.justClosed.leftoverPaise").value(170_000));
        clock.set(Instant.parse("2026-11-07T04:00:00Z"));
        budgetToday(u).andExpect(jsonPath("$.justClosed.cycleId").value(oct.toString()));
        clock.set(Instant.parse("2026-11-08T04:00:00Z"));
        budgetToday(u).andExpect(jsonPath("$.justClosed").doesNotExist());
    }

    @Test
    void choosingHidesIt() throws Exception { // API-TDY-10
        TestUser u = exampleUser();
        seedSpend(u, 1_330_000, EARLIER_THIS_CYCLE);
        budgetToday(u).andExpect(status().isOk()); // opens October for this user
        UUID oct = cycleIdStarting(u, "2026-10-01");
        clock.set(Instant.parse("2026-11-01T04:00:00Z"));
        budgetToday(u).andExpect(jsonPath("$.justClosed.cycleId").exists());
        closer.applyChoice(u.id(), oct, LeftoverChoice.SAVINGS);
        budgetToday(u).andExpect(jsonPath("$.justClosed").doesNotExist());
    }

    @Test
    void aFirstCycleHasNothingJustClosed() throws Exception {
        TestUser u = exampleUser();
        budgetToday(u).andExpect(status().isOk()); // October exists for this user
        clock.set(Instant.parse("2026-11-01T04:00:00Z"));
        budgetToday(u).andExpect(status().isOk()).andExpect(jsonPath("$.justClosed.leftoverPaise").value(1_500_000));
        TestUser fresh = exampleUser(); // first request on 1 Nov: no October row exists for this user
        budgetToday(fresh).andExpect(jsonPath("$.justClosed").doesNotExist());
    }
}
```

In `aFirstCycleHasNothingJustClosed`, the first user opens October on 23 Oct (nothing spent, so ₹15,000 is left over at close); the second user is created on 1 Nov and has only November.

- [ ] **Step 2: Run it to see it fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.budget.TodayInsightsApiTest'`
Expected: FAIL (`$.forecast` does not exist).

- [ ] **Step 3: The seam in `common`**

`server/src/main/java/in/gullak/common/insights/HomeForecast.java`:

```java
package in.gullak.common.insights;

/** Home's forecast line ("₹1,700 extra saved at this pace"). Rounded to ₹100 like the Insights sentence. */
public record HomeForecast(long spendPaise, long extraSavedPaise, boolean offTrack) {}
```

`server/src/main/java/in/gullak/common/insights/JustClosed.java`:

```java
package in.gullak.common.insights;

import java.time.LocalDate;
import java.util.UUID;

/** The previous cycle, closed with its leftover not yet chosen: Home's card that opens the cycle summary. */
public record JustClosed(UUID cycleId, LocalDate cycleStart, LocalDate cycleEnd, long leftoverPaise) {}
```

`server/src/main/java/in/gullak/common/insights/HomeInsights.java`:

```java
package in.gullak.common.insights;

/** What insights adds to GET /budget/today; either part may be null. */
public record HomeInsights(HomeForecast forecast, JustClosed justClosed) {
    public static final HomeInsights NONE = new HomeInsights(null, null);
}
```

`server/src/main/java/in/gullak/common/insights/HomeInsightsSource.java`:

```java
package in.gullak.common.insights;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Implemented by insights, read by budget for GET /budget/today. Lives in common because insights depends on
 * budget (cycle figures) and budget must never depend on insights.
 */
public interface HomeInsightsSource {
    HomeInsights forHome(UUID userId, UUID cycleId, LocalDate cycleStart, LocalDate today);
}
```

- [ ] **Step 4: Insights' side**

`server/src/main/java/in/gullak/insights/HomeInsightsService.java`:

```java
package in.gullak.insights;

import in.gullak.budget.CycleService;
import in.gullak.common.insights.HomeForecast;
import in.gullak.common.insights.HomeInsights;
import in.gullak.common.insights.HomeInsightsSource;
import in.gullak.common.insights.JustClosed;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Home's forecast line and the "cycle just closed" card. Runs inside GET /budget/today's transaction. */
@Service
class HomeInsightsService implements HomeInsightsSource {
    /** The card shows for the first week of the new cycle. */
    static final int JUST_CLOSED_DAYS = 7;

    private final InsightsService insights;
    private final CycleService cycles;

    HomeInsightsService(InsightsService insights, CycleService cycles) {
        this.insights = insights;
        this.cycles = cycles;
    }

    @Override
    public HomeInsights forHome(UUID userId, UUID cycleId, LocalDate cycleStart, LocalDate today) {
        Forecast f = insights.forecast(userId, cycleId);
        HomeForecast forecast = f.early() || f.spentPaise() <= 0
            ? null
            : new HomeForecast(f.spendPaise(), f.extraSavedPaise(), f.offTrack());
        JustClosed justClosed = today.isBefore(cycleStart.plusDays(JUST_CLOSED_DAYS))
            ? cycles.covering(userId, cycleStart.minusDays(1))
                .filter(c -> c.closedAt() != null && c.leftoverChoice() == null)
                .map(c -> new JustClosed(c.id(), c.cycle().start(), c.cycle().end(),
                    c.leftoverPaise() == null ? 0 : c.leftoverPaise()))
                .orElse(null)
            : null;
        return new HomeInsights(forecast, justClosed);
    }
}
```

- [ ] **Step 5: Budget's side**

Replace `server/src/main/java/in/gullak/budget/TodayResponse.java` with the version below. It lists the components of Plans 1, 5 and 6 in their order; if another plan added a component, keep it in place before `forecast` and pass it through in the convenience constructor, `withGame` and `withInsights`:

```java
package in.gullak.budget;

import in.gullak.common.game.HomeGame;
import in.gullak.common.insights.HomeForecast;
import in.gullak.common.insights.HomeInsights;
import in.gullak.common.insights.JustClosed;
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
    /** Tomorrow's budget if nothing more is spent today; null on the cycle's last day (Plan 5). */
    Long tomorrowPaise,
    /** The catch-up card (spec 2.2), or null (Plan 5). */
    CatchUp catchUp,
    /** Streak, level, stage and celebrations (Plan 6). */
    HomeGame game,
    /** "₹1,700 extra saved at this pace", or null (Plan 7). */
    HomeForecast forecast,
    /** The previous cycle waiting for its leftover choice, or null (Plan 7). */
    JustClosed justClosed) {

    /** Construction sites that compute figures only; today() adds the game strip and insights. */
    public TodayResponse(LocalDate date, long budgetPaise, long spentPaise, long leftPaise, long overPaise,
                         long poolOverPaise, Mood mood, String line, int daysLeft, LocalDate cycleStart, LocalDate cycleEnd,
                         Long tomorrowPaise, CatchUp catchUp) {
        this(date, budgetPaise, spentPaise, leftPaise, overPaise, poolOverPaise, mood, line, daysLeft, cycleStart, cycleEnd,
            tomorrowPaise, catchUp, HomeGame.NONE, null, null);
    }

    public TodayResponse withGame(HomeGame game) {
        return new TodayResponse(date, budgetPaise, spentPaise, leftPaise, overPaise, poolOverPaise, mood, line, daysLeft,
            cycleStart, cycleEnd, tomorrowPaise, catchUp, game, forecast, justClosed);
    }

    public TodayResponse withInsights(HomeInsights insights) {
        return new TodayResponse(date, budgetPaise, spentPaise, leftPaise, overPaise, poolOverPaise, mood, line, daysLeft,
            cycleStart, cycleEnd, tomorrowPaise, catchUp, game, insights.forecast(), insights.justClosed());
    }
}
```

If a construction site elsewhere passes `game` as a fourteenth argument, append `, null, null` to it.

In `server/src/main/java/in/gullak/budget/BudgetService.java`: add the import `in.gullak.common.insights.HomeInsights` and `in.gullak.common.insights.HomeInsightsSource`, the field `private final ObjectProvider<HomeInsightsSource> insights;`, and the constructor parameter `ObjectProvider<HomeInsightsSource> insights` (assigned in the constructor). The constructor, as Plans 5 and 6 left it plus this parameter, reads:

```java
    BudgetService(ProfileService profiles, FixedCostService fixedCosts, CycleService cycles,
                  SpendTotalsRepository totals, ObjectProvider<BudgetAdjustment> adjustments, HomeGameSource game,
                  ObjectProvider<HomeInsightsSource> insights, Clock clock) {
        this.profiles = profiles;
        this.fixedCosts = fixedCosts;
        this.cycles = cycles;
        this.totals = totals;
        this.adjustments = adjustments;
        this.game = game;
        this.insights = insights;
        this.clock = clock;
    }
```

(keep any other parameter Plan 3 added in its place). Replace `today` and `setFirstCyclePool` and add `homeInsights`:

```java
    /** One transaction so every figure comes from the same snapshot; read-write because it may open a cycle. */
    @Transactional
    public TodayResponse today(UUID userId) {
        Opened opened = open(userId);
        return compute(userId, opened, true).response()
            .withGame(game.forHome(userId))
            .withInsights(homeInsights(userId, opened));
    }

    @Transactional
    public TodayResponse setFirstCyclePool(UUID userId, long moneyLeftPaise) {
        Opened before = open(userId);
        cycles.setFirstCyclePool(userId, before.current(), moneyLeftPaise);
        Opened opened = open(userId);
        return compute(userId, opened, true).response()
            .withGame(game.forHome(userId))
            .withInsights(homeInsights(userId, opened));
    }

    /** Plan 7's forecast line and just-closed card; absent when no insights bean exists (slice tests). */
    private HomeInsights homeInsights(UUID userId, Opened o) {
        HomeInsightsSource source = insights.getIfAvailable();
        return source == null
            ? HomeInsights.NONE
            : source.forHome(userId, o.current().id(), o.current().cycle().start(), o.today());
    }
```

`ObjectProvider` is what breaks the constructor cycle: `HomeInsightsService` → `InsightsService` → `BudgetService` → `HomeInsightsSource`. The source is looked up on each call, after the context is built.

- [ ] **Step 6: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.budget.*' --tests 'in.gullak.insights.*' --tests 'in.gullak.rules.*'`
Expected: PASS (`TodayInsightsApiTest` 7 tests; Plan 1's `TodayApiTest`, Plan 5's `BudgetHooksApiTest` and Plan 6's `TodayGameApiTest` unchanged; the ArchUnit rules see `budget → common.insights` only).

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/main/java/in/gullak/common/insights server/src/main/java/in/gullak/insights/HomeInsightsService.java server/src/main/java/in/gullak/budget/TodayResponse.java server/src/main/java/in/gullak/budget/BudgetService.java server/src/test/java/in/gullak/budget/TodayInsightsApiTest.java
git commit -m "feat(server): forecast line and just-closed cycle on GET /budget/today

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Cycle summary and the leftover choice

**Owner:** backend-engineer (the two app files at the end are a mechanical regeneration and two message lines). **Test IDs:** API-CYC-01, 02, 03, 04, 05, 06, 07, API-CYC-08 (new: two choices at once record one), API-X-01 (cycles). **Red team:** yes (another user's cycle id; choosing twice, in parallel, or on an open cycle; a choice that does not fit the leftover; replaying a rollover to inflate the next pool).

**Files:**
- Create: `server/src/main/java/in/gullak/insights/TopCategory.java`, `BadgeEarned.java`, `CycleSummary.java`, `LeftoverRequest.java`, `CycleSummaryService.java`, `CycleSummaryController.java`
- Modify: `server/src/main/java/in/gullak/common/error/ErrorCode.java` (append two codes), `app/src/lib/errors.ts` (two messages), `app/src/lib/error-codes.ts` (regenerated)
- Test: `server/src/test/java/in/gullak/insights/CycleSummaryApiTest.java`

**Interfaces:**
- Consumes: Plan 5's `CycleCloseService.closeEndedBefore(UUID, LocalDate) : int`, `CycleCloseService.applyChoice(UUID, UUID, LeftoverChoice) : CycleClose.Result` (422 `NOT_POSSIBLE` for an open cycle, a second choice or a choice that does not fit), `LeftoverChoice {SAVINGS, ROLLOVER, CARRY, TAKE}`, `CycleService.find`, `CycleRecord`, `ConflictException(ErrorCode, String)`; Plan 6's `DailyCloseService.find(UUID, LocalDate) : Optional<DailyCloseView>` with `grade()`, `Grade`, `BadgeService.earned(UUID) : List<EarnedBadge>` with `code()` and `earnedAt()`; Task 5's `BudgetService.figures`, `InsightsService.forecast`, `InsightsService.rows`.
- Produces:
  - `ErrorCode.CYCLE_OPEN` (409), `ErrorCode.ALREADY_CHOSEN` (409)
  - `GET /api/v1/budget/cycles/{id}/summary` →
    `{"cycleId":"…","cycleStart":"2026-10-01","cycleEnd":"2026-10-31","closed":true,"spentPaise":1330000,"spendablePaise":1500000,"savedPaise":2170000,"extraSavedPaise":170000,"leftoverPaise":170000,"leftoverChoice":null,"choices":["SAVINGS","ROLLOVER"],"grades":{"A_PLUS":3,"A":0,"B":2,"C":0,"D":0,"F":1},"topCategories":[{"code":"shopping","name":"Shopping","spentPaise":500000},…],"badges":[{"code":"FIRST_LOG","earnedOn":"2026-10-05"}],"forecast":null}`; an open cycle has `closed:false`, figures so far, `extraSavedPaise`/`leftoverPaise`/`leftoverChoice` null, `choices:[]` and a `forecast`
  - `POST /api/v1/budget/cycles/{id}/leftover {"choice":"ROLLOVER"}` → 200 with the summary; 404 another user's cycle; 409 `CYCLE_OPEN`; 409 `ALREADY_CHOSEN`; 422 `NOT_POSSIBLE` when the choice does not fit the leftover's sign; 400 `VALIDATION` for any other value
  - `CycleSummaryService.summary(UUID userId, UUID cycleId) : CycleSummary`, `CycleSummaryService.chooseLeftover(UUID userId, UUID cycleId, LeftoverChoice) : CycleSummary`

- [ ] **Step 1: Write the failing test**

`server/src/test/java/in/gullak/insights/CycleSummaryApiTest.java`:

```java
package in.gullak.insights;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class CycleSummaryApiTest extends ApiTest {
    static final Instant NOV_1 = Instant.parse("2026-11-01T04:00:00Z");

    void close(TestUser u, String date, String grade) {
        jdbc.sql("""
                insert into daily_closes (id, user_id, date, budget_paise, spent_paise, grade, under_budget)
                values (?, ?, ?, 50000, 10000, ?, true)
                """)
            .params(UUID.randomUUID(), u.id(), LocalDate.parse(date), grade).update();
    }

    void badge(TestUser u, String code, String earnedAt) {
        jdbc.sql("insert into user_badges (id, user_id, badge_code, earned_at) values (?, ?, ?, ?)")
            .params(UUID.randomUUID(), u.id(), code, OffsetDateTime.parse(earnedAt)).update();
    }

    /** October with ₹13,300 spent in four categories, six closed days and four badges around it. */
    UUID october(TestUser u, long extraShopping) throws Exception {
        budgetToday(u).andExpect(status().isOk());
        UUID oct = cycleIdStarting(u, "2026-10-01");
        seedMerchantSpend(u, 500_000 + extraShopping, "2026-10-05", "shopping", "Myntra");
        seedMerchantSpend(u, 400_000, "2026-10-08", "food_delivery", "Swiggy");
        seedMerchantSpend(u, 300_000, "2026-10-12", "quick_commerce", "Zepto");
        seedMerchantSpend(u, 130_000, "2026-10-15", "eating_out", "Toit");
        close(u, "2026-10-01", "A_PLUS");
        close(u, "2026-10-02", "A_PLUS");
        close(u, "2026-10-03", "A_PLUS");
        close(u, "2026-10-04", "B");
        close(u, "2026-10-05", "B");
        close(u, "2026-10-06", "F");
        badge(u, "WEEK_WARRIOR", "2026-09-20T06:00:00Z");      // before the cycle
        badge(u, "FIRST_LOG", "2026-10-05T06:00:00Z");
        badge(u, "SORTED", "2026-10-31T18:00:00Z");            // 23:30 IST on 31 Oct: in
        badge(u, "ZEPTO_FREE_WEEK", "2026-10-31T19:00:00Z");   // 00:30 IST on 1 Nov: out
        return oct;
    }

    ResultActions summary(TestUser u, UUID cycle) throws Exception {
        return mvc.perform(get("/api/v1/budget/cycles/" + cycle + "/summary").with(auth(u)));
    }

    ResultActions choose(TestUser u, UUID cycle, String body) throws Exception {
        return mvc.perform(post("/api/v1/budget/cycles/" + cycle + "/leftover").with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    @Test
    void aClosedCycle() throws Exception { // API-CYC-01
        TestUser u = exampleUser();
        UUID oct = october(u, 0);
        clock.set(NOV_1);
        budgetToday(u).andExpect(status().isOk());
        summary(u, oct)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.cycleId").value(oct.toString()))
            .andExpect(jsonPath("$.closed").value(true))
            .andExpect(jsonPath("$.spentPaise").value(1_330_000))
            .andExpect(jsonPath("$.spendablePaise").value(1_500_000))
            .andExpect(jsonPath("$.leftoverPaise").value(170_000))
            .andExpect(jsonPath("$.extraSavedPaise").value(170_000))
            .andExpect(jsonPath("$.savedPaise").value(2_170_000))
            .andExpect(jsonPath("$.leftoverChoice").doesNotExist())
            .andExpect(jsonPath("$.choices[0]").value("SAVINGS"))
            .andExpect(jsonPath("$.choices[1]").value("ROLLOVER"))
            .andExpect(jsonPath("$.grades.A_PLUS").value(3))
            .andExpect(jsonPath("$.grades.A").value(0))
            .andExpect(jsonPath("$.grades.B").value(2))
            .andExpect(jsonPath("$.grades.C").value(0))
            .andExpect(jsonPath("$.grades.D").value(0))
            .andExpect(jsonPath("$.grades.F").value(1))
            .andExpect(jsonPath("$.topCategories.length()").value(3))
            .andExpect(jsonPath("$.topCategories[0].code").value("shopping"))
            .andExpect(jsonPath("$.topCategories[0].name").value("Shopping"))
            .andExpect(jsonPath("$.topCategories[0].spentPaise").value(500_000))
            .andExpect(jsonPath("$.topCategories[1].code").value("food_delivery"))
            .andExpect(jsonPath("$.topCategories[2].code").value("quick_commerce"))
            .andExpect(jsonPath("$.badges.length()").value(2))
            .andExpect(jsonPath("$.badges[0].code").value("FIRST_LOG"))
            .andExpect(jsonPath("$.badges[0].earnedOn").value("2026-10-05"))
            .andExpect(jsonPath("$.badges[1].code").value("SORTED"))
            .andExpect(jsonPath("$.badges[1].earnedOn").value("2026-10-31"))
            .andExpect(jsonPath("$.forecast").doesNotExist());
    }

    @Test
    void anOpenCycleShowsFiguresSoFar() throws Exception { // API-CYC-02
        TestUser u = exampleUser();
        budgetToday(u).andExpect(status().isOk());
        UUID oct = cycleIdStarting(u, "2026-10-01");
        seedSpend(u, 966_000, Instant.parse("2026-10-10T06:00:00Z"));
        seedSpend(u, 18_000, Instant.parse("2026-10-23T04:00:00Z"));
        summary(u, oct)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.closed").value(false))
            .andExpect(jsonPath("$.spentPaise").value(984_000))
            .andExpect(jsonPath("$.savedPaise").value(2_000_000))
            .andExpect(jsonPath("$.extraSavedPaise").doesNotExist())
            .andExpect(jsonPath("$.leftoverPaise").doesNotExist())
            .andExpect(jsonPath("$.choices.length()").value(0))
            .andExpect(jsonPath("$.forecast.spendPaise").value(1_330_000))
            .andExpect(jsonPath("$.forecast.extraSavedPaise").value(170_000));
    }

    @Test
    void anotherUsersCycleIsNotFound() throws Exception { // API-CYC-03, API-X-01
        TestUser owner = exampleUser();
        UUID oct = october(owner, 0);
        clock.set(NOV_1);
        TestUser other = exampleUser();
        summary(other, oct).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        choose(other, oct, "{\"choice\":\"ROLLOVER\"}").andExpect(status().isNotFound());
        summary(owner, UUID.randomUUID()).andExpect(status().isNotFound());
        summary(owner, oct).andExpect(jsonPath("$.leftoverChoice").doesNotExist());
    }

    @Test
    void rolloverMovesTheLeftoverIntoTheNextPool() throws Exception { // API-CYC-04
        TestUser u = exampleUser();
        UUID oct = october(u, 0);
        clock.set(NOV_1);
        budgetToday(u).andExpect(jsonPath("$.budgetPaise").value(50_000));
        choose(u, oct, "{\"choice\":\"ROLLOVER\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.leftoverChoice").value("ROLLOVER"))
            .andExpect(jsonPath("$.extraSavedPaise").value(0))
            .andExpect(jsonPath("$.savedPaise").value(2_000_000))
            .andExpect(jsonPath("$.choices.length()").value(0));
        budgetToday(u).andExpect(jsonPath("$.budgetPaise").value(55_600)); // (15,000 + 1,700) ÷ 30
    }

    @Test
    void savingsIsAChoiceToo() throws Exception {
        TestUser u = exampleUser();
        UUID oct = october(u, 0);
        clock.set(NOV_1);
        choose(u, oct, "{\"choice\":\"SAVINGS\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.leftoverChoice").value("SAVINGS"))
            .andExpect(jsonPath("$.savedPaise").value(2_170_000));
        budgetToday(u).andExpect(jsonPath("$.budgetPaise").value(50_000));
    }

    @Test
    void anOpenCycleCannotChoose() throws Exception { // API-CYC-05
        TestUser u = exampleUser();
        budgetToday(u).andExpect(status().isOk());
        UUID oct = cycleIdStarting(u, "2026-10-01");
        choose(u, oct, "{\"choice\":\"ROLLOVER\"}")
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("CYCLE_OPEN"));
    }

    @Test
    void choosingTwiceIsRefused() throws Exception { // API-CYC-06
        TestUser u = exampleUser();
        UUID oct = october(u, 0);
        clock.set(NOV_1);
        choose(u, oct, "{\"choice\":\"ROLLOVER\"}").andExpect(status().isOk());
        choose(u, oct, "{\"choice\":\"SAVINGS\"}")
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("ALREADY_CHOSEN"));
        choose(u, oct, "{\"choice\":\"ROLLOVER\"}").andExpect(jsonPath("$.code").value("ALREADY_CHOSEN"));
        budgetToday(u).andExpect(jsonPath("$.budgetPaise").value(55_600));
    }

    @Test
    void aBadChoiceIsRefused() throws Exception { // API-CYC-07
        TestUser u = exampleUser();
        UUID oct = october(u, 0);
        clock.set(NOV_1);
        choose(u, oct, "{\"choice\":\"burn\"}").andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
        choose(u, oct, "{}").andExpect(status().isBadRequest());
        choose(u, oct, "{\"choice\":\"rollover\"}").andExpect(status().isBadRequest());
        choose(u, oct, "{\"choice\":\"TAKE\"}").andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("NOT_POSSIBLE"));
        summary(u, oct).andExpect(jsonPath("$.leftoverChoice").doesNotExist());
    }

    @Test
    void parallelChoicesRecordOne() throws Exception { // API-CYC-08, Review Focus
        TestUser u = exampleUser();
        UUID oct = october(u, 0);
        clock.set(NOV_1);
        budgetToday(u).andExpect(status().isOk());
        CountDownLatch go = new CountDownLatch(1);
        List<CompletableFuture<Integer>> calls = List.of(1, 2).stream()
            .map(i -> CompletableFuture.supplyAsync(() -> {
                try {
                    go.await();
                    return choose(u, oct, "{\"choice\":\"ROLLOVER\"}").andReturn().getResponse().getStatus();
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            }))
            .toList();
        go.countDown();
        List<Integer> statuses = calls.stream().map(CompletableFuture::join).sorted().toList();
        assertThat(statuses).containsExactly(200, 409);
        budgetToday(u).andExpect(jsonPath("$.budgetPaise").value(55_600));
    }

    @Test
    void anEndedCycleIsClosedOnTheSpot() throws Exception { // Review Focus
        TestUser u = exampleUser();
        UUID oct = october(u, 0);
        clock.set(NOV_1); // no request has opened November yet, and no job has run
        summary(u, oct).andExpect(status().isOk()).andExpect(jsonPath("$.closed").value(true));
        clock.reset(); // back to 23 Oct to set up a second user
        TestUser v = exampleUser();
        UUID oct2 = october(v, 0);
        clock.set(NOV_1);
        choose(v, oct2, "{\"choice\":\"ROLLOVER\"}").andExpect(status().isOk());
    }

    @Test
    void anOverspentCycleOffersCarryOrTake() throws Exception { // spec 2.2 through the summary
        TestUser u = exampleUser();
        UUID oct = october(u, 210_000); // ₹15,400 spent: ₹400 over
        clock.set(NOV_1);
        summary(u, oct)
            .andExpect(jsonPath("$.leftoverPaise").value(-40_000))
            .andExpect(jsonPath("$.extraSavedPaise").value(0))
            .andExpect(jsonPath("$.savedPaise").value(2_000_000))
            .andExpect(jsonPath("$.choices[0]").value("CARRY"))
            .andExpect(jsonPath("$.choices[1]").value("TAKE"));
        choose(u, oct, "{\"choice\":\"TAKE\"}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.leftoverChoice").value("TAKE"))
            .andExpect(jsonPath("$.savedPaise").value(1_960_000));
    }

    @Test
    void needsSignIn() throws Exception {
        mvc.perform(get("/api/v1/budget/cycles/" + UUID.randomUUID() + "/summary")).andExpect(status().isUnauthorized());
    }
}
```

`anEndedCycleIsClosedOnTheSpot` resets the clock to 23 Oct (the `MutableClock` default) before setting up the second user, whose October is then ended but unclosed when the leftover is chosen on 1 Nov.

- [ ] **Step 2: Run it to see it fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.CycleSummaryApiTest'`
Expected: FAIL (404 for the unknown route, and `CYCLE_OPEN` is not a code yet).

- [ ] **Step 3: Error codes**

In `server/src/main/java/in/gullak/common/error/ErrorCode.java`, add before `INTERNAL(false);` (after every code earlier plans appended):

```java
    CYCLE_OPEN(false),
    ALREADY_CHOSEN(false),
```

Run `cd app && npm run gen:errors` to regenerate `app/src/lib/error-codes.ts`, and add to the `messages` map in `app/src/lib/errors.ts`:

```ts
  CYCLE_OPEN: "This cycle is still running. You can choose when it ends.",
  ALREADY_CHOSEN: "You already chose where this money goes",
```

- [ ] **Step 4: Write the code**

`server/src/main/java/in/gullak/insights/TopCategory.java`:

```java
package in.gullak.insights;

public record TopCategory(String code, String name, long spentPaise) {}
```

`server/src/main/java/in/gullak/insights/BadgeEarned.java`:

```java
package in.gullak.insights;

import java.time.LocalDate;

/** A badge earned during the cycle; {@code earnedOn} is the IST day. */
public record BadgeEarned(String code, LocalDate earnedOn) {}
```

`server/src/main/java/in/gullak/insights/CycleSummary.java`:

```java
package in.gullak.insights;

import in.gullak.gamification.Grade;
import in.gullak.goals.LeftoverChoice;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Spec 2.8's cycle summary with 2.1's leftover choice. For an open cycle: figures so far, no leftover, a forecast.
 * {@code choices} lists what the user may still pick (empty once chosen or while open).
 */
public record CycleSummary(
    UUID cycleId,
    LocalDate cycleStart,
    LocalDate cycleEnd,
    boolean closed,
    long spentPaise,
    long spendablePaise,
    long savedPaise,
    Long extraSavedPaise,
    Long leftoverPaise,
    LeftoverChoice leftoverChoice,
    List<LeftoverChoice> choices,
    Map<Grade, Integer> grades,
    List<TopCategory> topCategories,
    List<BadgeEarned> badges,
    Forecast forecast) {}
```

`server/src/main/java/in/gullak/insights/LeftoverRequest.java`:

```java
package in.gullak.insights;

import in.gullak.goals.LeftoverChoice;
import jakarta.validation.constraints.NotNull;

/** "SAVINGS" or "ROLLOVER" for money left, "CARRY" or "TAKE" for an overspent cycle; anything else is 400. */
public record LeftoverRequest(@NotNull LeftoverChoice choice) {}
```

`server/src/main/java/in/gullak/insights/CycleSummaryService.java`:

```java
package in.gullak.insights;

import in.gullak.budget.BudgetService;
import in.gullak.budget.CycleFigures;
import in.gullak.budget.CycleRecord;
import in.gullak.budget.CycleService;
import in.gullak.common.error.ConflictException;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.NotFoundException;
import in.gullak.common.error.UnprocessableException;
import in.gullak.common.time.Ist;
import in.gullak.gamification.BadgeService;
import in.gullak.gamification.DailyCloseService;
import in.gullak.gamification.Grade;
import in.gullak.goals.CycleCloseService;
import in.gullak.goals.LeftoverChoice;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The cycle summary and the leftover choice. Methods are deliberately not @Transactional: each call below runs in
 * its own transaction, so when Plan 5's applyChoice rolls back on a lost race, no outer transaction is left
 * rollback-only and the race can be reported as ALREADY_CHOSEN.
 */
@Service
public class CycleSummaryService {
    private final CycleService cycles;
    private final BudgetService budget;
    private final CycleCloseService closer;
    private final InsightsService insights;
    private final DailyCloseService closes;
    private final BadgeService badges;
    private final Clock clock;

    CycleSummaryService(CycleService cycles, BudgetService budget, CycleCloseService closer, InsightsService insights,
                        DailyCloseService closes, BadgeService badges, Clock clock) {
        this.cycles = cycles;
        this.budget = budget;
        this.closer = closer;
        this.insights = insights;
        this.closes = closes;
        this.badges = badges;
        this.clock = clock;
    }

    /** Closes anything that ended before today first, so a cycle that ended last night is summarised as closed. */
    public CycleSummary summary(UUID userId, UUID cycleId) {
        closer.closeEndedBefore(userId, Ist.today(clock));
        return read(userId, cycleId);
    }

    public CycleSummary chooseLeftover(UUID userId, UUID cycleId, LeftoverChoice choice) {
        closer.closeEndedBefore(userId, Ist.today(clock));
        CycleRecord c = cycles.find(userId, cycleId).orElseThrow(() -> new NotFoundException("Cycle"));
        if (c.closedAt() == null) {
            throw new ConflictException(ErrorCode.CYCLE_OPEN, "This cycle is still running. You can choose when it ends.");
        }
        if (c.leftoverChoice() != null) {
            throw alreadyChosen();
        }
        try {
            closer.applyChoice(userId, cycleId, choice);
        } catch (UnprocessableException e) {
            boolean lostTheRace = cycles.find(userId, cycleId).map(CycleRecord::leftoverChoice).isPresent();
            if (lostTheRace) {
                throw alreadyChosen();
            }
            throw e;
        }
        return read(userId, cycleId);
    }

    private static ConflictException alreadyChosen() {
        return new ConflictException(ErrorCode.ALREADY_CHOSEN, "You already chose where this money goes");
    }

    private CycleSummary read(UUID userId, UUID cycleId) {
        CycleRecord c = cycles.find(userId, cycleId).orElseThrow(() -> new NotFoundException("Cycle"));
        LocalDate today = Ist.today(clock);
        CycleFigures f = budget.figures(userId, cycleId, today);
        boolean closed = c.closedAt() != null;
        boolean started = !f.through().isBefore(f.start());
        List<TopCategory> top = started
            ? insights.rows(userId, f.start(), f.through()).stream()
                .filter(r -> r.spentPaise() > 0).limit(3)
                .map(r -> new TopCategory(r.code(), r.name(), r.spentPaise())).toList()
            : List.of();
        Map<Grade, Integer> grades = grades(userId, f.start(), f.end().isBefore(today) ? f.end() : today.minusDays(1));
        List<BadgeEarned> earned = badges(userId, f.start(), f.end());
        if (!closed) {
            return new CycleSummary(cycleId, f.start(), f.end(), false, f.spentPaise(), f.spendablePaise(), f.savingsPaise(),
                null, null, null, List.of(), grades, top, earned, insights.forecast(userId, cycleId));
        }
        long leftover = c.leftoverPaise() == null ? 0 : c.leftoverPaise();
        LeftoverChoice choice = c.leftoverChoice() == null ? null : LeftoverChoice.valueOf(c.leftoverChoice());
        long extra = leftover > 0 && choice != LeftoverChoice.ROLLOVER ? leftover : 0;
        long taken = leftover < 0 && choice == LeftoverChoice.TAKE ? -leftover : 0;
        List<LeftoverChoice> choices = choice != null || leftover == 0
            ? List.of()
            : leftover > 0 ? List.of(LeftoverChoice.SAVINGS, LeftoverChoice.ROLLOVER) : List.of(LeftoverChoice.CARRY, LeftoverChoice.TAKE);
        return new CycleSummary(cycleId, f.start(), f.end(), true, f.spentPaise(), f.spendablePaise(),
            f.savingsPaise() + extra - taken, extra, leftover, choice, choices, grades, top, earned, null);
    }

    /** Every grade with its count of closed days from {@code from} through {@code to}; zeros included. */
    private Map<Grade, Integer> grades(UUID userId, LocalDate from, LocalDate to) {
        Map<Grade, Integer> counts = new EnumMap<>(Grade.class);
        for (Grade g : Grade.values()) {
            counts.put(g, 0);
        }
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            closes.find(userId, d).ifPresent(v -> counts.merge(v.grade(), 1, Integer::sum));
        }
        return counts;
    }

    /** Badges whose earnedAt falls on an IST day of the cycle, oldest first. */
    private List<BadgeEarned> badges(UUID userId, LocalDate start, LocalDate end) {
        Instant from = Ist.startOf(start);
        Instant to = Ist.startOf(end.plusDays(1));
        return badges.earned(userId).stream()
            .filter(b -> !b.earnedAt().isBefore(from) && b.earnedAt().isBefore(to))
            .sorted(Comparator.comparing(b -> b.earnedAt()))
            .map(b -> new BadgeEarned(b.code(), LocalDate.ofInstant(b.earnedAt(), Ist.ZONE)))
            .toList();
    }
}
```

Catching `UnprocessableException` is a specific business exception, allowed by `SourceRulesTest`; the handler either maps it to `ALREADY_CHOSEN` or rethrows it unchanged.

`server/src/main/java/in/gullak/insights/CycleSummaryController.java`:

```java
package in.gullak.insights;

import in.gullak.common.web.CurrentUser;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Spec 4.6's Today row: the cycle summary and the leftover choice live with insights (budget cannot see goals). */
@RestController
@RequestMapping("/api/v1/budget/cycles")
class CycleSummaryController {
    private final CycleSummaryService summaries;

    CycleSummaryController(CycleSummaryService summaries) {
        this.summaries = summaries;
    }

    @GetMapping("/{id}/summary")
    CycleSummary summary(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return summaries.summary(CurrentUser.id(jwt), id);
    }

    @PostMapping("/{id}/leftover")
    CycleSummary leftover(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody LeftoverRequest body) {
        return summaries.chooseLeftover(CurrentUser.id(jwt), id, body.choice());
    }
}
```

Plan 5's `applyChoice` logs `cycle.leftover_chosen`; this task logs nothing more.

- [ ] **Step 5: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.insights.*' --tests 'in.gullak.goals.*' --tests 'in.gullak.common.error.*'`
Expected: PASS (`CycleSummaryApiTest` 12 tests, Plan 5's cycle-close tests unchanged).

Then: `cd server && ./gradlew test` and `cd app && npm run typecheck && npx jest src/lib`
Expected: PASS (the app's `messages` map covers the two new codes).

- [ ] **Step 6: Commit**

```bash
git add server/src/main/java/in/gullak/common/error/ErrorCode.java server/src/main/java/in/gullak/insights server/src/test/java/in/gullak/insights/CycleSummaryApiTest.java app/src/lib/errors.ts app/src/lib/error-codes.ts
git commit -m "feat(insights): cycle summary and the leftover choice (CYCLE_OPEN, ALREADY_CHOSEN)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Isolation and redaction sweep, docs and test-case edits

**Owner:** qa-engineer. **Test IDs:** API-X-01 (every insights endpoint that takes an id), LOG-05 and SEC-01 (insights traffic), API-X-02 (error shape on the new codes). **Red team:** yes (the whole insights surface: ids from another account, merchant text in bodies and logs, the leftover replayed).

**Files:**
- Test: `server/src/test/java/in/gullak/security/InsightsIsolationApiTest.java`, `server/src/test/java/in/gullak/security/InsightsLogRedactionApiTest.java`
- Modify: `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`, `docs/engineering-standards.md`, `README.md`, `docs/superpowers/plans/README.md`

**Interfaces:**
- Consumes: every endpoint from Tasks 4–8; `ApiTest` helpers `exampleUser`, `seedMerchantSpend`, `cycleIdStarting`, `budgetToday`.
- Produces: nothing new for code; the docs describe this plan's endpoints, events and test IDs.

- [ ] **Step 1: Write the tests**

`server/src/test/java/in/gullak/security/InsightsIsolationApiTest.java`:

```java
package in.gullak.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.insights.SubscriptionService;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/** API-X-01 for Plan 7: every endpoint that takes an id answers 404 with the other user's id and changes nothing. */
class InsightsIsolationApiTest extends ApiTest {
    @Autowired SubscriptionService subscriptions;

    @Test
    void anotherUsersIdsAreNotFoundEverywhere() throws Exception {
        TestUser owner = exampleUser();
        budgetToday(owner).andExpect(status().isOk());
        UUID oct = cycleIdStarting(owner, "2026-10-01");
        seedMerchantSpend(owner, 64_900, "2026-09-03", "subscriptions", "Netflix");
        seedMerchantSpend(owner, 64_900, "2026-10-03", "subscriptions", "Netflix");
        subscriptions.detect(owner.id());
        UUID sub = jdbc.sql("select id from subscriptions where user_id = ?").param(owner.id()).query(UUID.class).single();
        clock.set(Instant.parse("2026-11-01T04:00:00Z"));
        budgetToday(owner).andExpect(status().isOk()); // October closes

        TestUser other = exampleUser();
        mvc.perform(get("/api/v1/insights/cycle").param("cycleId", oct.toString()).with(auth(other)))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(get("/api/v1/insights/category/subscriptions").param("cycleId", oct.toString()).with(auth(other)))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(get("/api/v1/budget/cycles/" + oct + "/summary").with(auth(other)))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(post("/api/v1/budget/cycles/" + oct + "/leftover").with(auth(other))
                .contentType(MediaType.APPLICATION_JSON).content("{\"choice\":\"ROLLOVER\"}"))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(post("/api/v1/subscriptions/" + sub + "/answer").with(auth(other))
                .contentType(MediaType.APPLICATION_JSON).content("{\"answer\":\"CANCELLED\"}"))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(get("/api/v1/subscriptions").with(auth(other))).andExpect(jsonPath("$.items.length()").value(0));

        mvc.perform(get("/api/v1/budget/cycles/" + oct + "/summary").with(auth(owner)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.leftoverChoice").doesNotExist());
        mvc.perform(get("/api/v1/subscriptions").with(auth(owner))).andExpect(jsonPath("$.items[0].state").value("ASKING"));
    }
}
```

`server/src/test/java/in/gullak/security/InsightsLogRedactionApiTest.java`:

```java
package in.gullak.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.insights.SubscriptionService;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.util.UUID;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;

/** LOG-05 and SEC-01 for Plan 7: insights traffic logs ids and counts, never a merchant or an amount. */
@ExtendWith(OutputCaptureExtension.class)
class InsightsLogRedactionApiTest extends ApiTest {
    static final String MERCHANT = "Zqxnetflixwide";
    static final Pattern AMOUNT = Pattern.compile("(?<![0-9a-fA-F])(64917|649\\.17|₹649)(?![0-9a-fA-F])");

    @Autowired SubscriptionService subscriptions;

    @Test
    void noMerchantOrAmountInTheLogs(CapturedOutput output) throws Exception {
        TestUser u = exampleUser();
        budgetToday(u).andExpect(status().isOk());
        UUID oct = jdbc.sql("select id from cycles where user_id = ?").param(u.id()).query(UUID.class).single();
        seedMerchantSpend(u, 64_917, "2026-09-03", "subscriptions", MERCHANT);
        seedMerchantSpend(u, 64_917, "2026-10-03", "subscriptions", MERCHANT);
        subscriptions.detect(u.id());
        UUID sub = jdbc.sql("select id from subscriptions where user_id = ?").param(u.id()).query(UUID.class).single();
        mvc.perform(get("/api/v1/insights/cycle").with(auth(u))).andExpect(status().isOk());
        mvc.perform(get("/api/v1/insights/category/subscriptions").with(auth(u))).andExpect(status().isOk());
        mvc.perform(get("/api/v1/subscriptions").with(auth(u))).andExpect(status().isOk());
        mvc.perform(post("/api/v1/subscriptions/" + sub + "/answer").with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content("{\"answer\":\"CANCELLED\"}")).andExpect(status().isOk());
        clock.set(Instant.parse("2026-11-01T04:00:00Z"));
        mvc.perform(get("/api/v1/budget/cycles/" + oct + "/summary").with(auth(u))).andExpect(status().isOk());
        mvc.perform(post("/api/v1/budget/cycles/" + oct + "/leftover").with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content("{\"choice\":\"ROLLOVER\"}")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/budget/cycles/" + oct + "/leftover").with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content("{\"choice\":\"ROLLOVER\"}")).andExpect(status().isConflict());

        String logs = output.getAll();
        assertThat(logs).contains("subscription.detected").contains("subscription.answered");
        assertThat(logs.toLowerCase()).doesNotContain(MERCHANT.toLowerCase());
        assertThat(AMOUNT.matcher(logs).find()).isFalse();
        assertThat(logs).doesNotContain(u.email()).doesNotContain(u.accessToken());
    }
}
```

- [ ] **Step 2: Run them**

Run: `cd server && ./gradlew test --tests 'in.gullak.security.Insights*'`
Expected: PASS. A failure here is a real leak or isolation bug: send it back to the owning task's engineer with the failing line, do not weaken the test.

Then: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 3: Edit the test-cases doc**

In `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`:

1. Row API-TDY-01, Expected column: replace `(streak and forecast arrive in Plans 5 and 6)` with `; game from Plan 6; forecast {spendPaise 1330000, extraSavedPaise 170000, offTrack false} (Home: "₹1,700 extra saved at this pace")`.
2. After the last API-TDY row (API-TDY-09 if Plan 6 added it, else API-TDY-08), add:
   `| API-TDY-10 | Cycle just closed | 1 Nov, October closed with ₹1,700 left, no choice yet | justClosed {cycleId, cycleStart 2026-10-01, cycleEnd 2026-10-31, leftoverPaise 170000}; shown to 7 Nov; gone on 8 Nov or once a choice is made |`
3. Row API-CYC-04, Request column: `POST leftover {"choice":"ROLLOVER"} on a closed cycle`; Expected: `200; leftoverChoice ROLLOVER; next cycle's budget on 1 Nov is ₹556 instead of ₹500`.
4. Row API-CYC-05, Expected: `409 CYCLE_OPEN` (unchanged); add to its Request column: `(a cycle that already ended is closed first and accepted)`.
5. Row API-CYC-07, Request column: `{"choice":"burn"}, {"choice":"rollover"}, {}`; Expected: `400 VALIDATION`.
6. After API-CYC-07, add:
   `| API-CYC-08 | Two choices at once | two POST leftover ROLLOVER in parallel | one 200, one 409 ALREADY_CHOSEN; next pool grows once |`
7. Row API-INS-01, Expected column: `categories sum to spent; forecast = (spent to date − subscription charges this cycle) ÷ days elapsed (today included) × cycle days + those charges + live subscriptions still due this cycle, rounded to ₹100 (₹13,300 on the example day); extra saved = spendable − forecast (₹1,700); save = savings + extra (₹21,700)`.
8. After API-INS-04, add:
   `| API-INS-05 | Forecast with subscriptions and early days | Netflix charged 3 Oct, Spotify due 28 Oct; then day 1 of a cycle | ₹13,200 with Spotify, ₹13,000 after Spotify is cancelled; on days 1 and 2 forecast early true and offTrack false |`
9. Row API-SUB-05, Request: `POST answer {"answer":"USING"}`. Row API-SUB-06, Request: `POST answer {"answer":"CANCELLED"}`. Row API-SUB-07, Request: `{"answer":"dunno"}` or `{}`.
10. After API-SUB-08, add:
    `| API-SUB-09 | Detection triggers | an import commits; the 02:30 job runs | subscriptions found after the commit (not after a rolled-back import) and for users who spent in the last 2 days |`
    `| API-SUB-10 | Charged after cancelling | Netflix cancelled 20 Oct, charged again 3 Nov | answer cleared, "Still using?" asked again; a charge dated before the cancel keeps it cancelled |`
11. In section 9 (App tests), after the last APP row, add:
    `| APP-40 | Insights copy | forecast sentence for more, equal, less and "more than you have"; "23 orders", "1 order", "3 payments"; "2 repeating charges", "1 repeating charge"; "₹649 every month · since Mar" |`
    `| APP-41 | Insights screen | loading skeleton; error with Retry; offline shows "Updated 2 hours ago" with cached data; categories largest first with bars; "Still using?" → "Using it" / "Cancelled" → "Kept" / "Marked as cancelled"; a failed answer rolls back with a message; the upload button opens Add a statement |`
    `| APP-42 | Category drill-down | tapping a category opens its spends with merchant totals; a spend opens spend detail; empty and error states |`
    `| APP-43 | Cycle summary | closed cycle shows spent, saved, extra saved, days by grade, top 3 categories, badges; Add to savings / Roll into this cycle with Confirm; CYCLE_OPEN and ALREADY_CHOSEN messages inline; open cycle shows "This cycle is still running. These are the figures so far." |`
    `| APP-44 | Home forecast and closed cycle | "₹1,700 extra saved at this pace" under the bar; "₹1,000 short at this pace" when short; hidden on day one and first run; the closed-cycle card opens the summary |`

- [ ] **Step 4: Edit the other docs**

`docs/engineering-standards.md` section 1, the event vocabulary sentence: append `` `subscription.detected`, `subscription.answered` ``.

`README.md`, under the API table (add a heading `### API added by Plan 7` after the last plan's table if each plan has its own; otherwise append the rows):

```markdown
| Method | Path | Notes |
|---|---|---|
| GET | /api/v1/insights/cycle[?cycleId] | spent, spendable, forecast (null once ended), categories largest first with counts |
| GET | /api/v1/insights/category/{code}[?cycleId] | the category's spends (newest 500) and totals by merchant; 404 for an unknown code |
| GET | /api/v1/subscriptions | live repeating charges with state ASKING, USING or CANCELLED |
| POST | /api/v1/subscriptions/{id}/answer | `{answer: USING or CANCELLED}`; Cancelled earns Subscription slayer once |
| GET | /api/v1/budget/cycles/{id}/summary | spent, saved, extra saved, grades, top 3 categories, badges; open cycles show figures so far |
| POST | /api/v1/budget/cycles/{id}/leftover | `{choice: SAVINGS, ROLLOVER, CARRY or TAKE}`; 409 `CYCLE_OPEN`, 409 `ALREADY_CHOSEN` |

`GET /api/v1/budget/today` also returns `forecast` and `justClosed`. A job `subscription-scan` runs at 02:30 IST.
```

`docs/superpowers/plans/README.md` already lists this plan's file, task count, migration block and test IDs (set in the cross-plan consistency pass). Check the Plan 7 row against what this plan actually shipped and change it only where a test ID or migration was added or renamed during execution.

- [ ] **Step 5: Run everything**

Run: `cd server && ./gradlew test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/test/java/in/gullak/security/InsightsIsolationApiTest.java server/src/test/java/in/gullak/security/InsightsLogRedactionApiTest.java docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/engineering-standards.md README.md docs/superpowers/plans/README.md
git commit -m "test(insights): isolation and log redaction sweep; docs and test cases for Plan 7

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## App

### Task 10: App insights client, hooks, copy and chart tokens

**Owner:** app-engineer. **Test IDs:** APP-40 (new: insights copy), APP-01 and APP-02 (regression of money and dates). **Red team:** no (no screen yet; Task 11 onwards).

**Files:**
- Create: `app/src/theme/chart.ts`
- Modify: `app/src/theme/index.ts` (export `chart`), `app/src/lib/dates.ts` (`formatMonthOf`), `app/src/lib/dates.test.ts`
- Create: `app/src/features/insights/api.ts`, `keys.ts`, `hooks.ts`, `copy.ts`, `copy.test.ts`, `hooks.test.tsx`
- Create: `app/src/features/insights/components/value-bar.tsx`, `back-header.tsx`, `value-bar.test.tsx`

**Interfaces:**
- Consumes: Plan 2's `api` (`@/lib/client`), `formatRupees` (`@/lib/money`), `formatDayMonth`, `IST` and the private `fromIso` (`@/lib/dates`), `colors`, `spacing` (`@/theme`), `Button`, `Icon`, `Text`; `todayKey` (`@/features/budget/hooks`); the endpoints of Tasks 4–8.
- Produces:
  - `chart = { fill, barThickness: 8, barEndRadius: 4 }` from `@/theme`
  - `formatMonthOf(date: string, today: string): string` ("Mar", or "Oct 2025" in another year)
  - types `Forecast`, `CountKind`, `CategoryRow`, `CycleInsights`, `CategorySpend`, `MerchantTotal`, `CategoryInsights`, `SubscriptionState`, `SubscriptionAnswer`, `Subscription`, `LeftoverChoice`, `Grade`, `GRADES`, `CycleSummary`; `insightsApi.{cycle, category, subscriptions, answer, summary, chooseLeftover}`
  - `insightsKeys.{all, cycles, cycle(id?), category(code, id?), subscriptions, summary(id)}`, `summarySeenKey(cycleId) : string` (`cycle-summary-seen.<id>`)
  - hooks `useCycleInsights(cycleId?)`, `useCategoryInsights(code, cycleId?)`, `useSubscriptions()`, `useAnswerSubscription()`, `useCycleSummary(cycleId)`, `useChooseLeftover(cycleId)`
  - copy `forecastParts(f) : { lead, bold, tail }`, `forecastSentence(f)`, `countNote(row)`, `repeatingTitle(n)`, `subscriptionMeta(s, today)`, `cycleLine(start, end, day)`, `rangeLabel(start, end)`, `gradeLabel(g)`, `daysLabel(n)`, `paymentLabel(m)`, `leftoverOption(choice, summary)`, `leftoverHeading(summary)`, `chosenStatus(choice)`
  - components `ValueBar({ value, max, testID? })`, `BackHeader({ title, subtitle?, onBack })`

- [ ] **Step 1: Write the failing tests**

Add to `app/src/lib/dates.test.ts`:

```ts
import { formatMonthOf } from "./dates";

describe("formatMonthOf", () => {
  it("shows the month alone in the same year and with the year otherwise", () => {
    expect(formatMonthOf("2026-03-05", "2026-10-23")).toBe("Mar");
    expect(formatMonthOf("2026-09-03", "2026-10-23")).toBe("Sep");
    expect(formatMonthOf("2025-10-03", "2026-10-23")).toBe("Oct 2025");
  });
});
```

`app/src/features/insights/copy.test.ts`:

```ts
import type { CycleSummary, Forecast, Subscription } from "./api";
import {
  chosenStatus,
  countNote,
  cycleLine,
  daysLabel,
  forecastSentence,
  gradeLabel,
  leftoverHeading,
  leftoverOption,
  paymentLabel,
  rangeLabel,
  repeatingTitle,
  subscriptionMeta,
} from "./copy";

const exampleForecast: Forecast = {
  cycleEnd: "2026-10-31",
  daysElapsed: 23,
  cycleDays: 31,
  spentPaise: 984000,
  spendablePaise: 1500000,
  spendPaise: 1330000,
  plannedSavingsPaise: 2000000,
  extraSavedPaise: 170000,
  savePaise: 2170000,
  early: false,
  offTrack: false,
};

const closed: CycleSummary = {
  cycleId: "c1",
  cycleStart: "2026-10-01",
  cycleEnd: "2026-10-31",
  closed: true,
  spentPaise: 1330000,
  spendablePaise: 1500000,
  savedPaise: 2170000,
  extraSavedPaise: 170000,
  leftoverPaise: 170000,
  leftoverChoice: null,
  choices: ["SAVINGS", "ROLLOVER"],
  grades: { A_PLUS: 3, A: 0, B: 2, C: 0, D: 0, F: 1 },
  topCategories: [],
  badges: [],
  forecast: null,
};

describe("insights copy (APP-40)", () => {
  it("builds the mockup's forecast sentence", () => {
    expect(forecastSentence(exampleForecast)).toBe(
      "At this pace you'll spend ₹13,300 by 31 Oct and save ₹21,700, ₹1,700 more than planned",
    );
  });

  it("says as planned, less than planned, and more than you have", () => {
    expect(forecastSentence({ ...exampleForecast, spendPaise: 1500000, extraSavedPaise: 0, savePaise: 2000000 })).toBe(
      "At this pace you'll spend ₹15,000 by 31 Oct and save ₹20,000, as planned",
    );
    expect(forecastSentence({ ...exampleForecast, spendPaise: 1600000, extraSavedPaise: -100000, savePaise: 1900000 })).toBe(
      "At this pace you'll spend ₹16,000 by 31 Oct and save ₹19,000, ₹1,000 less than planned",
    );
    expect(forecastSentence({ ...exampleForecast, spendPaise: 4000000, extraSavedPaise: -2500000, savePaise: -500000 })).toBe(
      "At this pace you'll spend ₹40,000 by 31 Oct, ₹25,000 more than you have to spend",
    );
  });

  it("names counts the way the mockup does", () => {
    expect(countNote({ code: "quick_commerce", name: "Quick commerce", spentPaise: 246000, count: 23, countKind: "ORDERS" })).toBe("23 orders");
    expect(countNote({ code: "food_delivery", name: "Food delivery", spentPaise: 1, count: 1, countKind: "ORDERS" })).toBe("1 order");
    expect(countNote({ code: "upi_to_people", name: "UPI to people", spentPaise: 1, count: 3, countKind: "PAYMENTS" })).toBe("3 payments");
    expect(countNote({ code: "upi_to_people", name: "UPI to people", spentPaise: 1, count: 1, countKind: "PAYMENTS" })).toBe("1 payment");
    expect(countNote({ code: "shopping", name: "Shopping", spentPaise: 1, count: 4, countKind: "NONE" })).toBe("");
  });

  it("titles and describes subscriptions", () => {
    expect(repeatingTitle(2)).toBe("2 repeating charges");
    expect(repeatingTitle(1)).toBe("1 repeating charge");
    const netflix: Subscription = {
      id: "s1",
      merchant: "Netflix",
      amountPaise: 64900,
      period: "MONTHLY",
      since: "2026-03-03",
      lastSeen: "2026-10-03",
      state: "ASKING",
    };
    expect(subscriptionMeta(netflix, "2026-10-23")).toBe("₹649 every month · since Mar");
    expect(subscriptionMeta({ ...netflix, merchant: "Prime", amountPaise: 149900, period: "YEARLY", since: "2025-10-03" }, "2026-10-23")).toBe(
      "₹1,499 every year · since Oct 2025",
    );
  });

  it("labels the cycle, grades, days and payment methods", () => {
    expect(cycleLine("2026-10-01", "2026-10-31", 23)).toBe("Cycle 1 Oct – 31 Oct · day 23");
    expect(rangeLabel("2026-10-01", "2026-10-31")).toBe("1 Oct – 31 Oct");
    expect(gradeLabel("A_PLUS")).toBe("A+");
    expect(gradeLabel("F")).toBe("F");
    expect(daysLabel(1)).toBe("1 day");
    expect(daysLabel(3)).toBe("3 days");
    expect(paymentLabel("UPI")).toBe("UPI");
    expect(paymentLabel("CARD")).toBe("Card");
    expect(paymentLabel("CASH")).toBe("Cash");
    expect(paymentLabel("UNKNOWN")).toBe("Bank");
  });

  it("words the leftover choice", () => {
    expect(leftoverHeading(closed)).toBe("₹1,700 left over");
    expect(leftoverHeading({ ...closed, leftoverPaise: -40000 })).toBe("₹400 over budget");
    expect(leftoverOption("SAVINGS", closed)).toEqual({ title: "Add to savings", description: "Your savings for this cycle become ₹21,700" });
    expect(leftoverOption("ROLLOVER", closed)).toEqual({ title: "Roll into this cycle", description: "Adds ₹1,700 to what you can spend until payday" });
    expect(leftoverOption("CARRY", { ...closed, leftoverPaise: -40000 })).toEqual({ title: "Carry it into this cycle", description: "This cycle starts ₹400 lower" });
    expect(leftoverOption("TAKE", { ...closed, leftoverPaise: -40000 })).toEqual({ title: "Take it from savings", description: "Your savings for that cycle drop by ₹400" });
    expect(chosenStatus("SAVINGS")).toBe("Added to your savings");
    expect(chosenStatus("ROLLOVER")).toBe("Rolled into this cycle");
    expect(chosenStatus("CARRY")).toBe("Carried into this cycle");
    expect(chosenStatus("TAKE")).toBe("Taken from your savings");
  });
});
```

The SAVINGS description uses `savedPaise` (₹21,700): while the choice is open, the server already counts the default (leftover to savings) in it.

`app/src/features/insights/components/value-bar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import React from "react";
import { chart } from "@/theme";
import { ValueBar } from "./value-bar";

/** The bar is decorative (hidden from screen readers), so queries must include hidden elements. */
const HIDDEN = { includeHiddenElements: true } as const;

describe("ValueBar", () => {
  it("draws a single-series bar as a share of the largest value", () => {
    render(<ValueBar value={1035} max={2070} testID="bar" />);
    const fill = screen.getByTestId("bar-fill", HIDDEN);
    expect(fill).toHaveStyle({ width: "50%", height: chart.barThickness, backgroundColor: chart.fill });
    expect(fill).toHaveStyle({ borderTopRightRadius: chart.barEndRadius, borderBottomRightRadius: chart.barEndRadius });
  });

  it("draws nothing for zero, negative or a zero max, and is hidden from screen readers", () => {
    render(
      <>
        <ValueBar value={0} max={100} testID="zero" />
        <ValueBar value={-5} max={100} testID="neg" />
        <ValueBar value={5} max={0} testID="nomax" />
      </>,
    );
    expect(screen.queryByTestId("zero-fill", HIDDEN)).toBeNull();
    expect(screen.queryByTestId("neg-fill", HIDDEN)).toBeNull();
    expect(screen.queryByTestId("nomax-fill", HIDDEN)).toBeNull();
    expect(screen.getByTestId("zero", HIDDEN)).toHaveProp("accessibilityElementsHidden", true);
    expect(screen.queryByTestId("zero")).toBeNull(); // not reachable by default queries: hidden from screen readers
  });

  it("caps at the full width", () => {
    render(<ValueBar value={300} max={100} testID="over" />);
    expect(screen.getByTestId("over-fill", HIDDEN)).toHaveStyle({ width: "100%" });
  });
});
```

`app/src/features/insights/hooks.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { todayKey } from "@/features/budget/hooks";
import type { CycleSummary, Subscription } from "./api";
import { useAnswerSubscription, useChooseLeftover, useSubscriptions } from "./hooks";
import { insightsKeys } from "./keys";

jest.mock("./api", () => ({
  insightsApi: {
    cycle: jest.fn(),
    category: jest.fn(),
    subscriptions: jest.fn(),
    answer: jest.fn(),
    summary: jest.fn(),
    chooseLeftover: jest.fn(),
  },
}));
import { insightsApi } from "./api";
const mocked = insightsApi as jest.Mocked<typeof insightsApi>;

const netflix: Subscription = { id: "s1", merchant: "Netflix", amountPaise: 64900, period: "MONTHLY", since: "2026-09-03", lastSeen: "2026-10-03", state: "ASKING" };

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

describe("insights hooks", () => {
  it("answers optimistically and keeps the server's version", async () => {
    const { qc, wrapper } = setup();
    mocked.subscriptions.mockResolvedValue({ items: [netflix] });
    let resolve: (s: Subscription) => void = () => undefined;
    mocked.answer.mockReturnValue(new Promise<Subscription>((r) => (resolve = r)));
    const list = renderHook(() => useSubscriptions(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    const answer = renderHook(() => useAnswerSubscription(), { wrapper });
    act(() => answer.result.current.mutate({ id: "s1", answer: "CANCELLED" }));
    await waitFor(() => expect(qc.getQueryData<Subscription[]>(insightsKeys.subscriptions)?.[0]?.state).toBe("CANCELLED"));
    await act(async () => resolve({ ...netflix, state: "CANCELLED" }));
    await waitFor(() => expect(answer.result.current.isSuccess).toBe(true));
    expect(qc.getQueryData<Subscription[]>(insightsKeys.subscriptions)?.[0]?.state).toBe("CANCELLED");
  });

  it("rolls back when the answer fails", async () => {
    const { qc, wrapper } = setup();
    mocked.subscriptions.mockResolvedValue({ items: [netflix] });
    mocked.answer.mockRejectedValue(new Error("offline"));
    const list = renderHook(() => useSubscriptions(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    const answer = renderHook(() => useAnswerSubscription(), { wrapper });
    act(() => answer.result.current.mutate({ id: "s1", answer: "USING" }));
    await waitFor(() => expect(answer.result.current.isError).toBe(true));
    expect(qc.getQueryData<Subscription[]>(insightsKeys.subscriptions)?.[0]?.state).toBe("ASKING");
  });

  it("a leftover choice stores the new summary and refreshes Home", async () => {
    const { qc, wrapper } = setup();
    const summary = { cycleId: "c1", leftoverChoice: "ROLLOVER" } as CycleSummary;
    mocked.chooseLeftover.mockResolvedValue(summary);
    qc.setQueryData(todayKey, { budgetPaise: 50000 });
    const choose = renderHook(() => useChooseLeftover("c1"), { wrapper });
    await act(async () => {
      await choose.result.current.mutateAsync("ROLLOVER");
    });
    expect(mocked.chooseLeftover).toHaveBeenCalledWith("c1", "ROLLOVER");
    expect(qc.getQueryData(insightsKeys.summary("c1"))).toBe(summary);
    expect(qc.getQueryState(todayKey)?.isInvalidated).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx jest src/features/insights src/lib/dates.test.ts`
Expected: FAIL, modules missing (`./copy`, `./hooks`, `./value-bar`, `formatMonthOf`).

- [ ] **Step 3: Tokens and dates**

`app/src/theme/chart.ts`:

```ts
import { colors } from "./colors";

/**
 * Dataviz mark spec for Gullak's one chart form (single-series bars): muted fill, 8px thick, a 4px rounded data
 * end and a square baseline. Text never wears the fill colour; values are ink labels beside the bar.
 */
export const chart = {
  fill: colors.muted,
  barThickness: 8,
  barEndRadius: 4,
} as const;
```

In `app/src/theme/index.ts` add:

```ts
export { chart } from "./chart";
```

In `app/src/lib/dates.ts`, add after `formatDayMonth`:

```ts
const monthShort = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: IST });

/** "2026-03-05" → "Mar" when it is in the same year as `today`, else "Mar 2025" ("since Mar" on Insights). */
export function formatMonthOf(date: string, today: string): string {
  const month = monthShort.format(fromIso(date)).replace("Sept", "Sep");
  return date.slice(0, 4) === today.slice(0, 4) ? month : `${month} ${date.slice(0, 4)}`;
}
```

- [ ] **Step 4: Client, keys and hooks**

`app/src/features/insights/api.ts`:

```ts
import { api } from "@/lib/client";

export type Forecast = {
  cycleEnd: string;
  daysElapsed: number;
  cycleDays: number;
  spentPaise: number;
  spendablePaise: number;
  spendPaise: number;
  plannedSavingsPaise: number;
  extraSavedPaise: number;
  savePaise: number;
  early: boolean;
  offTrack: boolean;
};

export type CountKind = "ORDERS" | "PAYMENTS" | "NONE";

export type CategoryRow = { code: string; name: string; spentPaise: number; count: number; countKind: CountKind };

export type CycleInsights = {
  cycleId: string;
  cycleStart: string;
  cycleEnd: string;
  day: number;
  days: number;
  closed: boolean;
  spentPaise: number;
  spendablePaise: number;
  forecast: Forecast | null;
  categories: CategoryRow[];
};

export type PaymentMethod = "UPI" | "CARD" | "CASH" | "UNKNOWN";

export type CategorySpend = {
  id: string;
  kind: "SPEND" | "REFUND";
  amountPaise: number;
  occurredAt: string;
  merchant: string | null;
  paymentMethod: PaymentMethod;
};

export type MerchantTotal = { merchant: string | null; spentPaise: number; count: number };

export type CategoryInsights = {
  cycleId: string;
  cycleStart: string;
  cycleEnd: string;
  code: string;
  name: string;
  spentPaise: number;
  count: number;
  countKind: CountKind;
  merchants: MerchantTotal[];
  spends: CategorySpend[];
};

export type SubscriptionState = "ASKING" | "USING" | "CANCELLED";
export type SubscriptionAnswer = "USING" | "CANCELLED";

export type Subscription = {
  id: string;
  merchant: string;
  amountPaise: number;
  period: "MONTHLY" | "YEARLY";
  since: string;
  lastSeen: string;
  state: SubscriptionState;
};

export type LeftoverChoice = "SAVINGS" | "ROLLOVER" | "CARRY" | "TAKE";

export type Grade = "A_PLUS" | "A" | "B" | "C" | "D" | "F";
export const GRADES: readonly Grade[] = ["A_PLUS", "A", "B", "C", "D", "F"];

export type CycleSummary = {
  cycleId: string;
  cycleStart: string;
  cycleEnd: string;
  closed: boolean;
  spentPaise: number;
  spendablePaise: number;
  savedPaise: number;
  extraSavedPaise: number | null;
  leftoverPaise: number | null;
  leftoverChoice: LeftoverChoice | null;
  choices: LeftoverChoice[];
  grades: Record<Grade, number>;
  topCategories: { code: string; name: string; spentPaise: number }[];
  badges: { code: string; earnedOn: string }[];
  forecast: Forecast | null;
};

const q = (cycleId?: string) => (cycleId ? `?cycleId=${encodeURIComponent(cycleId)}` : "");

export const insightsApi = {
  cycle: (cycleId?: string) => api.get<CycleInsights>(`/insights/cycle${q(cycleId)}`),
  category: (code: string, cycleId?: string) => api.get<CategoryInsights>(`/insights/category/${encodeURIComponent(code)}${q(cycleId)}`),
  subscriptions: () => api.get<{ items: Subscription[] }>("/subscriptions"),
  answer: (id: string, answer: SubscriptionAnswer) => api.post<Subscription>(`/subscriptions/${encodeURIComponent(id)}/answer`, { answer }),
  summary: (cycleId: string) => api.get<CycleSummary>(`/budget/cycles/${encodeURIComponent(cycleId)}/summary`),
  chooseLeftover: (cycleId: string, choice: LeftoverChoice) =>
    api.post<CycleSummary>(`/budget/cycles/${encodeURIComponent(cycleId)}/leftover`, { choice }),
};
```

`app/src/features/insights/keys.ts`:

```ts
export const insightsKeys = {
  all: ["insights"] as const,
  cycles: ["insights", "cycle"] as const,
  cycle: (cycleId: string | undefined) => ["insights", "cycle", cycleId ?? "current"] as const,
  category: (code: string, cycleId: string | undefined) => ["insights", "category", code, cycleId ?? "current"] as const,
  subscriptions: ["insights", "subscriptions"] as const,
  summary: (cycleId: string) => ["insights", "summary", cycleId] as const,
};

/** kv key set when a cycle's summary has loaded; Home hides a zero-leftover "cycle just closed" card after it. */
export function summarySeenKey(cycleId: string): string {
  return `cycle-summary-seen.${cycleId}`;
}
```

`app/src/features/insights/hooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { todayKey } from "@/features/budget/hooks";
import { insightsApi, type LeftoverChoice, type Subscription, type SubscriptionAnswer } from "./api";
import { insightsKeys } from "./keys";

export function useCycleInsights(cycleId?: string) {
  return useQuery({ queryKey: insightsKeys.cycle(cycleId), queryFn: () => insightsApi.cycle(cycleId), staleTime: 60_000 });
}

export function useCategoryInsights(code: string, cycleId?: string) {
  return useQuery({ queryKey: insightsKeys.category(code, cycleId), queryFn: () => insightsApi.category(code, cycleId), staleTime: 60_000 });
}

export function useSubscriptions() {
  return useQuery({
    queryKey: insightsKeys.subscriptions,
    queryFn: async () => (await insightsApi.subscriptions()).items,
    staleTime: 60_000,
  });
}

type AnswerVars = { id: string; answer: SubscriptionAnswer };

/** "Using it" / "Cancelled": shown at once, rolled back if the server says no; the forecast and Home refetch after. */
export function useAnswerSubscription() {
  const qc = useQueryClient();
  return useMutation<Subscription, Error, AnswerVars, { previous: Subscription[] | undefined }>({
    mutationFn: ({ id, answer }) => insightsApi.answer(id, answer),
    onMutate: async ({ id, answer }) => {
      await qc.cancelQueries({ queryKey: insightsKeys.subscriptions });
      const previous = qc.getQueryData<Subscription[]>(insightsKeys.subscriptions);
      qc.setQueryData<Subscription[]>(insightsKeys.subscriptions, (list) => list?.map((s) => (s.id === id ? { ...s, state: answer } : s)));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(insightsKeys.subscriptions, context.previous);
    },
    onSuccess: (saved) => {
      qc.setQueryData<Subscription[]>(insightsKeys.subscriptions, (list) => list?.map((s) => (s.id === saved.id ? saved : s)));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: insightsKeys.cycles });
      void qc.invalidateQueries({ queryKey: todayKey });
    },
  });
}

export function useCycleSummary(cycleId: string) {
  return useQuery({ queryKey: insightsKeys.summary(cycleId), queryFn: () => insightsApi.summary(cycleId), staleTime: 60_000 });
}

/** The leftover choice: the response is the new summary; Home's pool and the insights figures change with it. */
export function useChooseLeftover(cycleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (choice: LeftoverChoice) => insightsApi.chooseLeftover(cycleId, choice),
    onSuccess: (summary) => {
      qc.setQueryData(insightsKeys.summary(cycleId), summary);
      void qc.invalidateQueries({ queryKey: todayKey });
      void qc.invalidateQueries({ queryKey: insightsKeys.cycles });
    },
  });
}
```

- [ ] **Step 5: Copy**

`app/src/features/insights/copy.ts`:

```ts
import { formatDayMonth, formatMonthOf } from "@/lib/dates";
import { formatRupees } from "@/lib/money";
import type { CategoryRow, CycleSummary, Forecast, Grade, LeftoverChoice, PaymentMethod, Subscription } from "./api";

/** The forecast sentence in three parts so the screen can set the savings figure in bold, as the mockup does. */
export function forecastParts(f: Forecast): { lead: string; bold: string; tail: string } {
  const lead = `At this pace you'll spend ${formatRupees(f.spendPaise)} by ${formatDayMonth(f.cycleEnd)}`;
  if (f.savePaise <= 0) {
    return { lead: `${lead}, `, bold: formatRupees(f.spendPaise - f.spendablePaise), tail: " more than you have to spend" };
  }
  const tail =
    f.extraSavedPaise > 0
      ? `, ${formatRupees(f.extraSavedPaise)} more than planned`
      : f.extraSavedPaise < 0
        ? `, ${formatRupees(-f.extraSavedPaise)} less than planned`
        : ", as planned";
  return { lead: `${lead} and save `, bold: formatRupees(f.savePaise), tail };
}

export function forecastSentence(f: Forecast): string {
  const p = forecastParts(f);
  return `${p.lead}${p.bold}${p.tail}`;
}

/** "23 orders" for delivery and quick commerce, "3 payments" for UPI to people, nothing otherwise. */
export function countNote(row: Pick<CategoryRow, "count" | "countKind">): string {
  if (row.countKind === "ORDERS") return `${row.count} order${row.count === 1 ? "" : "s"}`;
  if (row.countKind === "PAYMENTS") return `${row.count} payment${row.count === 1 ? "" : "s"}`;
  return "";
}

export function repeatingTitle(n: number): string {
  return `${n} repeating charge${n === 1 ? "" : "s"}`;
}

export function subscriptionMeta(s: Subscription, today: string): string {
  return `${formatRupees(s.amountPaise)} every ${s.period === "MONTHLY" ? "month" : "year"} · since ${formatMonthOf(s.since, today)}`;
}

export function rangeLabel(start: string, end: string): string {
  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

export function cycleLine(start: string, end: string, day: number): string {
  return `Cycle ${rangeLabel(start, end)} · day ${day}`;
}

export function gradeLabel(g: Grade): string {
  return g === "A_PLUS" ? "A+" : g;
}

export function daysLabel(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

const payment: Record<PaymentMethod, string> = { UPI: "UPI", CARD: "Card", CASH: "Cash", UNKNOWN: "Bank" };

export function paymentLabel(m: PaymentMethod): string {
  return payment[m];
}

export function leftoverHeading(s: CycleSummary): string {
  const left = s.leftoverPaise ?? 0;
  return left >= 0 ? `${formatRupees(left)} left over` : `${formatRupees(-left)} over budget`;
}

export function leftoverOption(choice: LeftoverChoice, s: CycleSummary): { title: string; description: string } {
  const amount = formatRupees(Math.abs(s.leftoverPaise ?? 0));
  switch (choice) {
    case "SAVINGS":
      return { title: "Add to savings", description: `Your savings for this cycle become ${formatRupees(s.savedPaise)}` };
    case "ROLLOVER":
      return { title: "Roll into this cycle", description: `Adds ${amount} to what you can spend until payday` };
    case "CARRY":
      return { title: "Carry it into this cycle", description: `This cycle starts ${amount} lower` };
    case "TAKE":
      return { title: "Take it from savings", description: `Your savings for that cycle drop by ${amount}` };
  }
}

export function chosenStatus(choice: LeftoverChoice): string {
  switch (choice) {
    case "SAVINGS":
      return "Added to your savings";
    case "ROLLOVER":
      return "Rolled into this cycle";
    case "CARRY":
      return "Carried into this cycle";
    case "TAKE":
      return "Taken from your savings";
  }
}
```

- [ ] **Step 6: Components**

`app/src/features/insights/components/value-bar.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { chart } from "@/theme";

/**
 * One single-series bar (dataviz spec): grows from a square left baseline to a rounded data end, no track, no
 * border. Decorative: the row's text label carries the value for screen readers (the list is the table view).
 */
export function ValueBar({ value, max, testID = "value-bar" }: { value: number; max: number; testID?: string }) {
  const percent = max > 0 && value > 0 ? Math.min(100, (value * 100) / max) : 0;
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: chart.barThickness, flexDirection: "row" }}
    >
      {percent > 0 ? (
        <View
          testID={`${testID}-fill`}
          style={{
            width: `${Math.round(percent * 10) / 10}%`,
            minWidth: chart.barEndRadius,
            height: chart.barThickness,
            backgroundColor: chart.fill,
            borderTopRightRadius: chart.barEndRadius,
            borderBottomRightRadius: chart.barEndRadius,
          }}
        />
      ) : null}
    </View>
  );
}
```

`app/src/features/insights/components/back-header.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { spacing } from "@/theme";

/** The drill-down and summary screens draw their own header, like the rest of the app (no native header). */
export function BackHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Button title="Back" variant="ghost" iconOnly icon={<Icon name="left" />} onPress={onBack} />
      <View style={{ flex: 1 }}>
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text variant="labelMuted">{subtitle}</Text> : null}
      </View>
    </View>
  );
}
```

- [ ] **Step 7: Run the tests**

Run: `cd app && npx jest src/features/insights src/lib && npm run lint && npm run typecheck`
Expected: PASS (copy 7, value bar 3, hooks 3, the dates case, and every earlier `lib` test).

- [ ] **Step 8: Commit**

```bash
git add app/src/theme/chart.ts app/src/theme/index.ts app/src/lib/dates.ts app/src/lib/dates.test.ts app/src/features/insights
git commit -m "feat(app): insights client, hooks, copy and the single-series bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: App Insights tab

**Owner:** app-engineer. **Test IDs:** APP-40 (copy on screen), APP-41 (new: Insights screen), ERR-13 (Insights), APP-29 (labels and targets on the new controls), E2E-04 (the "Insights totals updated" half: the tab refetches when it gains focus). **Red team:** no (reads only; the one write, a subscription answer, is covered by Task 4's server tests and this task's rollback test).

Mockup (`Insights.dc.html`), quoted: header "Insights", "Cycle 1 Oct – 31 Oct · day 23", an upload button; "Cycle so far" with "₹9,840" "spent of ₹15,000", a bar labelled "Cycle budget used" (66), a check icon and "At this pace you'll spend ₹13,300 by 31 Oct and save **₹21,700**, ₹1,700 more than planned"; "Spending by category" with rows "Quick commerce · 23 orders · ₹2,460", "Food delivery · 11 orders · ₹2,070", "Shopping · ₹1,888", "UPI to people · 3 payments · ₹1,610", "Eating out · ₹1,044", "Subscriptions · ₹768", each with a bar; a TV icon and "2 repeating charges"; rows "Netflix · ₹649 every month · since Mar" and "Spotify · ₹119 every month · since Jan" with "Still using?" → "Using it" / "Cancelled" → "Kept" / "Marked as cancelled". All copy passes `.claude/design.md` (sentence case, no full stop on single sentences, ₹ with Indian grouping). The upload button keeps Plan 4's entry: label "Add a statement", opening `/upload`.

**Files:**
- Create: `app/src/features/insights/components/cycle-card.tsx`, `category-list.tsx`, `subscription-list.tsx`
- Create: `app/src/features/insights/screens/insights-screen.tsx`, `app/src/features/insights/screens/insights-screen.test.tsx`
- Modify: `app/app/(tabs)/insights.tsx` (replaced; Plan 4's "Add a statement" entry now lives in the screen's header, so remove any Plan 4 button from the route file)

**Interfaces:**
- Consumes: Task 10's hooks, copy, `ValueBar`, `insightsKeys`; Plan 2's `Screen`, `Text`, `Button`, `ProgressBar`, `Skeleton`, `EmptyState`, `ErrorState`, `Toast`, `Icon`, `describeError`, `messageFor`, `relativeTime`, `todayIst`, `formatRupees`; `expo-router`'s `useRouter`, `useFocusEffect`; routes `/insights/category/[code]` (Task 12) and `/upload` (Plan 4).
- Produces: `InsightsScreen({ now? })`; `CycleCard({ insights })`; `CategoryList({ rows, onOpen, onAddStatement })`; `SubscriptionList({ today })`.

- [ ] **Step 1: Write the failing test**

`app/src/features/insights/screens/insights-screen.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import type { CycleInsights, Subscription } from "../api";
import { insightsKeys } from "../keys";
import { InsightsScreen } from "./insights-screen";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }), useFocusEffect: jest.fn() }));
jest.mock("../api", () => ({
  insightsApi: { cycle: jest.fn(), category: jest.fn(), subscriptions: jest.fn(), answer: jest.fn(), summary: jest.fn(), chooseLeftover: jest.fn() },
}));
import { insightsApi } from "../api";
const mocked = insightsApi as jest.Mocked<typeof insightsApi>;

const NOW = new Date("2026-10-23T08:00:00Z");

const october: CycleInsights = {
  cycleId: "c1",
  cycleStart: "2026-10-01",
  cycleEnd: "2026-10-31",
  day: 23,
  days: 31,
  closed: false,
  spentPaise: 984000,
  spendablePaise: 1500000,
  forecast: {
    cycleEnd: "2026-10-31",
    daysElapsed: 23,
    cycleDays: 31,
    spentPaise: 984000,
    spendablePaise: 1500000,
    spendPaise: 1330000,
    plannedSavingsPaise: 2000000,
    extraSavedPaise: 170000,
    savePaise: 2170000,
    early: false,
    offTrack: false,
  },
  categories: [
    { code: "quick_commerce", name: "Quick commerce", spentPaise: 246000, count: 23, countKind: "ORDERS" },
    { code: "food_delivery", name: "Food delivery", spentPaise: 207000, count: 11, countKind: "ORDERS" },
    { code: "shopping", name: "Shopping", spentPaise: 188800, count: 1, countKind: "NONE" },
    { code: "upi_to_people", name: "UPI to people", spentPaise: 161000, count: 3, countKind: "PAYMENTS" },
    { code: "eating_out", name: "Eating out", spentPaise: 104400, count: 2, countKind: "NONE" },
    { code: "subscriptions", name: "Subscriptions", spentPaise: 76800, count: 2, countKind: "NONE" },
  ],
};

const subs: Subscription[] = [
  { id: "s1", merchant: "Netflix", amountPaise: 64900, period: "MONTHLY", since: "2026-03-03", lastSeen: "2026-10-03", state: "ASKING" },
  { id: "s2", merchant: "Spotify", amountPaise: 11900, period: "MONTHLY", since: "2026-01-28", lastSeen: "2026-09-28", state: "ASKING" },
];

function renderScreen(qc = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "offlineFirst" }, mutations: { retry: false } } })) {
  render(
    <QueryClientProvider client={qc}>
      <InsightsScreen now={NOW} />
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
  mocked.cycle.mockResolvedValue(october);
  mocked.subscriptions.mockResolvedValue({ items: subs });
});

describe("Insights (APP-41)", () => {
  it("shows a skeleton, then the cycle, the forecast and the categories largest first", async () => {
    renderScreen();
    expect(screen.getByTestId("insights-skeleton")).toBeTruthy();
    expect(await screen.findByText("Cycle 1 Oct – 31 Oct · day 23")).toBeTruthy();
    expect(screen.getByText("₹9,840")).toBeTruthy();
    expect(screen.getByText("spent of ₹15,000")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Cycle budget used" })).toHaveAccessibilityValue({ now: 66 });
    expect(screen.getByText("At this pace you'll spend ₹13,300 by 31 Oct and save ₹21,700, ₹1,700 more than planned")).toBeTruthy();
    expect(screen.getByText("Spending by category")).toBeTruthy();
    const rows = screen.getAllByRole("button", { name: /^(Quick commerce|Food delivery|Shopping|UPI to people|Eating out|Subscriptions),/ });
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
      "Quick commerce, ₹2,460, 23 orders",
      "Food delivery, ₹2,070, 11 orders",
      "Shopping, ₹1,888",
      "UPI to people, ₹1,610, 3 payments",
      "Eating out, ₹1,044",
      "Subscriptions, ₹768",
    ]);
    expect(screen.getByText("23 orders")).toBeTruthy();
    expect(screen.getByText("3 payments")).toBeTruthy();
  });

  it("opens a category's spends", async () => {
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Quick commerce, ₹2,460, 23 orders" }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/insights/category/[code]", params: { code: "quick_commerce", cycleId: "c1" } });
  });

  it("asks Still using? and records Cancelled", async () => {
    mocked.answer.mockResolvedValue({ ...subs[0]!, state: "CANCELLED" });
    renderScreen();
    expect(await screen.findByText("2 repeating charges")).toBeTruthy();
    expect(screen.getByText("₹649 every month · since Mar")).toBeTruthy();
    fireEvent.press(screen.getAllByRole("button", { name: "Still using?" })[0]!);
    expect(screen.getByRole("button", { name: "Using it" })).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Cancelled" }));
    expect(await screen.findByText("Marked as cancelled")).toBeTruthy();
    expect(mocked.answer).toHaveBeenCalledWith("s1", "CANCELLED");
    await waitFor(() => expect(mocked.cycle).toHaveBeenCalledTimes(2)); // the forecast refetches
  });

  it("records Using it as Kept", async () => {
    mocked.answer.mockResolvedValue({ ...subs[1]!, state: "USING" });
    renderScreen();
    await screen.findByText("Spotify");
    fireEvent.press(screen.getAllByRole("button", { name: "Still using?" })[1]!);
    fireEvent.press(screen.getByRole("button", { name: "Using it" }));
    expect(await screen.findByText("Kept")).toBeTruthy();
  });

  it("puts the question back when the answer fails", async () => {
    mocked.answer.mockRejectedValue(new Error("offline"));
    renderScreen();
    await screen.findByText("Netflix");
    fireEvent.press(screen.getAllByRole("button", { name: "Still using?" })[0]!);
    fireEvent.press(screen.getByRole("button", { name: "Cancelled" }));
    expect(await screen.findByText("Couldn't save your answer. Try again.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Still using?" })).toHaveLength(2);
  });

  it("shows the error state with Retry (ERR-13)", async () => {
    mocked.cycle.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(october);
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Cycle 1 Oct – 31 Oct · day 23")).toBeTruthy();
  });

  it("shows empty states and the statement entry", async () => {
    mocked.cycle.mockResolvedValue({ ...october, spentPaise: 0, categories: [], forecast: { ...october.forecast!, spentPaise: 0 } });
    mocked.subscriptions.mockResolvedValue({ items: [] });
    renderScreen();
    expect(await screen.findByText("No spends this cycle yet")).toBeTruthy();
    expect(screen.queryByText(/At this pace/)).toBeNull();
    expect(await screen.findByText("No repeating charges yet")).toBeTruthy();
    fireEvent.press(screen.getAllByRole("button", { name: "Add a statement" })[0]!);
    expect(mockPush).toHaveBeenCalledWith("/upload");
  });

  it("waits until day 3 for the forecast", async () => {
    mocked.cycle.mockResolvedValue({ ...october, day: 2, forecast: { ...october.forecast!, early: true, daysElapsed: 2 } });
    renderScreen();
    expect(await screen.findByText("Your forecast appears on day 3")).toBeTruthy();
  });

  it("shows saved data offline with when it was updated", async () => {
    // "online" pauses at once while offline; the app's offlineFirst client pauses after its first failed try.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "online" } } });
    qc.setQueryData(insightsKeys.cycle(undefined), october, { updatedAt: NOW.getTime() - 2 * 60 * 60 * 1000 });
    qc.setQueryData(insightsKeys.subscriptions, subs, { updatedAt: NOW.getTime() - 2 * 60 * 60 * 1000 });
    onlineManager.setOnline(false);
    renderScreen(qc);
    expect(await screen.findByText("Updated 2 hours ago")).toBeTruthy();
    expect(screen.getByText("₹9,840")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npx jest src/features/insights/screens/insights-screen.test.tsx`
Expected: FAIL (`./insights-screen` missing).

- [ ] **Step 3: Write the components**

`app/src/features/insights/components/cycle-card.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Text } from "@/components/ui/text";
import { formatRupees } from "@/lib/money";
import { colors, fonts, radius, spacing } from "@/theme";
import type { CycleInsights } from "../api";
import { forecastParts } from "../copy";

/** "Cycle so far": spent of spendable, the cycle bar and the forecast sentence (spec 2.8). */
export function CycleCard({ insights }: { insights: CycleInsights }) {
  const used = insights.spendablePaise > 0 ? Math.round((insights.spentPaise * 100) / insights.spendablePaise) : 0;
  const f = insights.forecast;
  const parts = f ? forecastParts(f) : null;
  const short = !!f && f.extraSavedPaise < 0;
  return (
    <View
      accessibilityLabel="Cycle so far"
      style={{ gap: spacing.cm, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
        <Text variant="amount">{formatRupees(insights.spentPaise)}</Text>
        <Text variant="bodyMuted">{`spent of ${formatRupees(insights.spendablePaise)}`}</Text>
      </View>
      <ProgressBar value={used} label="Cycle budget used" tone={f?.offTrack ? "warn" : "ink"} />
      {f && parts && insights.spentPaise > 0 ? (
        f.early ? (
          <Text variant="labelMuted">Your forecast appears on day 3</Text>
        ) : (
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
            <Icon name={short ? "alert" : "check"} size={18} color={short ? colors.warnInk : colors.good} />
            <Text variant="label" style={{ flex: 1 }}>
              {parts.lead}
              <Text variant="label" style={{ fontFamily: fonts.ui700 }}>
                {parts.bold}
              </Text>
              {parts.tail}
            </Text>
          </View>
        )
      ) : null}
    </View>
  );
}
```

`app/src/features/insights/components/category-list.tsx`:

```tsx
import React from "react";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Text } from "@/components/ui/text";
import { formatRupees } from "@/lib/money";
import { colors, spacing, touchTarget } from "@/theme";
import type { CategoryRow } from "../api";
import { countNote } from "../copy";
import { ValueBar } from "./value-bar";

/**
 * Spending by category, largest first, one colour (spec 2.8). Each row is the table view of its bar: the label
 * reads name, amount and count; the bar is decorative. Tapping opens the drill-down (spec 3.2 #4).
 */
export function CategoryList({
  rows,
  onOpen,
  onAddStatement,
}: {
  rows: CategoryRow[];
  onOpen: (code: string) => void;
  onAddStatement: () => void;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.spentPaise), 0);
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="title" accessibilityRole="header">
        Spending by category
      </Text>
      {rows.length === 0 ? (
        <EmptyState
          title="No spends this cycle yet"
          body="Log spends or upload a statement and your month appears here"
          action={<Button title="Add a statement" variant="secondary" onPress={onAddStatement} />}
        />
      ) : (
        rows.map((r) => {
          const note = countNote(r);
          const amount = formatRupees(r.spentPaise);
          return (
            <Pressable
              key={r.code}
              accessibilityRole="button"
              accessibilityLabel={`${r.name}, ${amount}${note ? `, ${note}` : ""}`}
              accessibilityHint="Shows the spends"
              onPress={() => onOpen(r.code)}
              style={({ pressed }) => ({ minHeight: touchTarget, paddingVertical: spacing.sm, gap: spacing.xs, opacity: pressed ? 0.7 : 1 })}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", columnGap: spacing.sm }}>
                  <Text variant="label">{r.name}</Text>
                  {note ? <Text variant="labelMuted">{note}</Text> : null}
                </View>
                <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>
                  {amount}
                </Text>
              </View>
              <ValueBar value={r.spentPaise} max={max} testID={`bar-${r.code}`} />
            </Pressable>
          );
        })
      )}
      <View style={{ height: 1, backgroundColor: colors.line }} />
    </View>
  );
}
```

The name and the "23 orders" note are sibling `Text` elements in a wrapping row, so a long name pushes the note to the next line instead of truncating it.

`app/src/features/insights/components/subscription-list.tsx`:

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { colors, spacing } from "@/theme";
import type { Subscription, SubscriptionAnswer } from "../api";
import { repeatingTitle, subscriptionMeta } from "../copy";
import { useAnswerSubscription, useSubscriptions } from "../hooks";

/** Repeating charges with "Still using?" → "Using it" / "Cancelled" (spec 2.8, ux finding: never a bare "Yes"). */
export function SubscriptionList({ today }: { today: string }) {
  const subs = useSubscriptions();
  const answer = useAnswerSubscription();
  const [asking, setAsking] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const send = (s: Subscription, value: SubscriptionAnswer) => {
    setFailed(null);
    setAsking(null);
    answer.mutate({ id: s.id, answer: value }, { onError: () => setFailed(s.id) });
  };

  if (!subs.data && subs.isLoading) {
    return <Skeleton height={96} />;
  }
  if (!subs.data) {
    return <ErrorState body={describeError(subs.error, messageFor)} onRetry={() => void subs.refetch()} />;
  }
  if (subs.data.length === 0) {
    return <EmptyState title="No repeating charges yet" body="Gullak spots a charge that repeats every month or year" />;
  }
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name="tv" size={18} />
        <Text variant="title" accessibilityRole="header">
          {repeatingTitle(subs.data.length)}
        </Text>
      </View>
      {subs.data.map((s) => (
        <View key={s.id} style={{ gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text variant="label">{s.merchant}</Text>
              <Text variant="caption">{subscriptionMeta(s, today)}</Text>
            </View>
            {s.state === "ASKING" && asking !== s.id ? (
              <Button title="Still using?" variant="secondary" onPress={() => setAsking(s.id)} />
            ) : null}
            {s.state === "USING" ? (
              <Text variant="label" color={colors.muted} accessibilityRole="text" accessibilityLiveRegion="polite">
                Kept
              </Text>
            ) : null}
            {s.state === "CANCELLED" ? (
              <Text variant="label" color={colors.goodDeep} accessibilityLiveRegion="polite">
                Marked as cancelled
              </Text>
            ) : null}
          </View>
          {s.state === "ASKING" && asking === s.id ? (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button title="Using it" variant="secondary" onPress={() => send(s, "USING")} style={{ flex: 1 }} />
              <Button title="Cancelled" variant="secondary" onPress={() => send(s, "CANCELLED")} style={{ flex: 1 }} />
            </View>
          ) : null}
          {failed === s.id ? (
            <Text variant="label" color={colors.bad} accessibilityRole="alert">
              Couldn't save your answer. Try again.
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 4: The screen and the route**

`app/src/features/insights/screens/insights-screen.tsx`:

```tsx
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { Toast } from "@/components/ui/toast";
import { describeError } from "@/lib/api-errors";
import { relativeTime, todayIst } from "@/lib/dates";
import { messageFor } from "@/lib/errors";
import { spacing } from "@/theme";
import { CategoryList } from "../components/category-list";
import { CycleCard } from "../components/cycle-card";
import { SubscriptionList } from "../components/subscription-list";
import { cycleLine } from "../copy";
import { useCycleInsights } from "../hooks";

export function InsightsScreen({ now = new Date() }: { now?: Date }) {
  const router = useRouter();
  const insights = useCycleInsights();
  const { refetch } = insights;

  // E2E-04: after an import, coming back to the tab shows the new totals.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const addStatement = () => router.push("/upload");
  const data = insights.data;

  return (
    <Screen testID="insights">
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text variant="heading" accessibilityRole="header">
            Insights
          </Text>
          {data ? <Text variant="labelMuted">{cycleLine(data.cycleStart, data.cycleEnd, data.day)}</Text> : null}
        </View>
        <Button title="Add a statement" variant="ghost" iconOnly icon={<Icon name="upload" size={20} />} onPress={addStatement} />
      </View>
      {!data && insights.isLoading ? (
        <View testID="insights-skeleton" style={{ gap: spacing.md }}>
          <Skeleton height={120} />
          <Skeleton height={24} width="50%" />
          <Skeleton height={240} />
        </View>
      ) : !data ? (
        <ErrorState body={describeError(insights.error, messageFor)} onRetry={() => void insights.refetch()} />
      ) : (
        <>
          {insights.fetchStatus === "paused" ? (
            <Toast message={`Updated ${relativeTime(insights.dataUpdatedAt, now.getTime())}`} />
          ) : insights.error ? (
            <Toast message="Could not refresh. Showing saved data." tone="bad" />
          ) : null}
          <CycleCard insights={data} />
          <CategoryList
            rows={data.categories}
            onAddStatement={addStatement}
            onOpen={(code) => router.push({ pathname: "/insights/category/[code]", params: { code, cycleId: data.cycleId } })}
          />
          <SubscriptionList today={todayIst(now)} />
        </>
      )}
    </Screen>
  );
}
```

`app/app/(tabs)/insights.tsx` (replaces Plan 2's placeholder and Plan 4's version):

```tsx
import React from "react";
import { InsightsScreen } from "@/features/insights/screens/insights-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function InsightsRoute() {
  return <InsightsScreen />;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd app && npx jest src/features/insights && npm run lint && npm run typecheck`
Expected: PASS (`insights-screen.test.tsx` 9 tests; Task 10's tests). If Plan 4's `entry-points.test.tsx` asserted an "Add a statement" button inside the old route file, point it at `InsightsScreen` (the label and target are unchanged).

Then: `cd app && npm test`
Expected: PASS.

Manual check on a phone (Expo Go or a dev build, `cd app && npx expo start`): with the example data the screen matches the mockup; with VoiceOver or TalkBack each category row reads "Quick commerce, ₹2,460, 23 orders" and the bars are skipped.

- [ ] **Step 6: Commit**

```bash
git add app/src/features/insights "app/app/(tabs)/insights.tsx"
git commit -m "feat(app): Insights tab with the cycle forecast, categories and Still using?

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: App category drill-down

**Owner:** app-engineer. **Test IDs:** APP-42 (new: category drill-down), ERR-13 (drill-down), APP-29 (labels and targets). **Red team:** no (reads only; the server tests of Task 6 cover isolation).

Spec 3.2 #4, not drawn: "the spends in that category this cycle, with totals by merchant". Built in the Insights style: a back header with the category name and "₹2,460 · 23 orders · 1 Oct – 31 Oct"; "By merchant" rows with the same single-series bars; "Spends" rows like Home's (`Main.dc.html`: name, "Eating out · UPI · 9:12 am"-style meta, "−₹150", chevron), here with the date instead of the time ("Thu, 22 Oct · UPI") because the list spans the cycle. A refund reads "Refund · Tue, 13 Oct · UPI" and "+₹50". A spend with no merchant reads "No name".

**Files:**
- Create: `app/src/features/insights/screens/category-screen.tsx`, `app/src/features/insights/screens/category-screen.test.tsx`
- Create: `app/app/insights/category/[code].tsx`
- Modify: `app/src/features/insights/copy.ts` (`spendsNote`, `spendMeta`, `signedAmount`), `app/src/features/insights/copy.test.ts`, `app/app/_layout.tsx` (one `Stack.Screen`)

**Interfaces:**
- Consumes: Task 10's `useCategoryInsights`, `BackHeader`, `ValueBar`, `rangeLabel`, `countNote`, `paymentLabel`; Plan 2's `formatDay`, `todayIst`, `formatRupees`, `relativeTime`, `Screen`, `Skeleton`, `EmptyState`, `ErrorState`, `Toast`, `Icon`, `Text`; Plan 3's route `/spend/[id]`.
- Produces: route `/insights/category/[code]?cycleId=`; `CategoryScreen({ code, cycleId?, now? })`; copy `spendsNote(count, kind)`, `spendMeta(spend)`, `signedAmount(spend)`.

- [ ] **Step 1: Write the failing tests**

Add to `app/src/features/insights/copy.test.ts` (extend the import from `./copy` with `signedAmount, spendMeta, spendsNote`):

```ts
describe("drill-down copy (APP-42)", () => {
  it("counts spends, names payments and signs amounts", () => {
    expect(spendsNote(3, "ORDERS")).toBe("3 orders");
    expect(spendsNote(1, "NONE")).toBe("1 spend");
    expect(spendsNote(4, "NONE")).toBe("4 spends");
    const zepto = { id: "t1", kind: "SPEND" as const, amountPaise: 11000, occurredAt: "2026-10-22T06:30:00Z", merchant: "Zepto", paymentMethod: "UPI" as const };
    expect(spendMeta(zepto)).toBe("Thu, 22 Oct · UPI");
    expect(signedAmount(zepto)).toBe("−₹110");
    const refund = { ...zepto, kind: "REFUND" as const, amountPaise: 5000, occurredAt: "2026-10-13T06:30:00Z" };
    expect(spendMeta(refund)).toBe("Refund · Tue, 13 Oct · UPI");
    expect(signedAmount(refund)).toBe("+₹50");
    expect(spendMeta({ ...zepto, occurredAt: "2026-10-22T19:00:00Z" })).toBe("Fri, 23 Oct · UPI"); // 00:30 IST
  });
});
```

`app/src/features/insights/screens/category-screen.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import type { CategoryInsights } from "../api";
import { CategoryScreen } from "./category-screen";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));
jest.mock("../api", () => ({
  insightsApi: { cycle: jest.fn(), category: jest.fn(), subscriptions: jest.fn(), answer: jest.fn(), summary: jest.fn(), chooseLeftover: jest.fn() },
}));
import { insightsApi } from "../api";
const mocked = insightsApi as jest.Mocked<typeof insightsApi>;

const quickCommerce: CategoryInsights = {
  cycleId: "c1",
  cycleStart: "2026-10-01",
  cycleEnd: "2026-10-31",
  code: "quick_commerce",
  name: "Quick commerce",
  spentPaise: 68000,
  count: 5,
  countKind: "ORDERS",
  merchants: [
    { merchant: "Blinkit", spentPaise: 40000, count: 2 },
    { merchant: "Zepto", spentPaise: 28000, count: 3 },
  ],
  spends: [
    { id: "t1", kind: "SPEND", amountPaise: 11000, occurredAt: "2026-10-22T06:30:00Z", merchant: "Zepto", paymentMethod: "UPI" },
    { id: "t2", kind: "REFUND", amountPaise: 5000, occurredAt: "2026-10-13T06:30:00Z", merchant: "Zepto", paymentMethod: "UPI" },
    { id: "t3", kind: "SPEND", amountPaise: 20000, occurredAt: "2026-10-05T06:30:00Z", merchant: null, paymentMethod: "CARD" },
  ],
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CategoryScreen code="quick_commerce" cycleId="c1" now={new Date("2026-10-23T08:00:00Z")} />
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

describe("Category drill-down (APP-42)", () => {
  it("shows the category, totals by merchant and the spends", async () => {
    mocked.category.mockResolvedValue(quickCommerce);
    renderScreen();
    expect(screen.getByTestId("category-skeleton")).toBeTruthy();
    expect(await screen.findByText("Quick commerce")).toBeTruthy();
    expect(mocked.category).toHaveBeenCalledWith("quick_commerce", "c1");
    expect(screen.getByText("₹680 · 5 orders · 1 Oct – 31 Oct")).toBeTruthy();
    expect(screen.getByText("By merchant")).toBeTruthy();
    expect(screen.getByLabelText("Blinkit, ₹400, 2 orders")).toBeTruthy();
    expect(screen.getByLabelText("Zepto, ₹280, 3 orders")).toBeTruthy();
    expect(screen.getByText("Thu, 22 Oct · UPI")).toBeTruthy();
    expect(screen.getByText("−₹110")).toBeTruthy();
    expect(screen.getByText("Refund · Tue, 13 Oct · UPI")).toBeTruthy();
    expect(screen.getByText("+₹50")).toBeTruthy();
    expect(screen.getByText("No name")).toBeTruthy();
  });

  it("opens a spend and goes back", async () => {
    mocked.category.mockResolvedValue(quickCommerce);
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Edit Zepto ₹110" }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/spend/[id]", params: { id: "t1" } });
    fireEvent.press(screen.getByRole("button", { name: "Back" }));
    expect(mockBack).toHaveBeenCalled();
  });

  it("shows the empty state", async () => {
    mocked.category.mockResolvedValue({ ...quickCommerce, spentPaise: 0, count: 0, merchants: [], spends: [] });
    renderScreen();
    expect(await screen.findByText("No spends in this category this cycle")).toBeTruthy();
  });

  it("shows the error state with Retry (ERR-13)", async () => {
    mocked.category.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(quickCommerce);
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Quick commerce")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx jest src/features/insights`
Expected: FAIL (`spendsNote` and `./category-screen` missing).

- [ ] **Step 3: Copy**

Add to `app/src/features/insights/copy.ts` (extend the imports: `formatDay`, `todayIst` from `@/lib/dates`; `CategorySpend`, `CountKind` from `./api`):

```ts
/** "3 orders" where the category counts orders or payments, "3 spends" otherwise. */
export function spendsNote(count: number, kind: CountKind): string {
  if (kind !== "NONE") return countNote({ count, countKind: kind });
  return `${count} spend${count === 1 ? "" : "s"}`;
}

/** "Thu, 22 Oct · UPI" (the IST day), with "Refund · " in front for a refund. */
export function spendMeta(s: CategorySpend): string {
  const day = formatDay(todayIst(new Date(s.occurredAt)));
  return `${s.kind === "REFUND" ? "Refund · " : ""}${day} · ${paymentLabel(s.paymentMethod)}`;
}

/** "−₹110" for a spend, "+₹50" for a refund. */
export function signedAmount(s: CategorySpend): string {
  return s.kind === "REFUND" ? `+${formatRupees(s.amountPaise)}` : formatRupees(-s.amountPaise);
}
```

- [ ] **Step 4: Screen and route**

`app/src/features/insights/screens/category-screen.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, View } from "react-native";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { Toast } from "@/components/ui/toast";
import { describeError } from "@/lib/api-errors";
import { relativeTime } from "@/lib/dates";
import { messageFor } from "@/lib/errors";
import { formatRupees } from "@/lib/money";
import { colors, spacing, touchTarget } from "@/theme";
import { BackHeader } from "../components/back-header";
import { ValueBar } from "../components/value-bar";
import { countNote, rangeLabel, signedAmount, spendMeta, spendsNote } from "../copy";
import { useCategoryInsights } from "../hooks";

/** Spec 3.2 #4: one category's spends this cycle, with totals by merchant. */
export function CategoryScreen({ code, cycleId, now = new Date() }: { code: string; cycleId?: string; now?: Date }) {
  const router = useRouter();
  const q = useCategoryInsights(code, cycleId);
  const data = q.data;
  const back = () => router.back();

  if (!data && q.isLoading) {
    return (
      <Screen testID="category">
        <BackHeader title="" onBack={back} />
        <View testID="category-skeleton" style={{ gap: spacing.md }}>
          <Skeleton height={24} width="60%" />
          <Skeleton height={120} />
          <Skeleton height={240} />
        </View>
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen testID="category">
        <BackHeader title="" onBack={back} />
        <ErrorState body={describeError(q.error, messageFor)} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  const note = countNote(data);
  const subtitle = `${formatRupees(data.spentPaise)}${note ? ` · ${note}` : ""} · ${rangeLabel(data.cycleStart, data.cycleEnd)}`;
  const max = data.merchants.reduce((m, r) => Math.max(m, r.spentPaise), 0);

  return (
    <Screen testID="category">
      <BackHeader title={data.name} subtitle={subtitle} onBack={back} />
      {q.fetchStatus === "paused" ? (
        <Toast message={`Updated ${relativeTime(q.dataUpdatedAt, now.getTime())}`} />
      ) : q.error ? (
        <Toast message="Could not refresh. Showing saved data." tone="bad" />
      ) : null}
      {data.spends.length === 0 ? (
        <EmptyState title="No spends in this category this cycle" body="They show up here as soon as you log one" />
      ) : (
        <>
          <View style={{ gap: spacing.sm }}>
            <Text variant="title" accessibilityRole="header">
              By merchant
            </Text>
            {data.merchants.map((m, i) => {
              const name = m.merchant ?? "No name";
              const amount = formatRupees(m.spentPaise);
              const mNote = spendsNote(m.count, data.countKind);
              return (
                <View key={`${name}-${i}`} accessible accessibilityLabel={`${name}, ${amount}, ${mNote}`} style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                    <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", columnGap: spacing.sm }}>
                      <Text variant="label">{name}</Text>
                      <Text variant="labelMuted">{mNote}</Text>
                    </View>
                    <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>
                      {amount}
                    </Text>
                  </View>
                  <ValueBar value={m.spentPaise} max={max} testID={`merchant-bar-${i}`} />
                </View>
              );
            })}
          </View>
          <View style={{ gap: spacing.xs }}>
            <Text variant="title" accessibilityRole="header">
              Spends
            </Text>
            {data.spends.map((s, i) => {
              const name = s.merchant ?? "No name";
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${name} ${formatRupees(s.amountPaise)}`}
                  onPress={() => router.push({ pathname: "/spend/[id]", params: { id: s.id } })}
                  style={({ pressed }) => ({
                    minHeight: touchTarget,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.cm,
                    paddingVertical: spacing.sm,
                    borderBottomWidth: i < data.spends.length - 1 ? 1 : 0,
                    borderBottomColor: colors.line,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="label">{name}</Text>
                    <Text variant="caption">{spendMeta(s)}</Text>
                  </View>
                  <Text variant="label" color={s.kind === "REFUND" ? colors.goodDeep : colors.ink} style={{ fontVariant: ["tabular-nums"] }}>
                    {signedAmount(s)}
                  </Text>
                  <Icon name="right" size={16} color={colors.muted} />
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}
```

`app/app/insights/category/[code].tsx`:

```tsx
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { CategoryScreen } from "@/features/insights/screens/category-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function CategoryRoute() {
  const { code, cycleId } = useLocalSearchParams<{ code: string; cycleId?: string }>();
  return <CategoryScreen code={String(code)} cycleId={typeof cycleId === "string" && cycleId !== "" ? cycleId : undefined} />;
}
```

In `app/app/_layout.tsx`, inside `<Stack.Protected guard={status === "signedIn"}>` after the existing screens, add:

```tsx
        <Stack.Screen name="insights/category/[code]" />
```

- [ ] **Step 5: Run the tests**

Run: `cd app && npx jest src/features/insights && npm run lint && npm run typecheck`
Expected: PASS (category screen 4 tests, the new copy test, and Tasks 10–11).

- [ ] **Step 6: Commit**

```bash
git add app/src/features/insights "app/app/insights/category/[code].tsx" app/app/_layout.tsx
git commit -m "feat(app): category drill-down with merchant totals and spends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: App cycle summary and the leftover choice

**Owner:** app-engineer. **Test IDs:** APP-43 (new: cycle summary and the leftover choice), ERR-13 (summary), APP-28 (decision errors inline, never a toast), APP-29. **Red team:** yes (double-tapped Confirm; a stale screen choosing after another device chose; a deep link to another user's cycle id).

Spec 3.2 #12, not drawn: "Cycle summary screen at cycle close (2.8), with the leftover choice (2.1)". Built in the Insights style:

- Back header "Cycle summary", subtitle "1 Oct – 31 Oct".
- An open cycle shows "This cycle is still running. These are the figures so far." (two sentences, so full stops).
- A card with "Spent" "₹13,300" "of ₹15,000", "Saved" "₹21,700", and for a closed cycle "Extra saved" "₹1,700"; an open cycle shows the forecast sentence instead of extra saved.
- "Days by grade": one row per grade, "A+" … "F", with "3 days" and a single-series bar (the rows are the table view; each reads "A+: 3 days"). No closed days: "No closed days yet".
- "Top categories": up to three rows, name and amount. None: "Nothing spent yet".
- "Badges earned": badge name (Plan 6's catalogue; a weekly-challenge badge reads "Weekly challenge") and the day, "First log · Mon, 5 Oct". None: "No badges this cycle".
- The choice, for a closed cycle not yet chosen: heading "₹1,700 left over" (or "₹400 over budget"), two radio cards ("Add to savings" / "Your savings for this cycle become ₹21,700"; "Roll into this cycle" / "Adds ₹1,700 to what you can spend until payday"; for an overspent cycle "Carry it into this cycle" / "This cycle starts ₹400 lower" and "Take it from savings" / "Your savings for that cycle drop by ₹400"), the first preselected because it is what already happened, and a terracotta "Confirm" (the screen's one primary action). Errors show inline under the button.
- After a choice: a status line with a check, "Rolled into this cycle" (or "Added to your savings", "Carried into this cycle", "Taken from your savings").

**Files:**
- Create: `app/src/features/insights/screens/cycle-summary-screen.tsx`, `app/src/features/insights/screens/cycle-summary.test.tsx`
- Create: `app/app/cycle/[id].tsx`
- Modify: `app/app/_layout.tsx` (one `Stack.Screen`)

**Interfaces:**
- Consumes: Task 10's `useCycleSummary`, `useChooseLeftover`, `summarySeenKey`, `GRADES`, copy (`rangeLabel`, `gradeLabel`, `daysLabel`, `leftoverHeading`, `leftoverOption`, `chosenStatus`, `forecastSentence`), `BackHeader`, `ValueBar`; Plan 2's `RadioCard`, `Button`, `Screen`, `Skeleton`, `ErrorState`, `Text`, `Icon`, `kv`, `formatDay`, `formatRupees`, `ApiError`, `isApiError`, `describeError`, `messageFor`; Plan 6's `badgeCatalog` (`@/features/game/badges/badge-catalog`) and `BadgeCode` (`@/features/game/api`); Task 8's messages for `CYCLE_OPEN` and `ALREADY_CHOSEN`.
- Produces: route `/cycle/[id]`; `CycleSummaryScreen({ id })`; it sets the `kv` key `summarySeenKey(id)` (Task 10) when the summary has loaded, which Task 14 reads.

- [ ] **Step 1: Write the failing test**

`app/src/features/insights/screens/cycle-summary.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { ApiError } from "@/lib/api-errors";
import type { CycleSummary } from "../api";
import { summarySeenKey } from "../keys";
import { CycleSummaryScreen } from "./cycle-summary-screen";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), back: mockBack }) }));
jest.mock("@/lib/kv", () => ({ kv: { get: jest.fn(() => Promise.resolve(null)), set: jest.fn(() => Promise.resolve()), remove: jest.fn(() => Promise.resolve()) } }));
jest.mock("../api", () => ({
  GRADES: ["A_PLUS", "A", "B", "C", "D", "F"],
  insightsApi: { cycle: jest.fn(), category: jest.fn(), subscriptions: jest.fn(), answer: jest.fn(), summary: jest.fn(), chooseLeftover: jest.fn() },
}));
import { kv } from "@/lib/kv";
import { insightsApi } from "../api";
const mocked = insightsApi as jest.Mocked<typeof insightsApi>;

const october: CycleSummary = {
  cycleId: "c1",
  cycleStart: "2026-10-01",
  cycleEnd: "2026-10-31",
  closed: true,
  spentPaise: 1330000,
  spendablePaise: 1500000,
  savedPaise: 2170000,
  extraSavedPaise: 170000,
  leftoverPaise: 170000,
  leftoverChoice: null,
  choices: ["SAVINGS", "ROLLOVER"],
  grades: { A_PLUS: 3, A: 0, B: 2, C: 0, D: 0, F: 1 },
  topCategories: [
    { code: "shopping", name: "Shopping", spentPaise: 500000 },
    { code: "food_delivery", name: "Food delivery", spentPaise: 400000 },
    { code: "quick_commerce", name: "Quick commerce", spentPaise: 300000 },
  ],
  badges: [
    { code: "FIRST_LOG", earnedOn: "2026-10-05" },
    { code: "CHALLENGE_FOOD_DELIVERY", earnedOn: "2026-10-26" },
  ],
  forecast: null,
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CycleSummaryScreen id="c1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

describe("Cycle summary (APP-43)", () => {
  it("shows the closed cycle's figures, grades, categories and badges", async () => {
    mocked.summary.mockResolvedValue(october);
    renderScreen();
    expect(screen.getByTestId("summary-skeleton")).toBeTruthy();
    expect(await screen.findByText("Cycle summary")).toBeTruthy();
    expect(screen.getByText("1 Oct – 31 Oct")).toBeTruthy();
    expect(screen.getByText("₹13,300")).toBeTruthy();
    expect(screen.getByText("of ₹15,000")).toBeTruthy();
    expect(screen.getByText("₹21,700")).toBeTruthy();
    expect(screen.getByText("Extra saved")).toBeTruthy();
    expect(screen.getByText("₹1,700")).toBeTruthy();
    expect(screen.getByLabelText("A+: 3 days")).toBeTruthy();
    expect(screen.getByLabelText("A: 0 days")).toBeTruthy();
    expect(screen.getByLabelText("B: 2 days")).toBeTruthy();
    expect(screen.getByLabelText("F: 1 day")).toBeTruthy();
    expect(screen.getByText("Shopping")).toBeTruthy();
    expect(screen.getByText("₹5,000")).toBeTruthy();
    expect(screen.getByText("First log · Mon, 5 Oct")).toBeTruthy();
    expect(screen.getByText("Weekly challenge · Mon, 26 Oct")).toBeTruthy();
    await waitFor(() => expect(kv.set).toHaveBeenCalledWith(summarySeenKey("c1"), "1"));
  });

  it("rolls the leftover over once, even on a double tap", async () => {
    mocked.summary.mockResolvedValue(october);
    mocked.chooseLeftover.mockResolvedValue({ ...october, leftoverChoice: "ROLLOVER", choices: [], extraSavedPaise: 0, savedPaise: 2000000 });
    renderScreen();
    expect(await screen.findByText("₹1,700 left over")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Add to savings" })).toBeChecked();
    expect(screen.getByText("Adds ₹1,700 to what you can spend until payday")).toBeTruthy();
    fireEvent.press(screen.getByRole("radio", { name: "Roll into this cycle" }));
    const confirm = screen.getByRole("button", { name: "Confirm" });
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    expect(await screen.findByText("Rolled into this cycle")).toBeTruthy();
    expect(mocked.chooseLeftover).toHaveBeenCalledTimes(1);
    expect(mocked.chooseLeftover).toHaveBeenCalledWith("c1", "ROLLOVER");
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("shows ALREADY_CHOSEN inline and refreshes (APP-28)", async () => {
    let fresh: (s: CycleSummary) => void = () => undefined;
    mocked.summary
      .mockResolvedValueOnce(october)
      .mockReturnValueOnce(new Promise<CycleSummary>((r) => (fresh = r)));
    mocked.chooseLeftover.mockRejectedValue(new ApiError("ALREADY_CHOSEN", 409, "x"));
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("You already chose where this money goes")).toBeTruthy();
    await waitFor(() => expect(mocked.summary).toHaveBeenCalledTimes(2)); // the screen refetches the summary
    await act(async () => fresh({ ...october, leftoverChoice: "SAVINGS", choices: [] }));
    expect(await screen.findByText("Added to your savings")).toBeTruthy();
  });

  it("offers carry or take for an overspent cycle", async () => {
    mocked.summary.mockResolvedValue({ ...october, leftoverPaise: -40000, extraSavedPaise: 0, savedPaise: 2000000, choices: ["CARRY", "TAKE"] });
    renderScreen();
    expect(await screen.findByText("₹400 over budget")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Carry it into this cycle" })).toBeChecked();
    expect(screen.getByText("Your savings for that cycle drop by ₹400")).toBeTruthy();
  });

  it("an open cycle shows figures so far and no choice", async () => {
    mocked.summary.mockResolvedValue({
      ...october,
      closed: false,
      spentPaise: 984000,
      savedPaise: 2000000,
      extraSavedPaise: null,
      leftoverPaise: null,
      choices: [],
      badges: [],
      forecast: {
        cycleEnd: "2026-10-31", daysElapsed: 23, cycleDays: 31, spentPaise: 984000, spendablePaise: 1500000, spendPaise: 1330000,
        plannedSavingsPaise: 2000000, extraSavedPaise: 170000, savePaise: 2170000, early: false, offTrack: false,
      },
    });
    renderScreen();
    expect(await screen.findByText("This cycle is still running. These are the figures so far.")).toBeTruthy();
    expect(screen.getByText("At this pace you'll spend ₹13,300 by 31 Oct and save ₹21,700, ₹1,700 more than planned")).toBeTruthy();
    expect(screen.getByText("No badges this cycle")).toBeTruthy();
    expect(screen.queryByText("Extra saved")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("shows the error state with Retry and goes back (ERR-13)", async () => {
    mocked.summary.mockRejectedValueOnce(new ApiError("NOT_FOUND", 404, "x")).mockResolvedValueOnce(october);
    renderScreen();
    expect(await screen.findByText("That no longer exists")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Back" }));
    expect(mockBack).toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("₹1,700 left over")).toBeTruthy();
  });
});
```

`RadioCard` (Plan 2) exposes `accessibilityRole="radio"` with `accessibilityState.checked`, which `toBeChecked` reads.

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npx jest src/features/insights/screens/cycle-summary.test.tsx`
Expected: FAIL (`./cycle-summary-screen` missing).

- [ ] **Step 3: Screen and route**

`app/src/features/insights/screens/cycle-summary-screen.tsx`:

```tsx
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { RadioCard } from "@/components/ui/radio-card";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import type { BadgeCode } from "@/features/game/api";
import { badgeCatalog } from "@/features/game/badges/badge-catalog";
import { describeError, isApiError } from "@/lib/api-errors";
import { formatDay } from "@/lib/dates";
import { messageFor } from "@/lib/errors";
import { kv } from "@/lib/kv";
import { formatRupees } from "@/lib/money";
import { colors, radius, spacing } from "@/theme";
import { GRADES, type CycleSummary, type LeftoverChoice } from "../api";
import { BackHeader } from "../components/back-header";
import { ValueBar } from "../components/value-bar";
import { chosenStatus, daysLabel, forecastSentence, gradeLabel, leftoverHeading, leftoverOption, rangeLabel } from "../copy";
import { useChooseLeftover, useCycleSummary } from "../hooks";
import { summarySeenKey } from "../keys";

function badgeName(code: string): string {
  return code in badgeCatalog ? badgeCatalog[code as BadgeCode].name : "Weekly challenge";
}

const card = { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line } as const;

/** Spec 2.8's cycle summary with 2.1's leftover choice (spec 3.2 #12). */
export function CycleSummaryScreen({ id }: { id: string }) {
  const router = useRouter();
  const q = useCycleSummary(id);
  const data = q.data;
  const back = () => router.back();

  useEffect(() => {
    if (data) void kv.set(summarySeenKey(id), "1");
  }, [data, id]);

  if (!data && q.isLoading) {
    return (
      <Screen testID="cycle-summary">
        <BackHeader title="Cycle summary" onBack={back} />
        <View testID="summary-skeleton" style={{ gap: spacing.md }}>
          <Skeleton height={120} />
          <Skeleton height={160} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen testID="cycle-summary">
        <BackHeader title="Cycle summary" onBack={back} />
        <ErrorState body={describeError(q.error, messageFor)} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen testID="cycle-summary">
      <BackHeader title="Cycle summary" subtitle={rangeLabel(data.cycleStart, data.cycleEnd)} onBack={back} />
      {!data.closed ? <Text variant="bodyMuted">This cycle is still running. These are the figures so far.</Text> : null}
      <Figures data={data} />
      <Grades data={data} />
      <View style={card}>
        <Text variant="title" accessibilityRole="header">
          Top categories
        </Text>
        {data.topCategories.length === 0 ? (
          <Text variant="bodyMuted">Nothing spent yet</Text>
        ) : (
          data.topCategories.map((c) => (
            <View key={c.code} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text variant="label">{c.name}</Text>
              <Text variant="label">{formatRupees(c.spentPaise)}</Text>
            </View>
          ))
        )}
      </View>
      <View style={card}>
        <Text variant="title" accessibilityRole="header">
          Badges earned
        </Text>
        {data.badges.length === 0 ? (
          <Text variant="bodyMuted">No badges this cycle</Text>
        ) : (
          data.badges.map((b) => (
            <Text key={`${b.code}-${b.earnedOn}`} variant="label">
              {`${badgeName(b.code)} · ${formatDay(b.earnedOn)}`}
            </Text>
          ))
        )}
      </View>
      {data.closed && data.leftoverChoice ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }} accessibilityLiveRegion="polite">
          <Icon name="check" size={18} color={colors.good} />
          <Text variant="bodyStrong">{chosenStatus(data.leftoverChoice)}</Text>
        </View>
      ) : null}
      {data.closed && !data.leftoverChoice && data.choices.length > 0 ? <Choice data={data} onStale={() => void q.refetch()} /> : null}
    </Screen>
  );
}

function Figures({ data }: { data: CycleSummary }) {
  const f = data.forecast;
  return (
    <View style={card}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text variant="label">Spent</Text>
        <View style={{ alignItems: "flex-end" }}>
          <Text variant="amount">{formatRupees(data.spentPaise)}</Text>
          <Text variant="caption">{`of ${formatRupees(data.spendablePaise)}`}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text variant="label">Saved</Text>
        <Text variant="amount">{formatRupees(data.savedPaise)}</Text>
      </View>
      {data.closed ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Text variant="label">Extra saved</Text>
          <Text variant="amount">{formatRupees(data.extraSavedPaise ?? 0)}</Text>
        </View>
      ) : f && !f.early && data.spentPaise > 0 ? (
        <Text variant="label">{forecastSentence(f)}</Text>
      ) : null}
    </View>
  );
}

/** Days by grade as single-series bars; each row reads "A+: 3 days" (the table view). */
function Grades({ data }: { data: CycleSummary }) {
  const counts = GRADES.map((g) => data.grades[g] ?? 0);
  const max = Math.max(0, ...counts);
  return (
    <View style={card}>
      <Text variant="title" accessibilityRole="header">
        Days by grade
      </Text>
      {max === 0 ? (
        <Text variant="bodyMuted">No closed days yet</Text>
      ) : (
        GRADES.map((g, i) => (
          <View key={g} accessible accessibilityLabel={`${gradeLabel(g)}: ${daysLabel(counts[i] ?? 0)}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text variant="label" style={{ width: spacing.lg }}>
              {gradeLabel(g)}
            </Text>
            <View style={{ flex: 1 }}>
              <ValueBar value={counts[i] ?? 0} max={max} testID={`grade-bar-${g}`} />
            </View>
            <Text variant="labelMuted">{daysLabel(counts[i] ?? 0)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

/** The leftover choice: the default (what already happened) is preselected; Confirm sends once. */
function Choice({ data, onStale }: { data: CycleSummary; onStale: () => void }) {
  const choose = useChooseLeftover(data.cycleId);
  const [picked, setPicked] = useState<LeftoverChoice>(data.choices[0] ?? "SAVINGS");
  const sending = useRef(false);

  const confirm = () => {
    if (sending.current) return;
    sending.current = true;
    choose.mutate(picked, {
      onError: (e) => {
        if (isApiError(e, "ALREADY_CHOSEN")) onStale();
      },
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="title" accessibilityRole="header">
        {leftoverHeading(data)}
      </Text>
      {data.choices.map((c) => {
        const o = leftoverOption(c, data);
        return <RadioCard key={c} title={o.title} description={o.description} checked={picked === c} onPress={() => setPicked(c)} />;
      })}
      <Button title="Confirm" onPress={confirm} loading={choose.isPending} />
      {choose.error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {describeError(choose.error, messageFor)}
        </Text>
      ) : null}
    </View>
  );
}
```

`app/app/cycle/[id].tsx`:

```tsx
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { CycleSummaryScreen } from "@/features/insights/screens/cycle-summary-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function CycleSummaryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CycleSummaryScreen id={String(id)} />;
}
```

In `app/app/_layout.tsx`, inside `<Stack.Protected guard={status === "signedIn"}>`, add after Task 12's line:

```tsx
        <Stack.Screen name="cycle/[id]" />
```

A deep link with another user's id gets 404 from the server, which the screen shows as "That no longer exists" with Retry and Back.

- [ ] **Step 4: Run the tests**

Run: `cd app && npx jest src/features/insights && npm run lint && npm run typecheck`
Expected: PASS (cycle summary 6 tests and the earlier insights tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/features/insights "app/app/cycle/[id].tsx" app/app/_layout.tsx
git commit -m "feat(app): cycle summary with grades, top categories, badges and the leftover choice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 14: App Home forecast line and the cycle-just-closed card

**Owner:** app-engineer. **Test IDs:** APP-44 (new: Home forecast and closed cycle), APP-11 (regression: Home's states unchanged), API-TDY-01 (app half: the line under the bar). **Red team:** no (display only; the card opens Task 13's screen, whose red team covers the choice).

Mockup (`Main.dc.html`), quoted: under the budget bar, left "₹180 spent", right a check icon and "₹1,700 extra saved at this pace". When the pace is short the same place reads "₹1,000 short at this pace" with the alert icon in warn ink; at exactly zero, "On plan at this pace". On a first-run day the right side keeps Plan 2's "Your streak starts tonight if you stay under". The forecast is absent in a cycle's first two days (the server sends null).

The closed-cycle card, not drawn, sits above the Gullak hero for the first week of a new cycle: title "1 Oct – 31 Oct is done", body "₹1,700 left over. See your summary and choose where it goes." (or "You went ₹400 over. See your summary and choose how to cover it.", or "See how your cycle went" when nothing was left), and a secondary "See summary" button (the + stays the screen's one terracotta action).

**Files:**
- Create: `app/src/features/home/forecast-note.tsx`, `app/src/features/home/just-closed-card.tsx`, `app/src/features/home/home-insights.test.tsx`
- Modify: `app/src/features/budget/api.ts` (`Today.forecast`, `Today.justClosed`), `app/src/features/home/hero.tsx` (the row under the bar), `app/src/features/home/home-screen.tsx` (the card above the hero), `app/src/features/home/home.test.tsx` (one case)

**Interfaces:**
- Consumes: Task 7's `forecast` and `justClosed` on `GET /budget/today`; Task 10's `rangeLabel`; Task 10's `summarySeenKey`; Task 13's route `/cycle/[id]`; Plan 2's `Hero`, `HomeScreen`, `Button`, `Icon`, `Text`, `kv`, `formatRupees`.
- Produces: types `HomeForecast`, `JustClosed` on `Today`; `forecastNote(f) : { text, tone }`, `ForecastNote({ forecast })`; `justClosedCopy(jc) : { title, body }`, `JustClosedCard({ justClosed, onOpen })`, `JustClosedSlot({ justClosed })`.

- [ ] **Step 1: Write the failing tests**

`app/src/features/home/home-insights.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { ForecastNote, forecastNote } from "./forecast-note";
import { JustClosedSlot, justClosedCopy } from "./just-closed-card";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/kv", () => ({ kv: { get: jest.fn(() => Promise.resolve(null)), set: jest.fn(() => Promise.resolve()), remove: jest.fn(() => Promise.resolve()) } }));
import { kv } from "@/lib/kv";

const october = { cycleId: "c1", cycleStart: "2026-10-01", cycleEnd: "2026-10-31", leftoverPaise: 170000 };

beforeEach(() => {
  jest.clearAllMocks();
  (kv.get as jest.Mock).mockResolvedValue(null);
});

describe("Home forecast line (APP-44)", () => {
  it("words extra, short and on plan", () => {
    expect(forecastNote({ spendPaise: 1330000, extraSavedPaise: 170000, offTrack: false })).toEqual({ text: "₹1,700 extra saved at this pace", tone: "good" });
    expect(forecastNote({ spendPaise: 1600000, extraSavedPaise: -100000, offTrack: true })).toEqual({ text: "₹1,000 short at this pace", tone: "warn" });
    expect(forecastNote({ spendPaise: 1500000, extraSavedPaise: 0, offTrack: false })).toEqual({ text: "On plan at this pace", tone: "muted" });
  });

  it("renders nothing without a forecast", () => {
    render(<ForecastNote forecast={null} />);
    expect(screen.queryByText(/at this pace/)).toBeNull();
    render(<ForecastNote forecast={{ spendPaise: 1330000, extraSavedPaise: 170000, offTrack: false }} />);
    expect(screen.getByText("₹1,700 extra saved at this pace")).toBeTruthy();
  });
});

describe("Cycle just closed card (APP-44)", () => {
  it("words the three cases", () => {
    expect(justClosedCopy(october)).toEqual({
      title: "1 Oct – 31 Oct is done",
      body: "₹1,700 left over. See your summary and choose where it goes.",
    });
    expect(justClosedCopy({ ...october, leftoverPaise: -40000 }).body).toBe("You went ₹400 over. See your summary and choose how to cover it.");
    expect(justClosedCopy({ ...october, leftoverPaise: 0 }).body).toBe("See how your cycle went");
  });

  it("opens the summary", async () => {
    render(<JustClosedSlot justClosed={october} />);
    expect(screen.getByText("1 Oct – 31 Oct is done")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "See summary" }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/cycle/[id]", params: { id: "c1" } });
  });

  it("a zero leftover hides once its summary was seen", async () => {
    (kv.get as jest.Mock).mockResolvedValue("1");
    render(<JustClosedSlot justClosed={{ ...october, leftoverPaise: 0 }} />);
    await waitFor(() => expect(kv.get).toHaveBeenCalledWith("cycle-summary-seen.c1"));
    expect(screen.queryByText("1 Oct – 31 Oct is done")).toBeNull();
  });

  it("a zero leftover shows until then", async () => {
    render(<JustClosedSlot justClosed={{ ...october, leftoverPaise: 0 }} />);
    expect(await screen.findByText("See how your cycle went")).toBeTruthy();
  });
});
```

Add this case to `app/src/features/home/home.test.tsx` inside `describe("Home (APP-11)", …)` (it reuses that file's `exampleDay`, `renderHome` and `mocked`):

```tsx
  it("shows the forecast line under the bar (APP-44, API-TDY-01)", async () => {
    mocked.getToday.mockResolvedValue({ ...exampleDay, forecast: { spendPaise: 1330000, extraSavedPaise: 170000, offTrack: false }, justClosed: null });
    renderHome();
    expect(await screen.findByText("₹1,700 extra saved at this pace")).toBeTruthy();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx jest src/features/home`
Expected: FAIL (`./forecast-note` and `./just-closed-card` missing; the new Home case does not find the line).

- [ ] **Step 3: Types**

In `app/src/features/budget/api.ts`, add above `Today`:

```ts
/** Plan 7: Home's "₹1,700 extra saved at this pace"; null in a cycle's first two days or before anything is spent. */
export type HomeForecast = { spendPaise: number; extraSavedPaise: number; offTrack: boolean };

/** Plan 7: the previous cycle, closed with its leftover not yet chosen, for the first week of the new cycle. */
export type JustClosed = { cycleId: string; cycleStart: string; cycleEnd: string; leftoverPaise: number };
```

and add to the `Today` type, after the fields earlier plans added:

```ts
  forecast?: HomeForecast | null;
  justClosed?: JustClosed | null;
```

(Optional, so earlier fixtures without them still type-check.)

- [ ] **Step 4: Components**

`app/src/features/home/forecast-note.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import type { HomeForecast } from "@/features/budget/api";
import { formatRupees } from "@/lib/money";
import { colors, spacing } from "@/theme";

export function forecastNote(f: HomeForecast): { text: string; tone: "good" | "warn" | "muted" } {
  if (f.extraSavedPaise > 0) return { text: `${formatRupees(f.extraSavedPaise)} extra saved at this pace`, tone: "good" };
  if (f.extraSavedPaise < 0) return { text: `${formatRupees(-f.extraSavedPaise)} short at this pace`, tone: "warn" };
  return { text: "On plan at this pace", tone: "muted" };
}

const toneColor = { good: colors.good, warn: colors.warnInk, muted: colors.muted } as const;

/** The right side of the row under Home's bar (Main mockup). Status colour with an icon, never colour alone. */
export function ForecastNote({ forecast }: { forecast: HomeForecast | null | undefined }) {
  if (!forecast) return null;
  const n = forecastNote(forecast);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 }}>
      <Icon name={n.tone === "warn" ? "alert" : "check"} size={16} color={toneColor[n.tone]} />
      <Text variant="label" color={toneColor[n.tone]}>
        {n.text}
      </Text>
    </View>
  );
}
```

`app/src/features/home/just-closed-card.tsx`:

```tsx
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import type { JustClosed } from "@/features/budget/api";
import { rangeLabel } from "@/features/insights/copy";
import { summarySeenKey } from "@/features/insights/keys";
import { kv } from "@/lib/kv";
import { formatRupees } from "@/lib/money";
import { colors, radius, spacing } from "@/theme";

export function justClosedCopy(jc: JustClosed): { title: string; body: string } {
  const title = `${rangeLabel(jc.cycleStart, jc.cycleEnd)} is done`;
  if (jc.leftoverPaise > 0) {
    return { title, body: `${formatRupees(jc.leftoverPaise)} left over. See your summary and choose where it goes.` };
  }
  if (jc.leftoverPaise < 0) {
    return { title, body: `You went ${formatRupees(-jc.leftoverPaise)} over. See your summary and choose how to cover it.` };
  }
  return { title, body: "See how your cycle went" };
}

export function JustClosedCard({ justClosed, onOpen }: { justClosed: JustClosed; onOpen: () => void }) {
  const copy = justClosedCopy(justClosed);
  return (
    <View style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.sand }}>
      <Text variant="bodyStrong">{copy.title}</Text>
      <Text variant="body">{copy.body}</Text>
      <Button title="See summary" variant="secondary" onPress={onOpen} />
    </View>
  );
}

/**
 * Shows the card while the server sends justClosed (first week, leftover unchosen). With nothing left over there
 * is nothing to choose, so the card goes once the summary has been opened.
 */
export function JustClosedSlot({ justClosed }: { justClosed: JustClosed }) {
  const router = useRouter();
  const needsCheck = justClosed.leftoverPaise === 0;
  const [hidden, setHidden] = useState<boolean>(needsCheck);

  useEffect(() => {
    if (!needsCheck) return;
    let alive = true;
    void kv.get(summarySeenKey(justClosed.cycleId)).then((v) => alive && setHidden(v === "1"));
    return () => {
      alive = false;
    };
  }, [needsCheck, justClosed.cycleId]);

  if (hidden) return null;
  return (
    <JustClosedCard
      justClosed={justClosed}
      onOpen={() => router.push({ pathname: "/cycle/[id]", params: { id: justClosed.cycleId } })}
    />
  );
}
```

- [ ] **Step 5: Wire them into Home**

In `app/src/features/home/hero.tsx`, add the import `import { ForecastNote } from "./forecast-note";` and replace the row under the progress bar (Plan 2's block, which earlier plans may have kept as is):

```tsx
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="label">{`${formatRupees(today.spentPaise)} spent`}</Text>
        <Text variant="labelMuted">{firstRun ? "Your streak starts tonight if you stay under" : ""}</Text>
      </View>
```

with:

```tsx
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
        <Text variant="label">{`${formatRupees(today.spentPaise)} spent`}</Text>
        {firstRun ? (
          <Text variant="labelMuted">Your streak starts tonight if you stay under</Text>
        ) : (
          <ForecastNote forecast={today.forecast} />
        )}
      </View>
```

In `app/src/features/home/home-screen.tsx`, add the import `import { JustClosedSlot } from "./just-closed-card";` and, in the branch that renders the figures, directly above `<Hero … />`, add:

```tsx
          {data.justClosed ? <JustClosedSlot justClosed={data.justClosed} /> : null}
```

- [ ] **Step 6: Run the tests**

Run: `cd app && npx jest src/features/home src/features/insights && npm run lint && npm run typecheck`
Expected: PASS (`home-insights.test.tsx` 6 tests, the new Home case, and every earlier Home test unchanged).

Then: `cd app && npm test`
Expected: PASS.

Manual check (`cd app && npx expo start` against a local server with the example data on 23 Oct): Home shows "₹1,700 extra saved at this pace" under the bar; with the server clock on 1 Nov the card "1 Oct – 31 Oct is done" opens the summary, and after "Roll into this cycle" → "Confirm", Home's budget rises and the card is gone.

- [ ] **Step 7: Commit**

```bash
git add app/src/features/budget/api.ts app/src/features/home
git commit -m "feat(app): Home forecast line and the cycle-just-closed card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the last task

- Run both suites from a clean checkout: `cd server && ./gradlew clean test` and `cd app && npm ci && npm test && npm run lint && npm run typecheck`.
- The whole-branch review checks the five Review Focus tests by name, the package graph (`insights` imported only by `jobs`), and that no response or log line in this plan carries `merchant_raw_enc` or an amount.
- Hand-off to Plan 8: `InsightsService.offTrack(UUID) : boolean` (spending half of spec 2.7, as of yesterday) and `InsightsService.forecast(UUID, UUID) : Forecast` (the push copy can reuse `spendPaise` and `extraSavedPaise`, already rounded to ₹100).
