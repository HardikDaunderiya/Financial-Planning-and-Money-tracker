# Gullak V1: test cases

Companion to `2026-10-23-gullak-v1-design.md`. Every case has an ID so the implementation plan and the code can point at it. Each test is written before the code it covers (TDD).

Conventions:

- Amounts are rupees here; the code works in paise.
- "Example user" means: take-home ₹50,000, fixed ₹15,000, savings ₹20,000, payday the 1st, personality Chill friend, timezone Asia/Kolkata. "Example day" is Fri 23 Oct 2026 with ₹9,660 spent before today in the 1 to 31 Oct cycle.
- API cases list the status and `code` expected. `VALIDATION` is the code for any 400 caused by bad input, with field details in the body.
- "Other user" means a second account used to prove isolation. The expected answer is always 404, never 403.
- Every API case runs against real Postgres (Testcontainers). Unit cases run without a database.

## 1. Budget engine (unit)

| ID | Case | Input | Expected |
|---|---|---|---|
| BUD-01 | Cycle for a fixed payday | payday 1, month Oct 2026 | 1 Oct to 31 Oct, 31 days |
| BUD-02 | Cycle for a mid-month payday | payday 15 | 15 Nov to 14 Dec, 30 days |
| BUD-03 | Cycle for February | payday 1, Feb 2027 | 1 Feb to 28 Feb, 28 days |
| BUD-04 | Last working day on a weekend | rule last_working_day, Oct 2026 (31 Oct is a Saturday) | payday Fri 30 Oct; cycle 30 Oct to 29 Nov |
| BUD-05 | Last working day on a weekday | Dec 2026 (31 Dec is a Thursday) | payday 31 Dec; cycle 30 Nov to 30 Dec for November |
| BUD-06 | Spendable | example user | ₹15,000 |
| BUD-07 | Daily budget on the example day | spent before today ₹9,660, 9 days left | ₹593 (59,333 paise rounded down) |
| BUD-08 | Rollover raises tomorrow | spend ₹460 of ₹580 | tomorrow's budget is higher than today's by the unspent share |
| BUD-09 | Overspend lowers tomorrow | spend ₹720 of ₹593 on the example day | tomorrow ₹577 ((5,340 − 720) ÷ 8) |
| BUD-10 | Pool below zero | spent ₹15,400 by day 20 | budget ₹0, over by ₹400, catch-up flag set, mood fainted |
| BUD-11 | Spread-over-cycle spend | ₹15,000 flight flagged spread | today's spent excludes it; pool includes it; mood unchanged by it |
| BUD-12 | Refund | credit ₹300 tagged refund | spent falls by ₹300 |
| BUD-13 | Extra income to pool | bonus ₹5,000 assigned to pool | spendable ₹20,000 |
| BUD-14 | Extra income split | bonus ₹5,000, 60% savings 40% pool | savings +₹3,000, spendable +₹2,000 |
| BUD-15 | Zero savings | savings ₹0 | spendable ₹35,000 |
| BUD-16 | Fixed cost edited mid-cycle | rent ₹10,000 to ₹12,000 on day 10 | spendable ₹13,000 from day 10; daily budget recomputed |
| BUD-17 | Income edited mid-cycle | income to ₹55,000 | spendable ₹20,000 at once |
| BUD-18 | Payday edited mid-cycle | payday 1 to 7 on day 10 | current cycle unchanged (1 to 31 Oct); a bridge cycle 1 to 6 Nov; then 7 Nov to 6 Dec |
| BUD-19 | Deleted spend | delete a ₹150 spend | excluded from spent at once |
| BUD-20 | Day with no spends | no transactions today | spent ₹0, left equals budget |
| BUD-21 | Last day of cycle | 1 day left, ₹900 in pool | budget ₹900 |
| BUD-22 | Cycle close, leftover to savings | ₹1,700 left at close | cycle.leftover ₹1,700, extra saved ₹1,700, next pool unchanged |
| BUD-23 | Cycle close, leftover rolled over | choice rollover | next cycle's spendable +₹1,700 |
| BUD-24 | Strict debt carried | Strict goal, pool −₹400 at close | next cycle spendable ₹14,600 |
| BUD-25 | Flexible shortfall from contribution | Flexible goal, pool −₹400, user picks "take from savings" | this cycle's contribution −₹400, pool back to ₹0 |
| BUD-26 | Setup impossible | income ₹30,000, fixed ₹15,000, savings ₹20,000 | NOT_POSSIBLE, spendable would be negative |
| BUD-27 | Rounding is always down | pool ₹1,000, 3 days | ₹333, never ₹334 |
| BUD-28 | Boundary at midnight IST | spend at 23:59:59 IST and 00:00:01 IST | first counts today, second counts tomorrow, regardless of server zone |
| BUD-29 | Transaction in a closed cycle | spend dated 20 Sep added on 23 Oct | September's history changes; today's budget does not |
| BUD-30 | Daily budget is not stored | inspect schema | no column holds a daily budget; the value comes from a query |
| BUD-31 | Whole-rupee daily budget | pool ₹1,000.50 over 3 days | budget ₹333 (33,300 paise); the 150 paise stay in the pool |
| BUD-32 | First cycle is pro-rated | spendable ₹15,000, setup on 23 Oct, payday 1st (cycle 1–31 Oct, 9 days left) | first-cycle pool ₹4,354; budget ₹483 a day; a "money left" answer of ₹6,000 gives ₹666 a day |
| BUD-32b | Money-left answer counts earlier spends | as BUD-32, ₹2,000 spent on 22 Oct, money left ₹6,000 | budget ₹666 a day (the pool is ₹8,000 less ₹2,000 spent) |

## 2. Goals and catch-up (unit)

| ID | Case | Input | Expected |
|---|---|---|---|
| GOAL-01 | Contribution for a deadline goal | ₹30,000 by Mar 2027, ₹12,000 saved, 5 paydays left | ₹3,600 a month |
| GOAL-02 | Contribution rounds up to ₹100 | ₹10,000 left, 3 paydays | ₹3,400 |
| GOAL-03 | Expected by today | Goa, 2 of 5 paydays elapsed | ₹12,000 expected |
| GOAL-04 | Behind amount | saved ₹10,200 | behind by ₹1,800 |
| GOAL-05 | On track | saved ₹12,000 | behind ₹0, status on track |
| GOAL-06 | Reality check doable | ₹60,000 over 10 paydays, free ₹9,700 | Doable, ₹3,700 stays free |
| GOAL-07 | Reality check tight | ₹85,000 over 10 | Tight (₹1,200 free, under ₹1,500) |
| GOAL-08 | Reality check not possible | ₹1,00,000 over 10 | Not possible (₹10,000 > ₹9,700) |
| GOAL-09 | Deadline in the past | deadline Aug 2026 | Not possible, reason DEADLINE_PASSED |
| GOAL-10 | Deadline this payday | deadline Nov 2026 | 1 payday, whole amount this month |
| GOAL-11 | Catch-up tighten | gap ₹1,800, 8 days left | ₹225 less a day |
| GOAL-12 | Catch-up move | gap ₹1,800, ₹3,600 a month | deadline moves to Apr 2027 (one more payday) |
| GOAL-13 | Catch-up lower | target ₹30,000, gap ₹1,800 | target ₹28,200 |
| GOAL-14 | Strict goal catch-up | mode strict | only tighten offered; move and lower rejected |
| GOAL-15 | Undo catch-up | tighten then undo | daily budget and goal back to before |
| GOAL-16 | Pause | pause Goa | contribution ₹0, free savings +₹3,600, status paused |
| GOAL-17 | Resume | resume after one cycle | contribution recomputed over the remaining paydays |
| GOAL-18 | Milestones | contributions crossing 25%, 50%, 75%, 100% | one milestone event each, never twice |
| GOAL-19 | Completed | saved reaches target | status done, +1,000 XP, Goal crusher badge |
| GOAL-20 | Free savings never negative | three goals totalling ₹21,000 against ₹20,000 savings | third goal rejected NOT_POSSIBLE |
| GOAL-21 | Monthly target only | no deadline goals | all ₹20,000 is free savings; extra saved adds to it |

## 3. Categorising and matching (unit)

| ID | Case | Input | Expected |
|---|---|---|---|
| CAT-01 | Dictionary hit | "SWIGGY*ORDER" | Food delivery |
| CAT-02 | Quick commerce | "PYU*BLINKIT8841", "ZEPTO", "INSTAMART" | Quick commerce |
| CAT-03 | Personal UPI handle | "UPI to priya.s@oksbi" | UPI to people |
| CAT-04 | Business UPI handle in dictionary | "UPI/THIRDWAVECOFFEE/okhdfc" | Eating out |
| CAT-05 | Unknown text | "BHARATPE*MOMO POINT" | uncategorised, goes to sort |
| CAT-06 | User rule wins | user rule "KAKA DHABA" → Eating out, dictionary says Other | Eating out |
| CAT-07 | Rule learned from sort | user tags "KAKA DHABA" as Eating out | next import categorises it automatically |
| CAT-08 | Case and spacing | "swiggy", " SWIGGY ", "Swiggy" | all Food delivery |
| MAT-01 | High confidence UPI | quick-add ₹250 UPI "Third Wave" 9:12; line ₹250 "UPI/THIRDWAVECOFFEE" same day | linked, confirmed, category kept, merchant text stored |
| MAT-02 | Card 3 days later | quick-add ₹1,499 card 17 Oct; line ₹1,499 20 Oct | linked |
| MAT-03 | Card 4 days later | line on 21 Oct | not linked |
| MAT-04 | Amount within tolerance | ₹250 vs ₹249 | linked (within ₹5) |
| MAT-05 | Amount outside tolerance | ₹250 vs ₹240 | not linked |
| MAT-06 | Cash never matches | quick-add ₹60 cash; line ₹60 same day | not linked |
| MAT-07 | Two identical coffees, one line | two ₹250 quick-adds, one ₹250 line | one linked (earliest), the other stays pending |
| MAT-08 | Daily chai | ₹20 quick-add every day; 5 lines of ₹20 | each line links to the same-day quick-add only |
| MAT-09 | Medium confidence | amount exact, day matches, merchant text unrelated | linked, marked undoable |
| MAT-10 | Low confidence | amount within tolerance only, 2 days apart, UPI | both kept |
| MAT-11 | Learned pair | user linked "Third Wave" to "THIRDWAVECOFFEE" once | next time high confidence regardless of text score |
| MAT-12 | Unlink | undo a link | two records, quick-add back to pending, line statement_only |
| MAT-13 | Unmatched becomes cash | import covers 11 Oct; pending ₹60 quick-add that day with no match | payment_method cash, status stays pending |
| MAT-14 | ATM withdrawal | line "ATM WDL ₹2,000" | transfer, counts_in_budget false |
| MAT-15 | Misc cash offer | ATM ₹2,000, cash spends logged ₹1,400 | offer to log ₹600 misc cash, once |
| MAT-16 | Fixed cost first sight | line ₹10,000 to ramesh@okaxis on 5 Oct, rent ₹10,000 | asks once; after yes, payee_pattern saved |
| MAT-17 | Fixed cost recognised | same payee ₹10,000 in November | fixed_cost_id set, counts_in_budget false, no question |
| MAT-18 | Fixed cost tolerance | rent line ₹10,800 (8% more) | still recognised; ₹11,500 (15%) is not |
| MAT-19 | Savings transfer | line "NEFT to SBI SIP ₹6,700" | goal contribution confirmed, counts_in_budget false |
| MAT-20 | Logging accuracy | 9 confirmed, 1 statement-only | 90%, +50 XP, Honest logger |
| MAT-21 | Duplicate statement line | same fingerprint imported twice | second import skips it |

## 4. Statement readers (unit, with sample files)

One anonymised sample per bank lives in `server/src/test/resources/statements/`.

| ID | Case | Input | Expected |
|---|---|---|---|
| RD-01 to RD-05 | Each bank's PDF | HDFC, ICICI, SBI, Axis, Kotak samples | line count, first and last date, debit and credit totals equal the saved expected JSON |
| RD-06 | Bank detection | each sample without a hint | correct bank |
| RD-07 | Password-protected PDF, no password | HDFC locked sample | PASSWORD_REQUIRED |
| RD-08 | Wrong password | "WRONG" | WRONG_PASSWORD, no partial result |
| RD-09 | Correct password | real one | lines parsed |
| RD-10 | Scanned PDF | image-only sample | SCANNED_PDF |
| RD-11 | Corrupt file | truncated PDF | UNREADABLE |
| RD-12 | Wrong type | PNG named .pdf | INVALID_FILE (magic bytes) |
| RD-13 | Oversized | 11 MB | TOO_LARGE before parsing |
| RD-14 | Parse timeout | PDF built to parse slowly | UNREADABLE after 10 s; thread released |
| RD-15 | Partial read | sample with 3 malformed rows | lines parsed, unreadable_count 3 |
| RD-16 | Unsupported bank | Yes Bank PDF | UNSUPPORTED_BANK with the detected name |
| RD-17 | Empty statement | valid PDF, 0 lines | preview with 0 transactions |
| RD-18 | CSV comma | standard columns | parsed |
| RD-19 | CSV semicolon | ; delimiter | parsed |
| RD-20 | CSV needs mapping | unknown headers | NEEDS_COLUMN_MAP with the headers listed |
| RD-21 | CSV with saved mapping | mapping exists for the bank | parsed without asking |
| RD-22 | Amount formats | "1,234.00", "-500", Dr/Cr column, separate debit and credit columns | all parsed to paise with the right direction |
| RD-23 | Date formats | DD/MM/YYYY, DD-MM-YY, "23 Oct 2026" | parsed per the mapping's declared format; ambiguous formats are never guessed |
| RD-24 | No file left behind | after any reader call | temp directory unchanged |
| RD-25 | Password not logged | run RD-08 and RD-09 | log output contains neither password |

## 5. Game: XP, levels, streaks, badges, challenge (unit)

| ID | Case | Input | Expected |
|---|---|---|---|
| XP-01 | Log a spend | 1 spend | +5 XP event |
| XP-02 | Daily cap | 11 spends in one day | 10 events of +5, the 11th earns nothing |
| XP-03 | Delete reverses | delete the spend from XP-01 | event has reversed_at; total excludes it |
| XP-04 | Delete after cap | 11 spends, delete the 11th | nothing reversed (it earned nothing) |
| XP-05 | Day under budget | close with spent ≤ budget | +20 once |
| XP-06 | Day over budget | spent > budget | no +20 |
| XP-07 | Sort finished | commit import | +10 |
| XP-08 | Level thresholds | 399, 400, 899, 900 XP | levels 1, 2, 2, 3 |
| XP-09 | Stage | levels 4, 5, 9, 10, 19, 20 | clay, painted, painted, gold, gold, diamond |
| XP-10 | Level-up event | cross 400 | one level_up event, celebration flag |
| STR-01 | Streak counts | 5 days under budget | current 5 |
| STR-02 | No-spend day counts | day with zero spends | streak continues |
| STR-03 | Freeze earned | day 7 | freezes 1 |
| STR-04 | Freeze cap | days 7 and 14 and 21 | freezes 2, not 3 |
| STR-05 | Freeze used | over budget with 1 freeze | streak kept, freezes 0 |
| STR-06 | Streak breaks | over budget with 0 freezes | current 0, best kept |
| STR-07 | Milestones | days 7, 30, 100 | +100, +500, +2,000 once each |
| STR-08 | Midnight boundary | close job runs at 00:05 IST | yesterday's day is the one counted |
| BDG-01 | First log | first spend ever | badge once |
| BDG-02 | Week warrior | streak 7 | badge once, not again at 14 |
| BDG-03 | No-Swiggy Sunday | Sunday with no Food delivery spend | badge |
| BDG-04 | Zepto-free week | 7 days without Quick commerce | badge; a Zepto spend on day 3 resets progress to 0 of 7 |
| BDG-05 | Subscription slayer | first "cancelled" answer | badge |
| BDG-06 | Comeback kid | 3 days over then a day under | badge |
| BDG-07 | Diamond Gullak | level 20 | badge |
| BDG-08 | Each badge is unique | trigger twice | one row |
| CHL-01 | Challenge selection | last 2 weeks: Food delivery highest discretionary at ₹1,150 a week average | "under ₹800 on Food delivery" (70% of 1,150 = 805, rounded to ₹800) |
| CHL-02 | Challenge done | week ends with ₹650 | done_at set, +150 XP, badge |
| CHL-03 | Challenge failed | ₹900 | no XP, next week's challenge chosen fresh |
| CHL-04 | Not enough data | new user, 2 days of spends | no challenge this week |

## 6. Jobs (integration)

| ID | Case | Expected |
|---|---|---|
| JOB-01 | Daily close idempotent | run twice for the same user and date: one daily_closes row, XP and streak counted once |
| JOB-02 | Daily close for all users | 3 users with spends: 3 rows, each graded by their own budget |
| JOB-03 | Grade | 79% used → B; 49% → A+; 101% → C; 151% → F |
| JOB-04 | Off-track push once per 3 days | user off track on 3 consecutive closes: one push |
| JOB-05 | Quiet hours | push due at 23:30 IST: sent at 07:00 |
| JOB-06 | Daily cap | 5 pushes due in a day: 4 sent, the lowest priority dropped |
| JOB-07 | Switched off | user disabled off-track messages: none sent |
| JOB-08 | Draft cleanup | draft import 8 days old: discarded; 6 days old: kept |
| JOB-09 | Deletion after grace | deletion requested 31 days ago: user rows gone; 29 days: kept |
| JOB-10 | Lock | two instances start the close job together: one runs, the other skips |
| JOB-11 | Retry | push provider fails once: retried, then sent |
| JOB-12 | Alert on repeated failure | provider fails 3 times: alert raised, job marked failed |

## 7. API tests

### 7.1 Auth

| ID | Case | Request | Expected |
|---|---|---|---|
| API-AUTH-01 | Request OTP, new email | POST /auth/otp/request {email} | 204; code hashed in otp_codes; email sent |
| API-AUTH-02 | Request OTP, existing email | same | 204, identical body and timing class |
| API-AUTH-03 | Bad email | "not-an-email" | 400 VALIDATION |
| API-AUTH-04 | Rate limit per email | 6th request in 10 min | 429 RATE_LIMITED |
| API-AUTH-05 | Rate limit per IP | 31st request in 10 min from one IP | 429 |
| API-AUTH-06 | Verify correct code | POST /auth/otp/verify {email, code} | 200 {accessToken, refreshToken, expiresIn}; code consumed |
| API-AUTH-07 | Verify wrong code | wrong code | 401 OTP_INVALID; attempts 1 |
| API-AUTH-08 | Verify locked | 6th wrong attempt | 401 OTP_LOCKED; a new request is needed |
| API-AUTH-08b | Daily guess cap | 10 wrong guesses across several codes in 24 h, then the right code | 401 OTP_LOCKED "Too many tries today"; works again after 24 h |
| API-AUTH-08c | Double-tapped request | 5 parallel requests for one email | exactly one live code; the last mailed code verifies |
| API-AUTH-05b | Spoofed X-Forwarded-For | 31 requests from one socket with different XFF, no trusted proxy | 31st is 429 (real HTTP port, not MockMvc) |
| API-AUTH-09 | Verify expired | 11 minutes later | 401 OTP_EXPIRED |
| API-AUTH-10 | Verify reused | correct code twice | second is 401 OTP_INVALID |
| API-AUTH-11 | Verify for another email | code issued to A, sent with email B | 401 OTP_INVALID |
| API-AUTH-12 | Refresh | POST /auth/refresh | 200 new pair; old token used_at set |
| API-AUTH-13 | Refresh reuse | the old token again | 401 TOKEN_REUSED; every refresh token for the user revoked |
| API-AUTH-13b | Stale token is not a kill switch | refresh with a logged-out token, or a used token after its expiry | 401 (UNAUTHENTICATED or TOKEN_EXPIRED); the user's other sessions keep working |
| API-AUTH-17b | Logout after the access token expired | POST /auth/logout with an expired bearer header | 204; refresh token revoked |
| API-AUTH-14 | Refresh expired | 31 days old | 401 TOKEN_EXPIRED |
| API-AUTH-15 | Refresh after logout | | 401 |
| API-AUTH-16 | Web refresh needs header | cookie present, no X-Requested-With | 403 CSRF |
| API-AUTH-17 | Logout | POST /auth/logout | 204; refresh now 401 |
| API-AUTH-18 | No token | GET /budget/today without Authorization | 401 UNAUTHENTICATED |
| API-AUTH-19 | Expired access token | 16 minutes old | 401 TOKEN_EXPIRED |
| API-AUTH-20 | Tampered token | signature changed | 401 |
| API-AUTH-21 | alg none | JWT with alg none | 401 |
| API-AUTH-22 | Token of a locked account | after DELETE /me | 403 ACCOUNT_LOCKED |

### 7.2 Profile and setup

| ID | Case | Request | Expected |
|---|---|---|---|
| API-PRO-01 | Get profile | GET /me/profile | 200 with the example values |
| API-PRO-02 | Update profile | PUT valid | 200; cycle created if none |
| API-PRO-03 | Income zero or negative | income 0, −1 | 400 VALIDATION |
| API-PRO-04 | Payday day out of range | payday_day 0, 29 | 400 |
| API-PRO-05 | Bad payday rule | "whenever" | 400 |
| API-PRO-06 | Bad personality | "pirate" | 400 |
| API-PRO-07 | Bad time | morning_time "25:00" | 400 |
| API-PRO-08 | Timezone not supported in V1 | "Europe/London" | 400 |
| API-PRO-09 | Savings exceed income minus fixed | savings ₹36,000 | 422 NOT_POSSIBLE with the maximum allowed |
| API-PRO-10 | Payday change timing | payday 1 to 7 | 200; current cycle end unchanged; bridge cycle 1 to 6 Nov; normal cycle from 7 Nov |
| API-PRO-11 | Before setup | GET /budget/today for a user with no profile | 409 SETUP_INCOMPLETE |
| API-FC-01 | Add fixed cost | POST {name "Rent", amount} | 201 |
| API-FC-02 | Zero amount | amount 0 | 400 |
| API-FC-03 | Long name | 61 characters | 400 |
| API-FC-04 | Edit | PATCH amount | 200; spendable recomputed (BUD-16) |
| API-FC-05 | Edit other user's | PATCH their id | 404 |
| API-FC-06 | Delete | DELETE | 204; active false; excluded from spendable |
| API-FC-07 | Delete twice | | 404 |
| API-FC-08 | Fixed costs exceed income | sum > income | 422 NOT_POSSIBLE |
| API-PUSH-01 | Register push token | valid Expo token | 201 |
| API-PUSH-02 | Bad token format | "abc" | 400 |
| API-PUSH-03 | Same token twice | | 200, one row |
| API-CON-01 | Record consent | POST {version} | 201 with consented_at |
| API-CON-02 | Missing version | | 400 |

### 7.3 Today and cycles

| ID | Case | Request | Expected |
|---|---|---|---|
| API-TDY-01 | Example day | GET /budget/today | budget 59300, spent 18000, left 41300, daysLeft 9, mood HAPPY, line "₹413 left for today. Nice and steady.", cycle 1 to 31 Oct (streak and forecast arrive in Plans 5 and 6) |
| API-TDY-02 | Nervous | spent 85% | mood nervous |
| API-TDY-03 | Fainted | spent 72000 | mood FAINTED, over 12700, left 0 |
| API-TDY-04 | Goal behind | Goa behind ₹1,800 | catchUp with three options and their numbers |
| API-TDY-05 | Strict goal behind | | catchUp with tighten only |
| API-TDY-06 | Pool negative | | budget 0, catchUp present |
| API-TDY-07 | Personality | profile Savage | line text from the Savage set |
| API-TDY-08 | First cycle created lazily | new user, first call after setup | cycle row exists with the right dates |
| API-CYC-01 | Closed cycle summary | GET /budget/cycles/{id}/summary | spent, saved, extra, grades, top 3 categories, badges |
| API-CYC-02 | Open cycle summary | | 200 with closed false and so-far figures |
| API-CYC-03 | Other user's cycle | | 404 |
| API-CYC-04 | Leftover choice | POST leftover {choice rollover} on a closed cycle | 200; next cycle's spendable updated |
| API-CYC-05 | Leftover on open cycle | | 409 CYCLE_OPEN |
| API-CYC-06 | Leftover chosen twice | | 409 ALREADY_CHOSEN |
| API-CYC-07 | Bad choice | "burn" | 400 |

### 7.4 Spends

| ID | Case | Request | Expected |
|---|---|---|---|
| API-SP-01 | Create | POST {clientId, amount 25000, category, paymentMethod upi, merchant} | 201; status pending; +5 XP |
| API-SP-02 | Idempotent | same clientId again, same body | 200, same id, no second XP |
| API-SP-03 | Same clientId, different body | | 409 CLIENT_ID_CONFLICT |
| API-SP-04 | Zero amount | 0 | 400 |
| API-SP-05 | Negative amount | −100 | 400 |
| API-SP-06 | Above cap | 1,00,00,000 | 400 |
| API-SP-07 | Future date | occurred_at +2 days | 400 |
| API-SP-08 | Tomorrow allowed | +1 day | 201 |
| API-SP-09 | Unknown category | "crypto" | 400 |
| API-SP-10 | Bad payment method | "cheque" | 400 |
| API-SP-11 | Merchant too long | 81 characters | 400 |
| API-SP-12 | Cash | paymentMethod cash | 201; never matched later (MAT-06) |
| API-SP-13 | Spread over cycle | spreadOverCycle true | 201; today's spent excludes it |
| API-SP-14 | Eleventh spend | | 201, no XP |
| API-SP-15 | Old date | 60 days ago | 201; affects that cycle (BUD-29) |
| API-SP-16 | Too old | 91 days ago | 400 |
| API-SP-17 | List | GET /transactions?from&to | own spends, newest first, with cursor |
| API-SP-18 | List filter | category=food_delivery | only that category |
| API-SP-19 | List inverted range | from > to | 400 |
| API-SP-20 | List excludes deleted | | deleted rows absent |
| API-SP-21 | List isolation | other user has spends | none of theirs appear |
| API-SP-22 | Get own | GET /transactions/{id} | 200 |
| API-SP-23 | Get other's | | 404 |
| API-SP-24 | Get deleted | | 404 |
| API-SP-25 | Edit amount | PATCH amount | 200; budget recomputed |
| API-SP-26 | Edit confirmed amount | spend linked to a statement line | 409 CONFIRMED_AMOUNT_LOCKED |
| API-SP-27 | Edit category on statement spend | | 200; user merchant rule created |
| API-SP-28 | Edit tag | tag regret | 200 |
| API-SP-29 | Edit bad tag | "meh" | 400 |
| API-SP-30 | Edit other's | | 404 |
| API-SP-31 | Delete | DELETE | 204; deleted_at set; XP reversed; budget back |
| API-SP-32 | Delete twice | | 404 |
| API-SP-33 | Delete linked spend | manual half of a link | 204; statement line stays as statement_only |
| API-SP-34 | Unlink | POST /transactions/{id}/unlink | 200 (MAT-12) |
| API-SP-35 | Unlink unlinked | | 409 NOT_LINKED |
| API-SP-36 | Assign income | POST assign-income {savings 60, pool 40} on a credit | 200 (BUD-14) |
| API-SP-37 | Assign income on a debit | | 409 NOT_INCOME |
| API-SP-38 | Assign income bad split | 60 and 50 | 400 |

### 7.5 Imports

| ID | Case | Request | Expected |
|---|---|---|---|
| API-IMP-01 | HDFC sample | POST /imports (multipart) | 201 preview {count 84, from, to, matched 9, auto 58, fixed 3, toSort 14}; status draft |
| API-IMP-02 | Password required | locked sample, no password | 422 PASSWORD_REQUIRED; no import row |
| API-IMP-03 | Wrong password | | 422 WRONG_PASSWORD; no import row; no temp file; password absent from logs |
| API-IMP-04 | Correct password | | 201 preview |
| API-IMP-05 | Scanned | | 422 SCANNED_PDF |
| API-IMP-06 | Unsupported bank | Yes Bank | 422 UNSUPPORTED_BANK {bank "Yes Bank"}; bank request counted |
| API-IMP-07 | CSV needs mapping | | 422 NEEDS_COLUMN_MAP {headers, importId} |
| API-IMP-08 | CSV with mapping | after API-IMP-10 | 201 preview |
| API-IMP-09 | Too large | 11 MB | 413 TOO_LARGE |
| API-IMP-10 | Column map | POST /imports/{id}/column-map {date, description, debit, credit, dateFormat} | 200 preview; csv_mappings row for the bank |
| API-IMP-11 | Column map missing date | | 400 |
| API-IMP-12 | Wrong type | PNG as .pdf | 400 INVALID_FILE |
| API-IMP-13 | Partial | malformed rows sample | 201 preview with unreadableCount 3 |
| API-IMP-14 | Same statement twice | | 201 preview with count 0 new, alreadyImported 84 |
| API-IMP-15 | Rate limit | 11th upload in an hour | 429 |
| API-IMP-16 | To-sort list | GET /imports/{id}/to-sort | 14 lines with suggested category chips |
| API-IMP-17 | To-sort other user's | | 404 |
| API-IMP-18 | Tag | POST tag {lineId, tag need, category} | 200; rule learned (CAT-07) |
| API-IMP-19 | Tag bad value | tag "maybe" | 400 |
| API-IMP-20 | Tag line not in import | | 404 |
| API-IMP-21 | Undo tag | POST undo-tag | 200; the last tag reverted |
| API-IMP-22 | Undo with nothing | | 409 NOTHING_TO_UNDO |
| API-IMP-23 | Commit | POST commit | 200; transactions created; matching ran; +10 XP; Sorted badge first time |
| API-IMP-24 | Commit twice | | 409 ALREADY_COMMITTED |
| API-IMP-25 | Commit with unsorted lines | 4 untagged | 200; those lines saved as Other with needsReview true |
| API-IMP-26 | Discard | POST discard on draft | 200; no transactions |
| API-IMP-27 | Discard after commit | | 409 |
| API-IMP-28 | Commit other user's import | | 404 |
| API-IMP-29 | Bank request | POST /banks/requests {bank "Yes Bank"} | 201 |
| API-IMP-30 | Bank request empty | | 400 |
| API-IMP-31 | No file stored | after API-IMP-01 | no file on disk; statement_imports has no blob column |

### 7.6 Goals

| ID | Case | Request | Expected |
|---|---|---|---|
| API-GL-01 | Create deadline goal | POST {name Goa, target 3000000, deadline 2027-03, mode flexible} | 201 with contribution 360000 and verdict |
| API-GL-02 | Create monthly only | type monthly | 201 |
| API-GL-03 | Empty name | | 400 |
| API-GL-04 | Long name | 41 characters | 400 |
| API-GL-05 | Zero target | | 400 |
| API-GL-06 | Past deadline | 2026-08 | 422 DEADLINE_PASSED |
| API-GL-07 | Not possible | contribution > free | 422 NOT_POSSIBLE with the maximum |
| API-GL-08 | Bad mode | "medium" | 400 |
| API-GL-09 | Check without saving | POST /goals/check | 200 verdict for doable, tight, not possible (GOAL-06 to 08); no row created |
| API-GL-10 | List | GET /goals | each goal with saved, expected, behind, status |
| API-GL-11 | Get other's | | 404 |
| API-GL-12 | Edit target | PATCH target | 200; contribution recomputed |
| API-GL-13 | Edit to impossible | | 422 NOT_POSSIBLE |
| API-GL-14 | Edit mode | strict | 200 |
| API-GL-15 | Pause | POST pause | 200 (GOAL-16) |
| API-GL-16 | Pause twice | | 409 ALREADY_PAUSED |
| API-GL-17 | Resume | | 200 (GOAL-17) |
| API-GL-18 | Catch-up tighten | POST catch-up {kind tighten} | 200; /budget/today shows the lower budget |
| API-GL-19 | Catch-up move | | 200; deadline Apr 2027 |
| API-GL-20 | Catch-up lower | | 200; target 2820000 |
| API-GL-21 | Catch-up on strict | kind move | 409 STRICT_GOAL |
| API-GL-22 | Catch-up when not behind | | 409 NOT_BEHIND |
| API-GL-23 | Undo catch-up | POST catch-up/undo | 200 |
| API-GL-24 | Undo with nothing | | 409 |
| API-GL-25 | Delete | DELETE | 204; status deleted; contributions kept; free savings up |
| API-GL-26 | Delete twice | | 404 |
| API-GL-27 | Milestone event | contribution crossing 25% | /me/progress shows the milestone once |

### 7.7 Insights and subscriptions

| ID | Case | Request | Expected |
|---|---|---|---|
| API-INS-01 | Cycle insights | GET /insights/cycle | categories sum to spent; forecast matches 2.8 formula; extra saved |
| API-INS-02 | Other cycle | other user's id | 404 |
| API-INS-03 | Category spends | GET /insights/category/quick_commerce | the spends, with merchant totals |
| API-INS-04 | Unknown category | | 404 |
| API-SUB-01 | Detect monthly | Netflix ₹649 on 3 Sep and 3 Oct | one subscription, period monthly |
| API-SUB-02 | Not a subscription | two charges 10 days apart | none |
| API-SUB-03 | Amount drift | ₹649 then ₹699 (7%) | none |
| API-SUB-04 | Yearly | 365 days apart | period yearly |
| API-SUB-05 | Answer using | POST answer {using} | 200; not asked again this cycle; asked next cycle |
| API-SUB-06 | Answer cancelled | | 200; excluded from forecast; Subscription slayer once |
| API-SUB-07 | Bad answer | "dunno" | 400 |
| API-SUB-08 | Other user's subscription | | 404 |

### 7.8 Game and content

| ID | Case | Request | Expected |
|---|---|---|---|
| API-GM-01 | Progress | GET /me/progress | xp excludes reversed; level; stage; streak; freezes; badges; challenge |
| API-GM-02 | Report card today | GET /report-card | 4 cards with grade, biggest spend, streak and XP, line |
| API-GM-03 | Report card future | date tomorrow | 400 |
| API-GM-04 | Report card before account | | 404 |
| API-GM-05 | Lines by personality | GET /content/lines?personality=savage | the Savage set |
| API-GM-06 | Unknown personality | | 400 |

### 7.9 Data

| ID | Case | Request | Expected |
|---|---|---|---|
| API-DT-01 | Export | POST /me/export | 202; email with a link; link works; CSV columns documented |
| API-DT-02 | Export link expired | 25 hours later | 410 LINK_EXPIRED |
| API-DT-03 | Export rate limit | second request within an hour | 429 |
| API-DT-04 | Export contains only own data | two users | file has only the caller's rows |
| API-DT-05 | Delete account | DELETE /me | 202; deletion_requested_at; every refresh token revoked |
| API-DT-06 | Login while locked | OTP verify | 403 ACCOUNT_LOCKED with restore instructions |
| API-DT-07 | Restore within grace | POST /me/restore with the emailed token | 200; account active |
| API-DT-08 | Restore after grace | day 31 | 404 |
| API-DT-09 | Restore bad token | | 401 |

### 7.10 Cross-cutting API checks

| ID | Case | Expected |
|---|---|---|
| API-X-01 | Cross-user 404 | parameterised over every endpoint that takes an id: the other user's id returns 404 |
| API-X-02 | Error shape | every 4xx and 5xx body is {code, message}; 5xx message is generic |
| API-X-03 | Unknown route | 404 NOT_FOUND in the same shape |
| API-X-04 | Wrong method | 405 in the same shape |
| API-X-05 | Malformed JSON | 400 VALIDATION |
| API-X-06 | Unknown fields | ignored, not an error |
| API-X-07 | Injection strings | `' OR 1=1 --` in every string field: stored or rejected as text, never executed |
| API-X-08 | Oversized body | 1 MB JSON | 413 |
| API-X-09 | Money as integers | every amount field rejects decimals and strings |
| API-X-10 | Pagination | cursor from one user is useless for another (404 or empty) |
| API-X-11 | Health | GET /actuator/health unauthenticated 200; every other actuator path 404 |

## 8. Security tests

| ID | Case | Expected |
|---|---|---|
| SEC-01 | Log redaction | after a day of API traffic, grep the logs: no amount, merchant text, UPI handle, email, token or password |
| SEC-02 | Encryption at rest | read `merchant_raw_enc` straight from Postgres: ciphertext, not the merchant text |
| SEC-03 | Key missing | server started without the encryption key: refuses to start |
| SEC-04 | Security headers | web responses carry CSP, frame-ancestors none, nosniff, HSTS |
| SEC-05 | CORS | request from an unlisted origin gets no CORS headers; the app origin does |
| SEC-06 | Refresh cookie flags | httpOnly, Secure, SameSite=Strict |
| SEC-07 | Access token on web | never written to localStorage or cookies (app test) |
| SEC-08 | Secrets scan | CI fails on a committed key |
| SEC-09 | Dependency audit | CI fails on a known critical vulnerability |
| SEC-10 | Upload abuse | 100 uploads in a minute from one user: rate limited; server memory stays bounded |
| SEC-11 | PDF with JavaScript | parsed as text only; nothing executed |
| SEC-12 | Account enumeration | OTP request for a known and an unknown email: same status, body and response time class |
| SEC-13 | Token in URL | tokens are never accepted as query parameters |
| SEC-14 | Deleted user data | after JOB-09, no row in any table references the user |

## 9. App tests (Jest, React Native Testing Library)

| ID | Case | Expected |
|---|---|---|
| APP-01 | Money format | 100000 paise → "₹1,000"; 10000000 → "₹1,00,000"; 0 → "₹0" |
| APP-02 | Date format | 2026-10-23 → "Fri, 23 Oct" |
| APP-03 | Quick-add reducer | "0" + "5" → "5"; "25" + "0" → "250"; "0" + "00" → "0"; backspace on "5" → "0"; 7-digit cap |
| APP-04 | Add disabled at zero | button reads "Enter an amount" and is disabled |
| APP-05 | Large amount check | ₹12,000 → "Sure?" shown once; second tap saves |
| APP-06 | Discard dialog | close with amount: dialog; Keep editing keeps state; Discard navigates; close at ₹0: no dialog |
| APP-07 | Dialog closes at zero | dialog open, amount deleted to 0 → dialog gone |
| APP-08 | Category row | horizontal scroll; selected chip has the 2px ink border and aria-pressed |
| APP-09 | Offline queue | POST fails with network error: spend kept locally, shown on Home, retried with backoff, sent once |
| APP-10 | Queue dedupe | app restarts mid-sync: no duplicate POST (same clientId) |
| APP-11 | Home states | loading skeleton; error with retry; "Updated 2 hours ago" when offline with cached data; first-run empty state |
| APP-12 | Mood mapping | 0, 49, 50, 79, 80, 100, 101% → happy, happy, calm, calm, nervous, nervous, fainted |
| APP-13 | Reduce Motion | OS setting on: Gullak renders a still, no animation hooks run |
| APP-14 | Gullak animations | coin drop fires on add; faint on fainted; celebrate on streak flag |
| APP-15 | Personality line | the line for the chosen personality is shown |
| APP-16 | Report card navigation | Skip on card 1 leaves; Back and Next clamp; Done on card 4; Share calls the share sheet with an image |
| APP-17 | Grade explanation | tapping the grade shows the rule |
| APP-18 | Swipe-to-sort | counter 14 → 0; buttons and swipes both tag; chip change before tag is sent; Undo reverts the last tag; summary plurals (1 regret, 2 regrets) |
| APP-19 | Import error mapping | each code (PASSWORD_REQUIRED, WRONG_PASSWORD, UNSUPPORTED_BANK, SCANNED_PDF, NEEDS_COLUMN_MAP, TOO_LARGE, UNREADABLE) opens its screen; wrong password keeps the file in memory for retry |
| APP-20 | Reality check preview | savings stepper shows Doable, Tight, Not possible at the thresholds; Continue disabled on Not possible |
| APP-21 | Typed amounts | stepper accepts a typed value; non-digits stripped; cap enforced |
| APP-22 | New goal | start disabled until named; past month blocked; date change recomputes paydays and verdict |
| APP-23 | Catch-up card | pick updates tomorrow's budget and the card title; Undo restores |
| APP-24 | Fixed costs | add, edit, remove, undo removal within 5 s; list scrolls; "Add another" hides when empty |
| APP-25 | Payday picker | each option updates the cycle line; "Another date" shows the day select |
| APP-26 | Me | download shows status; delete opens the confirmation; sign out clears tokens and the offline queue |
| APP-27 | Token storage | phone: SecureStore; web: access token in memory only |
| APP-28 | Error toast never carries an action | any error that needs a decision renders inline, not as a toast |
| APP-29 | Accessibility | every icon-only control has a label; every control is at least 44px |
| APP-30 | Web routes | quick-add, report card and notification screens are not reachable on web; dashboard, upload and goals are |

## 10. End-to-end (Maestro on an Android emulator; Playwright for web)

| ID | Flow | Checks |
|---|---|---|
| E2E-01 | Setup | email OTP, income, payday, fixed costs, savings, personality, notification step, first-run Home shows ₹500 |
| E2E-02 | Quick-add | + → ₹250 Eating out UPI → Home shows ₹250 spent and the Gullak reacts |
| E2E-03 | Edit and delete | open the spend, change to ₹180, save; delete it; Home back to ₹0 |
| E2E-04 | Statement | Insights → add statement → HDFC sample with password → preview → sort 14 → "All sorted" → Insights totals updated |
| E2E-05 | Wrong password | wrong then right password |
| E2E-06 | Goal and catch-up | new goal → Goals → force behind (test data) → catch-up tighten → Home shows the lower budget → undo |
| E2E-07 | Report card | open from the night notification deep link → 4 cards → share |
| E2E-08 | Offline | airplane mode → quick-add → back online → spend appears once on the server |
| E2E-09 | Delete account | Me → delete → login shows locked → restore link → login works |
| E2E-10 | Web smoke | login, dashboard renders the example numbers, CSV upload with column map, goal created |

## 11. Manual checklist

The 39-step prototype checklist in `docs/ux-test-findings.md`, run on a real Android phone and an iPhone before each release, plus: notifications arrive at the set times, quiet hours hold, the share image looks right in Instagram stories, and the app survives a phone restart mid-sync.

## 12. Logging and error handling

Standard: `docs/engineering-standards.md`.

| ID | Case | Expected |
|---|---|---|
| LOG-01 | Request line | one INFO line per request with method, route template, status, duration, requestId; none from controllers |
| LOG-02 | Request ID round trip | `X-Request-Id` sent in is echoed in the response header and the log; absent, one is generated |
| LOG-03 | Business events | creating a spend, committing an import, closing a cycle and finishing a job each log exactly one event from the vocabulary, with ids and counts only |
| LOG-04 | Levels | OTP lock, rate limit, wrong password and parse timeout log at WARN; an injected unexpected exception logs once at ERROR with a stack and an errorId equal to the one in the response |
| LOG-05 | Redaction | after running the API suite, the captured logs contain no amount from the fixtures, no merchant text, no email, no token, no OTP, no password, no file name |
| LOG-06 | Parameterised only | a static check fails on string concatenation inside a log call |
| LOG-07 | Job logging | a job over 3 users where user 2 throws: `job.started`, one `job.failed` for user 2, `job.finished` with processed 2 failed 1 |
| LOG-08 | App logger | ESLint fails on `console.log` outside `lib/log.ts`; in production builds `debug` is dropped and `info` reaches the reporting sink interface |
| LOG-09 | App redaction | the reporting sink never receives an amount, merchant or token in any field or breadcrumb |
| ERR-01 | Error shape everywhere | every 4xx and 5xx in the suite has `{code, message}`; 5xx has `errorId`; no stack trace or class name in any body |
| ERR-02 | Validation fields | a request with two bad fields returns 400 VALIDATION with both field names |
| ERR-03 | Malformed JSON | 400 VALIDATION, logged at INFO, not ERROR |
| ERR-04 | Unexpected exception | a service throwing `IllegalStateException` → 500 INTERNAL, generic message, one ERROR log |
| ERR-05 | No empty catch | ArchUnit fails on an empty catch block anywhere in `server/` |
| ERR-06 | No broad catch | ArchUnit fails on `catch (Exception` or `catch (Throwable` outside the error handler, job runner and async packages |
| ERR-07 | Transaction rollback | a write that throws after inserting a row leaves no row |
| ERR-08 | External call timeout | email provider stub that hangs: request completes, WARN logged, retry queued, no user-facing failure |
| ERR-09 | External call gives up | provider fails 3 times: WARN each, then queued for later, job records it |
| ERR-10 | Parser timeout releases the thread | after RD-14 the executor has no stuck thread; a second upload works |
| ERR-11 | Not found is thrown | a repository returning empty for the caller's own id produces 404 through the handler, never a null-pointer 500 |
| ERR-12 | API client mapping | app: 404 → ApiError NOT_FOUND; network drop → NetworkError; HTML error page → UnknownError; never a raw exception reaches a screen |
| ERR-13 | Every screen's error state | a failing query on each screen renders the error state with Retry; Retry refetches |
| ERR-14 | Optimistic rollback | delete fails with 500: the row returns and a message shows |
| ERR-15 | Error boundary | a component that throws during render shows the fallback with Retry, and the error is reported |
| ERR-16 | Unmapped code | server returns a new code: generic message shown, WARN logged with the code |
| ERR-17 | Offline queue on 4xx | a queued spend rejected with 400 is not retried; it is shown on Home as failed with the reason |
| ERR-18 | Unhandled rejection | a rejected promise with no handler is caught globally and logged, and the app keeps running |
