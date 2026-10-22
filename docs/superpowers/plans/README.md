# Gullak V1: plan roadmap

The spec (`docs/superpowers/specs/2026-10-23-gullak-v1-design.md`) covers several subsystems, so the build is split into nine plans. Each produces working, tested software on its own and is written when the previous one is merged, against the code that exists then.

| # | Plan | Delivers | Spec sections | Main test IDs |
|---|---|---|---|---|
| 1 | Server foundation (`2026-10-23-plan-01-server-foundation.md`) | Spring Boot server: errors, logging, code rules, email OTP login with rotating refresh tokens, profile and fixed costs, cycles, the budget engine, `GET /budget/today` | 2.1, 4.1, 4.3, 4.5–4.11 | BUD-01–10, 15–18, 20, 21, 26–28; API-AUTH-01–15, 17–21; API-PRO; API-FC; API-TDY-01–03, 06–08; API-X-01–06, 11; LOG-01–06; ERR-01–06 |
| 2 | App foundation | Expo app scaffold, design tokens, UI primitives, `lib/` (api, money, dates, log, errors), Gullak component with animations, login, setup (4 steps + notifications step), first-run and normal Home | 2.6, 3, 4.2, 4.4 | APP-01, 02, 11–13, 15, 20, 21, 25, 27–29; ERR-12, 13, 15, 16, 18; LOG-08, 09; E2E-01 |
| 3 | Spends | Server transactions CRUD, idempotency, refunds, spread-over-cycle, extra income, XP for logging; app quick-add, spend detail, offline queue | 2.1, 2.3, 2.6 (XP) | BUD-11–14, 19, 29; API-SP; XP-01–04; APP-03–10; ERR-14, 17; E2E-02, 03, 08 |
| 4 | Statements | PDF readers (HDFC, ICICI, SBI, Axis, Kotak), CSV with mapping, imports API, categorising, matching, fixed-cost and savings detection, encryption of raw text; app upload flow, error screens, swipe-to-sort | 2.3–2.5 | CAT, MAT, RD, API-IMP; SEC-02, 03, 10, 11; APP-18, 19; E2E-04, 05 |
| 5 | Goals | Goals API, reality check, catch-up, pause, milestones; app Goals, New goal, goal detail, catch-up card | 2.2 | GOAL; API-GL; BUD-22–25; APP-22, 23; E2E-06 |
| 6 | Game and jobs | XP levels and stages, streaks and freezes, badges, weekly challenge, daily close and other jobs, report card | 2.6, 2.7, 4.8 | XP-05–10; STR; BDG; CHL; JOB-01–03, 08, 10–12; API-GM; APP-14, 16, 17; E2E-07; LOG-07 |
| 7 | Insights | Cycle insights, category drill-down, subscriptions, forecast, cycle summary and leftover choice | 2.8 | API-INS; API-SUB; API-CYC |
| 8 | Me, data and notifications | Consent, export, deletion with grace, restore, push tokens, off-track and milestone pushes, quiet hours, real email provider, Me screens | 2.7, 4.7 (DPDP) | API-DT; API-PUSH; API-CON; API-AUTH-22; JOB-04–07, 09; SEC-14; APP-26; E2E-09 |
| 9 | Web and release | Web cookie session and CSRF header, CSP, CORS, web route guards, Playwright smoke, security sweep, CI release jobs, EAS builds | 1.1, 4.7 | API-AUTH-16; SEC-04–09, 12; APP-30; E2E-10; manual checklist |

Every task in every plan names its owner agent (`.claude/agents/`) and the test IDs it must make pass. The loop per task is in `docs/team.md`.
