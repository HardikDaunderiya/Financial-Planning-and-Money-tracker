# Founder questions from Plans 3–9

Each question says what happens if you say nothing (the default the plan is written with) and where it lands. Answer only the ones you want changed.

## Before launch (needs something from you)

1. **Real bank statements.** The five bank readers (HDFC, ICICI, SBI, Axis, Kotak) are built from educated guesses and synthetic sample PDFs. We need one real, anonymised statement per bank before launch.
   Default: synthetic samples only; each real one swaps in by replacing one reader and one sample. Affects Plan 4, Tasks 2–3.
2. **Privacy policy: legal entity and grievance contact.** The policy names no legal entity or postal address, and DPDP expects a contact the user can reach for grievances.
   Default: placeholders in `docs/privacy-policy.md`, which must be filled before launch. Affects Plan 8, Tasks 4 and 11.
3. **Email provider and its owner.** Plan 8 picked Amazon SES in Mumbai (keeps addresses and codes in India). Confirm, and say who owns the AWS account and the domain verification (DKIM, production access).
   Default: SES ap-south-1. Affects Plan 8, Task 2.
4. **Domain.** The web build and email links run on the DigitalOcean App Platform URL until you choose a domain.
   Default: App Platform URL; switching later is one dashboard change plus new app builds. Affects Plan 9, Tasks 6 and 9.
5. **Store accounts and GitHub home.** EAS submit jobs fail until Apple and Google accounts exist, and the repo has no remote yet (organisation or personal account?).
   Default: manual store submissions; release workflows wait for a remote. Affects Plan 9, Tasks 8–10.

## Copy to review

6. **Report-card evening lines.** The report-card lines in `content_lines` are new copy (3 bands × 4 personalities, may include the goal name), not from the mockups. The Savage and Indian mom sets need your eye most.
   Default: ships as written. Affects Plan 6, Tasks 9 and 11.
7. **Insights copy for undrawn screens.** Cycle summary, drill-down and Home card use new copy, e.g. "1 Oct – 31 Oct is done", "Roll into this cycle", "₹1,000 short at this pace".
   Default: ships as written. Affects Plan 7, Tasks 13–14.

## Spec deviations to confirm

8. **Level-up timing (spec 4.1).** The spec says levels are updated in the same transaction that writes the XP event. Plan 6 instead compares XP to a high-water mark when Home is read, a day closes or a job awards XP.
   Default: Plan 6's approach. A level-up from a spend shows on the next Home refresh (immediately, since Home refetches after a spend), and it never replays after XP is reversed and earned back. Affects Plan 6, Task 3.
9. **Notification cap (spec 2.7, changed in this pass).** The 4-a-day cap is now a total. The server sends at most 4 minus the number of local types switched on (morning, night, 80% alert), and never fewer than 1. With every switch on, that leaves 1 server push a day.
   Default: this rule. The alternative is a fixed server cap. Affects Plan 8, Task 9.

## Budget and spending rules

10. **Refunds and income on quick-add.** Only statements bring credits in today. Should quick-add let people type a refund or extra income?
    Default: no. Affects Plan 3, Task 9.
11. **Statement refunds.** Refunds and other credits on a statement do not add money back to the day or the pool in V1.
    Default: credits never change the budget. Affects Plan 4, Task 9.
12. **Spread over the cycle.** A spread spend shrinks the pool from its own day, so today's budget drops at once. Should it start counting from tomorrow instead?
    Default: from today. Affects Plan 3, Task 7.
13. **Abuse limit.** Manual spends are limited to 200 per user per hour.
    Default: 200. Affects Plan 3, Task 4.
14. **Failed queued spend.** A spend that failed to send can only be removed. Should it offer "Edit and retry"?
    Default: Remove only. Affects Plan 3, Task 12.

## Statements

15. **"Finish later" with no review screen.** Lines left unsorted become Other and are marked for review, but V1 has no screen to review them. Add a "Sort later" list (in Plan 7), or drop "Finish later"?
    Default: keep "Finish later", no review list. Affects Plan 4, Tasks 9 and 14.
16. **Merchant names in clear.** For unknown merchants the database keeps a cleaned name ("Kaka Dhaba"; a UPI handle loses everything after @) unencrypted. Raw text stays encrypted.
    Default: cleaned name in clear. The alternative is to show the category only. Affects Plan 4, Tasks 5 and 9.
17. **PDF bomb pre-scan.** A crafted PDF can still inflate inside PDFBox while it loads. The container's memory limit is the backstop.
    Default: no pre-scan. Affects Plan 4, Task 2.

## Goals

18. **Tighten from tomorrow.** Someone who picks "tighten" at 8 am sees today's number unchanged. Should it apply from today while today's budget is unused?
    Default: from tomorrow. Affects Plan 5, Task 8.
19. **Flexible goals at cycle close.** A shortfall is carried as debt into the next cycle unless the user picks "take from savings".
    Default: carry the debt. Affects Plan 5, Task 6.
20. **Milestone XP.** +50 XP at 25%, 50% and 75% of a goal. The spec's XP table has no row for this.
    Default: +50 each. Affects Plan 5, Task 5.
21. **Add money to a goal by hand.** This is not in the spec's goal detail, so it is not built. `MANUAL` contributions are reserved in the schema.
    Default: not in V1. Affects Plan 5, Task 11.
22. **Transfers above plan.** Confirmed savings transfers are shown on the goal but never raise "saved" (no double count with the planned contribution), even when someone transfers more than planned.
    Default: never raise saved. Affects Plan 5, Task 5.

## Game

23. **Share image amounts.** The shared report-card image shows no rupee amounts.
    Default: none. Affects Plan 6, Task 13.
24. **Challenge badges in "N of 10".** Weekly-challenge badges form their own family and do not count toward "N of 10".
    Default: not counted. Affects Plan 6, Tasks 5 and 14.
25. **Long outages and streaks.** The nightly close catches up 2 missed nights. A server outage longer than 3 nights resets streaks; the alternative is a manual re-run tool.
    Default: accept the reset. Affects Plan 6, Task 6.

## Insights

26. **Forecast with subscriptions.** The forecast adds each subscription charge once instead of pacing it, so a cancelled subscription changes the forecast at once. The plain spec 2.7 pace formula would not.
    Default: subscription-aware forecast. Affects Plan 7, Tasks 1 and 5.
27. **Personal UPI as subscriptions.** Repeat payments to a person (rent to a flatmate) are excluded from subscription detection.
    Default: excluded. Affects Plan 7, Task 2.
28. **Leftover window.** The "cycle just closed" card shows for 7 days. After that the default (leftover to savings) stays and there is no other way back to the choice.
    Default: 7 days. Affects Plan 7, Tasks 7 and 14.

## Data and operations

29. **Export format.** The export is a ZIP of CSVs (one per table, plus a README), not one flat CSV.
    Default: ZIP. Affects Plan 8, Task 7.
30. **Log retention promise.** The privacy policy now promises logs are kept 30 days. Confirm the log platform keeps them for exactly that.
    Default: 30 days. Affects Plan 8, Task 4.
31. **Preview builds hit production.** Internal preview builds use the production API. A small staging app would cost about $12–20 a month.
    Default: production API. Affects Plan 9, Task 10.
32. **One server instance.** Rate limits live in memory, so the server stays at one instance until the limits move to Postgres.
    Default: one instance at launch. Affects Plan 9, Task 3.
