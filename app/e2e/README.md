# End-to-end flows (Maestro)

Runs against a development build on an Android emulator (or an iOS simulator) and the local server.

1. Start Postgres and the server with the `local` profile (repo README). The dev OTP endpoint only exists there.
2. In `app/.env` point `EXPO_PUBLIC_API_URL` at the server as the emulator sees it (`http://10.0.2.2:8080/api/v1` on Android).
3. Build and install the app: `npx expo run:android` (or `run:ios`).
4. Install Maestro (`curl -Ls "https://get.maestro.mobile.dev" | bash`) and run:

```bash
cd app && maestro test -e GULLAK_API=http://10.0.2.2:8080/api/v1 e2e/setup.yaml
```

Each run signs up a fresh `e2e-<timestamp>@example.test` user. The flows are not part of CI (they need an emulator); run them before each release and record the result in `docs/reports/`.
