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
