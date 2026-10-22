# Gullak build team

Seven agents build Gullak. Their definitions live in `.claude/agents/`. The orchestrating session (Fable) dispatches them task by task from the implementation plan; every implementation agent runs on Opus.

## Roles

| Agent | Reports to | Does |
|---|---|---|
| `manager` | the founder, through the orchestrating session | Reviews every task's code and reports against the standards, accepts or sends back, keeps `docs/reports/` current, escalates security trade-offs to the founder |
| `product-manager` | manager | Turns a plan task into a brief: user story, acceptance criteria as test IDs from the test-cases doc, screens affected, what is out of scope; checks the finished work against the spec and the mockups |
| `backend-engineer` | manager | Spring Boot: API, budget engine, ingestion, goals, game, jobs |
| `app-engineer` | manager | Expo app for Android and iOS: screens, offline queue, notifications, Gullak animation |
| `web-engineer` | manager | The Expo web build: dashboard, upload, goals and budget settings; web-only security (cookies, CSP, CORS) |
| `qa-engineer` | manager | Writes the tests the engineers did not, runs the full suite and the end-to-end flows, keeps the test-cases doc in step with the code, reports pass and fail by test ID |
| `red-team` | manager | Plays the hostile user: attacks the local build and the UI with everything a malicious or careless person would try, and files findings with severity and reproduction steps |

## The loop for one task

1. `product-manager` writes the brief from the plan task and the spec.
2. The engineer for that layer implements with test-driven development: failing tests first (by the brief's test IDs), then code, then refactor. Hands back a summary: files changed, tests added, test run output, open questions.
3. `qa-engineer` runs everything, adds negative cases the engineer missed, runs end-to-end flows if the task touched a user flow, and reports by test ID.
4. `red-team` runs on every task that touches authentication, sessions, money, uploads, data access, deletion or the web build. It reports findings; a High or Critical finding sends the task back to the engineer before review.
5. `manager` reviews the diff for the standards in `docs/engineering-standards.md` (logging, error handling, security, conventions), checks the QA and red-team reports, and either accepts or sends the task back with a list. Accepted work is merged. The manager writes the task's entry in `docs/reports/YYYY-MM-DD.md`.
6. The orchestrating session moves to the next task.

No step is skipped. A task with a failing test, an unhandled error path or an open red-team finding is not accepted.

## Report format

Every agent ends with the same block so the manager can read reports fast:

```
Task: <plan task id and title>
Result: done | blocked | sent back
Tests: <passing>/<total> (IDs added: ...)
Changed: <files>
Risks: <anything the next person must know>
Questions: <for the manager or founder>
```

The manager's daily report in `docs/reports/` lists tasks done, tasks sent back and why, open red-team findings by severity, and decisions needed from the founder.

## Rules that bind every agent

- Security is never traded for speed. If the brief and the security standard conflict, stop and ask.
- Nothing touches a real bank, a real email account or any host other than the local build and its test containers.
- Money is paise, integers, everywhere.
- No log line ever contains an amount, merchant text, email, UPI handle, token, password or OTP.
- Every error path is handled and tested; empty catch blocks fail the build.
- Spring Boot and React conventions follow the spec (sections 4.3 and 4.4) and the installed skills: `expo-*`, `vercel-react-native-skills`, `vercel-react-best-practices`, `anthropic-skills:secure-engineering`.
