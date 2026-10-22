# Gullak

Daily-budget app for salaried people in India. Spec: `docs/superpowers/specs/2026-10-23-gullak-v1-design.md`.

## Server

Requirements: Java 21, Docker (for Postgres in tests and locally).

```bash
cd server
./gradlew test            # all tests, Postgres in Testcontainers
```

Run locally:

```bash
docker run -d --name gullak-db -e POSTGRES_DB=gullak -e POSTGRES_USER=gullak \
  -e POSTGRES_PASSWORD=$GULLAK_DB_PASSWORD -p 5432:5432 postgres:17
export GULLAK_JWT_SECRET=$(openssl rand -base64 48)
export GULLAK_OTP_PEPPER=$(openssl rand -base64 48)
./gradlew bootRun --args='--spring.profiles.active=local'
```

Secrets come only from environment variables. Never commit them.

### API so far (Plan 1)

| Method | Path | Notes |
|---|---|---|
| POST | /api/v1/auth/otp/request | `{email}` → 204 |
| POST | /api/v1/auth/otp/verify | `{email, code, device?}` → `{accessToken, refreshToken, expiresIn}` |
| POST | /api/v1/auth/refresh | `{refreshToken}` → new pair; reuse revokes every session |
| POST | /api/v1/auth/logout | `{refreshToken}` → 204 |
| GET, PUT | /api/v1/me/profile | income, savings, payday, personality, message times; GET is 409 `SETUP_INCOMPLETE` until the first PUT |
| GET, POST | /api/v1/me/fixed-costs | list, add |
| PATCH, DELETE | /api/v1/me/fixed-costs/{id} | edit, remove |
| GET | /api/v1/budget/today | `date, budgetPaise, spentPaise, leftPaise, overPaise, poolOverPaise, mood, line, daysLeft, cycleStart, cycleEnd` |

All amounts are paise, sent as JSON numbers (strings are rejected). Request bodies over 64 KB are 413 `TOO_LARGE`. Errors are `{code, message}`; see `server/src/main/java/in/gullak/common/error/ErrorCode.java`.
