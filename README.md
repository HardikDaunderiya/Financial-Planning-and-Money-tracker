# Gullak

Daily-budget app for salaried people in India. Spec: `docs/superpowers/specs/2026-10-23-gullak-v1-design.md`.

## Server

Requirements: Java 21, Docker (for Postgres in tests and locally).

```bash
cd server
./gradlew test            # all tests, Postgres in Testcontainers
```

Run locally (export `GULLAK_DB_PASSWORD` first: both the database container and the `local` profile read it):

```bash
export GULLAK_DB_PASSWORD=$(openssl rand -base64 24)
docker run -d --name gullak-db -e POSTGRES_DB=gullak -e POSTGRES_USER=gullak \
  -e POSTGRES_PASSWORD=$GULLAK_DB_PASSWORD -p 5432:5432 postgres:17
export GULLAK_JWT_SECRET=$(openssl rand -base64 48)
export GULLAK_OTP_PEPPER=$(openssl rand -base64 48)
./gradlew bootRun --args='--spring.profiles.active=local'
```

Secrets come only from environment variables. Never commit them.

### Configuration

Every environment variable the server reads:

| Variable | Used by | Required | Notes |
|---|---|---|---|
| `SPRING_PROFILES_ACTIVE` | all | yes | `prod` in production; on a laptop pass `--spring.profiles.active=local` as below. With no profile there is no mailer and no datasource, so startup fails. |
| `GULLAK_DB_PASSWORD` | `local` profile | local | Password for the `gullak` user on `localhost:5432/gullak`. |
| `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` | `prod` profile | prod | The production Postgres 17 database. Only `local` sets a datasource in YAML. |
| `GULLAK_JWT_SECRET` | all | yes | Signs access tokens (HS256). At least 32 characters, or startup fails. |
| `GULLAK_OTP_PEPPER` | all | yes | HMAC key for stored OTP codes. At least 32 characters, or startup fails. Changing it invalidates codes in flight. |
| `GULLAK_TRUSTED_PROXIES` | all | prod | Regex of the load balancer addresses allowed to set `X-Forwarded-For`. Empty (the default) trusts no proxy, which is right on a laptop. **`prod` refuses to start when it is empty**: behind a load balancer every user would share the balancer's IP, and the per-IP OTP limit would become one cap for the whole app. |

The `prod` profile also needs a real OTP mailer. Until one exists (Plan 8) it fails at startup by design.

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
