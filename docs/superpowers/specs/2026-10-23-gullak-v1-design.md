# Gullak V1: design spec

Date: 23 Oct 2026
Status: draft for the founder's review
Mockups: https://claude.ai/artifact/DPy3p9xKLzdgypzHbTXx8y (27 artboards, clickable)
Visual rules: `.claude/design.md`
Prototype test results: `docs/ux-test-findings.md`

Amounts in this document are in rupees. The worked example throughout is one user: take-home pay ₹50,000, fixed costs ₹15,000, monthly savings ₹20,000, payday on the 1st, today Fri 23 Oct 2026.

## 1. What Gullak is

Salaried people in Indian cities lose track of money in small daily payments: coffee, Zepto, Swiggy, UPI to friends. Gullak turns a monthly salary into one number per day and shows, every morning and every night, how the day went against it. A clay piggy bank (the Gullak) reacts to that number, and a light game keeps people logging.

The app is for salaried people aged roughly 22 to 35 who pay mostly by UPI, want to save a fixed amount each month, and do not want a spreadsheet.

V1 success means a new user can:

- finish setup in 2 minutes and see a daily budget;
- log a spend in two taps;
- upload a bank statement and have most lines sorted without touching them;
- see every morning what they can spend and every night how they did;
- set a savings goal and know whether they will reach it.

Numbers to watch after launch: day-7 retention, share of days with at least one logged spend, and share of statement lines sorted automatically (target above 70%).

### 1.1 In V1

- Email login.
- Setup: income, payday, fixed costs, monthly savings and goals, personality, message times.
- Daily budget, Home, quick-add, spend edit and delete.
- Statement upload: PDF for HDFC, ICICI, SBI, Axis and Kotak; CSV for any bank.
- Automatic categorising, matching of logged spends to statement lines, swipe-to-sort.
- Goals with Strict or Flexible mode and a catch-up plan.
- The Gullak with 5 moods and 4 growth stages, XP, levels, streaks with freezes, 10 badges, one weekly challenge.
- Morning and night messages, the night report card, off-track alerts.
- Insights by category, subscription detection, month-end forecast.
- Data export and account deletion.
- Android, iOS and a reduced web app (dashboard, upload, goals and budget settings; no quick-add, mascot moments or notifications on web).

### 1.2 Not in V1

Account Aggregator or SMS bank feeds, a professionally animated mascot (Rive), home-screen widgets, shared budgets, an AI coach, tax reports, leagues with friends, bank holidays in the payday calendar.

The data pipeline is built so that Account Aggregator can be added in V2 as one more transaction source without changing the budget, matching or game code.

## 2. Product rules

### 2.1 Budget cycle and daily budget

A cycle runs from one payday to the day before the next. Payday is one of: a fixed day of the month (1 to 28), the last working day (last Monday to Friday of the month; public holidays are ignored in V1), or "another date" (also 1 to 28). Changing the payday takes effect from the next cycle. Changes to income, fixed costs or savings apply to the current cycle at once.

All budget maths is done in paise and rounded down; the app shows whole rupees. The daily budget itself is rounded down to whole rupees, and the paise remainder stays in the pool, so every figure on screen adds up.

For each cycle:

```
spendable      = income − fixed costs − savings set aside
spent so far   = debits that count in the budget − refunds, from cycle start to yesterday
daily budget   = (spendable − spent so far) ÷ days left in the cycle, today included
```

The daily budget is never stored. The server works it out from transactions on every request, so it can never drift.

Example on 23 Oct: spendable ₹15,000, spent before today ₹9,660, 9 days left → ₹593 today.

Rules:

- Money not spent today stays in the pool, so tomorrow's budget rises a little. Overspending lowers it. Nothing resets mid-cycle.
- If the pool goes below zero, the daily budget is ₹0 until payday, the Gullak faints, and the catch-up plan appears.
- Fixed costs and transfers to savings or SIPs never count against the daily budget, even when they appear in a statement.
- The first cycle after setup usually starts mid-cycle. Its spendable amount is pro-rated: monthly spendable × days left including today ÷ days in the cycle, rounded down to whole rupees. Setup asks "How much money do you have left until payday?" pre-filled with that figure, and the user's answer replaces it for this first cycle only. The answer is the money in hand now: spends already logged in the cycle are added back, so the answer is exactly what is left to spend. It cannot exceed the monthly income. (Built in Plan 2 with Home first run.)
- A big one-off spend (for example a ₹15,000 flight) can be marked "spread over the cycle". It reduces the pool but is left out of today's spent figure, so one purchase does not faint the Gullak.
- Extra income (bonus, refund of a deposit) is a credit the user assigns: to savings, to the pool, or split.
- At cycle close, money left in the pool becomes "extra saved" and is added to savings (see 2.2). The user can instead roll it into the next cycle from the cycle summary.
- Day boundaries are Asia/Kolkata for every V1 user. The day closes at 00:05 the next morning by a server job; the night report at the user's chosen time shows the day so far.

### 2.2 Savings and goals

Savings come out first; the daily budget is what is left. The app records the plan and never moves money.

Goal types:

- Monthly target: "save ₹20,000 every month". It is the sum of all goal contributions plus a free amount the user may leave unassigned.
- Deadline goal: "₹30,000 for Goa by 15 Mar 2027". Monthly contribution = amount left ÷ paydays left, rounded up to ₹100. Progress expected by today = target × paydays elapsed ÷ paydays in total.

Reality check when a goal is set or changed, computed from the user's free savings (monthly savings minus contributions already promised to other goals):

- Doable: contribution fits, and at least ₹1,500 of free savings remains.
- Possible but tight: contribution fits with less than ₹1,500 free.
- Not possible: contribution exceeds free savings, or the deadline month has already passed. The start button is disabled and says what to change.

Each goal has a mode:

- Flexible (default): if a cycle ends short, or the pool runs out before payday, the catch-up plan may take the shortfall from this cycle's contribution (so the money comes back to the pool), move the goal's deadline or lower its target. Goals can slip, but only when the user picks that.
- Strict: the goal's contribution is never reduced by the app. If the pool runs out, the daily budget is ₹0 until payday and any overspend is carried into the next cycle's pool as a debt. The catch-up plan only offers "spend less".

Catch-up plan (shown on Home when a goal is behind, and from the goal itself):

1. Tighten: spend (gap ÷ days left) less per day for the rest of the cycle.
2. Move the deadline: to the first payday that closes the gap.
3. Lower the target: target minus gap.

Picking one records a catch-up action that can be undone until the cycle closes. The daily budget updates at once for option 1.

Milestones at 25%, 50%, 75% and 100% of a goal trigger a Gullak celebration and XP. Goals can be edited, paused (contribution drops to ₹0 and the money returns to free savings) and deleted. Deleting a goal keeps its history.

Statement lines that are transfers to a savings account, SIP, RD or FD are matched to savings rather than spending (see 2.5) and shown on the goal as confirmed.

### 2.3 Money coming in

All transactions, whatever their source, pass through one pipeline:

```
source → normalise → categorise → match → save → budget recalculates
```

Sources in V1: `manual` (quick-add) and `statement` (PDF or CSV). `aa` (Account Aggregator) is reserved for V2 and must plug in at the same point.

Quick-add:

- Opens straight to the number pad. Amount, category, paid with (UPI, card, cash), optional merchant and note.
- Add is disabled at ₹0. The amount is capped at 7 digits. Above ₹10,000, or above 5 times the daily budget, the app asks "Sure?" once before saving.
- Each spend carries an ID made by the app, so an offline retry never creates a duplicate.
- Works offline: saved on the phone and sent when the network returns.
- Closing with an amount typed asks before discarding. Closing with ₹0 just closes.
- Saving gives +5 XP (up to 10 spends a day) and a Gullak reaction.

Editing and deleting (spend detail screen): amount, category, merchant, paid with, need/want/regret tag. Delete asks first, says what changes ("Today goes back to ₹563 left. The +5 XP goes too"), and reverses the XP. Deletes are soft (the row keeps a `deleted_at`).

Statement upload:

- Formats: PDF from HDFC, ICICI, SBI, Axis and Kotak (one reader class each, detected from the PDF text); CSV from any bank, with a one-time column mapping the app remembers per bank.
- The file is sent with the password if it has one. The server reads it in memory and keeps only the extracted lines as a draft import. The file is never written to disk or logged, and neither is the password.
- Outcomes: a preview (count, date range, and how many lines matched, were auto-sorted, are fixed costs, or need sorting), or one of `PASSWORD_REQUIRED`, `WRONG_PASSWORD`, `UNSUPPORTED_BANK`, `SCANNED_PDF`, `NEEDS_COLUMN_MAP`, `TOO_LARGE`, `UNREADABLE_LINES` (partial read, with the count). Each has a screen.
- Uploading the same statement twice is safe: lines already imported are skipped by (bank, date, amount, description) fingerprint.
- Unsupported bank: the user can ask for support; the request is counted so the next bank reader is chosen from demand.
- The import is committed only after swipe-to-sort or "finish later". A draft older than 7 days is discarded.

Swipe-to-sort: one card per line that needs the user. Right for Need, left for Want, up for Regret, with tap buttons for all three. Category chips on the card can be changed before tagging. The last tag can be undone. Finishing gives +10 XP and the Sorted badge the first time.

### 2.4 Categories, tags and payment methods

Twelve fixed categories: Food delivery, Eating out, Quick commerce, Groceries, Shopping, Subscriptions, Travel, Bills and recharges, Entertainment, Health, UPI to people, Other.

Categorising is rule-based. A global merchant dictionary maps statement text to categories (SWIGGY, ZOMATO → Food delivery; ZEPTO, BLINKIT, INSTAMART → Quick commerce; AMAZON, FLIPKART, MYNTRA, MEESHO → Shopping; NETFLIX, SPOTIFY, HOTSTAR → Subscriptions; UBER, OLA, RAPIDO → Travel; a UPI handle that looks personal → UPI to people). A user's correction becomes a user rule that wins over the global one next time. Unknown text goes to swipe-to-sort.

Tags: need, want, regret. Payment methods: upi, card, cash, unknown. Cash entries are never matched to statements.

### 2.5 Matching logged spends to statement lines

A quick-add is `pending` until a statement confirms it. Pending spends count in the budget straight away.

When a statement arrives, each line is scored against pending spends:

| Signal | Rule |
|---|---|
| Amount | exact, or within ₹5 or 2% |
| Date | same day for UPI; up to 3 days later for card |
| Payment method | cash never matches; UPI and card only match their own kind, or `unknown` |
| Merchant | fuzzy match between the typed name and the statement text |
| Category | the user's category against the dictionary's guess for the line |
| Learned pairs | a merchant pair the user has linked before always scores high |

Outcomes:

- High confidence: linked silently; the spend shows a tick, "Confirmed by bank". The user's category is kept; the statement's merchant text is stored.
- Medium: linked, shown as "Linked · Undo".
- Low: both kept separate. Nothing is merged behind the user's back.
- Every link can be undone from the spend detail.

After an import covers a date, any pending spend on that date with no match is marked cash automatically. ATM withdrawals are transfers to a wallet, not spending. If withdrawn cash is larger than the cash spends logged, the app offers once to log the difference as "Misc cash".

Fixed costs: the first time a line matches a fixed cost's amount (within 10%) around its usual date, the app asks once ("Is this your rent?"). A yes stores the payee pattern; from then on it is recognised automatically and kept out of the daily budget.

Logging accuracy = confirmed spends ÷ (confirmed + statement-only spends) for the import. 90% or more gives +50 XP and the Honest logger badge.

### 2.6 The Gullak and the game

Mood follows today's budget used: 0 to 49% happy, 50 to 79% calm, 80 to 100% nervous, over 100% fainted. A ₹0 budget with nothing overspent (the pool at exactly zero, or too small to give ₹1 a day) shows nervous, not fainted; the Gullak faints only when today's spend passes the budget or the pool goes below zero. The fainted line's "over by" figure is today's overspend plus any amount the pool is below zero. Celebrating shows for a moment on a streak day, a milestone or a level-up. The Gullak never dies; a fainted Gullak is back the next morning.

Growth stages by level: clay pot (levels 1 to 4), painted (5 to 9), gold (10 to 19), diamond (20 and up). Reaching a stage is a full-screen moment with a share button.

Animation in V1 is done in code (React Native Reanimated over the SVG drawing): idle bounce and blink, a coin drop when a spend is added, a sweat drop when nervous, a tilt and fall when fainted, a jump with confetti when celebrating. When the phone's Reduce Motion setting is on, the Gullak shows still images. The drawing and animation live behind one `<Gullak mood stage />` component so the final illustrated or Rive character can replace it later without touching screens.

Personality: Chill friend (default), Savage, Indian mom, Hype-man. Every Gullak line and notification has a version per personality. Lines are templates stored on the server (`content` module) so new ones ship without an app release. Personality changes the words, never the mood.

XP:

| Action | XP | Limit |
|---|---|---|
| Log a spend | 5 | 10 a day |
| Finish swipe-to-sort | 10 | per import |
| Day closed under budget | 20 | once a day |
| Streak reaches 7, 30, 100 days | 100, 500, 2,000 | once each |
| Monthly savings met at cycle close | 500 | once a cycle |
| Deadline goal completed | 1,000 | per goal |
| Logging accuracy 90% or more | 50 | per import |
| Weekly challenge done | 150 | per week |

XP is a ledger of events, never a counter. Deleting a spend reverses its event. Level thresholds are server configuration; starting rule: everyone starts at level 1, and level n (for n of 2 or more) is reached at 100 × n² XP (level 2 at 400, level 3 at 900, level 20 at 40,000). Mockup figures are illustrative.

Streaks: a day counts when spent today is at or under the daily budget at close; a day with no spends counts. Every 7 consecutive days earns one freeze, up to 2 held. A freeze is used automatically on the first day over, so a wedding dinner does not end a 40-day streak.

Badges (10): First log, Week warrior (7-day streak), No-Swiggy Sunday, Zepto-free week, Subscription slayer (marked a subscription cancelled), Goal crusher (finished a goal), Honest logger, Sorted (first swipe-to-sort), Comeback kid (under budget after 3 days over), Diamond Gullak (level 20).

Weekly challenge: one per week, chosen from the user's own data. Take the top discretionary category of the last two weeks and set a target of 70% of its average weekly spend, rounded to ₹50 ("Spend under ₹800 on food delivery this week"). Done gives +150 XP and a badge for that category.

### 2.7 Notifications and the night report

| Message | When | Sent by |
|---|---|---|
| Morning budget | user's time, default 08:00 | phone (scheduled locally) |
| Night report | user's time, default 22:00 | phone |
| 80% of today used | when a quick-add crosses it | phone |
| Goal off track, catch-up plan | after the daily close, at most once per 3 days | server, Expo Push |
| Milestone, level-up, badge | when earned | server |

Rules: at most 4 a day; quiet hours 23:00 to 07:00; every type can be switched off in Me; the app explains why before asking the OS for permission.

Off track is decided at the daily close: forecast cycle spend = spent to date ÷ days elapsed × cycle days. The user is off track when the forecast exceeds spendable, or when a deadline goal's projected amount at its deadline is below target.

Night report card: four swipeable cards. 1: the day's grade and spent vs budget. 2: biggest spend and top category. 3: streak, XP earned, progress to the next level. 4: a Gullak line in the chosen personality, with "Share as image" (a 1080×1920 image for Instagram stories). Grade by share of the daily budget used: A+ under 50%, A 50 to 69%, B 70 to 100%, C 101 to 125%, D 126 to 150%, F above 150%. The grade's rule is shown when the grade is tapped.

### 2.8 Insights

- Cycle so far: spent, spendable, a bar, and the forecast in one sentence ("At this pace you'll spend ₹13,300 by 31 Oct and save ₹21,700, ₹1,700 more than planned").
- Spending by category, largest first, single colour, with order counts for delivery and quick commerce. Tapping a category lists its spends.
- Subscriptions: a merchant with the same amount (within 2%) 2 or more times, 25 to 35 days apart (monthly) or 360 to 370 (yearly). The app asks "Still using?" once per cycle until answered. "Cancelled" removes it from the forecast and earns Subscription slayer the first time.
- A cycle summary at close: spent, saved, extra saved, grade distribution, top three categories, badges earned.

## 3. Screens

### 3.1 Drawn and tested (27 artboards)

Daily loop: Home (under budget), Home (over budget with catch-up plan), Quick-add, Night report card, Spend detail.
Setup: Setup 1 income and payday, Setup 2 fixed costs, Setup 3 monthly savings with reality check, Setup 4 personality and message times, Home first run.
Statements: Add a statement, PDF password, Wrong password, Reading, Preview, Bank not supported, Scanned PDF, Swipe-to-sort (with finished state).
Planning: Insights, Goals, New goal.
Profile: Me, Badges.
Building blocks: Gullak moods and stages sheet, Gullak component, Tab bar, Icon set.

Every screen has been clicked through in Chrome against the test plan in `docs/ux-test-findings.md`.

### 3.2 Still to draw, with behaviour

Build these in the same style; `.claude/design.md` has the rules.

1. CSV column mapping: the first 5 rows of the file, a dropdown per needed column (date, description, debit, credit or amount with sign), a preview of 3 parsed lines, "Looks right". Saved per bank.
2. Fixed cost edit: tap a row to change name and amount, add a custom cost, undo a removal for 5 seconds.
3. Typed amounts: every stepper (savings, goal target) also accepts a typed value; tapping the number opens the keyboard.
4. Category drill-down from Insights: the spends in that category this cycle, with totals by merchant.
5. Goal detail: progress, expected-by-today tick, contributions by cycle, confirmed transfers, edit, pause, delete, and the catch-up plan when behind.
6. Undo on swipe-to-sort: "Undo" for 5 seconds after each tag.
7. "Sure?" check on a large quick-add amount (rule in 2.3).
8. Notification permission step at the end of setup, explaining the four message types before the OS prompt.
9. Me additions: sign out, help and contact, privacy policy, per-message switches, consent record.
10. Account deletion with a 30-day grace period and a "restore" email link.
11. A nudge when monthly savings is set to ₹0 ("No savings this month. Set a target later from Me").
12. Cycle summary screen at cycle close (2.8), with the leftover choice (2.1).

### 3.3 Visual rules

`.claude/design.md` holds the palette, type scale, spacing, radii, copy rules, signature traits and the 2026 calendar used in mockups. Every new screen is checked against it.

## 4. Architecture

### 4.1 Overview

```
Expo app (Android, iOS, web)
  expo-router screens · TanStack Query for server data · expo-sqlite for offline quick-adds
  expo-notifications for local messages · Reanimated + react-native-svg for the Gullak
        │  HTTPS, JSON, JWT
        ▼
Spring Boot (Java 21), one deployable, packaged by feature
  auth · profile · budget · ingestion · goals · gamification · insights · content · notify · common
        ▼
PostgreSQL (managed), Flyway migrations
Hosted on DigitalOcean Bangalore: App Platform for the server, Managed Postgres, Spaces not used (no files stored)
```

One server application rather than services: one thing to deploy, debug and secure for one person. The feature packages keep the boundaries clear enough to split later.

Rules that hold everywhere:

- Money is stored and transmitted in paise as 64-bit integers. ₹250 is `25000`. No floating point anywhere near money.
- All times are stored in UTC with the user's zone (`Asia/Kolkata` for all V1 users) applied at the edges.
- The daily budget and all forecasts are computed, never stored.
- XP is an event ledger. Levels, streak counts and badges are derived or updated by the same transaction that writes the event.
- Nothing that came from a bank statement (raw descriptions, UPI handles) leaves the server unencrypted or appears in a log.

### 4.2 Repo structure

One repository, two applications, no shared build tooling between them.

```
gullak/
  app/                      Expo (React Native + web), TypeScript
    app/                    expo-router routes
      (tabs)/               index (Home), insights, goals, me
      add.tsx               quick-add (modal)
      spend/[id].tsx
      onboarding/           income, fixed-costs, savings, personality, notifications
      upload/               start, password, reading, preview, sort, errors
      goals/                new, [id]
      report-card.tsx
    src/
      features/             one folder per feature, tests next to the code
        auth/ budget/ spends/ imports/ goals/ game/ gullak/ insights/ profile/
          api.ts            typed calls for this feature
          hooks.ts          TanStack Query hooks
          components/       feature-only components
          *.test.tsx
      components/ui/        Button, Chip, Field, ProgressBar, Sheet, Tabs, Stepper
      lib/                  api client, secure storage, money, dates, notifications, offline queue
      theme/                tokens copied from .claude/design.md
    e2e/                    Maestro flows
    app.config.ts  package.json  tsconfig.json  jest.config.ts
  server/                   Spring Boot, Java 21, Gradle
    src/main/java/in/gullak/
      GullakApplication.java
      auth/        profile/     budget/      ingestion/
      goals/       gamification/ insights/   content/
      notify/      common/
        (each feature: *Controller, *Service, *Repository, domain/, dto/, and its own tests)
      common/      errors, money, time, security, pagination
    src/main/resources/
      application.yml  application-local.yml
      db/migration/    V001__users.sql, V002__transactions.sql, ...
    src/test/java/in/gullak/   mirrors main; Testcontainers for Postgres
    src/test/resources/statements/   anonymised sample PDFs and CSVs per bank
  docs/
    superpowers/specs/  superpowers/plans/  ux-test-findings.md  api.md
  .github/workflows/    ci.yml (app: lint, typecheck, test; server: test with Postgres; dependency audit)
  .gitignore  README.md
```

### 4.3 Backend conventions (Spring Boot)

- Package by feature, not by layer. A feature's controller, service, repository and entities sit together; other features call its service, never its repository.
- Constructor injection only. No field injection, no static state.
- Java records for all request and response bodies. Entities are never returned from a controller.
- Validate at the edge with `jakarta.validation` on request records (`@Positive` amounts, `@Size`, `@Pattern`). Services assume valid input and enforce business rules.
- One `@RestControllerAdvice` turns exceptions into `{code, message}` with the right status. Business errors are typed exceptions with a code from one enum shared with the app.
- `@Transactional` on service methods that write; read-only methods marked `readOnly = true`.
- Spring Data JPA (entities and repositories per feature) for ordinary reads and writes; JdbcClient or native queries for aggregate queries (budget totals, insights, matching), tested against real Postgres. Schema is owned by Flyway; Hibernate only validates it.
- Hibernate only validates the schema (`ddl-auto: validate`); Flyway owns it. Every migration is forward-only and reviewed.
- Configuration through `application.yml` and environment variables. Secrets never in the repository.
- Scheduled jobs (daily close, off-track push, draft cleanup) are idempotent, keyed by (user, date), and use a database lock so two instances cannot run the same job.
- Actuator exposes `health` only, unauthenticated, for the platform's checks.
- Logging is structured JSON with a request ID. Amounts, names, descriptions and UPI handles are never logged.
- Spring Boot's latest stable line at project start; Java 21 LTS; Gradle with the version catalog; dependency updates checked in CI.

### 4.4 Frontend conventions (Expo, React)

- TypeScript strict. No `any`.
- Function components and hooks only. Screens compose feature components; business rules live in hooks and `lib/`, not in components.
- Server state through TanStack Query (one hook per endpoint in each feature's `hooks.ts`). Client state through React context or a small store only where several screens share it (auth session, offline queue). No global state for things one screen owns.
- The API client in `lib/api.ts` is the only place that knows URLs, tokens and error codes. Features never call `fetch`.
- Money passes through the app in paise and is formatted once, by `lib/money.ts`, with Indian grouping (₹1,00,000).
- Dates are formatted once, by `lib/dates.ts`, as "Fri, 23 Oct".
- UI primitives in `components/ui/` carry the design tokens, 44px targets, focus states and accessibility labels. Screens do not restyle them.
- Every screen handles loading, empty and error states explicitly.
- Tests next to the code with Jest and React Native Testing Library; Maestro for the five main flows; the web build smoke-tested with Playwright.
- No secrets in the app bundle. The only configuration is the API base URL per environment.
- Lint and format in CI (ESLint, Prettier); the build fails on type errors.

### 4.5 Data model

Key columns only. Every table has `id` (UUID), `created_at`, `updated_at`. Money columns end in `_paise`.

| Table | Columns |
|---|---|
| users | email (unique), status, consent_version, consented_at, deletion_requested_at |
| profiles | user_id, income_paise, payday_rule (fixed_day / last_working_day), payday_day, personality, morning_time, night_time, notifications (jsonb of switches), timezone |
| fixed_costs | user_id, name, amount_paise, payee_pattern, active |
| cycles | user_id, start_date, end_date, income_paise, savings_paise, closed_at, leftover_paise, leftover_choice |
| goals | user_id, name, type (monthly / deadline), target_paise, deadline, mode (flexible / strict), status (active / paused / done / deleted), created_cycle_id |
| goal_contributions | goal_id, cycle_id, amount_paise, kind (planned / extra / manual / confirmed_transfer) |
| catch_up_actions | goal_id, cycle_id, kind (tighten / move / lower), details (jsonb), undone_at |
| categories | code, name, sort_order, discretionary |
| transactions | user_id, client_id (unique per user), amount_paise, direction (debit / credit), occurred_at, merchant_name, merchant_raw_enc, category_code, tag (need / want / regret), payment_method, source (manual / statement / aa), status (pending / confirmed / statement_only), counts_in_budget, spread_over_cycle, fixed_cost_id, goal_id, linked_txn_id, import_id, fingerprint, deleted_at |
| statement_imports | user_id, bank, period_from, period_to, row_count, matched_count, auto_count, fixed_count, to_sort_count, status (draft / committed / discarded) |
| csv_mappings | user_id, bank, mapping (jsonb) |
| merchant_rules | scope (global / user), user_id, pattern, category_code, fixed_cost_id, hits |
| subscriptions | user_id, merchant_name, amount_paise, period (monthly / yearly), first_seen, last_seen, answer (using / cancelled), answered_at, asked_cycle_id |
| xp_events | user_id, kind, xp, ref_type, ref_id, reversed_at |
| streaks | user_id, current, best, freezes, last_counted_date |
| user_badges | user_id, badge_code, earned_at |
| weekly_challenges | user_id, week_start, category_code, target_paise, progress_paise, done_at |
| otp_codes | email, code_hash, expires_at, attempts |
| refresh_tokens | user_id, token_hash, device, expires_at, used_at, revoked_at |
| push_tokens | user_id, token, platform |
| daily_closes | user_id, date, budget_paise, spent_paise, grade, under_budget (idempotency record for the close job) |

`merchant_raw_enc` is encrypted in the application (AES-256-GCM, key from the environment) before it reaches the database.

### 4.6 API

REST under `/api/v1`, JSON, money in paise, dates as ISO strings. Errors are `{code, message}`. All endpoints except `/auth/*` need a bearer token.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/otp/request` · `POST /auth/otp/verify` · `POST /auth/refresh` · `POST /auth/logout` |
| Profile | `GET/PUT /me/profile` · `GET/POST/PATCH/DELETE /me/fixed-costs/{id}` · `POST /me/push-tokens` · `POST /me/consent` |
| Today | `GET /budget/today` (budget, spent, left, mood, Gullak line, streak, days left, forecast, catch-up if any) · `GET /budget/cycles/{id}/summary` · `POST /budget/cycles/{id}/leftover` |
| Spends | `GET /transactions?from&to&category&cursor` · `POST /transactions` (idempotent on client_id) · `GET/PATCH/DELETE /transactions/{id}` · `POST /transactions/{id}/unlink` · `POST /transactions/{id}/assign-income` |
| Imports | `POST /imports` (multipart: file, password) → preview or error code · `POST /imports/{id}/column-map` · `GET /imports/{id}/to-sort` · `POST /imports/{id}/tag` · `POST /imports/{id}/undo-tag` · `POST /imports/{id}/commit` · `POST /imports/{id}/discard` · `POST /banks/requests` |
| Goals | `GET/POST /goals` · `GET/PATCH/DELETE /goals/{id}` · `POST /goals/{id}/pause` · `POST /goals/{id}/resume` · `POST /goals/{id}/catch-up` · `POST /goals/{id}/catch-up/undo` · `POST /goals/check` (reality check without saving) |
| Insights | `GET /insights/cycle?cycleId` · `GET /insights/category/{code}?cycleId` · `GET /subscriptions` · `POST /subscriptions/{id}/answer` |
| Game | `GET /me/progress` (XP, level, stage, streak, freezes, badges, challenge) · `GET /report-card?date` · `GET /content/lines?personality` |
| Data | `POST /me/export` · `DELETE /me` · `POST /me/restore` |

`POST /imports` is the one multipart endpoint. The server reads the upload into memory (10 MB limit), checks the magic bytes, parses with a 10-second timeout on a separate thread, then drops the bytes. A wrong password returns `WRONG_PASSWORD`; the app still holds the file and re-sends it with the new password.

### 4.7 Security and privacy

Login and sessions:

- 6-digit email OTP, 10-minute expiry, 5 attempts, then a new code is needed. A new request retires the previous code. At most 10 failed guesses per email in 24 hours, counted in the database; after that sign-in waits until the next day. The response to a request is identical whether or not the email exists.
- Rate limits per email and per IP on OTP request and verify. The client IP comes from `X-Forwarded-For` only when the connection is from a configured trusted proxy (`GULLAK_TRUSTED_PROXIES`); otherwise the socket address is used.
- Access token: JWT, 15 minutes, signed with a server key, carries only the user ID. Refresh token: random 256-bit, 30 days, stored hashed, single use, rotated on every refresh. Reuse of a spent refresh token revokes every session for that user.
- On the phone, tokens live in Expo SecureStore. On the web, the refresh token is an `httpOnly`, `Secure`, `SameSite=Strict` cookie and the access token stays in memory; refresh needs a custom header, which blocks CSRF.
- Sign out revokes the refresh token server-side. Only a refresh token that was already used counts as reuse and revokes every session; an expired or logged-out token is simply rejected. Access tokens on the public auth routes are ignored, so refresh and logout work after the access token expires. An access token stays valid until its 15-minute expiry after logout (stateless by design).

Authorisation:

- Every query is scoped by the user ID from the token. No endpoint accepts a user ID from the client.
- Reading another user's object returns 404, never 403, and an integration test proves it for each resource.

Data:

- TLS everywhere; HSTS on the web.
- Managed Postgres with encryption at rest, daily backups, point-in-time recovery for 7 days.
- `merchant_raw_enc` encrypted in the application; the key comes from the environment and is rotated by re-encrypting in a migration job.
- Logs never contain amounts, merchant text, UPI handles, emails or tokens. A log redaction test guards this.
- Exports are generated on the server and emailed as a link that expires in 24 hours.
- Account deletion: the account is locked at once, data is deleted by a job after 30 days, and the user can restore from the email in between.

Uploads:

- 10 MB limit, magic-byte check, PDF parsing in a worker thread with a timeout and a memory cap, no JavaScript or embedded file handling in the parser, no file written to disk.
- The password is used in memory and never persisted or logged.

Application hygiene:

- Security headers on web responses (CSP, no framing, no sniffing).
- CORS restricted to the app's web origin.
- Dependencies scanned in CI (Gradle dependency check, npm audit); builds fail on known critical issues.
- Secrets only in environment variables; a pre-commit hook blocks accidental commits.
- Input limits on every field (lengths, ranges, dates no more than one day in the future).
- The implementation follows the `anthropic-skills:secure-engineering` guidance for Spring Boot and React.

DPDP (India's data protection act):

- Consent screen at sign-up stating the purpose (budgeting only), with the version recorded.
- Privacy policy linked from Me.
- Export and deletion as above.
- Data hosted in India.
- A written breach-response note in `docs/`.

### 4.8 Errors, offline and jobs

- Error codes are one enum on the server and one TypeScript union in the app; every code maps to a drawn screen or an inline message. Raw server text is never shown.
- Offline quick-add: spends are written to SQLite first and synced by a queue that retries with backoff. The client-generated ID makes retries safe.
- Optimistic updates: a delete or edit shows at once; if the server rejects it, the row returns with a message. The screen never shows a state the server does not have.
- Server unreachable: Home shows the last response with "Updated 2 hours ago"; quick-add still works.
- Jobs: daily close at 00:05 Asia/Kolkata (grades, streaks, freezes, XP, `daily_closes` row), off-track push after the close, draft import cleanup, deletion after grace. All idempotent, retried on failure, and a repeated failure sends an alert.

### 4.9 Testing

The full list of test cases, positive and negative, with IDs, is in `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`. Every task in the implementation plan names the cases it must make pass. The table below is the summary by layer.

| Layer | What | Tool |
|---|---|---|
| Budget engine | every payday rule; 28, 30 and 31-day cycles; last working day on a weekend; rollover; overspend; pool below zero; Strict vs Flexible; ₹0 savings; spread-over-cycle; extra income | JUnit 5, table-driven |
| Goals | reality check thresholds, expected-by-today, catch-up maths, pause and resume, milestones | JUnit |
| Statement readers | one anonymised sample per bank with saved expected output; password, wrong password, scanned, corrupt, oversized, partial | JUnit with files in `src/test/resources/statements` |
| Matching | daily chai, card 3 days late, cash, ATM, two identical coffees, learned pairs, undo | JUnit |
| Game | XP caps and reversal, level thresholds, streak freeze, midnight boundary, challenge selection | JUnit |
| API | every endpoint against Postgres in Testcontainers; auth; cross-user 404; rate limits; log redaction | Spring Boot Test |
| App | components, hooks, money and date formatting, offline queue, each screen's loading, empty and error states | Jest, React Native Testing Library |
| End to end | setup, quick-add, upload and sort, catch-up, goal; web smoke | Maestro, Playwright |
| Manual | the checklist in `docs/ux-test-findings.md` | before each release |

### 4.10 Logging

The full standard is `docs/engineering-standards.md`, section 1. In short:

- Structured JSON logs with a request ID and the user's UUID in the MDC. One INFO line per request (method, route template, status, duration) written by a filter; one INFO line per business event from a fixed vocabulary (`spend.created`, `import.committed`, `cycle.closed`, `job.finished` and the rest), carrying ids and counts only.
- WARN for expected failures worth noticing (OTP locked, rate limit, wrong statement password, parse timeout, provider retry). ERROR once per unexpected exception, with a stack trace and an `errorId` that the client also receives.
- Never logged: amounts, merchant text, raw statement lines, file names, emails, UPI handles, tokens, passwords, OTP codes. A test greps for each.
- The app logs only through `lib/log.ts`; `console.*` is forbidden by lint. Production logs go to a pluggable reporting sink, off by default, with the same redaction.

### 4.11 Error handling

The full standard is `docs/engineering-standards.md`, section 2. In short:

- One typed exception hierarchy with codes from a single `ErrorCode` enum; one `@RestControllerAdvice` that turns every exception, expected or not, into `{code, message}` with the right status. Unexpected errors return `INTERNAL` with an `errorId` and a generic message.
- No empty catch blocks and no broad catch outside the error handler, jobs and async boundaries; ArchUnit enforces both. Caught exceptions are handled and logged or rethrown with context, never swallowed.
- External calls have timeouts and bounded retries; parsers run with a timeout and a memory cap; writes are transactional; jobs fail per user, not per run.
- The app's API client is the only reader of HTTP responses and produces `ApiError`, `NetworkError` or `UnknownError`; every screen renders loading, empty and error states; error boundaries at the root and per tab; every error code is mapped to a screen or message, and an unmapped one is logged so it gets mapped.

## 5. How we build it

- The plan is written on the Fable model. Implementation tasks are executed by subagents on the Opus model.
- The work is done by a team of seven agents defined in `.claude/agents/` and described in `docs/team.md`: a manager who reviews and accepts every task, a product manager who writes each task's brief and checks the result against this spec, three engineers (backend, phone app, web), a QA engineer who runs and extends the tests, and a red team that attacks the local build like a hostile user. Each task runs through brief, test-first implementation, QA, red team where security is touched, and manager review, in that order.
- Process: the writing-plans skill turns this spec into a task-by-task plan; tasks are executed subagent-driven, each with test-driven development; each task ends with the manager's review before the next starts.
- Security is never traded for speed. A task that would weaken 4.7 stops and asks.
- Suggested order: M0 repo, CI and skeletons; M1 auth, profile, budget engine, Home; M2 quick-add, spend detail, offline; M3 statements, matching, swipe-to-sort; M4 goals and catch-up; M5 game, Gullak, report card; M6 insights and subscriptions; M7 Me, export, deletion; M8 notifications and jobs; M9 web build and release. The plan may reorder within these.
- Definition of done for a task: tests written first and passing, the screen or endpoint matches this spec and `design.md`, review comments addressed, no new dependency without a reason in the PR.

## 6. Open decisions

- Email provider for OTP and exports (Amazon SES or Resend; either is fine).
- Final Gullak illustration: a designer or Rive animator after launch, behind the existing component.
- Domain and app store accounts.
