# Plan 2: App foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Expo app (Android, iOS, web) that signs in with an email code, walks a new user through setup (income and payday, fixed costs, savings with the reality check and the "money left until payday" question, personality and message times, notifications) and shows Home with the animated Gullak, fed by the Plan 1 server's `GET /budget/today`.

**Architecture:** One Expo Router app in `app/`. Routes live in `app/app/`; everything else in `app/src/`: `theme/` (tokens copied from `.claude/design.md`), `components/ui/` (primitives that carry the tokens, 44px targets and accessibility labels), `lib/` (the only API client, token storage, money and date formatting, the logger, the error-code map, the query client) and `features/` (one folder per feature with `api.ts`, `hooks.ts`, components and tests). Server state goes through TanStack Query; the only client state is the session and the setup draft. The Gullak is one `<Gullak mood stage />` component drawn with `react-native-svg` and animated with Reanimated on the UI thread, with a still version when Reduce Motion is on. Two small server changes land first: a `local`-profile-only endpoint that returns the last OTP code (the mailer is in-memory), and the pro-rated first cycle with its "money left" override.

**Tech Stack:** Expo SDK (current stable at project start, 56 or newer; Task 1 records the number), Expo Router, TypeScript strict, React Native (New Architecture), react-native-reanimated 4 + react-native-worklets, react-native-gesture-handler, react-native-svg, expo-secure-store, expo-notifications, expo-font, @tanstack/react-query v5 with the async-storage persister, @react-native-community/netinfo, Jest with jest-expo and React Native Testing Library, ESLint (flat config, eslint-config-expo, typescript-eslint type-aware rules), Prettier, Maestro for E2E-01. Server: Spring Boot 4.1.1, Java 21 (Plan 1 conventions).

**Spec:** `docs/superpowers/specs/2026-10-23-gullak-v1-design.md` (sections 2.1, 2.6, 2.7, 3, 4.2, 4.4, 4.7, 4.8, 4.11), with test cases in `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`, visual rules in `.claude/design.md`, prototype findings in `docs/ux-test-findings.md` and engineering rules in `docs/engineering-standards.md`. Read all of them before starting any task. The mockup copy quoted in this plan comes from the design canvas (`canvas.json` title "Gullak V1 Screens") and is verbatim.

## Global Constraints

- TypeScript strict; no `any`; no non-null assertions outside tests; `@/*` maps to `app/src/*`.
- Money is paise as integers (`number`, always whole). The app never does budget arithmetic except the display-only first-cycle preview in `lib/budget.ts`, which mirrors the server formula and is tested against the same numbers (BUD-32). Formatting only through `lib/money.ts` (`₹1,00,000`, Indian grouping, whole rupees) and `lib/dates.ts` (`Fri, 23 Oct`).
- Features never call `fetch`. `src/lib/api.ts` is the only reader of HTTP responses and the only place that knows URLs, tokens and error codes. It produces `ApiError`, `NetworkError` or `UnknownError`; nothing else reaches a screen.
- `console.*` is forbidden outside `src/lib/log.ts` (ESLint). Logs and the reporting sink never carry amounts, merchant text, emails, tokens or codes.
- Every screen that loads data renders loading, error (with Retry) and empty states explicitly. Empty is "resolved with zero items", never "still loading".
- Every tappable control is at least 44×44 and every icon-only control has an `accessibilityLabel`. Selected chips and radio cards show a 2px ink border and `accessibilityState.selected` or `checked`.
- Copy follows `.claude/design.md`: sentence case; a single sentence has no full stop; two or more sentences take a full stop after each; amounts always with ₹ and Indian grouping; dates as `Thu, 23 Oct`; locale `en-IN`.
- Design tokens live only in `src/theme/`. Components import tokens; screens import components. A hex colour, font size or spacing literal outside `src/theme/` fails review.
- Animations run on the UI thread (Reanimated shared values, `useAnimatedStyle`, `useAnimatedProps`); never `setState` per frame; `.get()`/`.set()` not `.value`; `scheduleOnRN` not `runOnJS`. Every animation respects Reduce Motion.
- Tests sit next to the code (`*.test.ts`, `*.test.tsx`). Each task names the test IDs it makes pass; the suite is green before every commit. The server suite (`cd server && ./gradlew test`) must also stay green.
- Server changes follow Plan 1's conventions (JPA, package-private entities, `ErrorCode` append-only, no amounts in logs, every query scoped by the JWT user).
- Each task's owner is named; after the owner hands back, `qa-engineer` runs, then `red-team` where the task says so, then `manager` reviews (`docs/team.md`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Two requests hit a 401 `TOKEN_EXPIRED` at the same moment: exactly one refresh call goes out and both requests retry with the new token. Pinned in Task 4 (`concurrentExpiredRequestsRefreshOnce`).
- An email typed as `" Priya@Example.COM "` signs in, and the code screen shows the same address the code was sent to. Pinned in Task 6 (`emailIsTrimmedAndLowercasedBeforeSending`).
- A code pasted as `"123 456"` or `"123-456"` fills the six boxes with digits only. Pinned in Task 6 (`pastedCodeKeepsDigitsOnly`).
- An income typed as `"₹50,000.75"` becomes 5,000,000 paise (whole rupees, never a float). Pinned in Task 8 (`typedIncomeStripsEverythingButDigits`).
- Home is open when the phone comes back from the background the next morning: the date, greeting and figures refresh. Pinned in Task 10 (`foregroundRefetchesToday`).

## Decisions made in this plan

- **Tab bar:** expo-router's JavaScript `Tabs` with a custom bar, not `NativeTabs`. The centre terracotta + button is a signature trait (`.claude/design.md`) that a native tab bar cannot draw. The + button and Home's "Add first spend" render disabled in this plan and are enabled by Plan 3's first task, which adds the quick-add route.
- **Fonts:** loaded with `useFonts` behind the existing hydration gate, not the `expo-font` config plugin, so one family name (`DMSans-400`, `Bricolage-700`) works on iOS, Android and web.
- **Onboarding header:** a custom `StepHeader` inside the screen ("Step 1 of 4 · Income" with a back chevron), not the native stack header, to match the mockups.
- **Message times:** half-hour chips (06:00–11:00 for morning, 19:00–23:00 for night) instead of native time pickers: fewer choices, works on web, testable.
- **"If I overspend" (Flexible/Strict)** from the savings mockup is a goal mode (spec 2.2) and is built in Plan 5 when the monthly goal exists. Setup step 3 in this plan has the stepper, the verdict, the breakdown and the money-left question.
- **First cycle (spec 2.1, BUD-32):** when a user's very first cycle is created mid-cycle, the server pins that cycle's pool to `monthly spendable × days left ÷ cycle days`, rounded down to whole rupees, in a new `cycles.pool_override_paise` column. `PUT /api/v1/budget/first-cycle {moneyLeftPaise}` replaces it with the user's answer while that cycle is open. A first cycle created on payday itself gets no override (the factor would be 1). While an override is set, income, savings and fixed-cost edits do not change that cycle's pool; the user said what they have. From the second cycle the normal formula applies.
- **Dev OTP:** `POST /api/v1/auth/dev/otp {email}` returns `{code}` and exists only under the `local` Spring profile. It sits under `/api/v1/auth/**` so Plan 1's public matcher covers it. The `test` and `prod` profiles do not register it.
- **Me screen:** this plan ships a minimal Me (email, personality, message times, sign out) because sign-out is needed to test the session; Plan 8 adds the rest.
- **Web sessions:** on web the refresh token stays in memory until Plan 9 adds the cookie session, so a page reload signs out. The access token is never written to `localStorage` (SEC-07).
- **Query cache:** persisted with `@react-native-async-storage/async-storage` on every platform so Home can show "Updated 2 hours ago" offline. Plan 3 adds `expo-sqlite` for the offline spend queue.
- **Local morning and night messages:** scheduled on the phone from the notifications step with static per-personality copy; rescheduled when the times change. Plan 6 adds the report-card deep link; Plan 8 adds per-type switches, quiet hours and server pushes.
- **Test-cases doc updates (Task 11):** E2E-01 no longer names "₹500" (the figure depends on the real date); APP-24 (fixed costs) is assigned to this plan; the roadmap README is corrected.

## File structure

```
app/
  app.config.ts                  Task 1
  package.json, tsconfig.json    Task 1
  eslint.config.js, .prettierrc  Task 1
  jest.config.js, jest.setup.ts  Task 1
  .env.example                   Task 1
  scripts/gen-error-codes.mjs    Task 3
  app/
    _layout.tsx                  Task 6 (providers, hydration gate, protected stacks)
    index.tsx                    Task 6 (redirect by session and profile)
    +not-found.tsx               Task 6
    login.tsx, login-code.tsx    Task 6
    onboarding/_layout.tsx       Task 8
    onboarding/income.tsx        Task 8
    onboarding/fixed-costs.tsx   Task 8
    onboarding/savings.tsx       Task 9
    onboarding/personality.tsx   Task 9
    onboarding/notifications.tsx Task 9
    (tabs)/_layout.tsx           Task 10
    (tabs)/index.tsx             Task 10 (Home)
    (tabs)/insights.tsx          Task 10
    (tabs)/goals.tsx             Task 10
    (tabs)/me.tsx                Task 10
  src/
    theme/colors.ts, spacing.ts, typography.ts, radius.ts, shadows.ts, motion.ts, index.ts   Task 2
    components/ui/text.tsx, screen.tsx, button.tsx, chip.tsx, field.tsx, stepper.tsx,
      progress-bar.tsx, radio-card.tsx, icon.tsx, skeleton.tsx, toast.tsx, empty-state.tsx,
      error-state.tsx, step-header.tsx, ui.test.tsx                                           Task 2
    components/error-boundary.tsx                                                             Task 6
    lib/log.ts, reporting.ts, log.test.ts                                                     Task 3
    lib/error-codes.ts (generated), errors.ts, errors.test.ts                                 Task 3
    lib/money.ts, money.test.ts, dates.ts, dates.test.ts, cycle.ts, cycle.test.ts,
      budget.ts, budget.test.ts                                                               Task 3
    lib/api-errors.ts, api.ts, api.test.ts                                                    Task 4
    lib/storage.ts, storage.web.ts, storage.test.ts, storage.web.test.ts                     Task 4
    lib/client.ts, query.ts, unhandled.ts, unhandled.test.ts                                  Task 4
    lib/notifications.ts, notifications.test.ts                                               Task 9
    features/auth/api.ts, session.tsx, session.test.tsx                                       Task 4
    features/auth/components/email-form.tsx, code-form.tsx, auth-screens.test.tsx             Task 6
    routing.test.tsx (the index redirects; tests never live under app/app/)                   Task 6
    features/gullak/drawing.ts, moods.ts, stage.ts, gullak-still.tsx, gullak.tsx, gullak.test.tsx   Task 7
    features/profile/api.ts, hooks.ts, setup-store.tsx                                        Task 8
    features/profile/components/payday-picker.tsx, fixed-cost-list.tsx, income.test.tsx,
      fixed-costs.test.tsx                                                                    Task 8
    features/profile/components/savings-stepper.tsx, reality-check.tsx, money-left-card.tsx,
      personality-picker.tsx, time-picker.tsx, savings.test.tsx, personality.test.tsx          Task 9
    features/budget/api.ts, hooks.ts                                                          Task 10
    features/home/hero.tsx, today-section.tsx, home-screen.tsx, home.test.tsx                 Task 10
    features/tabs/tab-bar.tsx, tab-bar.test.tsx                                               Task 10
  e2e/setup.yaml, e2e/README.md                                                               Task 11
server/
  src/main/java/in/gullak/auth/DevOtpController.java                                          Task 5
  src/main/java/in/gullak/budget/CurrentCycle.java, FirstCycleRequest.java                    Task 5
  src/main/java/in/gullak/budget/CycleEntity.java, CycleRepository.java, CycleService.java,
    BudgetService.java, BudgetController.java, BudgetInput.java (edited)                      Task 5
  src/main/java/in/gullak/common/error/ErrorCode.java (append FIRST_CYCLE_OVER)               Task 5
  src/main/resources/db/migration/V005__first_cycle_pool.sql                                  Task 5
  src/test/java/in/gullak/auth/DevOtpApiTest.java, budget/FirstCycleApiTest.java,
    support/ApiTest.java (seedCycle, exampleUser edit)                                        Task 5
.github/workflows/ci.yml (app job)                                                            Task 1
README.md (App section)                                                                       Tasks 1, 5, 11
docs/superpowers/plans/README.md, docs/superpowers/specs/...-test-cases.md                    Task 11
```

---

### Task 1: App scaffold, strict tooling, test runner and CI

**Owner:** app-engineer. **Test IDs:** LOG-08 (lint half). **Red team:** no.

**Files:**
- Create: `app/` via `create-expo-app`, then `app/app.config.ts`, `app/tsconfig.json`, `app/eslint.config.js`, `app/.prettierrc`, `app/jest.config.js`, `app/jest.setup.ts`, `app/.env.example`, `app/src/lib/log.ts` (stub, finished in Task 3), `app/src/lib/lint.test.ts`, `app/app/index.tsx` (temporary), `app/app/_layout.tsx` (temporary)
- Modify: `.github/workflows/ci.yml`, `README.md`, `.gitignore`

**Interfaces:**
- Produces: `npm run lint`, `npm run typecheck`, `npm test`, `npm run start`; the `@/*` alias; the ESLint rule set the whole plan relies on; `jest.setup.ts` with Reanimated test setup.

- [ ] **Step 1: Scaffold**

From the repo root:

```bash
npx create-expo-app@latest app --template default
cd app
npx expo install react-native-reanimated react-native-worklets react-native-gesture-handler react-native-svg expo-secure-store expo-notifications expo-font expo-splash-screen expo-haptics @react-native-async-storage/async-storage @react-native-community/netinfo react-native-safe-area-context
npx expo install @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-async-storage-persister
npx expo install @expo-google-fonts/dm-sans @expo-google-fonts/bricolage-grotesque
npx expo install jest jest-expo @testing-library/react-native @types/jest -- --save-dev
npm install --save-dev eslint eslint-config-expo typescript-eslint eslint-plugin-react prettier
```

Record the Expo SDK version from `package.json` (`"expo": "~5X.0.0"`) in `README.md` under "App". If the SDK is older than 56, stop and report (the `expo-router/react-navigation` import and `Stack.Protected` need it).

Delete the template's example screens and components: `app/app/(tabs)`, `app/app/modal.tsx` (if present), `app/components/*`, `app/constants/*`, `app/hooks/*`, `app/scripts/reset-project.js`. Keep `app/assets/`. Create `app/src/` and `app/app/` as the two roots. Remove the `"reset-project"` script from `package.json`.

If `@expo-google-fonts/bricolage-grotesque` does not exist on npm, download `BricolageGrotesque-SemiBold.ttf` and `BricolageGrotesque-Bold.ttf` from Google Fonts into `app/assets/fonts/` and point Task 2's `useFonts` map at those files; record it in the task report.

- [ ] **Step 2: Config files**

`app/app.config.ts`:

```ts
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Gullak",
  slug: "gullak",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "gullak",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  icon: "./assets/images/icon.png",
  splash: { image: "./assets/images/splash-icon.png", backgroundColor: "#FBF6EF", resizeMode: "contain" },
  ios: {
    bundleIdentifier: "in.gullak.app",
    supportsTablet: false,
    infoPlist: { CADisableMinimumFrameDurationOnPhone: true },
  },
  android: {
    package: "in.gullak.app",
    adaptiveIcon: { foregroundImage: "./assets/images/adaptive-icon.png", backgroundColor: "#FBF6EF" },
    edgeToEdgeEnabled: true,
  },
  web: { bundler: "metro", output: "single", favicon: "./assets/images/favicon.png" },
  plugins: ["expo-router", "expo-secure-store", "expo-notifications", "expo-font"],
  experiments: { typedRoutes: true },
};

export default config;
```

Delete `app/app.json` if the template created one (Expo reads `app.config.ts`).

`app/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "types": ["jest"]
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts", "jest.setup.ts"],
  "exclude": ["node_modules", "e2e"]
}
```

`app/eslint.config.js`:

```js
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const tseslint = require("typescript-eslint");
const react = require("eslint-plugin-react");

module.exports = defineConfig([
  expoConfig,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    plugins: { react },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/switch-exhaustiveness-check": ["error", { considerDefaultExhaustiveForUnions: true }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "react/jsx-no-leaked-render": ["error", { validStrategies: ["ternary", "coerce"] }],
    },
  },
  {
    files: ["src/lib/log.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "jest.setup.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    ignores: ["node_modules/", ".expo/", "dist/", "scripts/**/*.mjs"],
  },
]);
```

`app/.prettierrc`:

```json
{ "printWidth": 110, "singleQuote": false, "trailingComma": "all" }
```

`app/jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: "native",
      preset: "jest-expo/ios",
      setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
      testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
      testPathIgnorePatterns: ["\\.web\\.test\\."],
      moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
      transformIgnorePatterns: [
        "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-reanimated|react-native-worklets)/)",
      ],
    },
    {
      displayName: "web",
      preset: "jest-expo/web",
      setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
      testMatch: ["<rootDir>/src/**/*.web.test.ts", "<rootDir>/src/**/*.web.test.tsx"],
      moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
    },
  ],
};
```

`app/jest.setup.ts`:

```ts
import "@testing-library/react-native/extend-expect";

// Reanimated 4 test setup: animations resolve immediately and shared values are plain.
require("react-native-reanimated").setUpTests();

jest.mock("expo-font", () => ({
  ...jest.requireActual("expo-font"),
  useFonts: () => [true, null],
  isLoaded: () => true,
}));

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve(true)),
}));

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@react-native-community/netinfo", () => require("@react-native-community/netinfo/jest/netinfo-mock.js"));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000000" }));

process.env.EXPO_PUBLIC_API_URL = "http://test.local/api/v1";
```

Every file under `app/app/` is a route, so no test file may live there; tests for routes go in `app/src/` and import the route module by relative path.

`app/.env.example`:

```
# Base URL of the Gullak server, including /api/v1.
# Android emulator: http://10.0.2.2:8080/api/v1   iOS simulator and web: http://localhost:8080/api/v1
# A phone on the same Wi-Fi: http://<your laptop IP>:8080/api/v1
EXPO_PUBLIC_API_URL=http://localhost:8080/api/v1
```

Add to the repo-root `.gitignore`:

```
app/.env
app/.env.*.local
app/.expo/
app/dist/
app/node_modules/
```

`package.json` scripts (replace the template's):

```json
"scripts": {
  "start": "expo start",
  "android": "expo run:android",
  "ios": "expo run:ios",
  "web": "expo start --web",
  "lint": "eslint . --max-warnings 0",
  "format": "prettier --check .",
  "typecheck": "tsc --noEmit",
  "test": "jest",
  "gen:errors": "node scripts/gen-error-codes.mjs"
}
```

- [ ] **Step 3: Temporary routes and the logger stub**

`app/app/_layout.tsx` (replaced in Task 6):

```tsx
import { Stack } from "expo-router/stack";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`app/app/index.tsx` (replaced in Task 6):

```tsx
import { Text, View } from "react-native";

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FBF6EF" }}>
      <Text>Gullak</Text>
    </View>
  );
}
```

`app/src/lib/log.ts` (finished in Task 3; this stub exists so the lint override has a file to point at):

```ts
/* The only module allowed to call console. Task 3 replaces this with the real logger. */
export const log = {
  debug(message: string, data?: Record<string, unknown>): void {
    console.debug(message, data);
  },
};
```

- [ ] **Step 4: Write the failing lint test (LOG-08, lint half)**

`app/src/lib/lint.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { ESLint } from "eslint";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

async function lint(filePath: string, code: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "");
}

describe("lint rules the whole app relies on (LOG-08)", () => {
  it("rejects console.log outside src/lib/log.ts", async () => {
    const rules = await lint(path.join(root, "src/features/x/thing.ts"), 'console.log("x");\nexport {};\n');
    expect(rules).toContain("no-console");
  });

  it("allows console inside src/lib/log.ts", async () => {
    const rules = await lint(path.join(root, "src/lib/log.ts"), 'console.log("x");\nexport {};\n');
    expect(rules).not.toContain("no-console");
  });

  it("rejects any", async () => {
    const rules = await lint(path.join(root, "src/features/x/thing.ts"), "export const a: any = 1;\n");
    expect(rules).toContain("@typescript-eslint/no-explicit-any");
  });

  it("rejects a floating promise", async () => {
    const rules = await lint(
      path.join(root, "src/features/x/thing.ts"),
      "async function f(): Promise<void> {}\nf();\nexport {};\n",
    );
    expect(rules).toContain("@typescript-eslint/no-floating-promises");
  });

  it("rejects a non-exhaustive switch on a union", async () => {
    const rules = await lint(
      path.join(root, "src/features/x/thing.ts"),
      'type C = "A" | "B";\nexport function f(c: C): number {\n  switch (c) {\n    case "A":\n      return 1;\n  }\n  return 0;\n}\n',
    );
    expect(rules).toContain("@typescript-eslint/switch-exhaustiveness-check");
  });
});
```

Type-aware linting of virtual files needs them to be inside the project service's scope: `lintText` with a `filePath` under `src/` is enough because `projectService: true` resolves the nearest `tsconfig.json`. If the project service refuses virtual files ("file was not found by the project service"), add to `eslint.config.js` `parserOptions.projectService: { allowDefaultProject: ["src/features/x/*.ts"] }` and keep the fixture paths as written.

- [ ] **Step 5: Run to see it fail**

Run: `cd app && npx jest src/lib/lint.test.ts`
Expected: FAIL (the config or the rules are missing until Step 2's config is in place; if Step 2 is already done, the test passes and that is fine. The point of the test is to keep these rules from being removed later).

- [ ] **Step 6: Run everything**

Run: `cd app && npm run typecheck && npm run lint && npm test && npm run format`
Expected: all PASS. Then `npx expo start --web` once and confirm "Gullak" renders at `http://localhost:8081`; stop it.

- [ ] **Step 7: CI**

Append to `.github/workflows/ci.yml`:

```yaml
  app:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: app
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run format
      - run: npm test -- --ci
```

Add to `README.md` an "App" section:

````markdown
## App

Expo SDK <version> (Expo Router, TypeScript strict). Requirements: Node 22, and for phones the Expo Go app or a development build.

```bash
cd app
cp .env.example .env        # point EXPO_PUBLIC_API_URL at the server
npm install
npm run start               # press a for Android, i for iOS, w for web
npm test                    # Jest + React Native Testing Library
npm run lint && npm run typecheck
```

The server must be running with the `local` profile (above). Sign-in codes in local development come from `POST /api/v1/auth/dev/otp` (Plan 2, Task 5), which only exists under that profile.
````

- [ ] **Step 8: Commit**

```bash
git add app .github/workflows/ci.yml README.md .gitignore
git commit -m "feat(app): Expo scaffold with strict TypeScript, lint rules, Jest and CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Theme tokens and UI primitives

**Owner:** app-engineer. **Test IDs:** APP-29, APP-28 (toast). **Red team:** no.

**Files:**
- Create: `app/src/theme/colors.ts`, `spacing.ts`, `typography.ts`, `radius.ts`, `shadows.ts`, `motion.ts`, `index.ts`
- Create: `app/src/components/ui/text.tsx`, `screen.tsx`, `button.tsx`, `chip.tsx`, `field.tsx`, `stepper.tsx`, `progress-bar.tsx`, `radio-card.tsx`, `icon.tsx`, `skeleton.tsx`, `toast.tsx`, `empty-state.tsx`, `error-state.tsx`, `step-header.tsx`
- Test: `app/src/components/ui/ui.test.tsx`

**Interfaces:**
- Produces: `colors`, `spacing`, `type`, `fonts`, `radius`, `shadows`, `motion` from `@/theme`; the primitives above with the props shown in their code. Every later screen composes these and nothing else.

- [ ] **Step 1: Tokens**

`app/src/theme/colors.ts` (every value from `.claude/design.md`):

```ts
export const colors = {
  ground: "#FBF6EF",
  surface: "#FFFFFF",
  ink: "#2A1F1A",
  muted: "#6E5E54",
  line: "#EADFD3",
  control: "#9C8A7A",
  accent: "#B94A22",
  accentTint: "#F6E3D7",
  accentDeep: "#8E3515",
  sand: "#EFE5D9",
  good: "#2F7D4F",
  goodDeep: "#1F5E38",
  goodTint: "#E4F1E8",
  warnInk: "#7A4A00",
  warnTint: "#FBEFD9",
  bad: "#B3261E",
  badTint: "#FBE4E2",
  gold: "#E0A02F",
  ice: "#E6F0F7",
  iceInk: "#24506E",
  dark: "#2A1F1A",
  darkRaised: "#3D2E26",
  darkText: "#FBF6EF",
  darkMuted: "#D9C9B8",
  darkControl: "#8C7A6E",
  xpTrack: "#4A3A31",
  flame: "#C77700",
  stack1: "#F6EDE3",
  stack2: "#EFE5D9",
  onAccent: "#FFFFFF",
} as const;

export type ColorName = keyof typeof colors;
```

`app/src/theme/spacing.ts`:

```ts
/** 8-point scale; 4 is the half step and 12 is allowed inside compact rows (design.md). */
export const spacing = { xs: 4, sm: 8, cm: 12, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

/** Minimum touch target on every platform. */
export const touchTarget = 44;
```

`app/src/theme/typography.ts`:

```ts
import type { TextStyle } from "react-native";
import { colors } from "./colors";

/** Family names registered by useFonts in the root layout; the same on iOS, Android and web. */
export const fonts = {
  ui400: "DMSans-400",
  ui500: "DMSans-500",
  ui700: "DMSans-700",
  head600: "Bricolage-600",
  head700: "Bricolage-700",
} as const;

export const type = {
  caption: { fontFamily: fonts.ui400, fontSize: 12, lineHeight: 16, color: colors.muted },
  label: { fontFamily: fonts.ui500, fontSize: 14, lineHeight: 20, color: colors.ink },
  labelMuted: { fontFamily: fonts.ui500, fontSize: 14, lineHeight: 20, color: colors.muted },
  body: { fontFamily: fonts.ui400, fontSize: 16, lineHeight: 24, color: colors.ink },
  bodyMuted: { fontFamily: fonts.ui400, fontSize: 16, lineHeight: 24, color: colors.muted },
  bodyStrong: { fontFamily: fonts.ui700, fontSize: 16, lineHeight: 24, color: colors.ink },
  title: { fontFamily: fonts.head600, fontSize: 20, lineHeight: 26, color: colors.ink },
  amount: { fontFamily: fonts.head700, fontSize: 24, lineHeight: 30, color: colors.ink },
  heading: { fontFamily: fonts.head700, fontSize: 28, lineHeight: 34, color: colors.ink },
  hero: { fontFamily: fonts.head700, fontSize: 44, lineHeight: 50, color: colors.ink },
  display: { fontFamily: fonts.head700, fontSize: 72, lineHeight: 78, color: colors.ink },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;
```

`app/src/theme/radius.ts`:

```ts
export const radius = { sm: 8, md: 12, lg: 16, card: 24, full: 9999 } as const;
```

`app/src/theme/shadows.ts`:

```ts
/** CSS box-shadow strings (never legacy shadow props). Cards use a line border, not a shadow. */
export const shadows = {
  none: "none",
  addButton: "0 6px 16px rgba(185, 74, 34, 0.35)",
  toast: "0 8px 24px rgba(42, 31, 26, 0.18)",
} as const;
```

`app/src/theme/motion.ts`:

```ts
export const motion = {
  fast: 150, // press, toggle
  base: 250, // enter, exit
  slow: 400, // sheets, screens
  gullakIdle: 2400, // one bounce cycle
  undoWindow: 5000, // "Undo" stays for 5 seconds
} as const;
```

`app/src/theme/index.ts`:

```ts
export { colors } from "./colors";
export type { ColorName } from "./colors";
export { spacing, touchTarget } from "./spacing";
export { type, fonts } from "./typography";
export type { TypeVariant } from "./typography";
export { radius } from "./radius";
export { shadows } from "./shadows";
export { motion } from "./motion";
```

- [ ] **Step 2: Write the failing primitive tests (APP-29, APP-28)**

`app/src/components/ui/ui.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Button } from "./button";
import { Chip } from "./chip";
import { Field } from "./field";
import { Icon } from "./icon";
import { ProgressBar } from "./progress-bar";
import { RadioCard } from "./radio-card";
import { Stepper } from "./stepper";
import { Toast } from "./toast";
import { ErrorState } from "./error-state";
import { touchTarget } from "@/theme";

function minHeightOf(node: { props: { style?: unknown } }): number {
  const flat = Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as { minHeight?: number };
  return flat.minHeight ?? 0;
}

describe("UI primitives (APP-29)", () => {
  it("Button is at least 44px tall, has the button role and the title as its label", () => {
    render(<Button title="Continue" onPress={() => {}} />);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(minHeightOf(button)).toBeGreaterThanOrEqual(touchTarget);
  });

  it("Button disabled state is exposed and blocks presses", () => {
    const onPress = jest.fn();
    render(<Button title="Continue" onPress={onPress} disabled />);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("Button loading keeps the label for screen readers and reports busy", () => {
    render(<Button title="Sending" onPress={() => {}} loading />);
    const button = screen.getByRole("button", { name: "Sending" });
    expect(button).toHaveAccessibilityState({ busy: true, disabled: true });
  });

  it("Chip exposes selected state", () => {
    render(<Chip label="Food delivery" selected onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Food delivery" })).toHaveAccessibilityState({ selected: true });
  });

  it("RadioCard is a radio with checked state and a 44px target", () => {
    render(<RadioCard title="1st of the month" checked onPress={() => {}} />);
    const radio = screen.getByRole("radio", { name: "1st of the month" });
    expect(radio).toHaveAccessibilityState({ checked: true });
    expect(minHeightOf(radio)).toBeGreaterThanOrEqual(touchTarget);
  });

  it("Icon-only controls carry a label: Stepper minus and plus", () => {
    render(<Stepper label="Save every month" valuePaise={2000000} stepPaise={100000} min={0} max={3500000} onChange={() => {}} />);
    expect(screen.getByLabelText("Save ₹1,000 less")).toBeTruthy();
    expect(screen.getByLabelText("Save ₹1,000 more")).toBeTruthy();
  });

  it("Icon is hidden from assistive tech by default", () => {
    render(<Icon name="home" />);
    expect(screen.getByTestId("icon-home")).toHaveProp("accessibilityElementsHidden", true);
  });

  it("Field links its label and shows an error", () => {
    render(<Field label="Take-home pay per month" value="" onChangeText={() => {}} error="Enter your salary" />);
    expect(screen.getByLabelText("Take-home pay per month")).toBeTruthy();
    expect(screen.getByText("Enter your salary")).toBeTruthy();
  });

  it("ProgressBar exposes its value", () => {
    render(<ProgressBar value={30} label="Budget used" />);
    expect(screen.getByRole("progressbar", { name: "Budget used" })).toHaveAccessibilityValue({ now: 30, min: 0, max: 100 });
  });

  it("ErrorState has a Retry button", () => {
    const onRetry = jest.fn();
    render(<ErrorState onRetry={onRetry} />);
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("Toast (APP-28)", () => {
  it("renders a message and never an action", () => {
    render(<Toast message="Could not refresh. Showing saved data." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh. Showing saved data.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `cd app && npx jest src/components/ui`
Expected: FAIL with "Cannot find module './button'" (and the others).

- [ ] **Step 4: Write the primitives**

`app/src/components/ui/text.tsx`:

```tsx
import React from "react";
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";
import { type, type TypeVariant } from "@/theme";

export type TextProps = RNTextProps & { variant?: TypeVariant; color?: TextStyle["color"]; align?: TextStyle["textAlign"] };

export function Text({ variant = "body", color, align, style, ...props }: TextProps) {
  return <RNText style={[type[variant], color ? { color } : null, align ? { textAlign: align } : null, style]} {...props} />;
}
```

`app/src/components/ui/screen.tsx`:

```tsx
import React from "react";
import { ScrollView, View, type ScrollViewProps, type ViewStyle, type StyleProp } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";

type Props = {
  children: React.ReactNode;
  /** Content pinned below the scroll area (a primary button). It never sits under the keyboard because the scroll area shrinks. */
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  scrollProps?: Omit<ScrollViewProps, "children">;
  testID?: string;
};

/** The base of every screen: ground background, safe areas, 16px gutters, 16px rhythm. */
export function Screen({ children, footer, contentStyle, scrollProps, testID }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }} testID={testID}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          { paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.md },
          contentStyle,
        ]}
        {...scrollProps}
      >
        {children}
      </ScrollView>
      {footer ? (
        <View
          style={{
            paddingHorizontal: spacing.md,
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing.md,
            gap: spacing.sm,
            backgroundColor: colors.ground,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
```

`app/src/components/ui/button.tsx`:

```tsx
import React from "react";
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, spacing, touchTarget } from "@/theme";
import { Text } from "./text";

const variants = {
  primary: { background: colors.accent, border: colors.accent, text: colors.onAccent },
  secondary: { background: colors.surface, border: colors.control, text: colors.ink },
  ghost: { background: "transparent", border: "transparent", text: colors.ink },
  danger: { background: colors.badTint, border: colors.badTint, text: colors.bad },
} as const;

export type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: keyof typeof variants;
  disabled?: boolean;
  loading?: boolean;
  /** Icon-only buttons pass `icon` and keep `title` as the accessibility label. */
  icon?: React.ReactNode;
  iconOnly?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Button({ title, onPress, variant = "primary", disabled, loading, icon, iconOnly, style, testID }: ButtonProps) {
  const v = variants[variant];
  const off = !!disabled || !!loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      testID={testID}
      hitSlop={iconOnly ? 6 : undefined}
      pressRetentionOffset={8}
      style={({ pressed }) => [
        {
          minHeight: touchTarget,
          minWidth: iconOnly ? touchTarget : undefined,
          paddingHorizontal: iconOnly ? 0 : spacing.lg,
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: v.border,
          backgroundColor: v.background,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: spacing.sm,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {icon ?? null}
          {iconOnly ? null : (
            <Text variant="bodyStrong" color={v.text}>
              {title}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}
```

`app/src/components/ui/chip.tsx`:

```tsx
import React from "react";
import { Pressable } from "react-native";
import { colors, radius, spacing, touchTarget } from "@/theme";
import { Text } from "./text";

export type ChipProps = { label: string; selected?: boolean; onPress: () => void; icon?: React.ReactNode; testID?: string };

/** A selectable pill. Selected: 2px ink border (design.md). */
export function Chip({ label, selected = false, onPress, icon, testID }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: touchTarget,
        paddingHorizontal: spacing.md,
        borderRadius: radius.full,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.ink : colors.control,
        backgroundColor: selected ? colors.surface : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon ?? null}
      <Text variant={selected ? "bodyStrong" : "body"}>{label}</Text>
    </Pressable>
  );
}
```

`app/src/components/ui/field.tsx`:

```tsx
import React, { useId } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { colors, fonts, radius, spacing, touchTarget } from "@/theme";
import { Text } from "./text";

export type FieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  hint?: string;
  error?: string;
  /** A fixed prefix such as ₹, drawn inside the box. */
  prefix?: string;
  large?: boolean;
};

export function Field({ label, hint, error, prefix, large, ...input }: FieldProps) {
  const id = useId();
  const border = error ? colors.bad : colors.control;
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="label" nativeID={`${id}-label`}>
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: large ? 64 : touchTarget + 4,
          borderWidth: 1,
          borderColor: border,
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.md,
          gap: spacing.sm,
        }}
      >
        {prefix ? (
          <Text variant={large ? "hero" : "body"} color={colors.muted}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          accessibilityLabelledBy={`${id}-label`}
          placeholderTextColor={colors.control}
          style={{
            flex: 1,
            fontFamily: large ? fonts.head700 : fonts.ui400,
            fontSize: large ? 44 : 16,
            color: colors.ink,
            paddingVertical: spacing.sm,
          }}
          {...input}
        />
      </View>
      {error ? (
        <Text variant="caption" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
}
```

`app/src/components/ui/stepper.tsx` (typed values arrive in Task 9's `SavingsStepper`, which wraps this):

```tsx
import React from "react";
import { Pressable, View } from "react-native";
import { colors, radius, spacing, touchTarget } from "@/theme";
import { formatRupees } from "@/lib/money";
import { Icon } from "./icon";
import { Text } from "./text";

export type StepperProps = {
  label: string;
  valuePaise: number;
  stepPaise: number;
  min: number;
  max: number;
  onChange: (paise: number) => void;
  /** Tapping the number; Task 9 uses it to open a typed input. */
  onPressValue?: () => void;
  testID?: string;
};

export function Stepper({ label, valuePaise, stepPaise, min, max, onChange, onPressValue, testID }: StepperProps) {
  const step = formatRupees(stepPaise);
  const canLess = valuePaise - stepPaise >= min;
  const canMore = valuePaise + stepPaise <= max;
  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      <Text variant="label">{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
        <RoundButton label={`Save ${step} less`} icon="minus" disabled={!canLess} onPress={() => onChange(Math.max(min, valuePaise - stepPaise))} />
        <Pressable
          accessibilityRole={onPressValue ? "button" : "text"}
          accessibilityLabel={onPressValue ? `${label}, ${formatRupees(valuePaise)}, tap to type an amount` : undefined}
          onPress={onPressValue}
          disabled={!onPressValue}
          style={{ minHeight: touchTarget, justifyContent: "center" }}
        >
          <Text variant="hero" align="center" style={{ fontVariant: ["tabular-nums"] }}>
            {formatRupees(valuePaise)}
          </Text>
        </Pressable>
        <RoundButton label={`Save ${step} more`} icon="plus" disabled={!canMore} onPress={() => onChange(Math.min(max, valuePaise + stepPaise))} />
      </View>
    </View>
  );
}

function RoundButton({ label, icon, disabled, onPress }: { label: string; icon: "plus" | "minus"; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 56,
        height: 56,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: colors.control,
        backgroundColor: colors.surface,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      <Icon name={icon} size={24} />
    </Pressable>
  );
}
```

`app/src/components/ui/progress-bar.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { colors, radius } from "@/theme";

export type ProgressBarProps = { value: number; label: string; tone?: "ink" | "good" | "warn" | "bad"; height?: number };

/** A single-colour bar. value is 0..100; anything above 100 fills the bar. */
export function ProgressBar({ value, label, tone = "ink", height = 8 }: ProgressBarProps) {
  const fill = { ink: colors.muted, good: colors.good, warn: colors.warnInk, bad: colors.bad }[tone];
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ now: clamped, min: 0, max: 100 }}
      style={{ height, borderRadius: radius.full, backgroundColor: colors.sand, overflow: "hidden" }}
    >
      <View style={{ width: `${clamped}%`, height: "100%", backgroundColor: fill, borderRadius: radius.full }} />
    </View>
  );
}
```

`app/src/components/ui/radio-card.tsx`:

```tsx
import React from "react";
import { Pressable, View } from "react-native";
import { colors, radius, spacing, touchTarget } from "@/theme";
import { Text } from "./text";

export type RadioCardProps = {
  title: string;
  description?: string;
  checked: boolean;
  onPress: () => void;
  /** Extra content under the title (a sample line, a cycle line). */
  children?: React.ReactNode;
  testID?: string;
};

/** The selected-card pattern from the setup mockups: 1px control border, 2px ink border when checked. */
export function RadioCard({ title, description, checked, onPress, children, testID }: RadioCardProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ checked }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: touchTarget + 12,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: checked ? 2 : 1,
        borderColor: checked ? colors.ink : colors.control,
        backgroundColor: checked ? colors.surface : "transparent",
        gap: spacing.xs,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm }}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: radius.full,
            borderWidth: checked ? 6 : 2,
            borderColor: checked ? colors.ink : colors.control,
            backgroundColor: colors.surface,
          }}
        />
        <Text variant={checked ? "bodyStrong" : "body"}>{title}</Text>
      </View>
      {description ? <Text variant="labelMuted">{description}</Text> : null}
      {children}
    </Pressable>
  );
}
```

`app/src/components/ui/icon.tsx` (the 28 paths of the mockup's Icon component plus `minus`):

```tsx
import React from "react";
import Svg, { Path } from "react-native-svg";
import { colors } from "@/theme";

const paths = {
  home: "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6",
  chart: "M4 20V11M10 20V5M16 20v-6M2 20h20",
  target: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2",
  user: "M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8M4 21c1-4 4-6 8-6s7 2 8 6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  flame: "M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7c1 2 2 3 3 3c0-2 0-4 0-7z",
  food: "M3 12h18M4 12a8 8 0 0 0 16 0M9 8c0-2 2-2 2-4M14 8c0-2 2-2 2-4",
  cart: "M3 4h2l2 11h11l2-8H6M9 20h.01M17 20h.01",
  bag: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  coffee: "M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3",
  tv: "M3 7h18v12H3zM8 3l4 4 4-4",
  people: "M9 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6M3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 1 3 3 3 5",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v4h16v-4",
  check: "M5 12l5 5 9-10",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  up: "M12 19V5M5 12l7-7 7 7",
  alert: "M12 3l10 18H2zM12 10v4M12 17.5v.5",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a4 4 0 0 0 3 4M17 6h3v1a4 4 0 0 1-3 4M12 14v4M8 21h8",
  moon: "M20 14a8 8 0 1 1-10-10a6 6 0 0 0 10 10z",
  car: "M5 16v-5l2-5h10l2 5v5zM5 16v2M19 16v2M8 13h.01M16 13h.01",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  x: "M6 6l12 12M18 6L6 18",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
  backspace: "M9 6h11v12H9l-6-6zM12 9l5 6M17 9l-5 6",
  share: "M12 15V3M7 8l5-5 5 5M5 12v8h14v-8",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5l-1.5-1.5M19 19l1.5 1.5M5 19l-1.5 1.5M19 5l1.5-1.5M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8",
} as const;

export type IconName = keyof typeof paths;

export type IconProps = { name: IconName; size?: number; color?: string; strokeWidth?: number; label?: string };

/** Decorative by default; pass `label` only when the icon is the sole content of a control. */
export function Icon({ name, size = 24, color = colors.ink, strokeWidth = 2, label }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      testID={`icon-${name}`}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? "auto" : "no-hide-descendants"}
      accessibilityLabel={label}
    >
      <Path d={paths[name]} />
    </Svg>
  );
}
```

`app/src/components/ui/skeleton.tsx`:

```tsx
import React from "react";
import { View, type DimensionValue } from "react-native";
import { colors, radius } from "@/theme";

/** A static placeholder block (no shimmer: it would animate on every load, which fails the motion gate). */
export function Skeleton({ width = "100%", height = 16, round = false }: { width?: DimensionValue; height?: number; round?: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: round ? radius.full : radius.sm, backgroundColor: colors.sand }}
    />
  );
}
```

`app/src/components/ui/toast.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { colors, radius, shadows, spacing } from "@/theme";
import { Text } from "./text";

/** A passive notice. It never carries an action (APP-28): anything that needs a decision renders inline. */
export function Toast({ message, tone = "ink" }: { message: string; tone?: "ink" | "bad" }) {
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: tone === "bad" ? colors.badTint : colors.dark,
        paddingVertical: spacing.cm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        borderCurve: "continuous",
        boxShadow: shadows.toast,
      }}
    >
      <Text variant="label" color={tone === "bad" ? colors.bad : colors.darkText}>
        {message}
      </Text>
    </View>
  );
}
```

`app/src/components/ui/empty-state.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import { Text } from "./text";

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View
      style={{
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        gap: spacing.sm,
        alignItems: "center",
      }}
    >
      <Text variant="bodyStrong" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="bodyMuted" align="center">
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ alignSelf: "stretch", paddingTop: spacing.sm }}>{action}</View> : null}
    </View>
  );
}
```

`app/src/components/ui/error-state.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import { Button } from "./button";
import { Text } from "./text";

export function ErrorState({ title = "Something went wrong", body, onRetry }: { title?: string; body?: string; onRetry: () => void }) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: colors.badTint,
        gap: spacing.sm,
        alignItems: "center",
      }}
    >
      <Text variant="bodyStrong" color={colors.bad} align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" align="center">
          {body}
        </Text>
      ) : null}
      <Button title="Retry" variant="secondary" onPress={onRetry} style={{ alignSelf: "stretch", marginTop: spacing.sm }} />
    </View>
  );
}
```

`app/src/components/ui/step-header.tsx`:

```tsx
import React from "react";
import { Pressable, View } from "react-native";
import { colors, spacing, touchTarget } from "@/theme";
import { Icon } from "./icon";
import { Text } from "./text";

export function StepHeader({ step, total, name, onBack }: { step: number; total: number; name: string; onBack?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touchTarget }}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={8} style={{ width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center" }}>
          <Icon name="left" />
        </Pressable>
      ) : null}
      <Text variant="labelMuted" accessibilityRole="header">
        {`Step ${step} of ${total} · ${name}`}
      </Text>
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: "row", gap: spacing.xs }} accessibilityElementsHidden>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={{ width: 24, height: 3, borderRadius: 2, backgroundColor: i < step ? colors.ink : colors.line }} />
        ))}
      </View>
    </View>
  );
}
```

`Stepper` imports `formatRupees` from `@/lib/money`, which Task 3 writes. For this task's tests to run, create the minimal `app/src/lib/money.ts` now; Task 3 completes it and adds the tests:

```ts
const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Whole rupees with Indian grouping: 10000000 paise → "₹1,00,000". Paise are dropped, never rounded up. */
export function formatRupees(paise: number): string {
  const whole = Math.trunc(Math.abs(paise) / 100);
  return `${paise < 0 ? "−" : ""}₹${rupees.format(whole)}`;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd app && npx jest src/components/ui && npm run lint && npm run typecheck`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add app/src/theme app/src/components/ui app/src/lib/money.ts
git commit -m "feat(app): design tokens and accessible UI primitives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Logger, reporting sink, error codes, money, dates, cycles and the first-cycle preview

**Owner:** app-engineer. **Test IDs:** APP-01, APP-02, LOG-08 (production half), LOG-09, ERR-16, BUD-32 (client preview), APP-25 (cycle maths half). **Red team:** no.

**Files:**
- Create: `app/scripts/gen-error-codes.mjs`, `app/src/lib/error-codes.ts` (generated), `app/src/lib/errors.ts`, `app/src/lib/errors.test.ts`, `app/src/lib/log.ts` (replace the stub), `app/src/lib/reporting.ts`, `app/src/lib/log.test.ts`, `app/src/lib/money.ts` (complete), `app/src/lib/money.test.ts`, `app/src/lib/dates.ts`, `app/src/lib/dates.test.ts`, `app/src/lib/cycle.ts`, `app/src/lib/cycle.test.ts`, `app/src/lib/budget.ts`, `app/src/lib/budget.test.ts`
- Modify: `app/package.json` (the `gen:errors` script exists; add `"pretest": "node scripts/gen-error-codes.mjs --check"`), `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `ErrorCode` union and `ERROR_CODES` set; `messageFor(code)`; `log.debug|info|warn|error(event, data?)`; `reporting` sink interface with `setSink`; `formatRupees`, `parseRupeesToPaise`; `formatDay`, `formatDayLong`, `relativeTime`, `greeting`, `todayIst`; `PaydayRule`, `cycleContaining`, `payday`, `cycleLine`; `firstCyclePreview`.

- [ ] **Step 1: The error-code generator**

`app/scripts/gen-error-codes.mjs`:

```js
// Generates src/lib/error-codes.ts from the server's ErrorCode enum so the two cannot drift.
// `--check` exits 1 when the generated file is stale (used by pretest and CI).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const enumFile = path.resolve(here, "../../server/src/main/java/in/gullak/common/error/ErrorCode.java");
const outFile = path.resolve(here, "../src/lib/error-codes.ts");

const java = readFileSync(enumFile, "utf8");
const body = java.slice(java.indexOf("{") + 1, java.indexOf(";"));
const codes = [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*\(/gm)].map((m) => m[1]);
if (codes.length === 0) throw new Error("No codes found in " + enumFile);

const generated =
  "// Generated by scripts/gen-error-codes.mjs from server/src/main/java/in/gullak/common/error/ErrorCode.java. Do not edit.\n" +
  "export const ERROR_CODES = [\n" +
  codes.map((c) => `  "${c}",`).join("\n") +
  "\n] as const;\n\n" +
  "export type ErrorCode = (typeof ERROR_CODES)[number];\n\n" +
  "export function isErrorCode(value: unknown): value is ErrorCode {\n" +
  "  return typeof value === \"string\" && (ERROR_CODES as readonly string[]).includes(value);\n" +
  "}\n";

if (process.argv.includes("--check")) {
  const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
  if (current !== generated) {
    console.error("src/lib/error-codes.ts is stale. Run: npm run gen:errors");
    process.exit(1);
  }
} else {
  writeFileSync(outFile, generated);
  console.log(`Wrote ${codes.length} codes to ${path.relative(process.cwd(), outFile)}`);
}
```

Run `cd app && npm run gen:errors`. Add `"pretest": "node scripts/gen-error-codes.mjs --check"` to `package.json` scripts and add `- run: npm run gen:errors -- --check` to the app CI job before the tests.

- [ ] **Step 2: Write the failing tests**

`app/src/lib/money.test.ts` (APP-01):

```ts
import { formatRupees, parseRupeesToPaise } from "./money";

describe("formatRupees (APP-01)", () => {
  it.each([
    [100000, "₹1,000"],
    [10000000, "₹1,00,000"],
    [0, "₹0"],
    [59333, "₹593"],
    [99, "₹0"],
    [-40050, "−₹400"],
    [1234567800, "₹1,23,45,678"],
  ])("%i paise → %s", (paise, text) => {
    expect(formatRupees(paise)).toBe(text);
  });
});

describe("parseRupeesToPaise", () => {
  it.each([
    ["50000", 5000000],
    ["₹50,000", 5000000],
    ["50,000.75", 5000000],
    ["  1 000 ", 100000],
    ["", 0],
    ["abc", 0],
    ["99999999", 9999999_00],
  ])("%s → %i", (text, paise) => {
    expect(parseRupeesToPaise(text)).toBe(paise);
  });

  it("caps at 7 digits of rupees", () => {
    expect(parseRupeesToPaise("123456789")).toBe(1234567_00);
  });
});
```

`app/src/lib/dates.test.ts` (APP-02):

```ts
import { formatDay, formatDayLong, greeting, relativeTime, todayIst } from "./dates";

describe("dates (APP-02)", () => {
  it("formats a date as Fri, 23 Oct", () => {
    expect(formatDay("2026-10-23")).toBe("Fri, 23 Oct");
    expect(formatDay("2026-11-01")).toBe("Sun, 1 Nov");
  });

  it("formats a long date with the year", () => {
    expect(formatDayLong("2026-10-23")).toBe("Fri, 23 Oct 2026");
  });

  it("gives today in Asia/Kolkata whatever the device zone", () => {
    expect(todayIst(new Date("2026-10-23T19:00:00Z"))).toBe("2026-10-24");
    expect(todayIst(new Date("2026-10-23T18:29:59Z"))).toBe("2026-10-23");
  });

  it("greets by the hour in IST", () => {
    expect(greeting(new Date("2026-10-23T03:30:00Z"))).toBe("Good morning"); // 09:00 IST
    expect(greeting(new Date("2026-10-23T08:00:00Z"))).toBe("Good afternoon"); // 13:30 IST
    expect(greeting(new Date("2026-10-23T14:00:00Z"))).toBe("Good evening"); // 19:30 IST
  });

  it("describes how old a timestamp is", () => {
    const now = new Date("2026-10-23T10:00:00Z").getTime();
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2 hours ago");
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe("yesterday");
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3 days ago");
  });
});
```

`app/src/lib/cycle.test.ts` (BUD-01 to BUD-05 mirrored for the client copy, and the APP-25 cycle line):

```ts
import { cycleContaining, cycleLine, payday } from "./cycle";

describe("cycle maths (client copy of the server rules)", () => {
  it("BUD-01 fixed payday 1, Oct 2026", () => {
    expect(cycleContaining("2026-10-23", { rule: "FIXED_DAY", day: 1 })).toEqual({ start: "2026-10-01", end: "2026-10-31", days: 31 });
  });

  it("BUD-02 mid-month payday", () => {
    expect(cycleContaining("2026-11-20", { rule: "FIXED_DAY", day: 15 })).toEqual({ start: "2026-11-15", end: "2026-12-14", days: 30 });
  });

  it("BUD-03 February", () => {
    expect(cycleContaining("2027-02-10", { rule: "FIXED_DAY", day: 1 })).toEqual({ start: "2027-02-01", end: "2027-02-28", days: 28 });
  });

  it("BUD-04 last working day on a weekend", () => {
    expect(payday("2026-10", { rule: "LAST_WORKING_DAY" })).toBe("2026-10-30");
    expect(cycleContaining("2026-11-10", { rule: "LAST_WORKING_DAY" })).toEqual({ start: "2026-10-30", end: "2026-11-29", days: 31 });
  });

  it("BUD-05 last working day on a weekday", () => {
    expect(payday("2026-12", { rule: "LAST_WORKING_DAY" })).toBe("2026-12-31");
  });

  it("a date on payday starts a new cycle; the day before belongs to the old one", () => {
    expect(cycleContaining("2026-11-01", { rule: "FIXED_DAY", day: 1 }).start).toBe("2026-11-01");
    expect(cycleContaining("2026-10-31", { rule: "FIXED_DAY", day: 1 }).start).toBe("2026-10-01");
  });

  it("APP-25 cycle line names the next two cycles", () => {
    const today = "2026-10-23";
    expect(cycleLine(today, { rule: "FIXED_DAY", day: 1 })).toBe("Your budget cycle runs 1 Nov – 30 Nov, then 1 Dec – 31 Dec");
    expect(cycleLine(today, { rule: "LAST_WORKING_DAY" })).toBe("Your budget cycle runs 30 Oct – 29 Nov, then 30 Nov – 30 Dec");
    expect(cycleLine(today, { rule: "FIXED_DAY", day: 7 })).toBe("Your budget cycle runs 7 Nov – 6 Dec, then 7 Dec – 6 Jan");
    expect(cycleLine(today, { rule: "FIXED_DAY", day: 15 })).toBe("Your budget cycle runs 15 Nov – 14 Dec, then 15 Dec – 14 Jan");
  });
});
```

`app/src/lib/budget.test.ts` (BUD-32, client preview):

```ts
import { firstCyclePreview, perDayPreview, realityCheck } from "./budget";

describe("first-cycle preview (BUD-32)", () => {
  it("pro-rates the pool by the days left and rounds down to whole rupees", () => {
    const p = firstCyclePreview({ monthlySpendablePaise: 1500000, today: "2026-10-23", payday: { rule: "FIXED_DAY", day: 1 } });
    expect(p).toEqual({ cycleStart: "2026-10-01", cycleEnd: "2026-10-31", daysLeft: 9, poolPaise: 435400, dayBudgetPaise: 48300, proRated: true });
  });

  it("a stated money-left amount replaces the pool", () => {
    const p = firstCyclePreview({ monthlySpendablePaise: 1500000, today: "2026-10-23", payday: { rule: "FIXED_DAY", day: 1 }, moneyLeftPaise: 600000 });
    expect(p.poolPaise).toBe(600000);
    expect(p.dayBudgetPaise).toBe(66600);
  });

  it("signing up on payday is not pro-rated", () => {
    const p = firstCyclePreview({ monthlySpendablePaise: 1500000, today: "2026-11-01", payday: { rule: "FIXED_DAY", day: 1 } });
    expect(p.proRated).toBe(false);
    expect(p.poolPaise).toBe(1500000);
    expect(p.dayBudgetPaise).toBe(50000);
  });
});

describe("setup previews", () => {
  it("per day in the next full cycle", () => {
    expect(perDayPreview({ freePaise: 1500000, today: "2026-10-23", payday: { rule: "FIXED_DAY", day: 1 } })).toEqual({ perDayPaise: 50000, cycleName: "November", cycleDays: 30 });
  });

  it("APP-20 verdict thresholds", () => {
    expect(realityCheck({ incomePaise: 5000000, fixedPaise: 1500000, savingsPaise: 2000000, cycleDays: 30 }).verdict).toBe("doable");
    expect(realityCheck({ incomePaise: 5000000, fixedPaise: 1500000, savingsPaise: 2800000, cycleDays: 30 }).verdict).toBe("tight"); // ₹233 a day
    expect(realityCheck({ incomePaise: 5000000, fixedPaise: 1500000, savingsPaise: 3500000, cycleDays: 30 }).verdict).toBe("notPossible");
    expect(realityCheck({ incomePaise: 5000000, fixedPaise: 1500000, savingsPaise: 3600000, cycleDays: 30 }).verdict).toBe("notPossible");
  });
});
```

`app/src/lib/log.test.ts` (LOG-08 production half, LOG-09):

```ts
import { createLogger, redact } from "./log";
import type { ReportingSink } from "./reporting";

function sink(): ReportingSink & { events: { level: string; event: string; data?: Record<string, unknown> }[] } {
  const events: { level: string; event: string; data?: Record<string, unknown> }[] = [];
  return { events, report: (level, event, data) => void events.push({ level, event, data }) };
}

describe("logger (LOG-08)", () => {
  it("in development everything prints to the console", () => {
    const console = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const s = sink();
    const log = createLogger({ dev: true, console, sink: s });
    log.debug("screen.view", { route: "/" });
    log.info("api.call", { route: "/budget/today", status: 200 });
    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(s.events).toHaveLength(0);
  });

  it("in production debug is dropped and info and above reach the sink", () => {
    const console = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const s = sink();
    const log = createLogger({ dev: false, console, sink: s });
    log.debug("screen.view", { route: "/" });
    log.info("api.call", { route: "/budget/today", status: 200 });
    log.warn("error.unmapped", { code: "NEW_CODE" });
    log.error("boundary.caught", { message: "boom" });
    expect(console.debug).not.toHaveBeenCalled();
    expect(s.events.map((e) => e.level)).toEqual(["info", "warn", "error"]);
  });
});

describe("redaction (LOG-09)", () => {
  it("drops amounts, merchant text, emails, tokens and codes from any field", () => {
    const out = redact({
      route: "/transactions",
      amountPaise: 25000,
      merchant: "Third Wave",
      email: "priya@example.com",
      accessToken: "eyJabc",
      refreshToken: "abc",
      code: "123456",
      nested: { merchantName: "Zepto", total: 300, kind: "ok" },
      status: 201,
    });
    expect(out).toEqual({ route: "/transactions", nested: { kind: "ok" }, status: 201 });
  });

  it("drops string values that look like an email, a JWT or a 6-digit code", () => {
    expect(redact({ message: "sent to priya@example.com" })).toEqual({});
    expect(redact({ message: "token eyJhbGciOi.eyJzdWIi.sig" })).toEqual({});
    expect(redact({ message: "code 123456" })).toEqual({});
    expect(redact({ message: "status 200" })).toEqual({ message: "status 200" });
  });

  it("the sink never receives an unredacted field", () => {
    const s = sink();
    const log = createLogger({ dev: false, console: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }, sink: s });
    log.info("spend.created", { id: "abc", amountPaise: 25000 });
    expect(s.events[0]?.data).toEqual({ id: "abc" });
  });
});
```

`app/src/lib/errors.test.ts` (ERR-16):

```ts
import { messageFor } from "./errors";
import { ERROR_CODES } from "./error-codes";

describe("error messages (ERR-16)", () => {
  it("every server code has a message", () => {
    for (const code of ERROR_CODES) {
      expect(messageFor(code)).not.toBe("");
    }
  });

  it("an unknown code gets the generic message and is logged at WARN", () => {
    const warn = jest.fn();
    expect(messageFor("BRAND_NEW" as never, { warn })).toBe("Something went wrong. Try again in a moment.");
    expect(warn).toHaveBeenCalledWith("error.unmapped", { code: "BRAND_NEW" });
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd app && npx jest src/lib`
Expected: FAIL: modules missing (`./dates`, `./cycle`, `./budget`, `./errors`), and `parseRupeesToPaise` not exported.

- [ ] **Step 4: Write the libraries**

`app/src/lib/money.ts` (complete):

```ts
const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** The largest amount any field accepts: ₹99,99,999 (7 digits), the same cap as the server. */
export const MAX_AMOUNT_PAISE = 9_999_999_00;

/** Whole rupees with Indian grouping: 10000000 paise → "₹1,00,000". Paise are dropped, never rounded up. */
export function formatRupees(paise: number): string {
  const whole = Math.trunc(Math.abs(paise) / 100);
  return `${paise < 0 ? "−" : ""}₹${rupees.format(whole)}`;
}

/** Typed rupees → paise. Keeps digits only (so "₹50,000.75" is ₹50,000), caps at 7 digits. */
export function parseRupeesToPaise(text: string): number {
  const digits = text.split(".")[0]?.replace(/\D/g, "") ?? "";
  if (digits === "") return 0;
  const capped = digits.slice(0, 7);
  return Number.parseInt(capped, 10) * 100;
}
```

`app/src/lib/dates.ts`:

```ts
export const IST = "Asia/Kolkata";

const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST });
const dayLong = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: IST });
const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: IST });
const isoParts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, timeZone: IST });

/** "2026-10-23" → a Date at noon UTC, safe to format in IST without crossing a day. */
function fromIso(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function clean(s: string): string {
  return s.replace(/,?\s*(\d{4})$/, " $1").replace(/\s+/g, " ").replace("Sept", "Sep").trim();
}

/** "2026-10-23" → "Fri, 23 Oct" */
export function formatDay(date: string): string {
  const parts = day.formatToParts(fromIso(date));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month").replace("Sept", "Sep")}`;
}

/** "2026-10-23" → "Fri, 23 Oct 2026" */
export function formatDayLong(date: string): string {
  const parts = dayLong.formatToParts(fromIso(date));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return clean(`${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}`);
}

/** "2026-10-23" → "23 Oct" */
export function formatDayMonth(date: string): string {
  const parts = dayMonth.formatToParts(fromIso(date));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month").replace("Sept", "Sep")}`;
}

/** The calendar date in Asia/Kolkata for an instant, as "YYYY-MM-DD". */
export function todayIst(now: Date = new Date()): string {
  const parts = isoParts.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The hour (0–23) in Asia/Kolkata. */
export function hourIst(now: Date = new Date()): number {
  const h = isoParts.formatToParts(now).find((p) => p.type === "hour")?.value ?? "0";
  return Number.parseInt(h, 10) % 24;
}

export function greeting(now: Date = new Date()): string {
  const h = hourIst(now);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** "5 minutes ago", "2 hours ago", "yesterday", "3 days ago". */
export function relativeTime(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/** Days from a to b inclusive, both "YYYY-MM-DD". */
export function daysInclusive(a: string, b: string): number {
  return Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86_400_000) + 1;
}

export function addDays(date: string, n: number): string {
  const d = fromIso(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
```

`app/src/lib/cycle.ts` (a port of the server's `CycleCalculator`; the server is the authority, this only draws previews):

```ts
import { addDays, daysInclusive } from "./dates";

export type PaydayRule = { rule: "FIXED_DAY"; day: number } | { rule: "LAST_WORKING_DAY" };

export type CycleRange = { start: string; end: string; days: number };

function ym(date: string): { y: number; m: number } {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function shiftMonth(y: number, m: number, by: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + by;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** The payday in month "YYYY-MM" under a rule. Last working day skips Saturday and Sunday only (spec 2.1). */
export function payday(month: string, rule: PaydayRule): string {
  const { y, m } = ym(`${month}-01`);
  if (rule.rule === "FIXED_DAY") return iso(y, m, rule.day);
  let d = daysInMonth(y, m);
  while ([0, 6].includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) d -= 1;
  return iso(y, m, d);
}

/** The cycle that contains a date: from the latest payday on or before it to the day before the next. */
export function cycleContaining(date: string, rule: PaydayRule): CycleRange {
  const { y, m } = ym(date);
  const thisMonth = payday(`${y}-${String(m).padStart(2, "0")}`, rule);
  let start: string;
  let next: string;
  if (date >= thisMonth) {
    start = thisMonth;
    const n = shiftMonth(y, m, 1);
    next = payday(`${n.y}-${String(n.m).padStart(2, "0")}`, rule);
  } else {
    const p = shiftMonth(y, m, -1);
    start = payday(`${p.y}-${String(p.m).padStart(2, "0")}`, rule);
    next = thisMonth;
  }
  const end = addDays(next, -1);
  return { start, end, days: daysInclusive(start, end) };
}

function short(date: string): string {
  const d = Number(date.slice(8, 10));
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${names[Number(date.slice(5, 7)) - 1]}`;
}

/** "Your budget cycle runs 1 Nov – 30 Nov, then 1 Dec – 31 Dec": the two cycles after the one containing today. */
export function cycleLine(today: string, rule: PaydayRule): string {
  const current = cycleContaining(today, rule);
  const first = cycleContaining(addDays(current.end, 1), rule);
  const second = cycleContaining(addDays(first.end, 1), rule);
  return `Your budget cycle runs ${short(first.start)} – ${short(first.end)}, then ${short(second.start)} – ${short(second.end)}`;
}
```

`app/src/lib/budget.ts`:

```ts
import { cycleContaining, type PaydayRule } from "./cycle";
import { addDays, daysInclusive } from "./dates";

/** Round paise down to a whole rupee. */
export function wholeRupees(paise: number): number {
  return Math.floor(paise / 100) * 100;
}

export type FirstCyclePreview = {
  cycleStart: string;
  cycleEnd: string;
  daysLeft: number;
  poolPaise: number;
  dayBudgetPaise: number;
  proRated: boolean;
};

/**
 * Mirrors the server (spec 2.1, BUD-32): the first cycle's pool is monthly spendable × days left ÷ cycle days,
 * rounded down to whole rupees, unless the user states what they have left. On payday itself nothing is pro-rated.
 */
export function firstCyclePreview(input: { monthlySpendablePaise: number; today: string; payday: PaydayRule; moneyLeftPaise?: number }): FirstCyclePreview {
  const cycle = cycleContaining(input.today, input.payday);
  const daysLeft = daysInclusive(input.today, cycle.end);
  const proRated = daysLeft < cycle.days;
  const computed = proRated ? wholeRupees(Math.floor((input.monthlySpendablePaise * daysLeft) / cycle.days)) : input.monthlySpendablePaise;
  const poolPaise = input.moneyLeftPaise ?? computed;
  return {
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
    daysLeft,
    poolPaise,
    dayBudgetPaise: poolPaise > 0 ? wholeRupees(Math.floor(poolPaise / daysLeft)) : 0,
    proRated,
  };
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Per day in November (30 days)": the next full cycle after today's. */
export function perDayPreview(input: { freePaise: number; today: string; payday: PaydayRule }): { perDayPaise: number; cycleName: string; cycleDays: number } {
  const current = cycleContaining(input.today, input.payday);
  const next = cycleContaining(addDays(current.end, 1), input.payday);
  const name = monthNames[Number(next.start.slice(5, 7)) - 1] ?? "";
  return { perDayPaise: input.freePaise > 0 ? wholeRupees(Math.floor(input.freePaise / next.days)) : 0, cycleName: name, cycleDays: next.days };
}

export type Verdict = "doable" | "tight" | "notPossible";

/** The setup reality check (APP-20): nothing free → not possible; under ₹250 a day → tight; else doable. */
export function realityCheck(input: { incomePaise: number; fixedPaise: number; savingsPaise: number; cycleDays: number }): { verdict: Verdict; freePaise: number; perDayPaise: number; maxSavingsPaise: number } {
  const freePaise = input.incomePaise - input.fixedPaise - input.savingsPaise;
  const perDayPaise = freePaise > 0 ? wholeRupees(Math.floor(freePaise / input.cycleDays)) : 0;
  const maxSavingsPaise = Math.max(0, input.incomePaise - input.fixedPaise - 100);
  const verdict: Verdict = freePaise <= 0 ? "notPossible" : perDayPaise < 25000 ? "tight" : "doable";
  return { verdict, freePaise, perDayPaise, maxSavingsPaise };
}
```

`app/src/lib/reporting.ts`:

```ts
export type ReportLevel = "info" | "warn" | "error";

/** Where production logs go. Off by default; a provider (Sentry or similar) can be plugged in later. */
export interface ReportingSink {
  report(level: ReportLevel, event: string, data?: Record<string, unknown>): void;
}

let current: ReportingSink | null = null;

export const reporting = {
  setSink(sink: ReportingSink | null): void {
    current = sink;
  },
  get sink(): ReportingSink | null {
    return current;
  },
};
```

`app/src/lib/log.ts` (replace the stub):

```ts
/* The only module allowed to call console. Everything else logs through `log`. */
import { reporting, type ReportingSink } from "./reporting";

type ConsoleLike = Pick<Console, "debug" | "info" | "warn" | "error">;

const FORBIDDEN_KEYS = /(amount|paise|merchant|email|token|password|otp|^code$|secret|raw|upi|note$|name$|total|budget|spent|left)/i;
const FORBIDDEN_VALUES = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // email
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/, // JWT
  /\b\d{6}\b/, // OTP code
  /[₹]\s?\d/, // a rupee amount
];

/** Drops any field whose key or value could identify money, a person or a secret (LOG-09). */
export function redact(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    if (typeof value === "string" && FORBIDDEN_VALUES.some((re) => re.test(value))) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redact(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export type Logger = {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
};

export function createLogger(opts: { dev: boolean; console: ConsoleLike; sink?: ReportingSink | null | (() => ReportingSink | null) }): Logger {
  const sinkOf = () => (typeof opts.sink === "function" ? opts.sink() : (opts.sink ?? null));
  const emit = (level: "debug" | "info" | "warn" | "error", event: string, data?: Record<string, unknown>) => {
    const safe = redact(data);
    if (opts.dev) {
      opts.console[level](event, safe);
      return;
    }
    if (level === "debug") return;
    sinkOf()?.report(level, event, safe);
  };
  return {
    debug: (e, d) => emit("debug", e, d),
    info: (e, d) => emit("info", e, d),
    warn: (e, d) => emit("warn", e, d),
    error: (e, d) => emit("error", e, d),
  };
}

export const log: Logger = createLogger({ dev: __DEV__, console, sink: () => reporting.sink });
```

`app/src/lib/errors.ts`:

```ts
import { isErrorCode, type ErrorCode } from "./error-codes";
import { log } from "./log";

const GENERIC = "Something went wrong. Try again in a moment.";

/** One user-facing message per server code. Screens that need a specific screen for a code handle it before calling this. */
const messages: Record<ErrorCode, string> = {
  VALIDATION: "Check the highlighted fields",
  UNAUTHENTICATED: "Sign in again to continue",
  TOKEN_EXPIRED: "Sign in again to continue",
  TOKEN_REUSED: "You were signed out everywhere for safety. Sign in again.",
  OTP_INVALID: "That code is not right. Check the email and try again.",
  OTP_EXPIRED: "That code has expired. Request a new one.",
  OTP_LOCKED: "Too many tries. Request a new code or try again tomorrow.",
  RATE_LIMITED: "Too many requests. Wait a minute and try again.",
  FORBIDDEN: "You cannot do that here",
  NOT_FOUND: "That no longer exists",
  METHOD_NOT_ALLOWED: GENERIC,
  UNSUPPORTED_MEDIA_TYPE: GENERIC,
  NOT_ACCEPTABLE: GENERIC,
  TOO_LARGE: "That is too big to send",
  NOT_POSSIBLE: "Those numbers do not add up",
  SETUP_INCOMPLETE: "Finish setup first",
  INTERNAL: GENERIC,
};

/** The message for a code; an unmapped code logs a WARN so it gets mapped (ERR-16). */
export function messageFor(code: string, deps: { warn: (event: string, data: Record<string, unknown>) => void } = log): string {
  if (isErrorCode(code)) {
    return messages[code];
  }
  deps.warn("error.unmapped", { code });
  return GENERIC;
}
```

`messages` is typed `Record<ErrorCode, string>`, so adding a server code without a message fails `typecheck`. `FIRST_CYCLE_OVER` arrives with Task 5, which regenerates the codes and adds its message line.

- [ ] **Step 5: Run the tests**

Run: `cd app && npx jest src/lib && npm run lint && npm run typecheck`
Expected: PASS, 38 tests across money, dates, cycle, budget, log, errors, lint.

- [ ] **Step 6: Commit**

```bash
git add app/scripts app/src/lib app/package.json .github/workflows/ci.yml
git commit -m "feat(app): logger with redaction, generated error codes, money, dates, cycle and budget previews

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: API client, token storage, session, query client and global error handlers

**Owner:** app-engineer. **Test IDs:** ERR-12, APP-27, ERR-18, SEC-07 (app half). **Red team:** yes (token storage, refresh flow, sign-out).

**Files:**
- Create: `app/src/lib/api-errors.ts`, `app/src/lib/api.ts`, `app/src/lib/api.test.ts`, `app/src/lib/storage.ts`, `app/src/lib/storage.web.ts`, `app/src/lib/storage.test.ts`, `app/src/lib/storage.web.test.ts`, `app/src/lib/kv.ts`, `app/src/lib/client.ts`, `app/src/lib/query.ts`, `app/src/lib/unhandled.ts`, `app/src/lib/unhandled.test.ts`, `app/src/features/auth/api.ts`, `app/src/features/auth/session.tsx`, `app/src/features/auth/session.test.tsx`

**Interfaces:**
- Consumes: `log`, `messageFor`, `ErrorCode` (Task 3).
- Produces: `ApiError`, `NetworkError`, `UnknownError`, `isApiError(e, code?)`; `createApi(deps): Api` with `get/post/put/patch/del/request`; `api` singleton and `authEvents` (`client.ts`); `TokenStore`, `tokenStore`, `Tokens`; `kv.get/set/remove`; `queryClient`, `persister`, `wireOnlineManager()`; `installGlobalHandlers()`; `authApi.requestCode/verifyCode`; `SessionProvider`, `useSession()` with `{ status, signIn, signOut }`.

- [ ] **Step 1: Install the one extra package**

```bash
cd app && npx expo install expo-crypto
```

- [ ] **Step 2: Write the failing tests**

`app/src/lib/api.test.ts` (ERR-12 and the refresh race):

```ts
import { ApiError, NetworkError, UnknownError } from "./api-errors";
import { createApi, type Api } from "./api";
import type { TokenStore, Tokens } from "./storage";

type FakeResponse = { status: number; headers: { get(name: string): string | null }; text(): Promise<string> };

function json(status: number, body: unknown): FakeResponse {
  return { status, headers: { get: (n) => (n.toLowerCase() === "content-type" ? "application/json" : null) }, text: () => Promise.resolve(JSON.stringify(body)) };
}
function html(status: number): FakeResponse {
  return { status, headers: { get: () => "text/html" }, text: () => Promise.resolve("<html>Bad gateway</html>") };
}
function empty(status: number): FakeResponse {
  return { status, headers: { get: () => null }, text: () => Promise.resolve("") };
}

function memoryStore(initial: Tokens | null = { accessToken: "A1", refreshToken: "R1" }): TokenStore & { tokens: Tokens | null } {
  const s = {
    tokens: initial,
    load: () => Promise.resolve(s.tokens),
    save: (t: Tokens) => void (s.tokens = t) ?? Promise.resolve(),
    clear: () => void (s.tokens = null) ?? Promise.resolve(),
  };
  return s;
}

type Call = { url: string; init: RequestInit };

function setup(script: (call: Call, n: number) => FakeResponse | Promise<FakeResponse>, store = memoryStore()) {
  const calls: Call[] = [];
  const onSignedOut = jest.fn();
  const fetchFn = jest.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(script({ url, init }, calls.length));
  });
  const api: Api = createApi({ baseUrl: "http://test.local/api/v1", tokens: store, onSignedOut, fetchFn: fetchFn as unknown as typeof fetch });
  return { api, calls, store, onSignedOut };
}

function header(call: Call, name: string): string | undefined {
  return (call.init.headers as Record<string, string>)[name];
}

describe("api client (ERR-12)", () => {
  it("maps a 404 to ApiError NOT_FOUND", async () => {
    const { api } = setup(() => json(404, { code: "NOT_FOUND", message: "Fixed cost not found" }));
    await expect(api.get("/me/fixed-costs/x")).rejects.toMatchObject({ name: "ApiError", code: "NOT_FOUND", status: 404 });
  });

  it("carries validation fields", async () => {
    const { api } = setup(() => json(400, { code: "VALIDATION", message: "Check the highlighted fields", fields: [{ field: "amountPaise", message: "must be positive" }] }));
    const err = await api.post("/me/fixed-costs", { amountPaise: 0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).fields).toEqual([{ field: "amountPaise", message: "must be positive" }]);
  });

  it("maps a network drop to NetworkError", async () => {
    const { api } = setup(() => {
      throw new TypeError("Network request failed");
    });
    await expect(api.get("/budget/today")).rejects.toBeInstanceOf(NetworkError);
  });

  it("maps an HTML error page to UnknownError with the status", async () => {
    const { api } = setup(() => html(502));
    const err = await api.get("/budget/today").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownError);
    expect((err as UnknownError).status).toBe(502);
  });

  it("returns undefined for 204", async () => {
    const { api } = setup(() => empty(204));
    await expect(api.post("/auth/logout", { refreshToken: "R1" }, { auth: false })).resolves.toBeUndefined();
  });

  it("sends the bearer token, JSON headers and a request id", async () => {
    const { api, calls } = setup(() => json(200, { ok: true }));
    await api.get("/budget/today");
    expect(calls[0]?.url).toBe("http://test.local/api/v1/budget/today");
    expect(header(calls[0]!, "Authorization")).toBe("Bearer A1");
    expect(header(calls[0]!, "Content-Type")).toBe("application/json");
    expect(header(calls[0]!, "X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends no Authorization header on public calls", async () => {
    const { api, calls } = setup(() => empty(204));
    await api.post("/auth/otp/request", { email: "a@b.c" }, { auth: false });
    expect(header(calls[0]!, "Authorization")).toBeUndefined();
  });

  it("never sends the token in the URL", async () => {
    const { api, calls } = setup(() => json(200, {}));
    await api.get("/budget/today");
    expect(calls[0]?.url).not.toContain("A1");
  });
});

describe("token refresh", () => {
  it("refreshes once on TOKEN_EXPIRED, saves the pair and retries with the new token", async () => {
    const { api, calls, store } = setup((call, n) => {
      if (call.url.endsWith("/auth/refresh")) return json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 });
      return n === 1 ? json(401, { code: "TOKEN_EXPIRED", message: "Sign in again" }) : json(200, { budgetPaise: 1 });
    });
    await expect(api.get("/budget/today")).resolves.toEqual({ budgetPaise: 1 });
    expect(calls.map((c) => c.url.replace("http://test.local/api/v1", ""))).toEqual(["/budget/today", "/auth/refresh", "/budget/today"]);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ refreshToken: "R1" });
    expect(header(calls[2]!, "Authorization")).toBe("Bearer A2");
    expect(store.tokens).toEqual({ accessToken: "A2", refreshToken: "R2" });
  });

  it("concurrentExpiredRequestsRefreshOnce", async () => {
    let refreshes = 0;
    const { api, calls } = setup((call) => {
      if (call.url.endsWith("/auth/refresh")) {
        refreshes += 1;
        return json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 });
      }
      const auth = header(call, "Authorization");
      return auth === "Bearer A2" ? json(200, { ok: true }) : json(401, { code: "TOKEN_EXPIRED", message: "x" });
    });
    await Promise.all([api.get("/budget/today"), api.get("/me/profile"), api.get("/me/fixed-costs")]);
    expect(refreshes).toBe(1);
    expect(calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("signs out when the refresh is rejected", async () => {
    const { api, store, onSignedOut } = setup((call) => {
      if (call.url.endsWith("/auth/refresh")) return json(401, { code: "TOKEN_REUSED", message: "x" });
      return json(401, { code: "TOKEN_EXPIRED", message: "x" });
    });
    await expect(api.get("/budget/today")).rejects.toMatchObject({ code: "TOKEN_REUSED" });
    expect(store.tokens).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("does not refresh without a stored session", async () => {
    const { api, calls } = setup(() => json(401, { code: "UNAUTHENTICATED", message: "x" }), memoryStore(null));
    await expect(api.get("/budget/today")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(calls).toHaveLength(1);
  });

  it("leaves the session alone when the refresh fails on the network", async () => {
    const { api, store, onSignedOut } = setup((call) => {
      if (call.url.endsWith("/auth/refresh")) throw new TypeError("offline");
      return json(401, { code: "TOKEN_EXPIRED", message: "x" });
    });
    await expect(api.get("/budget/today")).rejects.toBeInstanceOf(NetworkError);
    expect(store.tokens).not.toBeNull();
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
```

`app/src/lib/storage.test.ts` (APP-27, phone):

```ts
jest.mock("expo-secure-store", () => {
  const m = new Map<string, string>();
  return {
    getItemAsync: (k: string) => Promise.resolve(m.get(k) ?? null),
    setItemAsync: (k: string, v: string) => Promise.resolve(void m.set(k, v)),
    deleteItemAsync: (k: string) => Promise.resolve(void m.delete(k)),
    __map: m,
  };
});

import * as SecureStore from "expo-secure-store";
import { tokenStore } from "./storage";

const map = (SecureStore as unknown as { __map: Map<string, string> }).__map;

describe("token storage on the phone (APP-27)", () => {
  beforeEach(() => map.clear());

  it("round-trips a token pair through SecureStore", async () => {
    await tokenStore.save({ accessToken: "A", refreshToken: "R" });
    expect([...map.keys()]).toEqual(["gullak.session"]);
    await expect(tokenStore.load()).resolves.toEqual({ accessToken: "A", refreshToken: "R" });
  });

  it("clear removes the pair", async () => {
    await tokenStore.save({ accessToken: "A", refreshToken: "R" });
    await tokenStore.clear();
    await expect(tokenStore.load()).resolves.toBeNull();
  });

  it("a corrupt value reads as signed out", async () => {
    map.set("gullak.session", "{not json");
    await expect(tokenStore.load()).resolves.toBeNull();
  });
});
```

`app/src/lib/storage.web.test.ts` (APP-27, SEC-07, web project):

```ts
import { tokenStore } from "./storage";

describe("token storage on the web (APP-27, SEC-07)", () => {
  it("keeps the pair in memory only", async () => {
    await tokenStore.save({ accessToken: "ACCESS-abc", refreshToken: "REFRESH-xyz" });
    await expect(tokenStore.load()).resolves.toEqual({ accessToken: "ACCESS-abc", refreshToken: "REFRESH-xyz" });
    const everything = [...Object.values(localStorage), ...Object.values(sessionStorage), document.cookie].join(" ");
    expect(everything).not.toContain("ACCESS-abc");
    expect(everything).not.toContain("REFRESH-xyz");
  });

  it("clear forgets the pair", async () => {
    await tokenStore.save({ accessToken: "A", refreshToken: "R" });
    await tokenStore.clear();
    await expect(tokenStore.load()).resolves.toBeNull();
  });
});
```

`app/src/lib/unhandled.test.ts` (ERR-18):

```ts
import { installGlobalHandlers } from "./unhandled";

describe("global handlers (ERR-18)", () => {
  it("an unhandled rejection is logged and the app keeps running", () => {
    const error = jest.fn();
    let tracker: { onUnhandled: (id: number, reason: unknown) => void } | null = null;
    installGlobalHandlers({
      log: { error },
      hermes: { enablePromiseRejectionTracker: (o) => void (tracker = o as typeof tracker) },
      errorUtils: null,
    });
    expect(tracker).not.toBeNull();
    expect(() => tracker!.onUnhandled(1, new Error("boom"))).not.toThrow();
    expect(error).toHaveBeenCalledWith("promise.unhandled", { message: "boom" });
  });

  it("falls back to the window event on web", () => {
    const error = jest.fn();
    const listeners: Record<string, (e: { reason: unknown }) => void> = {};
    installGlobalHandlers({
      log: { error },
      hermes: null,
      errorUtils: null,
      addEventListener: (name, fn) => void (listeners[name] = fn),
    });
    listeners["unhandledrejection"]?.({ reason: "nope" });
    expect(error).toHaveBeenCalledWith("promise.unhandled", { message: "nope" });
  });

  it("uncaught JS errors are logged and passed to the previous handler", () => {
    const error = jest.fn();
    const previous = jest.fn();
    let handler: ((e: Error, fatal?: boolean) => void) | null = null;
    installGlobalHandlers({
      log: { error },
      hermes: null,
      errorUtils: { getGlobalHandler: () => previous, setGlobalHandler: (h) => void (handler = h) },
    });
    handler!(new Error("crash"), true);
    expect(error).toHaveBeenCalledWith("js.uncaught", { message: "crash", fatal: true });
    expect(previous).toHaveBeenCalled();
  });
});
```

`app/src/features/auth/session.test.tsx`:

```tsx
import { act, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { SessionProvider, useSession } from "./session";
import type { TokenStore, Tokens } from "@/lib/storage";
import { NetworkError } from "@/lib/api-errors";

function store(initial: Tokens | null): TokenStore & { tokens: Tokens | null } {
  const s = { tokens: initial, load: () => Promise.resolve(s.tokens), save: (t: Tokens) => void (s.tokens = t) ?? Promise.resolve(), clear: () => void (s.tokens = null) ?? Promise.resolve() };
  return s;
}

function Probe({ onReady }: { onReady?: (s: ReturnType<typeof useSession>) => void }) {
  const session = useSession();
  onReady?.(session);
  return <Text testID="status">{session.status}</Text>;
}

describe("session", () => {
  it("hydrates to signedIn when a pair is stored, and nothing renders before that", async () => {
    render(
      <SessionProvider store={store({ accessToken: "A", refreshToken: "R" })} logout={() => Promise.resolve()}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
  });

  it("hydrates to signedOut with nothing stored", async () => {
    render(
      <SessionProvider store={store(null)} logout={() => Promise.resolve()}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedOut"));
  });

  it("signIn stores the pair; signOut revokes it on the server and clears it even when the server is unreachable", async () => {
    const s = store(null);
    const logout = jest.fn(() => Promise.reject(new NetworkError("offline")));
    let session: ReturnType<typeof useSession> | undefined;
    render(
      <SessionProvider store={s} logout={logout}>
        <Probe onReady={(x) => (session = x)} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedOut"));
    await act(() => session!.signIn({ accessToken: "A", refreshToken: "R" }));
    expect(s.tokens).toEqual({ accessToken: "A", refreshToken: "R" });
    expect(screen.getByTestId("status")).toHaveTextContent("signedIn");
    await act(() => session!.signOut());
    expect(logout).toHaveBeenCalledWith("R");
    expect(s.tokens).toBeNull();
    expect(screen.getByTestId("status")).toHaveTextContent("signedOut");
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd app && npx jest src/lib/api src/lib/storage src/lib/unhandled src/features/auth`
Expected: FAIL, modules missing.

- [ ] **Step 4: Write the code**

`app/src/lib/api-errors.ts`:

```ts
import type { ErrorCode } from "./error-codes";

export type FieldError = { field: string; message: string };

/** A 4xx or 5xx the server described in its {code, message} shape. */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly fields: FieldError[] = [],
    readonly errorId?: string,
  ) {
    super(message);
  }
}

/** The request never got an answer: offline, DNS, timeout. Safe to retry. */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
}

/** An answer that is not ours: a proxy's HTML page, a body that is not JSON. */
export class UnknownError extends Error {
  override readonly name = "UnknownError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function isApiError(e: unknown, code?: ErrorCode): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

/** The message a screen shows for any thrown value. */
export function describeError(e: unknown, messageFor: (code: string) => string): string {
  if (e instanceof ApiError) return messageFor(e.code);
  if (e instanceof NetworkError) return "No connection. Check your network and try again.";
  return "Something went wrong. Try again in a moment.";
}
```

`app/src/lib/storage.ts` (phone):

```ts
import * as SecureStore from "expo-secure-store";
import { log } from "./log";

export type Tokens = { accessToken: string; refreshToken: string };

export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

const KEY = "gullak.session";

function parse(raw: string | null): Tokens | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Tokens>;
    if (typeof v.accessToken === "string" && typeof v.refreshToken === "string") {
      return { accessToken: v.accessToken, refreshToken: v.refreshToken };
    }
  } catch (e) {
    log.warn("session.corrupt", { reason: e instanceof Error ? e.name : "parse" });
  }
  return null;
}

/** Tokens live in the device keychain / keystore (spec 4.7). */
export const tokenStore: TokenStore = {
  async load() {
    return parse(await SecureStore.getItemAsync(KEY));
  },
  async save(tokens) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY);
  },
};
```

`app/src/lib/storage.web.ts`:

```ts
import type { TokenStore, Tokens } from "./storage";
export type { TokenStore, Tokens } from "./storage";

let current: Tokens | null = null;

/**
 * Web: tokens stay in memory only (SEC-07). A reload signs out until Plan 9 moves the refresh token
 * into an httpOnly cookie. Nothing is ever written to localStorage, sessionStorage or document.cookie.
 */
export const tokenStore: TokenStore = {
  load: () => Promise.resolve(current),
  save: (tokens) => {
    current = tokens;
    return Promise.resolve();
  },
  clear: () => {
    current = null;
    return Promise.resolve();
  },
};
```

`app/src/lib/kv.ts` (small flags; never tokens):

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { log } from "./log";

/** Per-device flags such as "first spend logged" or "notifications asked". Never secrets, never money. */
export const kv = {
  async get(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(`gullak.${key}`);
    } catch (e) {
      log.warn("kv.read_failed", { key, reason: e instanceof Error ? e.name : "unknown" });
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(`gullak.${key}`, value);
    } catch (e) {
      log.warn("kv.write_failed", { key, reason: e instanceof Error ? e.name : "unknown" });
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(`gullak.${key}`);
    } catch (e) {
      log.warn("kv.remove_failed", { key, reason: e instanceof Error ? e.name : "unknown" });
    }
  },
};
```

`app/src/lib/api.ts`:

```ts
import { randomUUID } from "expo-crypto";
import { ApiError, NetworkError, UnknownError, type FieldError } from "./api-errors";
import { log } from "./log";
import type { TokenStore, Tokens } from "./storage";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestOptions = {
  /** Default true: send the bearer token and refresh it once on TOKEN_EXPIRED. */
  auth?: boolean;
  signal?: AbortSignal;
};

export type Api = {
  request<T>(method: HttpMethod, path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  del<T>(path: string, options?: RequestOptions): Promise<T>;
};

export type ApiDeps = {
  baseUrl: string;
  tokens: TokenStore;
  /** Called once when a refresh is rejected: the session is gone. */
  onSignedOut: () => void;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

type ErrorBody = { code?: unknown; message?: unknown; fields?: unknown; errorId?: unknown };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/me/fixed-costs/3f2…" → "/me/fixed-costs/{id}" so logs never carry ids from URLs. */
function routeOf(path: string): string {
  return path.split("?")[0]?.replace(UUID, "{id}") ?? path;
}

function isFieldError(f: unknown): f is FieldError {
  return typeof f === "object" && f !== null && typeof (f as { field?: unknown }).field === "string" && typeof (f as { message?: unknown }).message === "string";
}

function fieldsOf(raw: unknown): FieldError[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(isFieldError).map((f) => ({ field: f.field, message: f.message }));
}

export function createApi(deps: ApiDeps): Api {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  let refreshing: Promise<Tokens> | null = null;

  async function send(method: HttpMethod, path: string, body: unknown, accessToken: string | null, signal?: AbortSignal): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", "X-Request-Id": randomUUID() };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    signal?.addEventListener("abort", () => controller.abort());
    const started = Date.now();
    let res: { status: number; headers: { get(name: string): string | null }; text(): Promise<string> };
    try {
      res = await fetchFn(`${deps.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (signal?.aborted) throw e;
      throw new NetworkError(e instanceof Error && e.name === "AbortError" ? "timeout" : "network");
    }
    clearTimeout(timer);
    const text = await res.text();
    log.info("api.call", { route: routeOf(path), method, status: res.status, ms: Date.now() - started });
    if (res.status === 204 || text === "") return { status: res.status, data: undefined };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) throw new UnknownError(`Unexpected ${contentType || "response"}`, res.status);
    try {
      return { status: res.status, data: JSON.parse(text) as unknown };
    } catch {
      throw new UnknownError("Response was not JSON", res.status);
    }
  }

  function toError(status: number, data: unknown): Error {
    const b = (data ?? {}) as ErrorBody;
    if (typeof b.code === "string") {
      return new ApiError(b.code, status, typeof b.message === "string" ? b.message : "", fieldsOf(b.fields), typeof b.errorId === "string" ? b.errorId : undefined);
    }
    return new UnknownError(`HTTP ${status}`, status);
  }

  async function refresh(current: Tokens): Promise<Tokens> {
    const { status, data } = await send("POST", "/auth/refresh", { refreshToken: current.refreshToken }, null);
    if (status >= 400) {
      const err = toError(status, data);
      if (err instanceof ApiError) {
        await deps.tokens.clear();
        deps.onSignedOut();
      }
      throw err;
    }
    const pair = data as Partial<Tokens>;
    if (typeof pair.accessToken !== "string" || typeof pair.refreshToken !== "string") throw new UnknownError("Refresh gave no tokens", status);
    const next = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    await deps.tokens.save(next);
    return next;
  }

  async function request<T>(method: HttpMethod, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? true;
    const stored = auth ? await deps.tokens.load() : null;
    let { status, data } = await send(method, path, body, stored?.accessToken ?? null, options.signal);
    if (status === 401 && auth && stored && (data as ErrorBody)?.code === "TOKEN_EXPIRED") {
      refreshing ??= refresh(stored).finally(() => {
        refreshing = null;
      });
      const fresh = await refreshing;
      ({ status, data } = await send(method, path, body, fresh.accessToken, options.signal));
    }
    if (status >= 400) throw toError(status, data);
    return data as T;
  }

  return {
    request,
    get: (path, options) => request("GET", path, undefined, options),
    post: (path, body, options) => request("POST", path, body, options),
    put: (path, body, options) => request("PUT", path, body, options),
    patch: (path, body, options) => request("PATCH", path, body, options),
    del: (path, options) => request("DELETE", path, undefined, options),
  };
}
```

`app/src/lib/client.ts`:

```ts
import { createApi } from "./api";
import { tokenStore } from "./storage";

const baseUrl = process.env.EXPO_PUBLIC_API_URL;
if (!baseUrl) {
  throw new Error("EXPO_PUBLIC_API_URL is not set; copy app/.env.example to app/.env");
}

type Listener = () => void;
const signedOutListeners = new Set<Listener>();

/** Fired when the server rejected a refresh: the session is gone and the UI must return to login. */
export const authEvents = {
  onSignedOut(listener: Listener): () => void {
    signedOutListeners.add(listener);
    return () => signedOutListeners.delete(listener);
  },
};

export const api = createApi({
  baseUrl,
  tokens: tokenStore,
  onSignedOut: () => signedOutListeners.forEach((l) => l()),
});
```

`app/src/lib/query.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { QueryClient, onlineManager } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { ApiError } from "./api-errors";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: WEEK,
      networkMode: "offlineFirst", // cached data is served while offline; the fetch pauses
      retry: (count, error) => !(error instanceof ApiError) && count < 2,
    },
    mutations: { networkMode: "online", retry: 0 },
  },
});

/** The cache survives restarts so Home can show "Updated 2 hours ago" (APP-11). Tokens are never in it. */
export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "gullak.query-cache" });

export const persistOptions = { persister, maxAge: WEEK };

export function wireOnlineManager(): void {
  onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)));
}
```

`app/src/lib/unhandled.ts`:

```ts
import { log as defaultLog } from "./log";

type Tracker = { allRejections: boolean; onUnhandled: (id: number, reason: unknown) => void; onHandled: (id: number) => void };
type Hermes = { enablePromiseRejectionTracker?: (options: Tracker) => void };
type ErrorUtilsLike = { getGlobalHandler(): ((e: Error, isFatal?: boolean) => void) | undefined; setGlobalHandler(h: (e: Error, isFatal?: boolean) => void): void };

export type GlobalHandlerDeps = {
  log: { error: (event: string, data?: Record<string, unknown>) => void };
  hermes: Hermes | null;
  errorUtils: ErrorUtilsLike | null;
  addEventListener?: (name: "unhandledrejection", fn: (e: { reason: unknown }) => void) => void;
};

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "non-error rejection";
}

function detect(): GlobalHandlerDeps {
  const g = globalThis as { HermesInternal?: Hermes; ErrorUtils?: ErrorUtilsLike; addEventListener?: GlobalHandlerDeps["addEventListener"] };
  return {
    log: defaultLog,
    hermes: g.HermesInternal ?? null,
    errorUtils: g.ErrorUtils ?? null,
    addEventListener: typeof g.addEventListener === "function" ? g.addEventListener.bind(globalThis) : undefined,
  };
}

/** ERR-18: unhandled rejections and uncaught errors are logged; the app keeps running. Call once at startup. */
export function installGlobalHandlers(deps: GlobalHandlerDeps = detect()): void {
  const onUnhandled = (reason: unknown) => deps.log.error("promise.unhandled", { message: messageOf(reason) });
  if (deps.hermes?.enablePromiseRejectionTracker) {
    deps.hermes.enablePromiseRejectionTracker({ allRejections: true, onUnhandled: (_id, reason) => onUnhandled(reason), onHandled: () => undefined });
  } else if (deps.addEventListener) {
    deps.addEventListener("unhandledrejection", (e) => onUnhandled(e.reason));
  }
  if (deps.errorUtils) {
    const previous = deps.errorUtils.getGlobalHandler();
    deps.errorUtils.setGlobalHandler((e, isFatal) => {
      deps.log.error("js.uncaught", { message: e.message, fatal: !!isFatal });
      previous?.(e, isFatal);
    });
  }
}
```

`app/src/features/auth/api.ts`:

```ts
import { api } from "@/lib/client";
import type { Tokens } from "@/lib/storage";

export type TokenPair = Tokens & { expiresIn: number };

const device = (process.env.EXPO_OS ?? "unknown").slice(0, 60);

export const authApi = {
  requestCode: (email: string) => api.post<void>("/auth/otp/request", { email }, { auth: false }),
  verifyCode: (email: string, code: string) => api.post<TokenPair>("/auth/otp/verify", { email, code, device }, { auth: false }),
  logout: (refreshToken: string) => api.post<void>("/auth/logout", { refreshToken }, { auth: false }),
};
```

`app/src/features/auth/session.tsx`:

```tsx
import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { NetworkError } from "@/lib/api-errors";
import { authEvents } from "@/lib/client";
import { log } from "@/lib/log";
import { queryClient } from "@/lib/query";
import { tokenStore, type TokenStore, type Tokens } from "@/lib/storage";
import { authApi } from "./api";

export type SessionStatus = "loading" | "signedOut" | "signedIn";

export type Session = {
  status: SessionStatus;
  signIn(tokens: Tokens): Promise<void>;
  signOut(): Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

type Props = { children: React.ReactNode; store?: TokenStore; logout?: (refreshToken: string) => Promise<void> };

export function SessionProvider({ children, store = tokenStore, logout = authApi.logout }: Props) {
  const [status, setStatus] = useState<SessionStatus>("loading");

  useEffect(() => {
    let alive = true;
    store
      .load()
      .then((t) => alive && setStatus(t ? "signedIn" : "signedOut"))
      .catch((e: unknown) => {
        log.warn("session.load_failed", { reason: e instanceof Error ? e.name : "unknown" });
        if (alive) setStatus("signedOut");
      });
    return () => {
      alive = false;
    };
  }, [store]);

  useEffect(
    () =>
      authEvents.onSignedOut(() => {
        queryClient.clear();
        setStatus("signedOut");
      }),
    [],
  );

  const signIn = useCallback(
    async (tokens: Tokens) => {
      await store.save(tokens);
      setStatus("signedIn");
      log.info("auth.signed_in");
    },
    [store],
  );

  const signOut = useCallback(async () => {
    const t = await store.load();
    if (t) {
      try {
        await logout(t.refreshToken);
      } catch (e) {
        // The local sign-out still happens; the server token expires on its own within 30 days.
        log.warn(e instanceof NetworkError ? "auth.logout_offline" : "auth.logout_rejected", { reason: e instanceof Error ? e.name : "unknown" });
      }
    }
    await store.clear();
    queryClient.clear();
    setStatus("signedOut");
    log.info("auth.signed_out");
  }, [store, logout]);

  const value = useMemo(() => ({ status, signIn, signOut }), [status, signIn, signOut]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const s = use(SessionContext);
  if (!s) throw new Error("useSession needs a SessionProvider");
  return s;
}
```

`queryClient.clear()` on sign-out also drops the persisted cache the next time the persister writes; the AsyncStorage key is removed explicitly in Task 10's Me screen sign-out so another person on the same phone never sees cached figures.

- [ ] **Step 5: Run the tests**

Run: `cd app && npm test && npm run lint && npm run typecheck`
Expected: PASS. The web project runs `storage.web.test.ts` against `storage.web.ts` (Metro-style platform resolution is honoured by `jest-expo/web`).

- [ ] **Step 6: Red team**

Dispatch `red-team` with task id `plan-02-task-4` on: tokens in URLs, tokens in logs (grep the test output of `api.test.ts` with logging to a captured console), the refresh race, sign-out when offline, whether any code path writes a token to AsyncStorage or the query cache. Findings go to `docs/reports/red-team/plan-02-task-4.md`. A High or Critical finding is fixed in this task.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib app/src/features/auth app/package.json app/package-lock.json docs/reports/red-team/plan-02-task-4.md
git commit -m "feat(app): API client with typed errors and single-flight refresh, secure token storage, session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Server: dev OTP endpoint and the pro-rated first cycle

**Owner:** backend-engineer. **Test IDs:** BUD-32, API-TDY-08 (updated), API-X-03 (dev route absent outside `local`), API-FC-08 and API-PRO-02 under concurrency. **Red team:** yes (the dev endpoint must not exist in `test` or `prod`; the override is scoped to the caller's first open cycle).

**Files:**
- Create: `server/src/main/java/in/gullak/auth/DevOtpController.java`, `server/src/main/java/in/gullak/budget/CurrentCycle.java`, `server/src/main/java/in/gullak/budget/FirstCycle.java`, `server/src/main/java/in/gullak/budget/FirstCycleRequest.java`, `server/src/main/resources/db/migration/V005__first_cycle_pool.sql`, `server/src/test/java/in/gullak/auth/DevOtpApiTest.java`, `server/src/test/java/in/gullak/budget/FirstCycleApiTest.java`, `server/src/test/java/in/gullak/budget/FirstCycleTest.java`
- Modify: `server/src/main/java/in/gullak/budget/CycleEntity.java`, `CycleRepository.java`, `CycleService.java`, `BudgetService.java`, `BudgetController.java`, `BudgetInput.java`, `server/src/main/java/in/gullak/profile/ProfileRepository.java`, `ProfileService.java`, `FixedCostService.java`, `server/src/main/java/in/gullak/common/error/ErrorCode.java`, `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/test/java/in/gullak/support/ApiTest.java`, `server/src/test/java/in/gullak/budget/TodayApiTest.java`, `server/src/test/java/in/gullak/profile/ProfileApiTest.java`, `FixedCostApiTest.java`, `README.md`, `app/src/lib/error-codes.ts` (regenerate), `app/src/lib/errors.ts` (add the `FIRST_CYCLE_OVER` message)

**Interfaces:**
- Consumes: `InMemoryOtpMailer.lastCodeFor` (Plan 1), `CycleCalculator`, `BudgetCalculator`, `ProfileService.get`, `FixedCostService.totalFor`.
- Produces: `POST /api/v1/auth/dev/otp {email} → {code}` (local only); `PUT /api/v1/budget/first-cycle {moneyLeftPaise} → TodayResponse`; `cycles.pool_override_paise`; `CycleService.current(userId, today, profile, monthlySpendablePaise) : CurrentCycle`; `ErrorCode.FIRST_CYCLE_OVER`; `Events.CYCLE_POOL_SET`; test helpers `newlySetUpUser()` and `seedCycle(user, start, end)`.

- [ ] **Step 1: Migration**

`server/src/main/resources/db/migration/V005__first_cycle_pool.sql`:

```sql
-- The first cycle after setup usually starts mid-cycle (spec 2.1). Its pool is pinned here: pro-rated by
-- the server when the cycle is created, or replaced by the user's "money left until payday" answer.
-- Null means the normal formula (income - fixed costs - savings) applies.
alter table cycles add column pool_override_paise bigint check (pool_override_paise >= 0);
```

- [ ] **Step 2: Write the failing tests**

`server/src/test/java/in/gullak/budget/FirstCycleTest.java` (unit, BUD-32):

```java
package in.gullak.budget;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class FirstCycleTest {
    private static final Cycle OCTOBER = new Cycle(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31));

    @Test
    void proRatesByDaysLeftAndRoundsDownToWholeRupees() { // BUD-32
        assertThat(FirstCycle.proRate(1_500_000, LocalDate.of(2026, 10, 23), OCTOBER)).isEqualTo(435_400L);
    }

    @Test
    void signingUpOnPaydayIsNotProRated() {
        assertThat(FirstCycle.proRate(1_500_000, LocalDate.of(2026, 10, 1), OCTOBER)).isNull();
    }

    @Test
    void lastDayOfTheCycleGetsOneDaysShare() {
        assertThat(FirstCycle.proRate(1_500_000, LocalDate.of(2026, 10, 31), OCTOBER)).isEqualTo(48_300L);
    }

    @Test
    void nothingToSpendGivesZero() {
        assertThat(FirstCycle.proRate(-5, LocalDate.of(2026, 10, 23), OCTOBER)).isEqualTo(0L);
    }
}
```

`server/src/test/java/in/gullak/budget/FirstCycleApiTest.java`:

```java
package in.gullak.budget;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class FirstCycleApiTest extends ApiTest {

    @Test
    void midCycleSignupProRatesTheFirstCycle() throws Exception { // BUD-32, API-TDY-08
        TestUser u = newlySetUpUser();
        today(u)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.cycleStart").value("2026-10-01"))
            .andExpect(jsonPath("$.daysLeft").value(9))
            .andExpect(jsonPath("$.budgetPaise").value(48_300))
            .andExpect(jsonPath("$.leftPaise").value(48_300));
        assertThat(poolOverride(u)).isEqualTo(435_400L);
    }

    @Test
    void moneyLeftAnswerReplacesThePool() throws Exception { // BUD-32
        TestUser u = newlySetUpUser();
        firstCycle(u, 600_000)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.budgetPaise").value(66_600));
        assertThat(poolOverride(u)).isEqualTo(600_000L);
        today(u).andExpect(jsonPath("$.budgetPaise").value(66_600));
    }

    @Test
    void moneyLeftCanBeZero() throws Exception {
        TestUser u = newlySetUpUser();
        firstCycle(u, 0).andExpect(status().isOk()).andExpect(jsonPath("$.budgetPaise").value(0)).andExpect(jsonPath("$.mood").value("NERVOUS"));
    }

    @Test
    void moneyLeftIsValidated() throws Exception {
        TestUser u = newlySetUpUser();
        firstCycle(u, -1).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{\"moneyLeftPaise\":\"6000\"}"))
            .andExpect(status().isBadRequest());
        mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void signupOnPaydayGetsTheFullMonth() throws Exception {
        clock.set(Instant.parse("2026-11-01T04:00:00Z"));
        TestUser u = newlySetUpUser();
        today(u).andExpect(jsonPath("$.budgetPaise").value(50_000)).andExpect(jsonPath("$.daysLeft").value(30));
        assertThat(poolOverride(u)).isNull();
    }

    @Test
    void spendsInTheFirstCycleComeOutOfTheProRatedPool() throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        seedSpend(u, 200_000, Instant.parse("2026-10-22T10:00:00Z")); // yesterday
        today(u).andExpect(jsonPath("$.budgetPaise").value(26_100)); // (435,400 − 200,000) ÷ 9 = 26,155 → ₹261
    }

    @Test
    void editsDuringTheFirstCycleKeepThePool() throws Exception { // decided in Plan 2: the user said what they have
        TestUser u = newlySetUpUser();
        today(u);
        addFixedCost(u, "Gym", 150_000);
        today(u).andExpect(jsonPath("$.budgetPaise").value(48_300));
    }

    @Test
    void overrideIsRejectedAfterTheFirstCycle() throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        clock.set(Instant.parse("2026-11-05T04:00:00Z"));
        today(u).andExpect(jsonPath("$.cycleStart").value("2026-11-01"));
        firstCycle(u, 600_000).andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("FIRST_CYCLE_OVER"));
    }

    @Test
    void secondCycleUsesTheNormalFormula() throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        clock.set(Instant.parse("2026-11-01T04:00:00Z"));
        today(u).andExpect(jsonPath("$.budgetPaise").value(50_000));
        assertThat(jdbc.sql("select pool_override_paise from cycles where user_id = ? and start_date = '2026-11-01'").param(u.id()).query(Long.class).optional()).isEmpty();
    }

    @Test
    void anotherUsersOverrideIsSeparate() throws Exception {
        TestUser a = newlySetUpUser();
        TestUser b = newlySetUpUser();
        firstCycle(a, 900_000).andExpect(status().isOk());
        today(b).andExpect(jsonPath("$.budgetPaise").value(48_300));
    }

    @Test
    void maturedExampleUserIsNotProRated() throws Exception { // the seeded cycle from exampleUser() keeps Plan 1's numbers
        TestUser u = exampleUser();
        today(u).andExpect(jsonPath("$.budgetPaise").value(166_600));
    }

    private ResultActions firstCycle(TestUser u, long paise) throws Exception {
        return mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content("{\"moneyLeftPaise\":" + paise + "}"));
    }

    private ResultActions today(TestUser u) throws Exception {
        return mvc.perform(get("/api/v1/budget/today").with(auth(u)));
    }

    private Long poolOverride(TestUser u) {
        return jdbc.sql("select pool_override_paise from cycles where user_id = ? order by start_date desc limit 1")
            .param(u.id()).query(Long.class).optional().orElse(null);
    }
}
```

`server/src/test/java/in/gullak/auth/DevOtpApiTest.java`:

```java
package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Profile;
import org.springframework.http.MediaType;

class DevOtpApiTest extends ApiTest {

    @Test
    void theDevRouteDoesNotExistOutsideTheLocalProfile() throws Exception { // API-X-03 shape, no leak
        String email = uniqueEmail();
        requestCode(email, freshIp()).andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/dev/otp").with(freshIp()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("NOT_FOUND"))
            .andExpect(jsonPath("$.code").isString());
    }

    @Test
    void theControllerIsBoundToTheLocalProfileOnly() {
        Profile profile = DevOtpController.class.getAnnotation(Profile.class);
        assertThat(profile).isNotNull();
        assertThat(profile.value()).containsExactly("local");
    }
}
```

In `TodayApiTest`, change `firstCallCreatesTheCycle` and `concurrentFirstRequestsCreateOneCycle` to use `newlySetUpUser()` instead of `exampleUser()`, and extend the first one:

```java
    @Test
    void firstCallCreatesTheCycle() throws Exception { // API-TDY-08
        TestUser u = newlySetUpUser();
        today(u).andExpect(status().isOk()).andExpect(jsonPath("$.budgetPaise").value(48_300));
        assertThat(cycleCount(u)).isEqualTo(1);
        today(u);
        assertThat(cycleCount(u)).isEqualTo(1);
    }
```

Move `insertCycle` from `TodayApiTest` into `ApiTest` as `seedCycle` (below) and delete the private copy.

- [ ] **Step 3: Test helpers**

In `server/src/test/java/in/gullak/support/ApiTest.java` replace `exampleUser()` with:

```java
    /** Signed in, fixed costs and profile saved, no cycle yet: the state right after setup. */
    protected TestUser newlySetUpUser() throws Exception {
        TestUser user = signIn();
        addFixedCost(user, "Rent", 1_000_000);
        addFixedCost(user, "Cook", 200_000);
        addFixedCost(user, "Maid", 150_000);
        addFixedCost(user, "Monthly groceries", 150_000);
        putProfile(user, EXAMPLE_PROFILE).andExpect(status().isOk());
        return user;
    }

    /**
     * The spec's example user, who has been in the 1–31 Oct 2026 cycle since payday: ₹50,000 income,
     * ₹15,000 fixed, ₹20,000 savings. The cycle is seeded so the first cycle is not pro-rated (BUD-32).
     */
    protected TestUser exampleUser() throws Exception {
        TestUser user = newlySetUpUser();
        seedCycle(user, "2026-10-01", "2026-10-31");
        return user;
    }

    protected void seedCycle(TestUser user, String start, String end) {
        jdbc.sql("insert into cycles (id, user_id, start_date, end_date) values (?, ?, ?::date, ?::date)")
            .params(UUID.randomUUID(), user.id(), start, end)
            .update();
    }
```

- [ ] **Step 4: Run to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.budget.FirstCycle*' --tests 'in.gullak.auth.DevOtpApiTest'`
Expected: compile failure (`FirstCycle`, `newlySetUpUser`, `DevOtpController` missing).

- [ ] **Step 5: Server code**

Append to `ErrorCode` (before `INTERNAL` is fine; the enum is append-only by name, not by position; keep `INTERNAL` last for readability):

```java
    FIRST_CYCLE_OVER(false),
```

Append to `Events`:

```java
    public static final String CYCLE_POOL_SET = "cycle.pool_set";
```

`server/src/main/java/in/gullak/budget/FirstCycle.java`:

```java
package in.gullak.budget;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/** Spec 2.1: the first cycle after setup is pro-rated by the days left in it. */
final class FirstCycle {
    private FirstCycle() {}

    /**
     * The pool for a first cycle created on {@code today}, rounded down to whole rupees, or null when today
     * is the cycle's first day (nothing to pro-rate).
     */
    static Long proRate(long monthlySpendablePaise, LocalDate today, Cycle cycle) {
        int daysLeft = (int) ChronoUnit.DAYS.between(today, cycle.end()) + 1;
        if (daysLeft >= cycle.days()) {
            return null;
        }
        long pool = Math.max(0, monthlySpendablePaise) * daysLeft / cycle.days();
        return pool / 100 * 100;
    }
}
```

`server/src/main/java/in/gullak/budget/CurrentCycle.java`:

```java
package in.gullak.budget;

import java.util.UUID;

/**
 * The cycle a request is working in. {@code poolOverridePaise} is set only on a pro-rated or user-stated
 * first cycle; {@code first} is true when no earlier cycle exists for the user.
 */
public record CurrentCycle(UUID id, Cycle cycle, Long poolOverridePaise, boolean first) {}
```

`server/src/main/java/in/gullak/budget/FirstCycleRequest.java`:

```java
package in.gullak.budget;

import in.gullak.common.money.Money;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

public record FirstCycleRequest(@NotNull @PositiveOrZero @Max(Money.MAX_INCOME_PAISE) Long moneyLeftPaise) {}
```

`CycleEntity`: add the column and getters (keep the class package-private and read-only):

```java
    @Column(name = "pool_override_paise")
    private Long poolOverridePaise;

    UUID getId() { return id; }
    LocalDate getStartDate() { return startDate; }
    Long getPoolOverridePaise() { return poolOverridePaise; }
```

`CycleRepository`: replace `insertIfAbsent` and add two queries:

```java
    @Modifying
    @Query(value = """
            insert into cycles (id, user_id, start_date, end_date, pool_override_paise)
            values (:id, :userId, :start, :end, :pool)
            on conflict do nothing
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("userId") UUID userId,
                       @Param("start") LocalDate start, @Param("end") LocalDate end, @Param("pool") Long pool);

    @Query("select count(c) from CycleEntity c where c.userId = :userId and c.endDate < :start")
    long countEndingBefore(@Param("userId") UUID userId, @Param("start") LocalDate start);

    /** Only an open cycle of the caller; returns 0 rows when it is closed or not theirs. */
    @Modifying(clearAutomatically = true)
    @Query(value = """
            update cycles set pool_override_paise = :pool, updated_at = now()
            where id = :id and user_id = :userId and closed_at is null
            """, nativeQuery = true)
    int setPoolOverride(@Param("id") UUID id, @Param("userId") UUID userId, @Param("pool") long pool);
```

`CycleService`:

```java
    /**
     * The cycle covering {@code today}, created on first use. After a payday change the current cycle
     * keeps its end date; the next one starts the day after it and ends the day before the new payday.
     * A user's very first cycle, created mid-cycle, gets a pro-rated pool (spec 2.1).
     */
    @Transactional
    public CurrentCycle current(UUID userId, LocalDate today, Profile profile, long monthlySpendablePaise) {
        Optional<CycleEntity> existing = cycles.findCovering(userId, today);
        if (existing.isPresent()) {
            return toCurrent(userId, existing.get());
        }
        Cycle natural = CycleCalculator.containing(today, profile.paydayRule(), profile.paydayDay());
        LocalDate start = cycles.latestEndBefore(userId, today)
            .map(end -> end.plusDays(1))
            .filter(s -> s.isAfter(natural.start()))
            .orElse(natural.start());
        Cycle cycle = new Cycle(start, natural.end());
        boolean first = cycles.countEndingBefore(userId, cycle.start()) == 0;
        Long pool = first ? FirstCycle.proRate(monthlySpendablePaise, today, cycle) : null;
        if (cycles.insertIfAbsent(UUID.randomUUID(), userId, cycle.start(), cycle.end(), pool) == 1) {
            log.info("{} user={} days={} proRated={}", Events.CYCLE_OPENED, userId, cycle.days(), pool != null);
        }
        return cycles.findCovering(userId, today)
            .map(e -> toCurrent(userId, e))
            .orElseGet(() -> new CurrentCycle(null, cycle, pool, first));
    }

    /** Pins the pool of the caller's first, still-open cycle to what they said they have left. */
    @Transactional
    public void setFirstCyclePool(UUID userId, CurrentCycle current, long poolPaise) {
        if (!current.first()) {
            throw new UnprocessableException(ErrorCode.FIRST_CYCLE_OVER, "Your first cycle has ended, so this can no longer be changed");
        }
        if (current.id() == null || cycles.setPoolOverride(current.id(), userId, poolPaise) == 0) {
            throw new UnprocessableException(ErrorCode.FIRST_CYCLE_OVER, "Your first cycle has ended, so this can no longer be changed");
        }
        log.info("{} user={} cycle={}", Events.CYCLE_POOL_SET, userId, current.id());
    }

    private CurrentCycle toCurrent(UUID userId, CycleEntity e) {
        return new CurrentCycle(e.getId(), e.toCycle(), e.getPoolOverridePaise(), cycles.countEndingBefore(userId, e.getStartDate()) == 0);
    }
```

`BudgetInput`: add the factory:

```java
    /** A cycle whose pool is pinned (the first cycle): the pool is the spendable amount, nothing is subtracted. */
    public static BudgetInput ofSpendable(long spendablePaise, long spentBeforeTodayPaise, long spentTodayPaise, int daysLeftIncludingToday) {
        return new BudgetInput(spendablePaise, 0, 0, spentBeforeTodayPaise, spentTodayPaise, daysLeftIncludingToday);
    }
```

`BudgetService`:

```java
    /** One transaction so every figure comes from the same snapshot; read-write because it may open a cycle. */
    @Transactional
    public TodayResponse today(UUID userId) {
        Profile profile = profiles.get(userId);
        LocalDate today = Ist.today(clock);
        long fixed = fixedCosts.totalFor(userId);
        CurrentCycle current = cycles.current(userId, today, profile, spendable(profile, fixed));
        return compute(userId, profile, today, fixed, current);
    }

    @Transactional
    public TodayResponse setFirstCyclePool(UUID userId, long moneyLeftPaise) {
        Profile profile = profiles.get(userId);
        LocalDate today = Ist.today(clock);
        long fixed = fixedCosts.totalFor(userId);
        CurrentCycle current = cycles.current(userId, today, profile, spendable(profile, fixed));
        cycles.setFirstCyclePool(userId, current, moneyLeftPaise);
        return compute(userId, profile, today, fixed, cycles.current(userId, today, profile, spendable(profile, fixed)));
    }

    private static long spendable(Profile profile, long fixed) {
        return profile.incomePaise() - fixed - profile.savingsPaise();
    }

    private TodayResponse compute(UUID userId, Profile profile, LocalDate today, long fixed, CurrentCycle current) {
        Cycle cycle = current.cycle();
        long before = totals.spent(userId, Ist.startOf(cycle.start()), Ist.startOf(today));
        long spentToday = totals.spent(userId, Ist.startOf(today), Ist.startOf(today.plusDays(1)));
        int daysLeft = (int) ChronoUnit.DAYS.between(today, cycle.end()) + 1;
        BudgetInput input = current.poolOverridePaise() != null
            ? BudgetInput.ofSpendable(current.poolOverridePaise(), before, spentToday, daysLeft)
            : new BudgetInput(profile.incomePaise(), fixed, profile.savingsPaise(), before, spentToday, daysLeft);
        DailyBudget b = BudgetCalculator.compute(input);
        return new TodayResponse(today, b.budgetPaise(), b.spentTodayPaise(), b.leftPaise(), b.overPaise(),
            b.poolOverPaise(), b.mood(), GullakLines.line(profile.personality(), b.mood(), b.leftPaise(), b.totalOverPaise()), daysLeft,
            cycle.start(), cycle.end());
    }
```

`BudgetController`: add

```java
    @PutMapping("/first-cycle")
    TodayResponse firstCycle(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody FirstCycleRequest body) {
        return budget.setFirstCyclePool(CurrentUser.id(jwt), body.moneyLeftPaise());
    }
```

`server/src/main/java/in/gullak/auth/DevOtpController.java`:

```java
package in.gullak.auth;

import in.gullak.common.error.NotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Local development only: returns the last sign-in code the in-memory mailer "sent" to an address, so the
 * app and the Maestro flows can sign in without a real mailbox. Never registered under test or prod
 * (DevOtpApiTest pins the profile). Sits under /api/v1/auth so the public auth matcher covers it.
 */
@RestController
@RequestMapping("/api/v1/auth/dev")
@Profile("local")
class DevOtpController {
    record Body(@NotBlank @Email String email) {}

    record Code(String code) {}

    private final InMemoryOtpMailer mailer;

    DevOtpController(InMemoryOtpMailer mailer) {
        this.mailer = mailer;
    }

    @PostMapping("/otp")
    Code last(@Valid @RequestBody Body body) {
        String code = mailer.lastCodeFor(body.email());
        if (code == null) {
            throw new NotFoundException("Code");
        }
        return new Code(code);
    }
}
```

- [ ] **Step 5b: Plan 1's deferred profile items: the nothing-to-spend guard under a row lock, and a race-free first PUT**

Plan 1's final review deferred two server defects here: two fixed-cost adds (or an add racing a profile PUT) could each pass the guard and together leave nothing to spend, and two first-time `PUT /me/profile` calls raced on the primary key so one got a 500. The fixed-cost path also reused the savings message. Tests first.

Add to `server/src/test/java/in/gullak/profile/FixedCostApiTest.java` (imports: `java.util.ArrayList`, `java.util.List`, `java.util.concurrent.Callable`, `CountDownLatch`, `ExecutorService`, `Executors`, `Future`):

```java
    @Test
    void concurrentAddsCannotTogetherLeaveNothingToSpend() throws Exception { // API-FC-08 under a race
        TestUser u = signIn();
        putProfile(u, EXAMPLE_PROFILE).andExpect(status().isOk()); // ₹50,000 income, ₹20,000 savings, no fixed costs yet
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch start = new CountDownLatch(1);
            Callable<Integer> call = () -> {
                start.await();
                return mvc.perform(post("/api/v1/me/fixed-costs").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Big\",\"amountPaise\":2000000}"))
                    .andReturn().getResponse().getStatus();
            };
            List<Future<Integer>> futures = List.of(pool.submit(call), pool.submit(call));
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> f : futures) {
                statuses.add(f.get());
            }
            assertThat(statuses).containsExactlyInAnyOrder(201, 422); // each alone fits; together they do not
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void impossibleCostHasItsOwnMessage() throws Exception {
        TestUser u = signIn();
        putProfile(u, EXAMPLE_PROFILE).andExpect(status().isOk());
        mvc.perform(post("/api/v1/me/fixed-costs").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Everything\",\"amountPaise\":3000000}"))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("NOT_POSSIBLE"))
            .andExpect(jsonPath("$.message").value("This cost leaves nothing to spend. Lower it or your savings."));
    }
```

Add to `server/src/test/java/in/gullak/profile/ProfileApiTest.java` (same imports):

```java
    @Test
    void parallelFirstTimePutsAllSucceedWithOneRow() throws Exception { // API-PRO-02 under a race
        TestUser u = signIn();
        ExecutorService pool = Executors.newFixedThreadPool(4);
        try {
            CountDownLatch start = new CountDownLatch(1);
            Callable<Integer> call = () -> {
                start.await();
                return putProfile(u, EXAMPLE_PROFILE).andReturn().getResponse().getStatus();
            };
            List<Future<Integer>> futures = List.of(call, call, call, call).stream().map(pool::submit).toList();
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> f : futures) {
                statuses.add(f.get());
            }
            assertThat(statuses).containsOnly(200);
            assertThat(jdbc.sql("select count(*) from profiles where user_id = ?").param(u.id()).query(Long.class).single()).isEqualTo(1L);
        } finally {
            pool.shutdownNow();
        }
    }
```

Run: `cd server && ./gradlew test --tests 'in.gullak.profile.*'`
Expected: the three new tests FAIL (a 201+201 pair, the old message, and a 500 among the parallel PUTs).

`server/src/main/java/in/gullak/profile/ProfileRepository.java`:

```java
package in.gullak.profile;

import jakarta.persistence.LockModeType;
import java.time.LocalTime;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface ProfileRepository extends JpaRepository<ProfileEntity, UUID> {

    /** Row lock for guards that read savings and fixed costs together: two writers for one user queue here. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from ProfileEntity p where p.userId = :userId")
    Optional<ProfileEntity> findByIdForUpdate(@Param("userId") UUID userId);

    /** First-time setup without a race: a second first-time PUT finds the row and updates it. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            insert into profiles (user_id, income_paise, savings_paise, payday_rule, payday_day, personality,
                                  morning_time, night_time, timezone)
            values (:userId, :income, :savings, :rule, :day, :personality, :morning, :night, :timezone)
            on conflict (user_id) do nothing
            """, nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("income") long income, @Param("savings") long savings,
                       @Param("rule") String rule, @Param("day") Integer day, @Param("personality") String personality,
                       @Param("morning") LocalTime morning, @Param("night") LocalTime night, @Param("timezone") String timezone);
}
```

`ProfileService`: replace `put`, `checkWithFixedTotal` and `requireSomethingToSpend` with:

```java
    static final String SAVINGS_MESSAGE = "Savings and fixed costs leave nothing to spend. Save {max} or less.";
    static final String FIXED_COST_MESSAGE = "This cost leaves nothing to spend. Lower it or your savings.";

    @Transactional
    public Profile put(UUID userId, ProfileRequest r) {
        Integer day = switch (r.paydayRule()) {
            case FIXED_DAY -> {
                if (r.paydayDay() == null) {
                    throw new ValidationException("paydayDay", "Pick the day your salary arrives");
                }
                yield r.paydayDay();
            }
            case LAST_WORKING_DAY -> null;
        };
        Profile p = new Profile(userId, r.incomePaise(), r.savingsPaise(), r.paydayRule(), day,
            r.personality(), r.morningTime(), r.nightTime(), r.timezone());
        // Create the row if it is missing, then lock it: the guard runs under the same lock fixed-cost writes
        // take, so the two never interleave. A rejected first-time profile rolls the insert back with the transaction.
        profiles.insertIfAbsent(userId, p.incomePaise(), p.savingsPaise(), p.paydayRule().name(), p.paydayDay(),
            p.personality().name(), p.morningTime(), p.nightTime(), p.timezone());
        ProfileEntity entity = profiles.findByIdForUpdate(userId)
            .orElseThrow(() -> new IllegalStateException("profile row missing after insert"));
        requireSomethingToSpend(p.incomePaise(), fixedCosts.totalActive(userId), p.savingsPaise(), SAVINGS_MESSAGE);
        entity.apply(p);
        profiles.save(entity);
        log.info("{} user={}", Events.PROFILE_UPDATED, userId);
        return p;
    }

    /** Locks the caller's profile row and returns it; empty before setup, when there is nothing to guard. */
    Optional<Profile> lockForGuard(UUID userId) {
        return profiles.findByIdForUpdate(userId).map(ProfileEntity::toProfile);
    }

    static void requireSomethingToSpend(long income, long fixed, long savings, String message) {
        if (income - fixed - savings <= 0) {
            long maxSavings = Math.max(0, income - fixed - 100);
            throw new UnprocessableException(ErrorCode.NOT_POSSIBLE, message.replace("{max}", RupeeFormat.format(maxSavings)));
        }
    }
```

`FixedCostService`: lock first, then total, then guard, in `add` and `edit`:

```java
    @Transactional
    FixedCost add(UUID userId, FixedCostRequest r) {
        Optional<Profile> locked = profiles.lockForGuard(userId);
        long total = repo.totalActive(userId) + r.amountPaise();
        locked.ifPresent(p -> ProfileService.requireSomethingToSpend(p.incomePaise(), total, p.savingsPaise(), ProfileService.FIXED_COST_MESSAGE));
        FixedCostEntity created = repo.save(new FixedCostEntity(userId, r.name().trim(), r.amountPaise()));
        FixedCost result = created.toRecord();
        log.info("{} user={} id={} action=add", Events.FIXED_COST_CHANGED, userId, result.id());
        return result;
    }

    @Transactional
    FixedCost edit(UUID userId, UUID id, FixedCostPatch p) {
        Optional<Profile> locked = profiles.lockForGuard(userId);
        FixedCostEntity current = repo.findByIdAndUserIdAndActiveTrue(id, userId)
            .orElseThrow(() -> new NotFoundException("Fixed cost"));
        String name = p.name() != null ? p.name().trim() : current.getName();
        long amount = p.amountPaise() != null ? p.amountPaise() : current.getAmountPaise();
        long total = repo.totalActive(userId) - current.getAmountPaise() + amount;
        locked.ifPresent(pr -> ProfileService.requireSomethingToSpend(pr.incomePaise(), total, pr.savingsPaise(), ProfileService.FIXED_COST_MESSAGE));
        current.change(name, amount);
        log.info("{} user={} id={} action=edit", Events.FIXED_COST_CHANGED, userId, id);
        return current.toRecord();
    }
```

Any Plan 1 test that asserted the old fixed-cost message text now expects `FIXED_COST_MESSAGE`; the savings-path message is unchanged.

- [ ] **Step 6: Run the server suite**

Run: `cd server && ./gradlew test`
Expected: all PASS, including the two edited `TodayApiTest` cases and every Plan 1 test (the seeded cycle in `exampleUser()` keeps their numbers).

- [ ] **Step 7: Regenerate the app's codes**

Run: `cd app && npm run gen:errors && npm run typecheck`. If Task 3 left `FIRST_CYCLE_OVER` out of `messages` in `errors.ts`, add it now: `FIRST_CYCLE_OVER: "Your first cycle has ended, so this can no longer be changed",`.

- [ ] **Step 8: README**

In the API table add:

```markdown
| PUT | /api/v1/budget/first-cycle | `{moneyLeftPaise}` → today; pins the pool of the user's first open cycle (spec 2.1); 422 `FIRST_CYCLE_OVER` afterwards |
| POST | /api/v1/auth/dev/otp | **`local` profile only.** `{email}` → `{code}`: the last code the in-memory mailer "sent" |
```

And under "Run locally", after the `bootRun` line: "Sign-in codes: `curl -X POST localhost:8080/api/v1/auth/dev/otp -H 'content-type: application/json' -d '{\"email\":\"you@example.com\"}'`."

- [ ] **Step 9: Red team**

Dispatch `red-team` with task id `plan-02-task-5`: confirm the dev route is 404 under `test` and absent from `prod` (ApplicationContextRunner with `prod` and the mailer stubbed, or by reading the profile condition); try `PUT /budget/first-cycle` with another user's token after their first cycle, with negative, decimal, string and huge values, twice in parallel, and on a closed cycle (insert `closed_at` directly). Report to `docs/reports/red-team/plan-02-task-5.md`.

- [ ] **Step 10: Commit**

```bash
git add server README.md app/src/lib/error-codes.ts app/src/lib/errors.ts docs/reports/red-team/plan-02-task-5.md
git commit -m "feat(server): pro-rated first cycle with the money-left override, local dev OTP endpoint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Root layout, hydration gate, protected routes, login screens and error boundaries

**Owner:** app-engineer. **Test IDs:** ERR-15, ERR-13 (login screens), APP-27 (gate), E2E-01 (login half). **Red team:** yes (email normalisation, code entry, lockout handling).

**Files:**
- Create: `app/app/_layout.tsx` (replace), `app/app/index.tsx` (replace), `app/app/+not-found.tsx`, `app/app/login.tsx`, `app/app/login-code.tsx`, `app/src/components/error-boundary.tsx`, `app/src/components/error-boundary.test.tsx`, `app/src/features/auth/components/email-form.tsx`, `app/src/features/auth/components/code-form.tsx`, `app/src/features/auth/components/auth-screens.test.tsx`, `app/src/features/profile/api.ts`, `app/src/features/profile/hooks.ts`, `app/src/routing.test.tsx`

**Interfaces:**
- Consumes: `SessionProvider`, `useSession`, `authApi`, `queryClient`, `persistOptions`, `wireOnlineManager`, `installGlobalHandlers`, `messageFor`, `describeError`, UI primitives.
- Produces: `useProfile()` returning `{ data: Profile | null | undefined, ... }` where `null` means "setup incomplete"; `Profile` type; `EmailForm`, `CodeForm`; `AppErrorBoundary`; the route tree.

- [ ] **Step 1: Write the failing tests**

`app/src/components/error-boundary.test.tsx` (ERR-15):

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { AppErrorBoundary } from "./error-boundary";

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error("render failed");
  return <Text>fine</Text>;
}

describe("AppErrorBoundary (ERR-15)", () => {
  it("shows the fallback with Retry, reports the error, and recovers", () => {
    const report = jest.fn();
    let explode = true;
    const { rerender } = render(
      <AppErrorBoundary report={report}>
        <Bomb explode={explode} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(report).toHaveBeenCalledWith("boundary.caught", { message: "render failed" });
    explode = false;
    rerender(
      <AppErrorBoundary report={report}>
        <Bomb explode={explode} />
      </AppErrorBoundary>,
    );
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("fine")).toBeTruthy();
  });
});
```

`app/src/features/auth/components/auth-screens.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { ApiError, NetworkError } from "@/lib/api-errors";
import { EmailForm } from "./email-form";
import { CodeForm } from "./code-form";

describe("EmailForm", () => {
  it("emailIsTrimmedAndLowercasedBeforeSending", async () => {
    const requestCode = jest.fn(() => Promise.resolve());
    const onSent = jest.fn();
    render(<EmailForm requestCode={requestCode} onSent={onSent} />);
    fireEvent.changeText(screen.getByLabelText("Email"), " Priya@Example.COM ");
    fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("priya@example.com"));
    expect(requestCode).toHaveBeenCalledWith("priya@example.com");
  });

  it("validates before sending", () => {
    const requestCode = jest.fn(() => Promise.resolve());
    render(<EmailForm requestCode={requestCode} onSent={() => {}} />);
    fireEvent.changeText(screen.getByLabelText("Email"), "not-an-email");
    fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(requestCode).not.toHaveBeenCalled();
  });

  it("shows the rate-limit message inline (ERR-13)", async () => {
    const requestCode = jest.fn(() => Promise.reject(new ApiError("RATE_LIMITED", 429, "slow down")));
    render(<EmailForm requestCode={requestCode} onSent={() => {}} />);
    fireEvent.changeText(screen.getByLabelText("Email"), "a@b.co");
    fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("Too many requests. Wait a minute and try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled();
  });

  it("shows the offline message and keeps the draft", async () => {
    const requestCode = jest.fn(() => Promise.reject(new NetworkError("offline")));
    render(<EmailForm requestCode={requestCode} onSent={() => {}} />);
    fireEvent.changeText(screen.getByLabelText("Email"), "a@b.co");
    fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("No connection. Check your network and try again.")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toHaveProp("value", "a@b.co");
  });
});

describe("CodeForm", () => {
  const pair = { accessToken: "A", refreshToken: "R", expiresIn: 900 };

  it("pastedCodeKeepsDigitsOnly and submits at six digits", async () => {
    const verifyCode = jest.fn(() => Promise.resolve(pair));
    const onVerified = jest.fn();
    render(<CodeForm email="a@b.co" verifyCode={verifyCode} requestCode={() => Promise.resolve()} onVerified={onVerified} />);
    fireEvent.changeText(screen.getByLabelText("6-digit code"), "123 456");
    await waitFor(() => expect(verifyCode).toHaveBeenCalledWith("a@b.co", "123456"));
    expect(onVerified).toHaveBeenCalledWith(pair);
    expect(screen.getByTestId("code-box-5")).toHaveTextContent("6");
  });

  it("ignores letters and caps at six", () => {
    render(<CodeForm email="a@b.co" verifyCode={() => Promise.resolve(pair)} requestCode={() => Promise.resolve()} onVerified={() => {}} />);
    fireEvent.changeText(screen.getByLabelText("6-digit code"), "12ab3");
    expect(screen.getByTestId("code-box-2")).toHaveTextContent("3");
    expect(screen.getByTestId("code-box-3")).toHaveTextContent("");
  });

  it("a wrong code shows the message and clears the boxes", async () => {
    const verifyCode = jest.fn(() => Promise.reject(new ApiError("OTP_INVALID", 401, "wrong")));
    render(<CodeForm email="a@b.co" verifyCode={verifyCode} requestCode={() => Promise.resolve()} onVerified={() => {}} />);
    fireEvent.changeText(screen.getByLabelText("6-digit code"), "000000");
    expect(await screen.findByText("That code is not right. Check the email and try again.")).toBeTruthy();
    expect(screen.getByTestId("code-box-0")).toHaveTextContent("");
  });

  it("a locked code offers a new one", async () => {
    const verifyCode = jest.fn(() => Promise.reject(new ApiError("OTP_LOCKED", 401, "locked")));
    const requestCode = jest.fn(() => Promise.resolve());
    render(<CodeForm email="a@b.co" verifyCode={verifyCode} requestCode={requestCode} onVerified={() => {}} />);
    fireEvent.changeText(screen.getByLabelText("6-digit code"), "000000");
    expect(await screen.findByText("Too many tries. Request a new code or try again tomorrow.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Send a new code" }));
    await waitFor(() => expect(requestCode).toHaveBeenCalledWith("a@b.co"));
  });
});
```

`app/src/routing.test.tsx` (the gate and redirects; uses `expo-router/testing-library`; it lives in `src/` because every file under `app/app/` becomes a route):

```tsx
import { renderRouter, screen } from "expo-router/testing-library";
import React from "react";
import { Text } from "react-native";
import { SessionProvider } from "@/features/auth/session";
import type { TokenStore, Tokens } from "@/lib/storage";

jest.mock("@/features/profile/hooks", () => ({ useProfile: jest.fn() }));
import { useProfile } from "@/features/profile/hooks";

const mockedUseProfile = useProfile as jest.Mock;

function store(initial: Tokens | null): TokenStore {
  let t = initial;
  return { load: () => Promise.resolve(t), save: (n) => void (t = n) ?? Promise.resolve(), clear: () => void (t = null) ?? Promise.resolve() };
}

function Index() {
  const Real = require("../app/index").default as React.ComponentType;
  return <Real />;
}

function tree(session: TokenStore) {
  const Layout = ({ children }: { children: React.ReactNode }) => (
    <SessionProvider store={session} logout={() => Promise.resolve()}>
      {children}
    </SessionProvider>
  );
  return {
    _layout: () => {
      const Slot = require("expo-router").Slot as React.ComponentType;
      return (
        <Layout>
          <Slot />
        </Layout>
      );
    },
    index: Index,
    login: () => <Text>login screen</Text>,
    "onboarding/income": () => <Text>income screen</Text>,
    "(tabs)/index": () => <Text>home screen</Text>,
  };
}

describe("routing by session and profile", () => {
  it("signed out goes to login", async () => {
    mockedUseProfile.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: jest.fn() });
    renderRouter(tree(store(null)), { initialUrl: "/" });
    expect(await screen.findByText("login screen")).toBeTruthy();
    expect(screen).toHavePathname("/login");
  });

  it("signed in without a profile goes to setup", async () => {
    mockedUseProfile.mockReturnValue({ data: null, isLoading: false, error: null, refetch: jest.fn() });
    renderRouter(tree(store({ accessToken: "A", refreshToken: "R" })), { initialUrl: "/" });
    expect(await screen.findByText("income screen")).toBeTruthy();
  });

  it("signed in with a profile goes home", async () => {
    mockedUseProfile.mockReturnValue({ data: { incomePaise: 1 }, isLoading: false, error: null, refetch: jest.fn() });
    renderRouter(tree(store({ accessToken: "A", refreshToken: "R" })), { initialUrl: "/" });
    expect(await screen.findByText("home screen")).toBeTruthy();
  });

  it("a failed profile load shows Retry instead of guessing", async () => {
    const refetch = jest.fn();
    mockedUseProfile.mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch });
    renderRouter(tree(store({ accessToken: "A", refreshToken: "R" })), { initialUrl: "/" });
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd app && npx jest src/components/error-boundary src/features/auth/components src/routing`
Expected: FAIL, modules missing.

- [ ] **Step 3: Write the code**

`app/src/components/error-boundary.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { log } from "@/lib/log";
import { colors, spacing } from "@/theme";
import { ErrorState } from "./ui/error-state";

type Props = { children: React.ReactNode; report?: (event: string, data: Record<string, unknown>) => void; full?: boolean };
type State = { failed: boolean };

/** Catches render errors (ERR-15). Retry re-mounts the children. The error reaches the logger, never the user. */
export class AppErrorBoundary extends React.Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    (this.props.report ?? log.error)("boundary.caught", { message: error.message });
  }

  override render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <View style={{ flex: this.props.full ? 1 : undefined, justifyContent: "center", padding: spacing.md, backgroundColor: colors.ground }}>
          <ErrorState onRetry={() => this.setState({ failed: false })} />
        </View>
      );
    }
    return this.props.children;
  }
}

/** The shape expo-router hands to a route's exported ErrorBoundary. */
export function RouteErrorFallback({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  log.error("route.caught", { message: error.message });
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: spacing.md, backgroundColor: colors.ground }}>
      <ErrorState onRetry={() => void retry()} />
    </View>
  );
}
```

`app/src/features/profile/api.ts` (Task 8 extends it):

```ts
import { api } from "@/lib/client";

export type PaydayRuleName = "FIXED_DAY" | "LAST_WORKING_DAY";
export type Personality = "CHILL" | "SAVAGE" | "MOM" | "HYPE";

export type Profile = {
  incomePaise: number;
  savingsPaise: number;
  paydayRule: PaydayRuleName;
  paydayDay?: number;
  personality: Personality;
  morningTime: string; // "08:00"
  nightTime: string; // "22:00"
  timezone: "Asia/Kolkata";
};

export const profileApi = {
  get: () => api.get<Profile>("/me/profile"),
};
```

`app/src/features/profile/hooks.ts` (Task 8 extends it):

```ts
import { useQuery } from "@tanstack/react-query";
import { isApiError } from "@/lib/api-errors";
import { profileApi, type Profile } from "./api";

export const profileKeys = { profile: ["profile"] as const };

/** `data === null` means the user has not finished setup (409 SETUP_INCOMPLETE). */
export function useProfile(options: { enabled?: boolean } = {}) {
  return useQuery<Profile | null>({
    queryKey: profileKeys.profile,
    queryFn: async () => {
      try {
        return await profileApi.get();
      } catch (e) {
        if (isApiError(e, "SETUP_INCOMPLETE")) return null;
        throw e;
      }
    },
    enabled: options.enabled ?? true,
  });
}
```

`app/app/_layout.tsx`:

```tsx
import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque";
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppErrorBoundary } from "@/components/error-boundary";
import { SessionProvider, useSession } from "@/features/auth/session";
import { persistOptions, queryClient, wireOnlineManager } from "@/lib/query";
import { installGlobalHandlers } from "@/lib/unhandled";
import { colors } from "@/theme";

void SplashScreen.preventAutoHideAsync();
installGlobalHandlers();
wireOnlineManager();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    "DMSans-400": DMSans_400Regular,
    "DMSans-500": DMSans_500Medium,
    "DMSans-700": DMSans_700Bold,
    "Bricolage-600": BricolageGrotesque_600SemiBold,
    "Bricolage-700": BricolageGrotesque_700Bold,
  });
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ground }}>
      <SafeAreaProvider>
        <AppErrorBoundary full>
          <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
            <SessionProvider>
              <Gate ready={fontsLoaded}>
                <Navigation />
              </Gate>
            </SessionProvider>
          </PersistQueryClientProvider>
        </AppErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Nothing renders until fonts and the stored session are known, so the first frame is never the wrong screen. */
function Gate({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  const { status } = useSession();
  const hydrated = ready && status !== "loading";
  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync();
  }, [hydrated]);
  if (!hydrated) return null;
  return children;
}

function Navigation() {
  const { status } = useSession();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="login" />
        <Stack.Screen name="login-code" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}
```

`app/app/index.tsx`:

```tsx
import { Redirect } from "expo-router";
import React from "react";
import { View } from "react-native";
import { ErrorState } from "@/components/ui/error-state";
import { useSession } from "@/features/auth/session";
import { useProfile } from "@/features/profile/hooks";
import { colors, spacing } from "@/theme";

export default function Index() {
  const { status } = useSession();
  const profile = useProfile({ enabled: status === "signedIn" });
  if (status === "signedOut") return <Redirect href="/login" />;
  if (profile.isLoading || (profile.data === undefined && !profile.error)) return null;
  if (profile.error) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: spacing.md, backgroundColor: colors.ground }}>
        <ErrorState body="Could not load your profile" onRetry={() => void profile.refetch()} />
      </View>
    );
  }
  if (profile.data === null) return <Redirect href="/onboarding/income" />;
  return <Redirect href="/(tabs)" />;
}
```

`app/app/+not-found.tsx`:

```tsx
import { Link } from "expo-router";
import React from "react";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";

export default function NotFound() {
  return (
    <Screen>
      <Text variant="heading">That page does not exist</Text>
      <Link href="/" asChild>
        <Text variant="body" style={{ textDecorationLine: "underline" }} accessibilityRole="link">
          Go home
        </Text>
      </Link>
    </Screen>
  );
}
```

`app/src/features/auth/components/email-form.tsx`:

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { spacing } from "@/theme";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function EmailForm({ requestCode, onSent }: { requestCode: (email: string) => Promise<void>; onSent: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    const clean = normaliseEmail(email);
    if (!EMAIL.test(clean)) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    setSending(true);
    try {
      await requestCode(clean);
      onSent(clean);
    } catch (e) {
      setError(describeError(e, messageFor));
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Text variant="heading">Sign in</Text>
      <Text variant="bodyMuted">We send a 6-digit code to your email. No password to remember.</Text>
      <Field
        label="Email"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          if (error) setError(null);
        }}
        error={error ?? undefined}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => void send()}
      />
      <Button title="Send code" onPress={() => void send()} loading={sending} />
    </View>
  );
}
```

`app/src/features/auth/components/code-form.tsx`:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { describeError, isApiError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { colors, fonts, radius, spacing } from "@/theme";
import type { TokenPair } from "../api";

type Props = {
  email: string;
  verifyCode: (email: string, code: string) => Promise<TokenPair>;
  requestCode: (email: string) => Promise<void>;
  onVerified: (pair: TokenPair) => void;
};

export function CodeForm({ email, verifyCode, requestCode, onVerified }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (code.length !== 6 || busy) return;
    let alive = true;
    setBusy(true);
    verifyCode(email, code)
      .then((pair) => alive && onVerified(pair))
      .catch((e: unknown) => {
        if (!alive) return;
        setCode("");
        setLocked(isApiError(e, "OTP_LOCKED") || isApiError(e, "OTP_EXPIRED"));
        setError(describeError(e, messageFor));
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verify exactly once per complete code
  }, [code]);

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await requestCode(email);
      setLocked(false);
      setResent(true);
      setCode("");
    } catch (e) {
      setError(describeError(e, messageFor));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Text variant="heading">Enter the code</Text>
      <Text variant="bodyMuted">{`Sent to ${email}. It works for 10 minutes.`}</Text>
      <Pressable onPress={() => input.current?.focus()} accessibilityRole="none">
        <View style={{ flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" }}>
          {Array.from({ length: 6 }, (_, i) => (
            <View
              key={i}
              testID={`code-box-${i}`}
              style={{
                flex: 1,
                height: 56,
                borderRadius: radius.md,
                borderCurve: "continuous",
                borderWidth: code.length === i ? 2 : 1,
                borderColor: error ? colors.bad : code.length === i ? colors.ink : colors.control,
                backgroundColor: colors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: fonts.head700, fontSize: 28 }}>{code[i] ?? ""}</Text>
            </View>
          ))}
        </View>
      </Pressable>
      <TextInput
        ref={input}
        accessibilityLabel="6-digit code"
        value={code}
        onChangeText={(t) => {
          setError(null);
          setCode(t.replace(/\D/g, "").slice(0, 6));
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        maxLength={12}
        editable={!busy && !locked}
        style={{ position: "absolute", opacity: 0, height: 1, width: 1 }}
      />
      {error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {resent ? <Text variant="caption">A new code is on its way</Text> : null}
      <Button title={locked ? "Send a new code" : "Resend code"} variant="secondary" onPress={() => void resend()} loading={busy && code.length < 6} />
    </View>
  );
}
```

`app/app/login.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { Screen } from "@/components/ui/screen";
import { authApi } from "@/features/auth/api";
import { EmailForm } from "@/features/auth/components/email-form";

export default function LoginScreen() {
  const router = useRouter();
  return (
    <Screen testID="login">
      <EmailForm requestCode={authApi.requestCode} onSent={(email) => router.push({ pathname: "/login-code", params: { email } })} />
    </Screen>
  );
}
```

`app/app/login-code.tsx`:

```tsx
import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";
import { Screen } from "@/components/ui/screen";
import { authApi } from "@/features/auth/api";
import { CodeForm } from "@/features/auth/components/code-form";
import { useSession } from "@/features/auth/session";

export default function LoginCodeScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const { signIn } = useSession();
  if (!email) return <Redirect href="/login" />;
  return (
    <Screen testID="login-code">
      <CodeForm
        email={email}
        verifyCode={authApi.verifyCode}
        requestCode={authApi.requestCode}
        onVerified={(pair) => void signIn({ accessToken: pair.accessToken, refreshToken: pair.refreshToken })}
      />
    </Screen>
  );
}
```

`CodeForm` deliberately keeps the hidden `TextInput` as the single source of digits so paste, autofill from SMS/email (`oneTimeCode`) and typing all go through the same digit filter (`pastedCodeKeepsDigitsOnly`).

- [ ] **Step 4: Run the tests**

Run: `cd app && npm test && npm run lint && npm run typecheck`
Expected: PASS. If `expo-router/testing-library` is not resolvable, it lives inside `expo-router` since SDK 50; check `node_modules/expo-router/testing-library` exists and that `jest-expo` is the preset (it is).

- [ ] **Step 5: Try it against the local server**

Start the server (`local` profile) and `npm run start` → web. Sign in with any email, fetch the code with the curl from Task 5, enter it: the app should land on the (temporary) index, which redirects to `/onboarding/income` and, until Task 8, shows the not-found screen. That is expected at this point; note it in the report.

- [ ] **Step 6: Red team**

Dispatch `red-team` with task id `plan-02-task-6`: email with leading/trailing unicode spaces, 300-character emails, codes with full-width digits (`１２３４５６`), rapid resend taps, back navigation from the code screen, deep link to `/login-code` without an email, deep link to `/(tabs)` while signed out (must land on login). Report to `docs/reports/red-team/plan-02-task-6.md`.

- [ ] **Step 7: Commit**

```bash
git add app/app app/src/components app/src/features docs/reports/red-team/plan-02-task-6.md
git commit -m "feat(app): root layout with hydration gate and protected routes, email-code sign-in, error boundaries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Gullak component: drawing, moods, stages, animation and Reduce Motion

**Owner:** app-engineer. **Test IDs:** APP-12, APP-13, APP-14 (component half: the coin, faint and celebrate animations exist and fire from props; Plans 3 and 6 wire the triggers), XP-09 (client mirror of stages). **Red team:** no.

**Files:**
- Create: `app/src/features/gullak/moods.ts`, `stage.ts`, `drawing.ts`, `gullak-still.tsx`, `gullak.tsx`, `gullak.test.tsx`

**Interfaces:**
- Produces: `Mood = "happy" | "calm" | "nervous" | "fainted" | "celebrating"`, `moodFor(percentUsed, over)`, `fromServerMood(m)`; `Stage`, `stageFor(level)`; `<Gullak mood stage size event? reduceMotion? />` where `event` is `{ kind: "coin" | "celebrate"; key: number }` and a new `key` replays it; `<GullakStill />`.

- [ ] **Step 1: Write the failing tests**

`app/src/features/gullak/gullak.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import React from "react";
import { useReducedMotion } from "react-native-reanimated";
import { Gullak } from "./gullak";
import { fromServerMood, moodFor } from "./moods";
import { stageFor } from "./stage";

jest.mock("react-native-reanimated", () => ({ ...jest.requireActual("react-native-reanimated"), useReducedMotion: jest.fn(() => false) }));
const mockedReduceMotion = useReducedMotion as jest.Mock;

describe("moodFor (APP-12)", () => {
  it.each([
    [0, "happy"],
    [49, "happy"],
    [50, "calm"],
    [79, "calm"],
    [80, "nervous"],
    [100, "nervous"],
    [101, "fainted"],
  ])("%i% used → %s", (percent, mood) => {
    expect(moodFor(percent)).toBe(mood);
  });

  it("maps the server's enum", () => {
    expect(fromServerMood("HAPPY")).toBe("happy");
    expect(fromServerMood("NERVOUS")).toBe("nervous");
    expect(fromServerMood("FAINTED")).toBe("fainted");
  });
});

describe("stageFor (XP-09 mirror)", () => {
  it.each([
    [1, "clay"],
    [4, "clay"],
    [5, "painted"],
    [9, "painted"],
    [10, "gold"],
    [19, "gold"],
    [20, "diamond"],
    [40, "diamond"],
  ])("level %i → %s", (level, stage) => {
    expect(stageFor(level)).toBe(stage);
  });
});

describe("Gullak", () => {
  it("renders a still with no animation when Reduce Motion is on (APP-13)", () => {
    render(<Gullak mood="happy" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-still")).toBeTruthy();
    expect(screen.queryByTestId("gullak-animated")).toBeNull();
  });

  it("reads the system Reduce Motion setting", () => {
    mockedReduceMotion.mockReturnValueOnce(true);
    render(<Gullak mood="happy" stage="clay" />);
    expect(screen.getByTestId("gullak-still")).toBeTruthy();
  });

  it("animates when motion is allowed", () => {
    render(<Gullak mood="happy" stage="clay" reduceMotion={false} />);
    expect(screen.getByTestId("gullak-animated")).toBeTruthy();
  });

  it.each([
    ["happy", "Gullak, happy"],
    ["calm", "Gullak, calm"],
    ["nervous", "Gullak, nervous and sweating"],
    ["fainted", "Gullak, fainted"],
    ["celebrating", "Gullak, celebrating"],
  ] as const)("labels the %s mood for screen readers", (mood, label) => {
    render(<Gullak mood={mood} stage="clay" reduceMotion />);
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it("the fainted Gullak is tilted even as a still", () => {
    render(<Gullak mood="fainted" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-still")).toHaveStyle({ transform: [{ rotate: "-14deg" }] });
  });

  it("shows the sweat drop only when nervous, confetti only when celebrating, stars only when fainted", () => {
    const { rerender } = render(<Gullak mood="nervous" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-sweat")).toHaveProp("opacity", 1);
    expect(screen.getByTestId("gullak-confetti")).toHaveProp("opacity", 0);
    rerender(<Gullak mood="celebrating" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-confetti")).toHaveProp("opacity", 1);
    expect(screen.getByTestId("gullak-sweat")).toHaveProp("opacity", 0);
    rerender(<Gullak mood="fainted" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-stars")).toHaveProp("opacity", 1);
  });

  it("a coin event renders the falling coin (APP-14, component half)", () => {
    const { rerender } = render(<Gullak mood="happy" stage="clay" reduceMotion={false} />);
    expect(screen.queryByTestId("gullak-coin")).toBeNull();
    rerender(<Gullak mood="happy" stage="clay" reduceMotion={false} event={{ kind: "coin", key: 1 }} />);
    expect(screen.getByTestId("gullak-coin")).toBeTruthy();
  });

  it("paints each stage with its own body colour", () => {
    const { rerender } = render(<Gullak mood="happy" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-body")).toHaveProp("fill", "#C0622F");
    rerender(<Gullak mood="happy" stage="gold" reduceMotion />);
    expect(screen.getByTestId("gullak-body")).toHaveProp("fill", "#D9A21B");
    rerender(<Gullak mood="happy" stage="diamond" reduceMotion />);
    expect(screen.getByTestId("gullak-body")).toHaveProp("fill", "#7FB7D9");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd app && npx jest src/features/gullak`
Expected: FAIL, modules missing.

- [ ] **Step 3: Write the code**

`app/src/features/gullak/moods.ts`:

```ts
export type Mood = "happy" | "calm" | "nervous" | "fainted" | "celebrating";

export type ServerMood = "HAPPY" | "CALM" | "NERVOUS" | "FAINTED";

/** Spec 2.6: 0–49 happy, 50–79 calm, 80–100 nervous, over 100 fainted. The server is the authority; this mirrors it for optimistic updates. */
export function moodFor(percentUsed: number): Mood {
  if (percentUsed > 100) return "fainted";
  if (percentUsed >= 80) return "nervous";
  if (percentUsed >= 50) return "calm";
  return "happy";
}

export function fromServerMood(mood: ServerMood): Mood {
  switch (mood) {
    case "HAPPY":
      return "happy";
    case "CALM":
      return "calm";
    case "NERVOUS":
      return "nervous";
    case "FAINTED":
      return "fainted";
  }
}

export const moodLabels: Record<Mood, string> = {
  happy: "Gullak, happy",
  calm: "Gullak, calm",
  nervous: "Gullak, nervous and sweating",
  fainted: "Gullak, fainted",
  celebrating: "Gullak, celebrating",
};
```

`app/src/features/gullak/stage.ts`:

```ts
export type Stage = "clay" | "painted" | "gold" | "diamond";

/** Spec 2.6: clay 1–4, painted 5–9, gold 10–19, diamond 20 and up. */
export function stageFor(level: number): Stage {
  if (level >= 20) return "diamond";
  if (level >= 10) return "gold";
  if (level >= 5) return "painted";
  return "clay";
}

export const stageLabels: Record<Stage, string> = { clay: "Clay pot", painted: "Painted", gold: "Gold", diamond: "Diamond" };
```

`app/src/features/gullak/drawing.ts` (the paths and palettes of the mockup's Gullak component, verbatim):

```ts
import type { Mood } from "./moods";
import type { Stage } from "./stage";

export const stagePaint: Record<Stage, { body: string; neck: string; rim: string; band: string; bandDash: string }> = {
  clay: { body: "#C0622F", neck: "#A24F22", rim: "#D57A45", band: "#C0622F", bandDash: "0 100" },
  painted: { body: "#C0622F", neck: "#A24F22", rim: "#D57A45", band: "#F6E3D7", bandDash: "6 6" },
  gold: { body: "#D9A21B", neck: "#B8860B", rim: "#EBC04F", band: "#FFF3C4", bandDash: "6 6" },
  diamond: { body: "#7FB7D9", neck: "#5B97BC", rim: "#A8D2EC", band: "#FFFFFF", bandDash: "2 5" },
};

const dotEyes = "M47 66h.01M73 66h.01";
const smileEyes = "M41 68q6-8 12 0M67 68q6-8 12 0";

export type Face = { eyes: string; mouth: string; mouthFill: string; brows: string; cheeks: number };

export const faces: Record<Mood, Face> = {
  happy: { eyes: smileEyes, mouth: "M50 80q10 11 20 0", mouthFill: "none", brows: "", cheeks: 1 },
  calm: { eyes: dotEyes, mouth: "M52 82q8 5 16 0", mouthFill: "none", brows: "", cheeks: 0.6 },
  nervous: { eyes: dotEyes, mouth: "M49 86q5.5-5 11 0q5.5 5 11 0", mouthFill: "none", brows: "M40 61l11-4M80 61l-11-4", cheeks: 0 },
  fainted: { eyes: "M42 61l10 10M52 61l-10 10M68 61l10 10M78 61l-10 10", mouth: "M60 80a5 6 0 1 0 0.01 0", mouthFill: "none", brows: "", cheeks: 0 },
  celebrating: { eyes: smileEyes, mouth: "M48 78q12 16 24 0z", mouthFill: "#2A1F1A", brows: "", cheeks: 1 },
};

/** Closed eyes for the blink: two short horizontal strokes at eye height. */
export const closedEyes = "M42 67h10M68 67h10";

export const ink = "#2A1F1A";
export const sweatBlue = "#5B9BD5";
export const gold = "#E0A02F";
```

`app/src/features/gullak/gullak-still.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import { closedEyes, faces, gold, ink, stagePaint, sweatBlue } from "./drawing";
import { moodLabels, type Mood } from "./moods";
import type { Stage } from "./stage";

export type GullakStillProps = {
  mood: Mood;
  stage: Stage;
  size?: number;
  /** When true the eyes are drawn closed (used by the blink). */
  eyesClosed?: boolean;
  /** The caller may pass overrides for animated layers; the still uses mood-driven defaults. */
  sweatOpacity?: number;
  confettiOpacity?: number;
  testID?: string;
};

/** The whole drawing, no animation. The animated Gullak draws the same thing and moves the wrapper and a few layers. */
export function GullakStill({ mood, stage, size = 200, eyesClosed = false, sweatOpacity, confettiOpacity, testID = "gullak-still" }: GullakStillProps) {
  const s = stagePaint[stage];
  const f = faces[mood];
  const sweat = sweatOpacity ?? (mood === "nervous" ? 1 : 0);
  const confetti = confettiOpacity ?? (mood === "celebrating" ? 1 : 0);
  const stars = mood === "fainted" ? 1 : 0;
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={moodLabels[mood]}
      style={{ width: size, height: size, transform: [{ rotate: mood === "fainted" ? "-14deg" : "0deg" }] }}
    >
      <GullakSvg size={size} paint={s} face={f} eyesClosed={eyesClosed} sweat={sweat} confetti={confetti} stars={stars} />
    </View>
  );
}

export const SWEAT_PATH = "M98 34c5 7 6 11 1 13c-5-2-4-6-1-13z";

export const eyeStroke = { fill: "none", stroke: ink, strokeWidth: 3.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The four confetti pieces; the animated version wraps them in an animated group. */
export function Confetti() {
  return (
    <>
      <Rect x="10" y="20" width="7" height="4" rx="1" fill={gold} transform="rotate(-25 13 22)" />
      <Rect x="100" y="14" width="7" height="4" rx="1" fill="#2F7D4F" transform="rotate(30 103 16)" />
      <Rect x="104" y="52" width="6" height="4" rx="1" fill={sweatBlue} transform="rotate(-15 107 54)" />
      <Rect x="6" y="56" width="6" height="4" rx="1" fill="#B94A22" transform="rotate(20 9 58)" />
    </>
  );
}

/** Layers the animated Gullak replaces with Reanimated-driven elements. Absent layers are drawn statically. */
export type GullakLayers = {
  eyesOpen?: React.ReactNode;
  eyesClosed?: React.ReactNode;
  sweat?: React.ReactNode;
  confetti?: React.ReactNode;
  coin?: React.ReactNode;
};

type SvgProps = {
  size: number;
  paint: (typeof stagePaint)[Stage];
  face: (typeof faces)[Mood];
  eyesClosed: boolean;
  sweat: number;
  confetti: number;
  stars: number;
  layers?: GullakLayers;
};

export function GullakSvg({ size, paint, face, eyesClosed, sweat, confetti, stars, layers }: SvgProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Ellipse cx="60" cy="112" rx="34" ry="4" fill={ink} opacity={0.12} />
      <Rect x="42" y="22" width="36" height="18" rx="6" fill={paint.neck} />
      <Rect x="38" y="17" width="44" height="10" rx="5" fill={paint.rim} />
      <Rect x="50" y="20" width="20" height="3.5" rx="1.75" fill="#3A1A0C" />
      {layers?.coin ?? null}
      <Ellipse testID="gullak-body" cx="60" cy="72" rx="46" ry="38" fill={paint.body} />
      <Path d="M20 60c13 6 27 9 40 9s27-3 40-9" fill="none" stroke={paint.band} strokeWidth={3} strokeLinecap="round" strokeDasharray={paint.bandDash} />
      <Path d="M30 92c9 6 19 9 30 9" fill="none" stroke="#FFFFFF" strokeOpacity={0.22} strokeWidth={4} strokeLinecap="round" />
      <Circle cx="38" cy="82" r="5" fill="#F28B82" opacity={face.cheeks} />
      <Circle cx="82" cy="82" r="5" fill="#F28B82" opacity={face.cheeks} />
      {face.brows ? <Path d={face.brows} fill="none" stroke={ink} strokeWidth={3} strokeLinecap="round" /> : null}
      {layers?.eyesOpen ?? (
        <G opacity={eyesClosed ? 0 : 1}>
          <Path d={face.eyes} {...eyeStroke} />
        </G>
      )}
      {layers?.eyesClosed ?? (
        <G opacity={eyesClosed ? 1 : 0}>
          <Path d={closedEyes} {...eyeStroke} />
        </G>
      )}
      <Path d={face.mouth} fill={face.mouthFill} stroke={ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {layers?.sweat ?? <Path testID="gullak-sweat" d={SWEAT_PATH} fill={sweatBlue} opacity={sweat} />}
      {layers?.confetti ?? (
        <G testID="gullak-confetti" opacity={confetti}>
          <Confetti />
        </G>
      )}
      <G testID="gullak-stars" opacity={stars} fill={gold}>
        <Path d="M28 22l2 4 4 1-4 1-2 4-2-4-4-1 4-1z" />
        <Path d="M92 14l1.5 3 3 1-3 1-1.5 3-1.5-3-3-1 3-1z" />
      </G>
    </Svg>
  );
}
```

`app/src/features/gullak/gullak.tsx`:

```tsx
import React, { useEffect } from "react";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Circle, G, Path } from "react-native-svg";
import { motion } from "@/theme";
import { closedEyes, faces, gold, stagePaint, sweatBlue } from "./drawing";
import { Confetti, GullakStill, GullakSvg, SWEAT_PATH, eyeStroke, type GullakLayers } from "./gullak-still";
import { moodLabels, type Mood } from "./moods";
import type { Stage } from "./stage";

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

export type GullakEvent = { kind: "coin" | "celebrate"; key: number };

export type GullakProps = {
  mood: Mood;
  stage: Stage;
  size?: number;
  /** A new `key` replays the event: a coin drop when a spend is added, a jump with confetti on a win. */
  event?: GullakEvent;
  /** Test and preview override; otherwise the system setting decides. */
  reduceMotion?: boolean;
};

/**
 * Animation gate (expo-animation skill): the idle bounce and blink are the mascot's signature (spec 2.6),
 * kept to 3px and off under Reduce Motion; coin, faint and celebrate are rare, event-driven delight.
 * Everything runs on the UI thread: transform and opacity only.
 */
export function Gullak({ mood, stage, size = 200, event, reduceMotion }: GullakProps) {
  const system = useReducedMotion();
  const reduced = reduceMotion ?? system;
  if (reduced) {
    return <GullakStill mood={mood} stage={stage} size={size} />;
  }
  return <AnimatedGullak mood={mood} stage={stage} size={size} event={event} />;
}

function AnimatedGullak({ mood, stage, size, event }: Required<Pick<GullakProps, "mood" | "stage" | "size">> & { event?: GullakEvent }) {
  const bounce = useSharedValue(0); // translateY of the whole Gullak
  const tilt = useSharedValue(0); // degrees; -14 when fainted
  const blink = useSharedValue(0); // 0 open, 1 closed
  const sweat = useSharedValue(mood === "nervous" ? 1 : 0);
  const confetti = useSharedValue(mood === "celebrating" ? 1 : 0);
  const coinY = useSharedValue(-24);
  const coinOpacity = useSharedValue(0);

  useEffect(() => {
    if (mood === "fainted") {
      cancelAnimation(bounce);
      cancelAnimation(blink);
      bounce.set(withTiming(0, { duration: motion.base, easing: EASE_OUT }));
      blink.set(0);
      tilt.set(withSpring(-14, { duration: 500, dampingRatio: 0.6 }));
      return;
    }
    tilt.set(withSpring(0, { duration: 400, dampingRatio: 1 }));
    bounce.set(
      withRepeat(
        withSequence(
          withTiming(-3, { duration: motion.gullakIdle / 2, easing: EASE_IN_OUT }),
          withTiming(0, { duration: motion.gullakIdle / 2, easing: EASE_IN_OUT }),
        ),
        -1,
        false,
      ),
    );
    blink.set(withRepeat(withSequence(withDelay(3400, withTiming(1, { duration: 80 })), withTiming(0, { duration: 100 })), -1, false));
    return () => {
      cancelAnimation(bounce);
      cancelAnimation(blink);
    };
  }, [mood, bounce, blink, tilt]);

  useEffect(() => {
    cancelAnimation(sweat);
    if (mood === "nervous") {
      sweat.set(withRepeat(withSequence(withTiming(1, { duration: 600 }), withTiming(0.4, { duration: 600 })), -1, true));
    } else {
      sweat.set(withTiming(0, { duration: motion.fast }));
    }
    confetti.set(withTiming(mood === "celebrating" ? 1 : 0, { duration: motion.base }));
  }, [mood, sweat, confetti]);

  useEffect(() => {
    if (!event) return;
    if (event.kind === "coin") {
      coinY.set(-24);
      coinOpacity.set(withSequence(withTiming(1, { duration: 50 }), withDelay(450, withTiming(0, { duration: 100 }))));
      coinY.set(withTiming(26, { duration: 600, easing: EASE_OUT }));
      bounce.set(withSequence(withTiming(2, { duration: 120, easing: EASE_OUT }), withTiming(0, { duration: 200, easing: EASE_OUT })));
    } else {
      bounce.set(withSequence(withSpring(-18, { duration: 300, dampingRatio: 0.6 }), withSpring(0, { duration: 400, dampingRatio: 0.8 })));
      confetti.set(withSequence(withTiming(1, { duration: 100 }), withDelay(700, withTiming(mood === "celebrating" ? 1 : 0, { duration: 200 }))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replay only when the event key changes
  }, [event?.key]);

  const wrapper = useAnimatedStyle(() => ({ transform: [{ translateY: bounce.get() }, { rotate: `${tilt.get()}deg` }] }));
  const eyesOpenProps = useAnimatedProps(() => ({ opacity: 1 - blink.get() }));
  const eyesClosedProps = useAnimatedProps(() => ({ opacity: blink.get() }));
  const sweatProps = useAnimatedProps(() => ({ opacity: sweat.get() }));
  const confettiProps = useAnimatedProps(() => ({ opacity: confetti.get() }));
  const coinProps = useAnimatedProps(() => ({ cy: 20 + coinY.get(), opacity: coinOpacity.get() }));

  const face = faces[mood];
  const layers: GullakLayers = {
    eyesOpen: (
      <AnimatedG animatedProps={eyesOpenProps}>
        <Path d={face.eyes} {...eyeStroke} />
      </AnimatedG>
    ),
    eyesClosed: (
      <AnimatedG animatedProps={eyesClosedProps}>
        <Path d={closedEyes} {...eyeStroke} />
      </AnimatedG>
    ),
    sweat: <AnimatedPath testID="gullak-sweat" d={SWEAT_PATH} fill={sweatBlue} animatedProps={sweatProps} />,
    confetti: (
      <AnimatedG testID="gullak-confetti" animatedProps={confettiProps}>
        <Confetti />
      </AnimatedG>
    ),
    coin: event?.kind === "coin" ? <AnimatedCircle testID="gullak-coin" cx="60" r="6" fill={gold} stroke="#B8860B" strokeWidth={1.5} animatedProps={coinProps} /> : null,
  };

  return (
    <Animated.View
      testID="gullak-animated"
      accessibilityRole="image"
      accessibilityLabel={moodLabels[mood]}
      style={[{ width: size, height: size }, wrapper]}
    >
      <GullakSvg
        size={size}
        paint={stagePaint[stage]}
        face={face}
        eyesClosed={false}
        sweat={mood === "nervous" ? 1 : 0}
        confetti={mood === "celebrating" ? 1 : 0}
        stars={mood === "fainted" ? 1 : 0}
        layers={layers}
      />
    </Animated.View>
  );
}
```

Verify on a device that the eyes blink and the sweat drop pulses. If a react-native-svg version ignores `opacity` from `animatedProps` on `G`, move the `animatedProps` onto `AnimatedPath` elements inside the group instead; the still and the tests do not change.

- [ ] **Step 4: Run the tests**

Run: `cd app && npx jest src/features/gullak && npm run lint && npm run typecheck`
Expected: PASS, 24 tests.

- [ ] **Step 5: Look at it**

Add a temporary preview to `app/app/index.tsx`? No: use the web build's dev menu instead. Run `npm run start`, open the app on a device or simulator and, in a scratch route file that is not committed (`app/app/gullak-preview.tsx`), render the five moods and four stages side by side with a button that fires `coin` and `celebrate`. Check on the slowest Android available: the bounce must not stutter while scrolling. Delete the scratch file before committing.

- [ ] **Step 6: Commit**

```bash
git add app/src/features/gullak
git commit -m "feat(app): the Gullak: SVG drawing, moods, stages, UI-thread animation, Reduce Motion still

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Setup steps 1 and 2: income and payday, fixed costs

**Owner:** app-engineer. **Test IDs:** APP-25, APP-24, ERR-13 (fixed-cost screen), E2E-01 (steps 1–2). **Red team:** no.

**Files:**
- Create: `app/src/features/profile/setup-store.tsx`, `app/src/features/profile/components/payday-picker.tsx`, `app/src/features/profile/components/fixed-cost-list.tsx`, `app/src/features/profile/components/undo-bar.tsx`, `app/src/features/profile/components/income.test.tsx`, `app/src/features/profile/components/fixed-costs.test.tsx`, `app/app/onboarding/_layout.tsx`, `app/app/onboarding/income.tsx`, `app/app/onboarding/fixed-costs.tsx`, `app/src/features/profile/screens/income-screen.tsx`, `app/src/features/profile/screens/fixed-costs-screen.tsx`
- Modify: `app/src/features/profile/api.ts`, `app/src/features/profile/hooks.ts`

**Interfaces:**
- Consumes: `cycleLine`, `todayIst`, `parseRupeesToPaise`, `formatRupees`, `kv`, UI primitives, `useProfile`.
- Produces: `SetupProvider`, `useSetup()` with `draft` and `set(patch)`; `profileApi.put`, `fixedCostApi.list/add/patch/remove`; `useFixedCosts`, `useAddFixedCost`, `usePatchFixedCost`, `useRemoveFixedCost`, `usePutProfile`; `PaydayPicker`, `FixedCostList`, `UndoBar`; routes `/onboarding/income`, `/onboarding/fixed-costs`.

- [ ] **Step 1: API and hooks**

Extend `app/src/features/profile/api.ts`:

```ts
export type ProfileRequest = Omit<Profile, "paydayDay"> & { paydayDay?: number };

export type FixedCost = { id: string; name: string; amountPaise: number };

export const profileApi = {
  get: () => api.get<Profile>("/me/profile"),
  put: (body: ProfileRequest) => api.put<Profile>("/me/profile", body),
};

export const fixedCostApi = {
  list: () => api.get<FixedCost[]>("/me/fixed-costs"),
  add: (body: { name: string; amountPaise: number }) => api.post<FixedCost>("/me/fixed-costs", body),
  patch: (id: string, body: { name?: string; amountPaise?: number }) => api.patch<FixedCost>(`/me/fixed-costs/${id}`, body),
  remove: (id: string) => api.del<void>(`/me/fixed-costs/${id}`),
};
```

Extend `app/src/features/profile/hooks.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fixedCostApi, profileApi, type FixedCost, type ProfileRequest } from "./api";

export const profileKeys = { profile: ["profile"] as const, fixedCosts: ["fixed-costs"] as const };

export function useFixedCosts() {
  return useQuery<FixedCost[]>({ queryKey: profileKeys.fixedCosts, queryFn: fixedCostApi.list });
}

export function useAddFixedCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fixedCostApi.add,
    onSuccess: (created) => qc.setQueryData<FixedCost[]>(profileKeys.fixedCosts, (old) => [...(old ?? []), created]),
  });
}

export function usePatchFixedCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; amountPaise?: number } }) => fixedCostApi.patch(id, body),
    onSuccess: (updated) => qc.setQueryData<FixedCost[]>(profileKeys.fixedCosts, (old) => (old ?? []).map((f) => (f.id === updated.id ? updated : f))),
  });
}

export function useRemoveFixedCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fixedCostApi.remove(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: profileKeys.fixedCosts });
      const previous = qc.getQueryData<FixedCost[]>(profileKeys.fixedCosts) ?? [];
      qc.setQueryData<FixedCost[]>(profileKeys.fixedCosts, previous.filter((f) => f.id !== id));
      return { previous };
    },
    onError: (_e, _id, ctx) => {
      if (ctx) qc.setQueryData(profileKeys.fixedCosts, ctx.previous);
    },
  });
}

export function usePutProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileRequest) => profileApi.put(body),
    onSuccess: (profile) => {
      qc.setQueryData(profileKeys.profile, profile);
      void qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}
```

(Keep the existing `useProfile` and merge the `profileKeys` constant.)

- [ ] **Step 2: Write the failing tests**

`app/src/features/profile/components/income.test.tsx` (APP-25 and the typed-income review item):

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { IncomeScreen } from "../screens/income-screen";
import { SetupProvider, useSetup } from "../setup-store";
import { Text } from "react-native";

function Draft() {
  const { draft } = useSetup();
  return <Text testID="draft">{JSON.stringify(draft)}</Text>;
}

function renderIncome(onContinue = jest.fn()) {
  render(
    <SetupProvider persist={false}>
      <IncomeScreen today="2026-10-23" onContinue={onContinue} />
      <Draft />
    </SetupProvider>,
  );
  return onContinue;
}

describe("Setup 1: income and payday (APP-25)", () => {
  it("typedIncomeStripsEverythingButDigits", () => {
    renderIncome();
    fireEvent.changeText(screen.getByLabelText("Take-home pay per month"), "₹50,000.75");
    expect(screen.getByTestId("draft")).toHaveTextContent('"incomePaise":5000000');
  });

  it("each payday option updates the cycle line", () => {
    renderIncome();
    fireEvent.press(screen.getByRole("radio", { name: "1st of the month" }));
    expect(screen.getByText("Your budget cycle runs 1 Nov – 30 Nov, then 1 Dec – 31 Dec")).toBeTruthy();
    fireEvent.press(screen.getByRole("radio", { name: "Last working day" }));
    expect(screen.getByText("Your budget cycle runs 30 Oct – 29 Nov, then 30 Nov – 30 Dec")).toBeTruthy();
    fireEvent.press(screen.getByRole("radio", { name: "7th of the month" }));
    expect(screen.getByText("Your budget cycle runs 7 Nov – 6 Dec, then 7 Dec – 6 Jan")).toBeTruthy();
  });

  it("Another date shows the day select and the line follows the day", () => {
    renderIncome();
    expect(screen.queryByText("Day of the month")).toBeNull();
    fireEvent.press(screen.getByRole("radio", { name: "Another date" }));
    expect(screen.getByText("Day of the month")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "15th" }));
    expect(screen.getByText("Your budget cycle runs 15 Nov – 14 Dec, then 15 Dec – 14 Jan")).toBeTruthy();
    expect(screen.getByTestId("draft")).toHaveTextContent('"day":15');
  });

  it("Continue needs an income and a payday", () => {
    const onContinue = renderIncome();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.changeText(screen.getByLabelText("Take-home pay per month"), "50000");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.press(screen.getByRole("radio", { name: "1st of the month" }));
    fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("Another date without a day keeps Continue disabled", () => {
    renderIncome();
    fireEvent.changeText(screen.getByLabelText("Take-home pay per month"), "50000");
    fireEvent.press(screen.getByRole("radio", { name: "Another date" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});
```

`app/src/features/profile/components/fixed-costs.test.tsx` (APP-24, ERR-13):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { ApiError, NetworkError } from "@/lib/api-errors";
import type { FixedCost } from "../api";
import { FixedCostsScreen } from "../screens/fixed-costs-screen";

jest.mock("../api", () => ({ fixedCostApi: { list: jest.fn(), add: jest.fn(), patch: jest.fn(), remove: jest.fn() }, profileApi: { get: jest.fn(), put: jest.fn() } }));
import { fixedCostApi } from "../api";
const mocked = fixedCostApi as jest.Mocked<typeof fixedCostApi>;

function renderScreen(onContinue = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FixedCostsScreen onContinue={onContinue} onBack={() => {}} />
    </QueryClientProvider>,
  );
  return onContinue;
}

let nextId = 1;
beforeEach(() => {
  nextId = 1;
  jest.useRealTimers();
  mocked.list.mockResolvedValue([]);
  mocked.add.mockImplementation((b) => Promise.resolve({ id: `fc-${nextId++}`, ...b }));
  mocked.patch.mockImplementation((id, b) => Promise.resolve({ id, name: b.name ?? "Rent", amountPaise: b.amountPaise ?? 0 }));
  mocked.remove.mockResolvedValue(undefined);
});

describe("Setup 2: fixed costs (APP-24)", () => {
  it("adds a preset and shows the total", async () => {
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Add Rent, ₹10,000" }));
    expect(await screen.findByText("Rent")).toBeTruthy();
    expect(screen.getByTestId("fixed-total")).toHaveTextContent("₹10,000");
    expect(mocked.add).toHaveBeenCalledWith({ name: "Rent", amountPaise: 1000000 });
  });

  it("adds a custom cost with a typed name and amount", async () => {
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Add another" }));
    fireEvent.changeText(screen.getByLabelText("Name"), "Society maintenance");
    fireEvent.changeText(screen.getByLabelText("Amount per month"), "2,500");
    fireEvent.press(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Society maintenance")).toBeTruthy();
    expect(mocked.add).toHaveBeenCalledWith({ name: "Society maintenance", amountPaise: 250000 });
  });

  it("edits an amount in place", async () => {
    mocked.list.mockResolvedValue([{ id: "fc-9", name: "Rent", amountPaise: 1000000 }]);
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Edit Rent, ₹10,000" }));
    fireEvent.changeText(screen.getByLabelText("Amount per month"), "12000");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith("fc-9", { name: "Rent", amountPaise: 1200000 }));
  });

  it("removes with a 5-second undo", async () => {
    jest.useFakeTimers();
    mocked.list.mockResolvedValue([{ id: "fc-9", name: "Rent", amountPaise: 1000000 }]);
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Remove Rent" }));
    expect(screen.queryByText("Rent")).toBeNull();
    expect(screen.getByText("Rent removed")).toBeTruthy();
    expect(mocked.remove).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Rent")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Remove Rent" }));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledWith("fc-9"));
  });

  it("Add another hides when every preset is used", async () => {
    mocked.list.mockResolvedValue(
      ["Rent", "Cook", "Maid", "Monthly groceries", "Wi-Fi", "Phone bill", "EMI", "Gym"].map((name, i) => ({ id: `p${i}`, name, amountPaise: 100 })),
    );
    renderScreen();
    expect(await screen.findByText("Gym")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Add .*, ₹/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Add another" })).toBeTruthy(); // custom is always possible
  });

  it("a failed load shows Retry (ERR-13)", async () => {
    mocked.list.mockRejectedValueOnce(new NetworkError("offline")).mockResolvedValueOnce([]);
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Add another")).toBeTruthy();
  });

  it("a rejected add keeps the form and shows why", async () => {
    mocked.add.mockRejectedValueOnce(new ApiError("NOT_POSSIBLE", 422, "Savings and fixed costs leave nothing to spend. Save ₹0 or less."));
    renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Add EMI, ₹4,500" }));
    expect(await screen.findByText("Those numbers do not add up")).toBeTruthy();
  });

  it("Continue is allowed with no fixed costs", async () => {
    const onContinue = renderScreen();
    fireEvent.press(await screen.findByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd app && npx jest src/features/profile`
Expected: FAIL, modules missing.

- [ ] **Step 4: Write the code**

`app/src/features/profile/setup-store.tsx`:

```tsx
import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { kv } from "@/lib/kv";
import type { PaydayRule } from "@/lib/cycle";
import type { Personality } from "./api";

export type SetupDraft = {
  incomePaise: number;
  /** null until a payday option is picked; "Another date" without a day is `{ rule: "FIXED_DAY", day: null }`. */
  payday: PaydayRule | { rule: "FIXED_DAY"; day: null } | null;
  savingsPaise: number;
  /** null until the user edits the pre-filled money-left figure. */
  moneyLeftPaise: number | null;
  personality: Personality;
  morningTime: string;
  nightTime: string;
};

export const emptyDraft: SetupDraft = {
  incomePaise: 0,
  payday: null,
  savingsPaise: 0,
  moneyLeftPaise: null,
  personality: "CHILL",
  morningTime: "08:00",
  nightTime: "22:00",
};

type Setup = { draft: SetupDraft; set: (patch: Partial<SetupDraft>) => void; reset: () => void; hydrated: boolean };

const SetupContext = createContext<Setup | null>(null);
const KEY = "setup-draft";

/** The answers given during setup, kept across the five steps and across an app restart. */
export function SetupProvider({ children, persist = true }: { children: React.ReactNode; persist?: boolean }) {
  const [draft, setDraft] = useState<SetupDraft>(emptyDraft);
  const [hydrated, setHydrated] = useState(!persist);

  useEffect(() => {
    if (!persist) return;
    let alive = true;
    void kv.get(KEY).then((raw) => {
      if (!alive) return;
      if (raw) {
        try {
          setDraft({ ...emptyDraft, ...(JSON.parse(raw) as Partial<SetupDraft>) });
        } catch {
          void kv.remove(KEY);
        }
      }
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [persist]);

  const set = useCallback(
    (patch: Partial<SetupDraft>) =>
      setDraft((d) => {
        const next = { ...d, ...patch };
        if (persist) void kv.set(KEY, JSON.stringify(next));
        return next;
      }),
    [persist],
  );

  const reset = useCallback(() => {
    setDraft(emptyDraft);
    if (persist) void kv.remove(KEY);
  }, [persist]);

  const value = useMemo(() => ({ draft, set, reset, hydrated }), [draft, set, reset, hydrated]);
  return <SetupContext value={value}>{children}</SetupContext>;
}

export function useSetup(): Setup {
  const s = use(SetupContext);
  if (!s) throw new Error("useSetup needs a SetupProvider");
  return s;
}

export function paydayIsComplete(p: SetupDraft["payday"]): p is PaydayRule {
  return p !== null && (p.rule === "LAST_WORKING_DAY" || p.day !== null);
}
```

`app/src/features/profile/components/payday-picker.tsx`:

```tsx
import React from "react";
import { ScrollView, View } from "react-native";
import { Chip } from "@/components/ui/chip";
import { RadioCard } from "@/components/ui/radio-card";
import { Text } from "@/components/ui/text";
import { cycleLine } from "@/lib/cycle";
import { spacing } from "@/theme";
import type { SetupDraft } from "../setup-store";

type Option = { id: "first" | "last" | "seventh" | "other"; label: string };
const options: Option[] = [
  { id: "first", label: "1st of the month" },
  { id: "last", label: "Last working day" },
  { id: "seventh", label: "7th of the month" },
  { id: "other", label: "Another date" },
];

function ordinal(n: number): string {
  const s = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${s}`;
}

/** Days 2–28 except 7 (the 1st and 7th have their own cards); 29–31 are not offered (spec 2.1). */
const otherDays = Array.from({ length: 27 }, (_, k) => k + 2).filter((n) => n !== 7);

export type PaydayValue = SetupDraft["payday"];

function optionOf(value: PaydayValue): Option["id"] | null {
  if (value === null) return null;
  if (value.rule === "LAST_WORKING_DAY") return "last";
  if (value.day === 1) return "first";
  if (value.day === 7) return "seventh";
  return value.day === null || otherDays.includes(value.day) ? "other" : null;
}

export function PaydayPicker({ value, today, onChange }: { value: PaydayValue; today: string; onChange: (v: PaydayValue) => void }) {
  const selected = optionOf(value);
  const line = value === null ? null : value.rule === "LAST_WORKING_DAY" ? cycleLine(today, value) : value.day !== null ? cycleLine(today, { rule: "FIXED_DAY", day: value.day }) : null;
  return (
    <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
      <Text variant="label">When does salary arrive?</Text>
      {options.map((o) => (
        <RadioCard
          key={o.id}
          title={o.label}
          checked={selected === o.id}
          onPress={() => {
            if (o.id === "first") onChange({ rule: "FIXED_DAY", day: 1 });
            else if (o.id === "seventh") onChange({ rule: "FIXED_DAY", day: 7 });
            else if (o.id === "last") onChange({ rule: "LAST_WORKING_DAY" });
            else onChange({ rule: "FIXED_DAY", day: null });
          }}
        >
          {selected === o.id && o.id === "other" ? (
            <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
              <Text variant="labelMuted">Day of the month</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {otherDays.map((d) => (
                  <Chip key={d} label={ordinal(d)} selected={value?.rule === "FIXED_DAY" && value.day === d} onPress={() => onChange({ rule: "FIXED_DAY", day: d })} />
                ))}
              </ScrollView>
            </View>
          ) : null}
          {selected === o.id && line ? <Text variant="caption">{line}</Text> : null}
        </RadioCard>
      ))}
    </View>
  );
}
```

`app/src/features/profile/screens/income-screen.tsx`:

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { StepHeader } from "@/components/ui/step-header";
import { Text } from "@/components/ui/text";
import { formatRupees, parseRupeesToPaise } from "@/lib/money";
import { spacing } from "@/theme";
import { PaydayPicker } from "../components/payday-picker";
import { paydayIsComplete, useSetup } from "../setup-store";

export function IncomeScreen({ today, onContinue }: { today: string; onContinue: () => void }) {
  const { draft, set } = useSetup();
  const [typed, setTyped] = useState(draft.incomePaise ? String(draft.incomePaise / 100) : "");
  const canContinue = draft.incomePaise > 0 && paydayIsComplete(draft.payday);
  return (
    <Screen testID="setup-income" footer={<Button title="Continue" onPress={onContinue} disabled={!canContinue} />}>
      <StepHeader step={1} total={4} name="Income" />
      <Text variant="heading">Your salary</Text>
      <Text variant="bodyMuted">I'll turn it into a daily budget. Takes 2 minutes.</Text>
      <Field
        label="Take-home pay per month"
        prefix="₹"
        large
        value={typed}
        onChangeText={(t) => {
          const paise = parseRupeesToPaise(t);
          setTyped(paise ? String(paise / 100) : "");
          set({ incomePaise: paise });
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        hint={draft.incomePaise ? `${formatRupees(draft.incomePaise)} a month. After tax and PF. Only you can see this.` : "After tax and PF. Only you can see this."}
      />
      <View style={{ height: spacing.sm }} />
      <PaydayPicker value={draft.payday} today={today} onChange={(payday) => set({ payday })} />
    </Screen>
  );
}
```

`app/src/features/profile/components/undo-bar.tsx`:

```tsx
import React, { useEffect } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { colors, motion, radius, spacing } from "@/theme";

/** An inline "X removed · Undo" row that commits after 5 seconds. Not a toast: it carries an action, so it sits in the content. */
export function UndoBar({ message, onUndo, onExpire }: { message: string; onUndo: () => void; onExpire: () => void }) {
  useEffect(() => {
    const t = setTimeout(onExpire, motion.undoWindow);
    return () => clearTimeout(t);
  }, [onExpire]);
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.dark, borderRadius: radius.md, paddingLeft: spacing.md, paddingRight: spacing.xs, minHeight: 52 }}
    >
      <Text variant="label" color={colors.darkText}>
        {message}
      </Text>
      <Button title="Undo" variant="ghost" textColor={colors.darkText} onPress={onUndo} style={{ paddingHorizontal: spacing.md }} />
    </View>
  );
}
```

`Button` (Task 2) has no `textColor` prop yet: add `textColor?: string` to `ButtonProps` and use it as the `Text` colour when given (`color={textColor ?? v.text}`), so the ghost button reads on the dark bar.

`app/src/features/profile/components/fixed-cost-list.tsx`:

```tsx
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { formatRupees, parseRupeesToPaise } from "@/lib/money";
import { colors, radius, spacing, touchTarget } from "@/theme";
import type { FixedCost } from "../api";

export const presets: { name: string; amountPaise: number }[] = [
  { name: "Rent", amountPaise: 1000000 },
  { name: "Cook", amountPaise: 200000 },
  { name: "Maid", amountPaise: 150000 },
  { name: "Monthly groceries", amountPaise: 150000 },
  { name: "Wi-Fi", amountPaise: 70000 },
  { name: "Phone bill", amountPaise: 29900 },
  { name: "EMI", amountPaise: 450000 },
  { name: "Gym", amountPaise: 150000 },
];

export function FixedCostRow({ cost, onEdit, onRemove }: { cost: FixedCost; onEdit: () => void; onRemove: () => void }) {
  const amount = formatRupees(cost.amountPaise);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: touchTarget + 8, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${cost.name}, ${amount}`} onPress={onEdit} style={{ flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: touchTarget }}>
        <Text variant="body">{cost.name}</Text>
        <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
          {amount}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${cost.name}`} onPress={onRemove} hitSlop={6} style={{ width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center" }}>
        <Icon name="x" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

export function FixedCostForm({ initial, onSubmit, onCancel, submitLabel, busy, error }: { initial?: FixedCost; onSubmit: (v: { name: string; amountPaise: number }) => void; onCancel: () => void; submitLabel: "Add" | "Save"; busy: boolean; error?: string }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amountPaise / 100) : "");
  const paise = parseRupeesToPaise(amount);
  const valid = name.trim().length > 0 && name.trim().length <= 60 && paise > 0;
  return (
    <View style={{ gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
      <Field label="Name" value={name} onChangeText={setName} maxLength={60} autoFocus={!initial} />
      <Field label="Amount per month" prefix="₹" value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d,]/g, ""))} keyboardType="number-pad" inputMode="numeric" error={error} />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button title={submitLabel} onPress={() => onSubmit({ name: name.trim(), amountPaise: paise })} disabled={!valid} loading={busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
```

`app/src/features/profile/screens/fixed-costs-screen.tsx`:

```tsx
import React, { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ErrorState } from "@/components/ui/error-state";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { StepHeader } from "@/components/ui/step-header";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { formatRupees } from "@/lib/money";
import { colors, spacing } from "@/theme";
import type { FixedCost } from "../api";
import { FixedCostForm, FixedCostRow, presets } from "../components/fixed-cost-list";
import { UndoBar } from "../components/undo-bar";
import { useAddFixedCost, useFixedCosts, usePatchFixedCost, useRemoveFixedCost } from "../hooks";

type Pending = { cost: FixedCost };

export function FixedCostsScreen({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  const costs = useFixedCosts();
  const add = useAddFixedCost();
  const patch = usePatchFixedCost();
  const remove = useRemoveFixedCost();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FixedCost | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = (costs.data ?? []).filter((c) => c.id !== pending?.cost.id);
  const total = list.reduce((s, c) => s + c.amountPaise, 0);
  const unused = presets.filter((p) => !list.some((c) => c.name === p.name));

  const commitRemove = useCallback(() => {
    if (!pending) return;
    const { cost } = pending;
    setPending(null);
    remove.mutate(cost.id, { onError: (e) => setError(describeError(e, messageFor)) });
  }, [pending, remove]);

  function addCost(v: { name: string; amountPaise: number }) {
    setError(null);
    add.mutate(v, { onSuccess: () => setAdding(false), onError: (e) => setError(describeError(e, messageFor)) });
  }

  return (
    <Screen testID="setup-fixed-costs" footer={<Button title="Continue" onPress={onContinue} />}>
      <StepHeader step={2} total={4} name="Fixed costs" onBack={onBack} />
      <Text variant="heading">Fixed costs</Text>
      <Text variant="bodyMuted">Bills that come every month. They never count against your daily budget.</Text>
      {costs.isLoading ? (
        <View style={{ gap: spacing.sm }}>
          <Skeleton height={52} />
          <Skeleton height={52} />
        </View>
      ) : costs.error && !costs.data ? (
        <ErrorState body={describeError(costs.error, messageFor)} onRetry={() => void costs.refetch()} />
      ) : (
        <View>
          {list.map((c) =>
            editing?.id === c.id ? (
              <FixedCostForm
                key={c.id}
                initial={c}
                submitLabel="Save"
                busy={patch.isPending}
                error={error ?? undefined}
                onCancel={() => setEditing(null)}
                onSubmit={(v) => patch.mutate({ id: c.id, body: v }, { onSuccess: () => setEditing(null), onError: (e) => setError(describeError(e, messageFor)) })}
              />
            ) : (
              <FixedCostRow key={c.id} cost={c} onEdit={() => setEditing(c)} onRemove={() => setPending({ cost: c })} />
            ),
          )}
          {pending ? (
            <UndoBar message={`${pending.cost.name} removed`} onUndo={() => setPending(null)} onExpire={commitRemove} />
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.cm }}>
            <Text variant="bodyStrong">Total</Text>
            <Text variant="bodyStrong" testID="fixed-total" style={{ fontVariant: ["tabular-nums"] }}>
              {formatRupees(total)}
            </Text>
          </View>
        </View>
      )}
      {error && !adding && !editing ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {adding ? (
        <FixedCostForm submitLabel="Add" busy={add.isPending} error={error ?? undefined} onCancel={() => setAdding(false)} onSubmit={addCost} />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {unused.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {unused.map((p) => (
                <Chip key={p.name} label={`Add ${p.name}, ${formatRupees(p.amountPaise)}`} onPress={() => addCost(p)} />
              ))}
            </ScrollView>
          ) : null}
          <Button title="Add another" variant="secondary" onPress={() => setAdding(true)} />
        </View>
      )}
      <Text variant="caption">SIPs and RDs go in the next step, as savings</Text>
    </Screen>
  );
}
```

The preset chips are labelled "Add Rent, ₹10,000" so a screen reader says what the tap does; the visible chip text is the same string, matching the mockup's "Rent ₹10,000" pills closely enough while staying honest about the action.

`app/app/onboarding/_layout.tsx`:

```tsx
import { Stack } from "expo-router/stack";
import React from "react";
import { SetupProvider } from "@/features/profile/setup-store";
import { colors } from "@/theme";

export default function OnboardingLayout() {
  return (
    <SetupProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />
    </SetupProvider>
  );
}
```

`app/app/onboarding/income.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { IncomeScreen } from "@/features/profile/screens/income-screen";
import { useSetup } from "@/features/profile/setup-store";
import { todayIst } from "@/lib/dates";

export default function IncomeRoute() {
  const router = useRouter();
  const { hydrated } = useSetup();
  if (!hydrated) return null;
  return <IncomeScreen today={todayIst()} onContinue={() => router.push("/onboarding/fixed-costs")} />;
}
```

`app/app/onboarding/fixed-costs.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { FixedCostsScreen } from "@/features/profile/screens/fixed-costs-screen";

export default function FixedCostsRoute() {
  const router = useRouter();
  return <FixedCostsScreen onContinue={() => router.push("/onboarding/savings")} onBack={() => router.back()} />;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd app && npm test && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/app/onboarding app/src/features/profile app/src/components/ui/button.tsx
git commit -m "feat(app): setup steps 1 and 2: income and payday, fixed costs with undo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Setup steps 3 to 5: savings with the reality check and money left, personality and times, notifications

**Owner:** app-engineer. **Test IDs:** APP-20, APP-21, APP-15 (sample lines), BUD-32 (screen), E2E-01 (steps 3–5). **Red team:** no.

**Files:**
- Create: `app/src/features/budget/api.ts`, `app/src/features/profile/components/savings-stepper.tsx`, `reality-check.tsx`, `money-left-card.tsx`, `personality-picker.tsx`, `time-picker.tsx`, `savings.test.tsx`, `personality.test.tsx`, `app/src/features/profile/screens/savings-screen.tsx`, `personality-screen.tsx`, `notifications-screen.tsx`, `app/src/features/gullak/lines.ts`, `app/src/lib/notifications.ts`, `app/src/lib/notifications.test.ts`, `app/app/onboarding/savings.tsx`, `personality.tsx`, `notifications.tsx`
- Modify: `app/app/_layout.tsx` (notification handler), `app/src/features/profile/hooks.ts` (`useFinishSetup`)

**Interfaces:**
- Consumes: `realityCheck`, `perDayPreview`, `firstCyclePreview`, `Stepper`, `Gullak`, `usePutProfile`, `kv`.
- Produces: `budgetApi.getToday/setFirstCycle`; `useFinishSetup()`; `scheduleDaily`, `askPermission`, `notificationCopy`; routes `/onboarding/savings`, `/onboarding/personality`, `/onboarding/notifications`.

- [ ] **Step 1: Write the failing tests**

`app/src/features/profile/components/savings.test.tsx` (APP-20, APP-21, BUD-32):

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { SavingsScreen } from "../screens/savings-screen";
import { SetupProvider, useSetup } from "../setup-store";

function Draft() {
  const { draft } = useSetup();
  return <Text testID="draft">{JSON.stringify(draft)}</Text>;
}

function renderSavings(onContinue = jest.fn()) {
  render(
    <SetupProvider persist={false}>
      <Seed />
      <SavingsScreen today="2026-10-23" fixedCosts={[{ id: "a", name: "Rent", amountPaise: 1000000 }, { id: "b", name: "Cook", amountPaise: 200000 }, { id: "c", name: "Maid", amountPaise: 150000 }, { id: "d", name: "Monthly groceries", amountPaise: 150000 }]} onContinue={onContinue} onBack={() => {}} />
      <Draft />
    </SetupProvider>,
  );
  return onContinue;
}

function Seed() {
  const { set, draft } = useSetup();
  React.useEffect(() => {
    if (draft.incomePaise === 0) set({ incomePaise: 5000000, payday: { rule: "FIXED_DAY", day: 1 }, savingsPaise: 2000000 });
  }, [set, draft.incomePaise]);
  return null;
}

describe("Setup 3: savings (APP-20)", () => {
  it("shows Doable with the per-day figure for the example user", () => {
    renderSavings();
    expect(screen.getByText("Doable")).toBeTruthy();
    expect(screen.getByText("You keep ₹500 a day for everything else")).toBeTruthy();
    expect(screen.getByText("Per day in November (30 days)")).toBeTruthy();
    expect(screen.getByText("Rent, cook, maid, monthly groceries")).toBeTruthy();
  });

  it("stepping up to ₹28,000 is tight; ₹35,000 is not possible and disables Continue", () => {
    renderSavings();
    for (let i = 0; i < 8; i++) fireEvent.press(screen.getByLabelText("Save ₹1,000 more"));
    expect(screen.getByText("Possible, but tight")).toBeTruthy();
    expect(screen.getByText("₹233 a day covers chai and the metro, not much else")).toBeTruthy();
    for (let i = 0; i < 7; i++) fireEvent.press(screen.getByLabelText("Save ₹1,000 more"));
    expect(screen.getByText("Not possible")).toBeTruthy();
    expect(screen.getByText("Only ₹35,000 is left after essentials. Try ₹27,000 or less.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lower your savings to continue" })).toBeDisabled();
  });

  it("typed amounts (APP-21): tapping the number opens a field; non-digits stripped; capped at the maximum", () => {
    renderSavings();
    fireEvent.press(screen.getByLabelText("Save every month, ₹20,000, tap to type an amount"));
    fireEvent.changeText(screen.getByLabelText("Save every month"), "₹2a5,000");
    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("draft")).toHaveTextContent('"savingsPaise":2500000');
    fireEvent.press(screen.getByLabelText("Save every month, ₹25,000, tap to type an amount"));
    fireEvent.changeText(screen.getByLabelText("Save every month"), "99999999");
    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("draft")).toHaveTextContent('"savingsPaise":3500000'); // income − fixed
  });

  it("money left until payday is pre-filled from BUD-32 and editable", () => {
    renderSavings();
    expect(screen.getByText("Left until payday")).toBeTruthy();
    expect(screen.getByText("₹4,354")).toBeTruthy();
    expect(screen.getByText("That's ₹483 a day until Sat, 31 Oct")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Change" }));
    fireEvent.changeText(screen.getByLabelText("Money left until payday"), "6000");
    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("That's ₹666 a day until Sat, 31 Oct")).toBeTruthy();
    expect(screen.getByTestId("draft")).toHaveTextContent('"moneyLeftPaise":600000');
  });

  it("Set savings later saves ₹0 and shows the nudge", () => {
    const onContinue = renderSavings();
    fireEvent.press(screen.getByRole("button", { name: "Set savings later" }));
    expect(screen.getByText("No savings this month. Set a target later from Me.")).toBeTruthy();
    expect(screen.getByTestId("draft")).toHaveTextContent('"savingsPaise":0');
    fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });
});
```

`app/src/features/profile/components/personality.test.tsx` (APP-15 sample lines, times, finish):

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { ApiError } from "@/lib/api-errors";
import { PersonalityScreen } from "../screens/personality-screen";
import { SetupProvider, useSetup } from "../setup-store";

function Seed() {
  const { set, draft } = useSetup();
  React.useEffect(() => {
    if (draft.incomePaise === 0) set({ incomePaise: 5000000, payday: { rule: "FIXED_DAY", day: 1 }, savingsPaise: 2000000 });
  }, [set, draft.incomePaise]);
  return null;
}

function renderIt(finish = jest.fn(() => Promise.resolve()), onDone = jest.fn()) {
  render(
    <SetupProvider persist={false}>
      <Seed />
      <PersonalityScreen today="2026-10-23" fixedPaise={1500000} finish={finish} onDone={onDone} onBack={() => {}} />
    </SetupProvider>,
  );
  return { finish, onDone };
}

describe("Setup 4: personality and message times", () => {
  it("shows the sample line in the chosen voice (APP-15)", () => {
    renderIt();
    expect(screen.getByText("₹483 left for today. Nice and steady.")).toBeTruthy();
    fireEvent.press(screen.getByRole("radio", { name: "Savage" }));
    expect(screen.getByText("₹483 left. Hide it before Swiggy smells it.")).toBeTruthy();
    fireEvent.press(screen.getByRole("radio", { name: "Indian mom" }));
    expect(screen.getByLabelText("Gullak, nervous and sweating")).toBeTruthy();
  });

  it("the start button names the day-one budget and sends the whole draft", async () => {
    const { finish, onDone } = renderIt();
    fireEvent.press(screen.getByRole("button", { name: "9:00 am" }));
    fireEvent.press(screen.getByRole("button", { name: "Start with ₹483 today" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(finish).toHaveBeenCalledWith({
      incomePaise: 5000000,
      savingsPaise: 2000000,
      paydayRule: "FIXED_DAY",
      paydayDay: 1,
      personality: "CHILL",
      morningTime: "09:00",
      nightTime: "22:00",
      timezone: "Asia/Kolkata",
      moneyLeftPaise: null,
    });
  });

  it("a server rejection shows inline and keeps the draft", async () => {
    const finish = jest.fn(() => Promise.reject(new ApiError("NOT_POSSIBLE", 422, "nope")));
    renderIt(finish);
    fireEvent.press(screen.getByRole("button", { name: "Start with ₹483 today" }));
    expect(await screen.findByText("Those numbers do not add up")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start with ₹483 today" })).toBeEnabled();
  });
});
```

`app/src/lib/notifications.test.ts`:

```ts
import { notificationCopy, scheduleDaily, type NotificationsApi } from "./notifications";

function fakeApi(granted = true): NotificationsApi & { scheduled: unknown[]; cancelled: string[] } {
  const scheduled: unknown[] = [];
  const cancelled: string[] = [];
  return {
    scheduled,
    cancelled,
    getPermissionsAsync: () => Promise.resolve({ granted }),
    requestPermissionsAsync: () => Promise.resolve({ granted }),
    getAllScheduledNotificationsAsync: () => Promise.resolve([{ identifier: "gullak.morning" }, { identifier: "other.app" }]),
    cancelScheduledNotificationAsync: (id) => void cancelled.push(id) ?? Promise.resolve(),
    scheduleNotificationAsync: (req) => void scheduled.push(req) ?? Promise.resolve("id"),
  };
}

describe("daily messages", () => {
  it("schedules a morning and a night message at the chosen times and replaces older ones", async () => {
    const api = fakeApi();
    await scheduleDaily({ morningTime: "08:00", nightTime: "22:30", personality: "CHILL" }, api);
    expect(api.cancelled).toEqual(["gullak.morning"]);
    expect(api.scheduled).toEqual([
      expect.objectContaining({ identifier: "gullak.morning", trigger: expect.objectContaining({ hour: 8, minute: 0 }) }),
      expect.objectContaining({ identifier: "gullak.night", trigger: expect.objectContaining({ hour: 22, minute: 30 }) }),
    ]);
  });

  it("schedules nothing without permission", async () => {
    const api = fakeApi(false);
    await scheduleDaily({ morningTime: "08:00", nightTime: "22:00", personality: "CHILL" }, api);
    expect(api.scheduled).toHaveLength(0);
  });

  it("copy exists for every personality and never contains an amount", () => {
    for (const p of ["CHILL", "SAVAGE", "MOM", "HYPE"] as const) {
      expect(notificationCopy[p].morning.body).not.toMatch(/₹|\d/);
      expect(notificationCopy[p].night.body).not.toMatch(/₹|\d/);
    }
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd app && npx jest src/features/profile src/lib/notifications`
Expected: FAIL, modules missing.

- [ ] **Step 3: Write the code**

`app/src/features/budget/api.ts`:

```ts
import { api } from "@/lib/client";
import type { ServerMood } from "@/features/gullak/moods";

export type Today = {
  date: string;
  budgetPaise: number;
  spentPaise: number;
  leftPaise: number;
  overPaise: number;
  poolOverPaise: number;
  mood: ServerMood;
  line: string;
  daysLeft: number;
  cycleStart: string;
  cycleEnd: string;
};

export const budgetApi = {
  getToday: () => api.get<Today>("/budget/today"),
  setFirstCycle: (moneyLeftPaise: number) => api.put<Today>("/budget/first-cycle", { moneyLeftPaise }),
};
```

`app/src/features/gullak/lines.ts` (the HAPPY lines, mirrored from the server's `GullakLines` for the setup preview; Plan 6 fetches them):

```ts
import type { Personality } from "@/features/profile/api";
import { formatRupees } from "@/lib/money";

const happy: Record<Personality, string> = {
  CHILL: "{left} left for today. Nice and steady.",
  SAVAGE: "{left} left. Hide it before Swiggy smells it.",
  MOM: "{left} left, beta. Ghar ka khana tonight, okay?",
  HYPE: "{left} to play with today. Look at you go.",
};

export function sampleLine(personality: Personality, leftPaise: number): string {
  return happy[personality].replace("{left}", formatRupees(leftPaise));
}
```

`app/src/features/profile/components/savings-stepper.tsx` (APP-21):

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Stepper } from "@/components/ui/stepper";
import { parseRupeesToPaise } from "@/lib/money";
import { spacing } from "@/theme";

export function SavingsStepper({ valuePaise, max, onChange }: { valuePaise: number; max: number; onChange: (paise: number) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  if (typing !== null) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Field label="Save every month" prefix="₹" large value={typing} onChangeText={(t) => setTyping(t.replace(/[^\d,]/g, ""))} keyboardType="number-pad" inputMode="numeric" autoFocus />
        <Button
          title="Done"
          onPress={() => {
            onChange(Math.min(max, parseRupeesToPaise(typing)));
            setTyping(null);
          }}
        />
      </View>
    );
  }
  return <Stepper label="Save every month" valuePaise={valuePaise} stepPaise={100000} min={0} max={max} onChange={onChange} onPressValue={() => setTyping(String(valuePaise / 100))} />;
}
```

`app/src/features/profile/components/reality-check.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Icon, type IconName } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { formatRupees } from "@/lib/money";
import type { Verdict } from "@/lib/budget";
import { colors, radius, spacing } from "@/theme";

const look: Record<Verdict, { icon: IconName; title: string; ink: string; bg: string }> = {
  doable: { icon: "check", title: "Doable", ink: colors.goodDeep, bg: colors.goodTint },
  tight: { icon: "alert", title: "Possible, but tight", ink: colors.warnInk, bg: colors.warnTint },
  notPossible: { icon: "x", title: "Not possible", ink: colors.bad, bg: colors.badTint },
};

export function RealityCheck({ verdict, perDayPaise, essentialsLeftPaise, suggestedSavingsPaise }: { verdict: Verdict; perDayPaise: number; essentialsLeftPaise: number; suggestedSavingsPaise: number }) {
  const l = look[verdict];
  const line =
    verdict === "doable"
      ? `You keep ${formatRupees(perDayPaise)} a day for everything else`
      : verdict === "tight"
        ? `${formatRupees(perDayPaise)} a day covers chai and the metro, not much else`
        : `Only ${formatRupees(essentialsLeftPaise)} is left after essentials. Try ${formatRupees(suggestedSavingsPaise)} or less.`;
  return (
    <View accessibilityRole="summary" style={{ flexDirection: "row", gap: spacing.cm, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: l.bg }}>
      <Icon name={l.icon} color={l.ink} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text variant="bodyStrong" color={l.ink}>
          {l.title}
        </Text>
        <Text variant="label" color={l.ink}>
          {line}
        </Text>
      </View>
    </View>
  );
}
```

`app/src/features/profile/components/money-left-card.tsx`:

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { formatDay } from "@/lib/dates";
import { formatRupees, parseRupeesToPaise } from "@/lib/money";
import type { FirstCyclePreview } from "@/lib/budget";
import { colors, radius, spacing } from "@/theme";

export function MoneyLeftCard({ preview, edited, onChange }: { preview: FirstCyclePreview; edited: boolean; onChange: (paise: number) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <View style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.sand }}>
      <Text variant="label">Left until payday</Text>
      <Text variant="caption">{edited ? "Your figure" : "Our guess for the rest of this cycle. Change it if you know better."}</Text>
      {typing !== null ? (
        <View style={{ gap: spacing.sm }}>
          <Field label="Money left until payday" prefix="₹" large value={typing} onChangeText={(t) => setTyping(t.replace(/[^\d,]/g, ""))} keyboardType="number-pad" inputMode="numeric" autoFocus />
          <Button
            title="Done"
            onPress={() => {
              onChange(parseRupeesToPaise(typing));
              setTyping(null);
            }}
          />
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text variant="amount">{formatRupees(preview.poolPaise)}</Text>
          <Button title="Change" variant="secondary" onPress={() => setTyping(String(preview.poolPaise / 100))} />
        </View>
      )}
      <Text variant="labelMuted">{`That's ${formatRupees(preview.dayBudgetPaise)} a day until ${formatDay(preview.cycleEnd)}`}</Text>
    </View>
  );
}
```

`app/src/features/profile/screens/savings-screen.tsx`:

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { StepHeader } from "@/components/ui/step-header";
import { Text } from "@/components/ui/text";
import { firstCyclePreview, perDayPreview, realityCheck, wholeRupees } from "@/lib/budget";
import { formatRupees } from "@/lib/money";
import { colors, spacing } from "@/theme";
import type { FixedCost } from "../api";
import { MoneyLeftCard } from "../components/money-left-card";
import { RealityCheck } from "../components/reality-check";
import { SavingsStepper } from "../components/savings-stepper";
import { paydayIsComplete, useSetup } from "../setup-store";

const MIN_PER_DAY_PAISE = 25000; // the "tight" line

function essentialsLabel(costs: FixedCost[]): string {
  if (costs.length === 0) return "No fixed costs";
  return costs.map((c, i) => (i === 0 ? c.name : c.name.toLowerCase())).join(", ");
}

export function SavingsScreen({ today, fixedCosts, onContinue, onBack }: { today: string; fixedCosts: FixedCost[]; onContinue: () => void; onBack: () => void }) {
  const { draft, set } = useSetup();
  const [deferred, setDeferred] = useState(false);
  const fixedPaise = fixedCosts.reduce((s, c) => s + c.amountPaise, 0);
  const payday = paydayIsComplete(draft.payday) ? draft.payday : { rule: "FIXED_DAY" as const, day: 1 };
  const next = perDayPreview({ freePaise: draft.incomePaise - fixedPaise - draft.savingsPaise, today, payday });
  const check = realityCheck({ incomePaise: draft.incomePaise, fixedPaise, savingsPaise: draft.savingsPaise, cycleDays: next.cycleDays });
  const maxSavings = Math.max(0, draft.incomePaise - fixedPaise);
  const suggested = wholeRupees(Math.max(0, Math.floor((draft.incomePaise - fixedPaise - MIN_PER_DAY_PAISE * next.cycleDays) / 100000) * 100000));
  const preview = firstCyclePreview({ monthlySpendablePaise: check.freePaise, today, payday, ...(draft.moneyLeftPaise !== null ? { moneyLeftPaise: draft.moneyLeftPaise } : {}) });
  const blocked = check.verdict === "notPossible";

  return (
    <Screen
      testID="setup-savings"
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button title={blocked ? "Lower your savings to continue" : "Continue"} onPress={onContinue} disabled={blocked} />
          {draft.savingsPaise > 0 ? (
            <Button
              title="Set savings later"
              variant="ghost"
              onPress={() => {
                set({ savingsPaise: 0 });
                setDeferred(true);
              }}
            />
          ) : null}
        </View>
      }
    >
      <StepHeader step={3} total={4} name="Savings" onBack={onBack} />
      <Text variant="heading">Monthly savings</Text>
      <Text variant="bodyMuted">This comes out first. Your daily budget is what's left.</Text>
      <SavingsStepper valuePaise={draft.savingsPaise} max={maxSavings} onChange={(savingsPaise) => set({ savingsPaise })} />
      <RealityCheck verdict={check.verdict} perDayPaise={check.perDayPaise} essentialsLeftPaise={draft.incomePaise - fixedPaise} suggestedSavingsPaise={suggested} />
      {deferred && draft.savingsPaise === 0 ? <Text variant="label" color={colors.warnInk}>No savings this month. Set a target later from Me.</Text> : null}
      <View style={{ gap: spacing.sm }}>
        <Row label="Salary" value={formatRupees(draft.incomePaise)} />
        <Row label={essentialsLabel(fixedCosts)} value={`−${formatRupees(fixedPaise)}`} />
        <Row label="Savings" value={`−${formatRupees(draft.savingsPaise)}`} />
        <Row label="Free to spend" value={formatRupees(Math.max(0, check.freePaise))} strong />
        <Row label={`Per day in ${next.cycleName} (${next.cycleDays} days)`} value={formatRupees(check.perDayPaise)} strong />
      </View>
      {!blocked && preview.proRated ? <MoneyLeftCard preview={preview} edited={draft.moneyLeftPaise !== null} onChange={(moneyLeftPaise) => set({ moneyLeftPaise })} /> : null}
    </Screen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}>
      <Text variant={strong ? "bodyStrong" : "body"} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant={strong ? "bodyStrong" : "body"} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
    </View>
  );
}
```

`app/src/features/profile/components/time-picker.tsx`:

```tsx
import React from "react";
import { ScrollView, View } from "react-native";
import { Chip } from "@/components/ui/chip";
import { Text } from "@/components/ui/text";
import { spacing } from "@/theme";

function label(t: string): string {
  const [h, m] = t.split(":").map(Number) as [number, number];
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

function range(fromHour: number, toHour: number): string[] {
  const out: string[] = [];
  for (let h = fromHour; h <= toHour; h++) for (const m of [0, 30]) if (!(h === toHour && m === 30)) out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  return out;
}

export const morningOptions = range(6, 11);
export const nightOptions = range(19, 23);

export function TimePicker({ title, value, options, onChange }: { title: string; value: string; options: string[]; onChange: (t: string) => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="label">{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {options.map((t) => (
          <Chip key={t} label={label(t)} selected={t === value} onPress={() => onChange(t)} />
        ))}
      </ScrollView>
    </View>
  );
}
```

`app/src/features/profile/components/personality-picker.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { RadioCard } from "@/components/ui/radio-card";
import { Gullak } from "@/features/gullak/gullak";
import { sampleLine } from "@/features/gullak/lines";
import type { Mood } from "@/features/gullak/moods";
import { Text } from "@/components/ui/text";
import { colors, radius, spacing } from "@/theme";
import type { Personality } from "../api";

export const personalities: { id: Personality; label: string; desc: string; mood: Mood }[] = [
  { id: "CHILL", label: "Chill friend", desc: "Calm, no judgement", mood: "calm" },
  { id: "SAVAGE", label: "Savage", desc: "Roasts you, lovingly", mood: "fainted" },
  { id: "MOM", label: "Indian mom", desc: "Worried, a little dramatic", mood: "nervous" },
  { id: "HYPE", label: "Hype-man", desc: "Cheers every small win", mood: "celebrating" },
];

export function PersonalityPicker({ value, dayBudgetPaise, onChange }: { value: Personality; dayBudgetPaise: number; onChange: (p: Personality) => void }) {
  const current = personalities.find((p) => p.id === value) ?? personalities[0];
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
        <Gullak mood={current.mood} stage="clay" size={120} />
        <Text variant="body" align="center">
          {sampleLine(value, dayBudgetPaise)}
        </Text>
      </View>
      <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
        {personalities.map((p) => (
          <RadioCard key={p.id} title={p.label} description={p.desc} checked={p.id === value} onPress={() => onChange(p.id)} />
        ))}
      </View>
    </View>
  );
}
```

`app/src/features/profile/screens/personality-screen.tsx`:

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { StepHeader } from "@/components/ui/step-header";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { firstCyclePreview } from "@/lib/budget";
import { messageFor } from "@/lib/errors";
import { formatRupees } from "@/lib/money";
import { colors, spacing } from "@/theme";
import type { ProfileRequest } from "../api";
import { PersonalityPicker } from "../components/personality-picker";
import { TimePicker, morningOptions, nightOptions } from "../components/time-picker";
import { paydayIsComplete, useSetup } from "../setup-store";

export type FinishSetupInput = ProfileRequest & { moneyLeftPaise: number | null };

type Props = { today: string; fixedPaise: number; finish: (input: FinishSetupInput) => Promise<void>; onDone: () => void; onBack: () => void };

export function PersonalityScreen({ today, fixedPaise, finish, onDone, onBack }: Props) {
  const { draft, set } = useSetup();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payday = paydayIsComplete(draft.payday) ? draft.payday : { rule: "FIXED_DAY" as const, day: 1 };
  const preview = firstCyclePreview({ monthlySpendablePaise: draft.incomePaise - fixedPaise - draft.savingsPaise, today, payday, ...(draft.moneyLeftPaise !== null ? { moneyLeftPaise: draft.moneyLeftPaise } : {}) });

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await finish({
        incomePaise: draft.incomePaise,
        savingsPaise: draft.savingsPaise,
        paydayRule: payday.rule,
        ...(payday.rule === "FIXED_DAY" ? { paydayDay: payday.day } : {}),
        personality: draft.personality,
        morningTime: draft.morningTime,
        nightTime: draft.nightTime,
        timezone: "Asia/Kolkata",
        moneyLeftPaise: draft.moneyLeftPaise,
      });
      onDone();
    } catch (e) {
      setError(describeError(e, messageFor));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      testID="setup-personality"
      footer={
        <View style={{ gap: spacing.xs }}>
          {error ? (
            <Text variant="label" color={colors.bad} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button title={`Start with ${formatRupees(preview.dayBudgetPaise)} today`} onPress={() => void start()} loading={busy} />
          <Text variant="caption" align="center">
            You can change this any time in Me
          </Text>
        </View>
      }
    >
      <StepHeader step={4} total={4} name="Personality" onBack={onBack} />
      <Text variant="heading">Gullak's personality</Text>
      <PersonalityPicker value={draft.personality} dayBudgetPaise={preview.dayBudgetPaise} onChange={(personality) => set({ personality })} />
      <Text variant="title">Daily messages</Text>
      <TimePicker title="Morning budget" value={draft.morningTime} options={morningOptions} onChange={(morningTime) => set({ morningTime })} />
      <TimePicker title="Night report" value={draft.nightTime} options={nightOptions} onChange={(nightTime) => set({ nightTime })} />
    </Screen>
  );
}
```

`useFinishSetup` in `app/src/features/profile/hooks.ts`:

```ts
import { budgetApi } from "@/features/budget/api";
import type { FinishSetupInput } from "./screens/personality-screen";

/** PUT the profile, then pin the first cycle's pool when the user changed the money-left figure. */
export function useFinishSetup() {
  const qc = useQueryClient();
  return useCallback(
    async ({ moneyLeftPaise, ...profile }: FinishSetupInput) => {
      const saved = await profileApi.put(profile);
      qc.setQueryData(profileKeys.profile, saved);
      if (moneyLeftPaise !== null) {
        const today = await budgetApi.setFirstCycle(moneyLeftPaise);
        qc.setQueryData(["today"], today);
      } else {
        await qc.invalidateQueries({ queryKey: ["today"] });
      }
    },
    [qc],
  );
}
```

`app/src/lib/notifications.ts`:

```ts
import type { Personality } from "@/features/profile/api";
import { log } from "./log";

export type NotificationsApi = {
  getPermissionsAsync(): Promise<{ granted: boolean }>;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  getAllScheduledNotificationsAsync(): Promise<{ identifier: string }[]>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  scheduleNotificationAsync(request: { identifier: string; content: { title: string; body: string }; trigger: { type: "daily"; hour: number; minute: number } }): Promise<string>;
};

/** Static per-personality copy; no amounts, because the message is scheduled hours ahead (spec 2.7). */
export const notificationCopy: Record<Personality, { morning: { title: string; body: string }; night: { title: string; body: string } }> = {
  CHILL: {
    morning: { title: "Morning", body: "Your number for today is ready" },
    night: { title: "How did today go?", body: "Your report card is in" },
  },
  SAVAGE: {
    morning: { title: "Wake up", body: "Your budget is waiting. So is Swiggy." },
    night: { title: "Report card time", body: "Brace yourself" },
  },
  MOM: {
    morning: { title: "Beta", body: "Check your budget before you leave the house" },
    night: { title: "Did you eat?", body: "Also, your report card is ready" },
  },
  HYPE: {
    morning: { title: "New day, new number", body: "Let's go" },
    night: { title: "Day done", body: "Come see your score" },
  },
};

function realApi(): NotificationsApi {
  // Imported lazily so the web build never loads expo-notifications (it is phone-only).
  const N = require("expo-notifications") as typeof import("expo-notifications");
  return {
    getPermissionsAsync: () => N.getPermissionsAsync(),
    requestPermissionsAsync: () => N.requestPermissionsAsync(),
    getAllScheduledNotificationsAsync: () => N.getAllScheduledNotificationsAsync(),
    cancelScheduledNotificationAsync: (id) => N.cancelScheduledNotificationAsync(id),
    scheduleNotificationAsync: (req) =>
      N.scheduleNotificationAsync({
        identifier: req.identifier,
        content: req.content,
        trigger: { type: N.SchedulableTriggerInputTypes.DAILY, hour: req.trigger.hour, minute: req.trigger.minute },
      }),
  };
}

export const notificationsSupported = process.env.EXPO_OS !== "web";

export async function askPermission(api: NotificationsApi = realApi()): Promise<boolean> {
  const current = await api.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await api.requestPermissionsAsync();
  log.info("notifications.permission", { granted: asked.granted });
  return asked.granted;
}

function parse(t: string): { hour: number; minute: number } {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return { hour: h, minute: m };
}

/** Replaces Gullak's two daily messages. Does nothing without permission. */
export async function scheduleDaily(opts: { morningTime: string; nightTime: string; personality: Personality }, api: NotificationsApi = realApi()): Promise<void> {
  if (!(await api.getPermissionsAsync()).granted) return;
  const existing = await api.getAllScheduledNotificationsAsync();
  for (const n of existing) if (n.identifier.startsWith("gullak.")) await api.cancelScheduledNotificationAsync(n.identifier);
  const copy = notificationCopy[opts.personality];
  await api.scheduleNotificationAsync({ identifier: "gullak.morning", content: copy.morning, trigger: { type: "daily", ...parse(opts.morningTime) } });
  await api.scheduleNotificationAsync({ identifier: "gullak.night", content: copy.night, trigger: { type: "daily", ...parse(opts.nightTime) } });
  log.info("notifications.scheduled", { count: 2 });
}
```

`app/src/features/profile/screens/notifications-screen.tsx`:

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { colors, spacing } from "@/theme";

const kinds: { icon: IconName; title: string; body: string }[] = [
  { icon: "sun", title: "Morning budget", body: "Your number for the day, at the time you picked" },
  { icon: "moon", title: "Night report", body: "How the day went, as a short report card" },
  { icon: "alert", title: "Close to the limit", body: "When a spend takes you past 80% of today" },
  { icon: "target", title: "Goals", body: "When a goal needs a catch-up plan, at most every 3 days" },
];

export function NotificationsScreen({ supported, onAllow, onSkip }: { supported: boolean; onAllow: () => Promise<void>; onSkip: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Screen
      testID="setup-notifications"
      footer={
        <View style={{ gap: spacing.sm }}>
          {supported ? (
            <Button
              title="Turn on notifications"
              loading={busy}
              onPress={() => {
                setBusy(true);
                void onAllow().finally(() => setBusy(false));
              }}
            />
          ) : null}
          <Button title={supported ? "Not now" : "Continue"} variant={supported ? "ghost" : "primary"} onPress={onSkip} />
        </View>
      }
    >
      <Text variant="heading">{supported ? "Two messages a day" : "Messages arrive on the phone app"}</Text>
      <Text variant="bodyMuted">At most 4 a day, never between 11 pm and 7 am, and each one can be switched off in Me</Text>
      <View style={{ gap: spacing.md }}>
        {kinds.map((k) => (
          <View key={k.title} style={{ flexDirection: "row", gap: spacing.cm, alignItems: "flex-start" }}>
            <Icon name={k.icon} color={colors.accentDeep} />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text variant="bodyStrong">{k.title}</Text>
              <Text variant="labelMuted">{k.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}
```

Routes:

`app/app/onboarding/savings.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { ErrorState } from "@/components/ui/error-state";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { useFixedCosts } from "@/features/profile/hooks";
import { SavingsScreen } from "@/features/profile/screens/savings-screen";
import { describeError } from "@/lib/api-errors";
import { todayIst } from "@/lib/dates";
import { messageFor } from "@/lib/errors";

export default function SavingsRoute() {
  const router = useRouter();
  const costs = useFixedCosts();
  if (costs.isLoading) {
    return (
      <Screen>
        <Skeleton height={44} />
        <Skeleton height={120} />
      </Screen>
    );
  }
  if (costs.error && !costs.data) {
    return (
      <Screen>
        <ErrorState body={describeError(costs.error, messageFor)} onRetry={() => void costs.refetch()} />
      </Screen>
    );
  }
  return <SavingsScreen today={todayIst()} fixedCosts={costs.data ?? []} onContinue={() => router.push("/onboarding/personality")} onBack={() => router.back()} />;
}
```

`app/app/onboarding/personality.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { useFinishSetup, useFixedCosts } from "@/features/profile/hooks";
import { PersonalityScreen } from "@/features/profile/screens/personality-screen";
import { useSetup } from "@/features/profile/setup-store";
import { todayIst } from "@/lib/dates";

export default function PersonalityRoute() {
  const router = useRouter();
  const finish = useFinishSetup();
  const costs = useFixedCosts();
  const { reset } = useSetup();
  const fixedPaise = (costs.data ?? []).reduce((s, c) => s + c.amountPaise, 0);
  return (
    <PersonalityScreen
      today={todayIst()}
      fixedPaise={fixedPaise}
      finish={finish}
      onDone={() => {
        reset();
        router.replace("/onboarding/notifications");
      }}
      onBack={() => router.back()}
    />
  );
}
```

`app/app/onboarding/notifications.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { useProfile } from "@/features/profile/hooks";
import { NotificationsScreen } from "@/features/profile/screens/notifications-screen";
import { kv } from "@/lib/kv";
import { log } from "@/lib/log";
import { askPermission, notificationsSupported, scheduleDaily } from "@/lib/notifications";

export default function NotificationsRoute() {
  const router = useRouter();
  const profile = useProfile();
  const done = async () => {
    await kv.set("notifications-asked", "1");
    router.replace("/(tabs)");
  };
  return (
    <NotificationsScreen
      supported={notificationsSupported}
      onAllow={async () => {
        try {
          if ((await askPermission()) && profile.data) {
            await scheduleDaily({ morningTime: profile.data.morningTime, nightTime: profile.data.nightTime, personality: profile.data.personality });
          }
        } catch (e) {
          log.warn("notifications.schedule_failed", { reason: e instanceof Error ? e.name : "unknown" });
        }
        await done();
      }}
      onSkip={() => void done()}
    />
  );
}
```

In `app/app/_layout.tsx`, above `installGlobalHandlers()`:

```tsx
if (process.env.EXPO_OS !== "web") {
  const Notifications = require("expo-notifications") as typeof import("expo-notifications");
  Notifications.setNotificationHandler({
    handleNotification: () => Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `cd app && npm test && npm run lint && npm run typecheck`
Expected: PASS. If ESLint's `@typescript-eslint/no-require-imports` flags the lazy `require` calls, add `// eslint-disable-next-line @typescript-eslint/no-require-imports -- phone-only module, kept out of the web bundle` above each; do not switch to a static import.

- [ ] **Step 5: Walk the whole setup against the local server**

With the server running: sign in, income ₹50,000 and payday 1st, add Rent ₹10,000, Cook ₹2,000, Maid ₹1,500, Monthly groceries ₹1,500, savings ₹20,000 (Doable), see the money-left card, Chill, 8:00 am and 10:00 pm, "Start with ₹… today", notifications step. The app then lands on `/(tabs)`, which Task 10 builds (until then the not-found screen). Check the server: `select pool_override_paise from cycles` shows the pro-rated figure (or your edited one).

- [ ] **Step 6: Commit**

```bash
git add app/app app/src
git commit -m "feat(app): setup steps 3 to 5: savings with the reality check and money left, personality and times, notifications

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Tabs, Home (first run and normal), Insights and Goals empty states, Me with sign-out

**Owner:** app-engineer. **Test IDs:** APP-11, APP-15, ERR-13 (Home), ERR-15 (per-tab boundaries), APP-26 (sign-out half), E2E-01 (Home half). **Red team:** yes (sign-out leaves nothing behind; cached figures never shown to the next user).

**Files:**
- Create: `app/src/features/budget/hooks.ts`, `app/src/features/home/hero.tsx`, `today-section.tsx`, `home-screen.tsx`, `home.test.tsx`, `app/src/features/tabs/tab-bar.tsx`, `tab-bar.test.tsx`, `app/app/(tabs)/_layout.tsx`, `index.tsx`, `insights.tsx`, `goals.tsx`, `me.tsx`, `app/src/features/profile/screens/me-screen.tsx`, `me.test.tsx`
- Modify: `app/src/features/auth/session.tsx` (`email`, cache wipe on sign-out), `app/src/features/auth/session.test.tsx`, `app/app/login-code.tsx`, `app/src/lib/kv.ts` (nothing new; used)

**Interfaces:**
- Consumes: `budgetApi`, `useProfile`, `Gullak`, `fromServerMood`, `formatRupees`, `formatDay`, `greeting`, `relativeTime`, `todayIst`, `kv`, `RouteErrorFallback`.
- Produces: `useToday()`, `todayKey`; `HomeScreen`; `TabBar`; `MeScreen`; `useSession().email`; routes `/(tabs)`, `/(tabs)/insights`, `/(tabs)/goals`, `/(tabs)/me`.

- [ ] **Step 1: Write the failing tests**

`app/src/features/home/home.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { AppState } from "react-native";
import { ApiError, NetworkError } from "@/lib/api-errors";
import { todayKey } from "@/features/budget/hooks";
import type { Today } from "@/features/budget/api";
import { HomeScreen } from "./home-screen";

jest.mock("@/features/budget/api", () => ({ budgetApi: { getToday: jest.fn(), setFirstCycle: jest.fn() } }));
jest.mock("@/lib/kv", () => ({ kv: { get: jest.fn(() => Promise.resolve(null)), set: jest.fn(() => Promise.resolve()), remove: jest.fn(() => Promise.resolve()) } }));
jest.mock("expo-router", () => ({ Redirect: () => null }));
import { budgetApi } from "@/features/budget/api";
import { kv } from "@/lib/kv";
const mocked = budgetApi as jest.Mocked<typeof budgetApi>;

const exampleDay: Today = {
  date: "2026-10-23",
  budgetPaise: 59300,
  spentPaise: 18000,
  leftPaise: 41300,
  overPaise: 0,
  poolOverPaise: 0,
  mood: "HAPPY",
  line: "₹413 left for today. Nice and steady.",
  daysLeft: 9,
  cycleStart: "2026-10-01",
  cycleEnd: "2026-10-31",
};

function renderHome(qc = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "offlineFirst" } } })) {
  render(
    <QueryClientProvider client={qc}>
      <HomeScreen now={new Date("2026-10-23T08:00:00Z")} />
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  onlineManager.setOnline(true);
  (kv.get as jest.Mock).mockResolvedValue(null);
});

describe("Home (APP-11)", () => {
  it("shows a skeleton while loading, then the figures and the personality line (APP-15)", async () => {
    mocked.getToday.mockResolvedValue(exampleDay);
    renderHome();
    expect(screen.getByTestId("home-skeleton")).toBeTruthy();
    expect(await screen.findByText("₹413")).toBeTruthy();
    expect(screen.getByText("left of ₹593 today")).toBeTruthy();
    expect(screen.getByText("₹180 spent")).toBeTruthy();
    expect(screen.getByText("₹413 left for today. Nice and steady.")).toBeTruthy();
    expect(screen.getByText("Fri, 23 Oct")).toBeTruthy();
    expect(screen.getByText("Good afternoon")).toBeTruthy();
    expect(screen.getByText("9 days left in this cycle, until Sat, 31 Oct")).toBeTruthy();
    expect(screen.getByLabelText("Gullak, happy")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Budget used" })).toHaveAccessibilityValue({ now: 30 });
  });

  it("first run: no spends ever → day-one copy and the Gullak's hello", async () => {
    mocked.getToday.mockResolvedValue({ ...exampleDay, spentPaise: 0, leftPaise: 59300, line: "₹593 left for today. Nice and steady." });
    renderHome();
    expect(await screen.findByText("Day one")).toBeTruthy();
    expect(screen.getByText("Hi, I'm your Gullak. Log a spend and I'll keep count.")).toBeTruthy();
    expect(screen.getByText("Your streak starts tonight if you stay under")).toBeTruthy();
    expect(screen.getByText("Your spends show up here. Log one as soon as you pay.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add first spend" })).toBeDisabled();
  });

  it("after the first spend was ever logged, zero spent today is not first run", async () => {
    (kv.get as jest.Mock).mockResolvedValue("1");
    mocked.getToday.mockResolvedValue({ ...exampleDay, spentPaise: 0, leftPaise: 59300, line: "₹593 left for today. Nice and steady." });
    renderHome();
    expect(await screen.findByText("₹593 left for today. Nice and steady.")).toBeTruthy();
    expect(screen.queryByText("Day one")).toBeNull();
  });

  it("fainted: ₹0 left, the over line, a full red bar", async () => {
    mocked.getToday.mockResolvedValue({ ...exampleDay, spentPaise: 72000, leftPaise: 0, overPaise: 12700, mood: "FAINTED", line: "Over by ₹127. Happens. Tomorrow’s a fresh start." });
    renderHome();
    expect(await screen.findByText("₹0")).toBeTruthy();
    expect(screen.getByText("Over by ₹127. Happens. Tomorrow’s a fresh start.")).toBeTruthy();
    expect(screen.getByLabelText("Gullak, fainted")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Budget used" })).toHaveAccessibilityValue({ now: 100 });
  });

  it("error with no cached data shows Retry, and Retry refetches (ERR-13)", async () => {
    mocked.getToday.mockRejectedValueOnce(new NetworkError("offline")).mockResolvedValueOnce(exampleDay);
    renderHome();
    fireEvent.press(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("₹413")).toBeTruthy();
    expect(mocked.getToday).toHaveBeenCalledTimes(2);
  });

  it("offline with cached data shows the figures and 'Updated 2 hours ago'", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "offlineFirst" } } });
    qc.setQueryData(todayKey, exampleDay, { updatedAt: new Date("2026-10-23T06:00:00Z").getTime() });
    onlineManager.setOnline(false);
    mocked.getToday.mockResolvedValue(exampleDay);
    renderHome(qc);
    expect(await screen.findByText("₹413")).toBeTruthy();
    expect(screen.getByText("Updated 2 hours ago")).toBeTruthy();
  });

  it("a failed refresh keeps the cached figures with a passive notice", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "offlineFirst", staleTime: 0 } } });
    qc.setQueryData(todayKey, exampleDay, { updatedAt: Date.now() - 10 * 60_000 });
    mocked.getToday.mockRejectedValue(new NetworkError("flaky"));
    renderHome(qc);
    expect(await screen.findByText("Could not refresh. Showing saved data.")).toBeTruthy();
    expect(screen.getByText("₹413")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("setup incomplete sends the user back to setup", async () => {
    mocked.getToday.mockRejectedValue(new ApiError("SETUP_INCOMPLETE", 409, "Finish setup first"));
    renderHome();
    expect(await screen.findByTestId("redirect-onboarding")).toBeTruthy();
  });

  it("foregroundRefetchesToday", async () => {
    let listener: ((s: string) => void) | null = null;
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_t, fn) => {
      listener = fn as (s: string) => void;
      return { remove: jest.fn() };
    });
    mocked.getToday.mockResolvedValue(exampleDay);
    renderHome();
    await screen.findByText("₹413");
    act(() => listener?.("active"));
    await waitFor(() => expect(mocked.getToday).toHaveBeenCalledTimes(2));
    spy.mockRestore();
  });
});
```

`app/src/features/tabs/tab-bar.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { TabBar } from "./tab-bar";

function props(index: number) {
  const navigate = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  return {
    navigate,
    p: {
      state: { index, routes: [{ key: "index", name: "index" }, { key: "insights", name: "insights" }, { key: "goals", name: "goals" }, { key: "me", name: "me" }] },
      navigation: { navigate, emit },
      descriptors: {},
    },
  };
}

describe("TabBar", () => {
  it("has the four tabs, the centre add button, and marks the current tab", () => {
    const { p } = props(0);
    render(<TabBar {...p} />);
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAccessibilityState({ selected: true });
    expect(screen.getByRole("tab", { name: "Insights" })).toHaveAccessibilityState({ selected: false });
    expect(screen.getByRole("tab", { name: "Goals" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Me" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a spend" })).toBeDisabled();
  });

  it("navigates on tap", () => {
    const { p, navigate } = props(0);
    render(<TabBar {...p} />);
    fireEvent.press(screen.getByRole("tab", { name: "Goals" }));
    expect(navigate).toHaveBeenCalledWith("goals");
  });
});
```

`app/src/features/profile/screens/me.test.tsx` (APP-26 sign-out half):

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { MeScreen } from "./me-screen";

describe("Me", () => {
  it("shows the email, personality and times, and signs out on confirmation", async () => {
    const signOut = jest.fn(() => Promise.resolve());
    render(
      <MeScreen
        email="priya@example.com"
        profile={{ incomePaise: 5000000, savingsPaise: 2000000, paydayRule: "FIXED_DAY", paydayDay: 1, personality: "CHILL", morningTime: "08:00", nightTime: "22:00", timezone: "Asia/Kolkata" }}
        signOut={signOut}
      />,
    );
    expect(screen.getByText("priya@example.com")).toBeTruthy();
    expect(screen.getByText("Chill friend")).toBeTruthy();
    expect(screen.getByText("8:00 am and 10:00 pm")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByText("Sign out of Gullak on this phone?")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Yes, sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});
```

Add to `app/src/features/auth/session.test.tsx`:

```tsx
  it("signOut wipes the persisted query cache so the next person sees nothing", async () => {
    const s = store({ accessToken: "A", refreshToken: "R" });
    const removeClient = jest.fn(() => Promise.resolve());
    let session: ReturnType<typeof useSession> | undefined;
    render(
      <SessionProvider store={s} logout={() => Promise.resolve()} wipeCache={removeClient}>
        <Probe onReady={(x) => (session = x)} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    await act(() => session!.signOut());
    expect(removeClient).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `cd app && npx jest src/features/home src/features/tabs src/features/profile/screens src/features/auth`
Expected: FAIL, modules missing and the new session prop unknown.

- [ ] **Step 3: Write the code**

`app/src/features/budget/hooks.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { budgetApi, type Today } from "./api";

export const todayKey = ["today"] as const;

export function useToday() {
  return useQuery<Today>({ queryKey: todayKey, queryFn: budgetApi.getToday, staleTime: 30_000 });
}
```

Session changes in `app/src/features/auth/session.tsx`:

```tsx
// props: add
//   wipeCache?: () => Promise<void>   (default: () => persister.removeClient())
// state: add `email: string | null`, loaded from kv "me.email" during hydration
// signIn(tokens, email?) stores the email in kv "me.email" when given
// signOut: after store.clear(): await kv.remove("me.email"); await wipeCache(); queryClient.clear();
// value: { status, email, signIn, signOut }
```

Make those edits (the full file is in Task 4; add `email` to the `Session` type, the `wipeCache` prop with its default, the kv reads/writes and the wipe in `signOut`). In `app/app/login-code.tsx`, pass the email: `onVerified={(pair) => void signIn({ accessToken: pair.accessToken, refreshToken: pair.refreshToken }, email)}`.

`app/src/features/home/hero.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Text } from "@/components/ui/text";
import { Gullak } from "@/features/gullak/gullak";
import { fromServerMood } from "@/features/gullak/moods";
import type { Today } from "@/features/budget/api";
import { formatDay } from "@/lib/dates";
import { formatRupees } from "@/lib/money";
import { colors, radius, spacing } from "@/theme";

const FIRST_RUN_LINE = "Hi, I'm your Gullak. Log a spend and I'll keep count.";

export function percentUsed(t: Today): number {
  if (t.budgetPaise <= 0) return t.spentPaise > 0 ? 100 : 0;
  return Math.min(100, Math.round((t.spentPaise * 100) / t.budgetPaise));
}

export function Hero({ today, firstRun }: { today: Today; firstRun: boolean }) {
  const mood = fromServerMood(today.mood);
  const used = percentUsed(today);
  const tone = mood === "fainted" ? "bad" : mood === "nervous" ? "warn" : "ink";
  return (
    <View style={{ gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <Gullak mood={mood} stage="clay" size={160} />
        <Text variant="body" align="center">
          {firstRun ? FIRST_RUN_LINE : today.line}
        </Text>
      </View>
      <View style={{ alignItems: "center" }}>
        <Text variant="display" style={{ fontVariant: ["tabular-nums"] }}>
          {formatRupees(today.leftPaise)}
        </Text>
        <Text variant="bodyMuted">{`left of ${formatRupees(today.budgetPaise)} today`}</Text>
      </View>
      <ProgressBar value={used} label="Budget used" tone={tone} />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="label">{`${formatRupees(today.spentPaise)} spent`}</Text>
        <Text variant="labelMuted">{firstRun ? "Your streak starts tonight if you stay under" : ""}</Text>
      </View>
      <Text variant="caption">{`${today.daysLeft} day${today.daysLeft === 1 ? "" : "s"} left in this cycle, until ${formatDay(today.cycleEnd)}`}</Text>
    </View>
  );
}
```

`app/src/features/home/today-section.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Text } from "@/components/ui/text";
import { spacing } from "@/theme";

/** Plan 3 fills this with the day's spends and enables the button; until then the empty state is the whole section. */
export function TodaySection() {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="title">Today</Text>
      <EmptyState
        title="Your spends show up here. Log one as soon as you pay."
        action={
          <View style={{ gap: spacing.sm }}>
            <Button title="Add first spend" onPress={() => undefined} disabled />
            <Text variant="caption" align="center">
              Or upload last month's statement
            </Text>
          </View>
        }
      />
    </View>
  );
}
```

`app/src/features/home/home-screen.tsx`:

```tsx
import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { ErrorState } from "@/components/ui/error-state";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { Toast } from "@/components/ui/toast";
import { useToday } from "@/features/budget/hooks";
import { describeError, isApiError } from "@/lib/api-errors";
import { formatDay, greeting, relativeTime, todayIst } from "@/lib/dates";
import { messageFor } from "@/lib/errors";
import { kv } from "@/lib/kv";
import { spacing } from "@/theme";
import { Hero } from "./hero";
import { TodaySection } from "./today-section";

export const FIRST_SPEND_FLAG = "first-spend-logged";

export function HomeScreen({ now = new Date() }: { now?: Date }) {
  const today = useToday();
  const [everLogged, setEverLogged] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void kv.get(FIRST_SPEND_FLAG).then((v) => alive && setEverLogged(v === "1"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void today.refetch();
    });
    return () => sub.remove();
  }, [today.refetch]);

  if (isApiError(today.error, "SETUP_INCOMPLETE")) {
    return (
      <View testID="redirect-onboarding">
        <Redirect href="/onboarding/income" />
      </View>
    );
  }

  const data = today.data;
  const firstRun = !!data && data.spentPaise === 0 && everLogged === false;
  const date = data?.date ?? todayIst(now);

  return (
    <Screen testID="home">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="labelMuted">{formatDay(date)}</Text>
        <Text variant="label">{firstRun ? "Day one" : greeting(now)}</Text>
      </View>
      {!data && today.isLoading ? (
        <View testID="home-skeleton" style={{ gap: spacing.md }}>
          <Skeleton height={160} round />
          <Skeleton height={72} width="60%" />
          <Skeleton height={8} />
          <Skeleton height={120} />
        </View>
      ) : !data ? (
        <ErrorState body={describeError(today.error, messageFor)} onRetry={() => void today.refetch()} />
      ) : (
        <>
          {today.fetchStatus === "paused" ? (
            <Toast message={`Updated ${relativeTime(today.dataUpdatedAt, now.getTime())}`} />
          ) : today.error ? (
            <Toast message="Could not refresh. Showing saved data." tone="bad" />
          ) : null}
          <Hero today={data} firstRun={firstRun} />
          <TodaySection />
        </>
      )}
    </Screen>
  );
}
```

`app/src/features/tabs/tab-bar.tsx`:

```tsx
import React from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors, radius, shadows, spacing, touchTarget } from "@/theme";

/** The subset of the navigator's tab-bar props this bar uses (typed structurally; expo-router's Tabs passes a superset). */
export type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void; emit: (e: { type: "tabPress"; target: string; canPreventDefault: true }) => { defaultPrevented: boolean } };
  descriptors: Record<string, { options?: { title?: string } }>;
};

const tabs: { name: string; label: string; icon: IconName }[] = [
  { name: "index", label: "Home", icon: "home" },
  { name: "insights", label: "Insights", icon: "chart" },
  { name: "goals", label: "Goals", icon: "target" },
  { name: "me", label: "Me", icon: "user" },
];

/** Design.md signature: a centre terracotta + button. It is enabled by Plan 3, which adds the quick-add route. */
export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  const items = [tabs[0], tabs[1], null, tabs[2], tabs[3]] as const;
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.xs }}
    >
      {items.map((t, i) =>
        t === null ? (
          <View key="add" style={{ flex: 1, alignItems: "center" }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a spend"
              accessibilityState={{ disabled: true }}
              disabled
              style={{ marginTop: -spacing.lg, width: 56, height: 56, borderRadius: radius.full, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", boxShadow: shadows.addButton, opacity: 0.5 }}
            >
              <Icon name="plus" size={28} color={colors.onAccent} strokeWidth={2.5} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            key={t.name}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: current === t.name }}
            onPress={() => {
              const route = state.routes.find((r) => r.name === t.name);
              const event = route ? navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true }) : { defaultPrevented: false };
              if (!event.defaultPrevented) navigation.navigate(t.name);
            }}
            style={{ flex: 1, alignItems: "center", gap: spacing.xs, minHeight: touchTarget + 4 }}
          >
            <View style={{ width: 24, height: 3, borderRadius: 2, backgroundColor: current === t.name ? colors.ink : "transparent" }} />
            <Icon name={t.icon} size={22} color={current === t.name ? colors.ink : colors.muted} />
            <Text variant="caption" color={current === t.name ? colors.ink : colors.muted} style={{ fontFamily: current === t.name ? "DMSans-700" : "DMSans-500" }}>
              {t.label}
            </Text>
          </Pressable>
        ),
      )}
    </View>
  );
}
```

Replace the two `fontFamily` literals with `fonts.ui700` / `fonts.ui500` from `@/theme` (the rule: no font literals outside the theme).

`app/app/(tabs)/_layout.tsx`:

```tsx
import { Tabs } from "expo-router";
import React from "react";
import { TabBar } from "@/features/tabs/tab-bar";
import { colors } from "@/theme";

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...(props as unknown as React.ComponentProps<typeof TabBar>)} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.ground }, animation: "none" }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="insights" options={{ title: "Insights" }} />
      <Tabs.Screen name="goals" options={{ title: "Goals" }} />
      <Tabs.Screen name="me" options={{ title: "Me" }} />
    </Tabs>
  );
}
```

`app/app/(tabs)/index.tsx`:

```tsx
import React from "react";
import { HomeScreen } from "@/features/home/home-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function HomeRoute() {
  return <HomeScreen />;
}
```

`app/app/(tabs)/insights.tsx`:

```tsx
import React from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function InsightsRoute() {
  return (
    <Screen testID="insights">
      <Text variant="heading">Insights</Text>
      <EmptyState title="Nothing to show yet" body="Log spends or upload a statement and your month appears here" />
    </Screen>
  );
}
```

`app/app/(tabs)/goals.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useProfile } from "@/features/profile/hooks";
import { formatRupees } from "@/lib/money";
import { colors, radius, spacing } from "@/theme";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function GoalsRoute() {
  const profile = useProfile();
  return (
    <Screen testID="goals">
      <Text variant="heading">Goals</Text>
      {profile.data ? (
        <View style={{ padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.sand, gap: spacing.xs }}>
          <Text variant="label">Saving every month</Text>
          <Text variant="amount">{formatRupees(profile.data.savingsPaise)}</Text>
        </View>
      ) : null}
      <EmptyState title="No goals yet" body="Set a goal like Goa by March and Gullak tells you whether you are on track" />
    </Screen>
  );
}
```

`app/src/features/profile/screens/me-screen.tsx`:

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { colors, radius, spacing } from "@/theme";
import type { Profile } from "../api";
import { personalities } from "../components/personality-picker";

function time(t: string): string {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function MeScreen({ email, profile, signOut }: { email: string | null; profile: Profile | null | undefined; signOut: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const personality = personalities.find((p) => p.id === profile?.personality)?.label;
  return (
    <Screen testID="me">
      <Text variant="heading">Me</Text>
      <View style={{ padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: spacing.sm }}>
        {email ? <Text variant="body" selectable>{email}</Text> : null}
        {personality ? <Text variant="bodyMuted">{personality}</Text> : null}
        {profile ? <Text variant="bodyMuted">{`${time(profile.morningTime)} and ${time(profile.nightTime)}`}</Text> : null}
        <Text variant="caption">Editing these arrives with a later update</Text>
      </View>
      {confirming ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="bodyStrong">Sign out of Gullak on this phone?</Text>
          <Button
            title="Yes, sign out"
            variant="danger"
            loading={busy}
            onPress={() => {
              setBusy(true);
              void signOut().finally(() => setBusy(false));
            }}
          />
          <Button title="Keep me signed in" variant="secondary" onPress={() => setConfirming(false)} />
        </View>
      ) : (
        <Button title="Sign out" variant="secondary" onPress={() => setConfirming(true)} />
      )}
    </Screen>
  );
}
```

`app/app/(tabs)/me.tsx`:

```tsx
import React from "react";
import { useSession } from "@/features/auth/session";
import { useProfile } from "@/features/profile/hooks";
import { MeScreen } from "@/features/profile/screens/me-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function MeRoute() {
  const { email, signOut } = useSession();
  const profile = useProfile();
  return <MeScreen email={email} profile={profile.data} signOut={signOut} />;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd app && npm test && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Use it end to end**

Server up, fresh email: sign in → setup → Home shows "Day one", the Gullak and the day-one budget. Kill the app and reopen: Home shows at once from the cache, then refreshes. Switch on airplane mode and reopen: the figures stay with "Updated … ago". Sign out from Me: back at login; sign in as a different email: no figures from the first user appear at any point.

- [ ] **Step 6: Red team**

Dispatch `red-team` with task id `plan-02-task-10`: inspect AsyncStorage after sign-out (no `gullak.query-cache`, no `gullak.me.email`), SecureStore after sign-out (no session), deep link to `/(tabs)/me` while signed out, a server returning a `line` with HTML or 2,000 characters, `budgetPaise: 0` with `spentPaise: 0`, negative `daysLeft`, a `date` in another year. Report to `docs/reports/red-team/plan-02-task-10.md`.

- [ ] **Step 7: Commit**

```bash
git add app/app app/src docs/reports/red-team/plan-02-task-10.md
git commit -m "feat(app): tabs with the centre add button, Home with the Gullak and its states, Me with sign-out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: E2E-01, web export check, accessibility sweep, docs and roadmap

**Owner:** qa-engineer writes the flow and the sweep; app-engineer fixes anything they find. **Test IDs:** E2E-01, APP-29 (screen level), APP-30 (export only; route guards are Plan 9), LOG-09 (re-check over the finished screens). **Red team:** no (each security-touching task had its own pass).

**Files:**
- Create: `app/e2e/setup.yaml`, `app/e2e/scripts/email.js`, `app/e2e/scripts/otp.js`, `app/e2e/README.md`, `app/src/a11y.test.tsx`
- Modify: `.github/workflows/ci.yml`, `README.md`, `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`, `docs/superpowers/plans/README.md`

- [ ] **Step 1: The Maestro flow (E2E-01)**

`app/e2e/scripts/email.js`:

```js
// A fresh address per run so the server's one-live-code rule and rate limits never collide between runs.
output.email = "e2e-" + Date.now() + "@example.test";
```

`app/e2e/scripts/otp.js`:

```js
// Reads the code the local server "mailed" (dev endpoint, local profile only).
const base = typeof GULLAK_API !== "undefined" ? GULLAK_API : "http://10.0.2.2:8080/api/v1";
const res = http.post(base + "/auth/dev/otp", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: output.email }),
});
if (!res.ok) throw new Error("dev otp failed: " + res.status);
output.code = json(res.body).code;
```

`app/e2e/setup.yaml`:

```yaml
appId: in.gullak.app
---
- launchApp:
    clearState: true
- runScript: scripts/email.js
- tapOn: "Email"
- inputText: ${output.email}
- tapOn: "Send code"
- assertVisible: "Enter the code"
- runScript: scripts/otp.js
- inputText: ${output.code}
- assertVisible: "Your salary"
- tapOn: "Take-home pay per month"
- inputText: "50000"
- tapOn: "1st of the month"
- tapOn: "Continue"
- assertVisible: "Fixed costs"
- tapOn: "Add Rent, ₹10,000"
- tapOn: "Add Cook, ₹2,000"
- assertVisible: "₹12,000"
- tapOn: "Continue"
- assertVisible: "Monthly savings"
- assertVisible: "Doable"
- tapOn: "Continue"
- assertVisible: "Gullak's personality"
- tapOn:
    text: "Start with .* today"
- tapOn: "Not now"
- assertVisible: "Day one"
- assertVisible: "Hi, I'm your Gullak. Log a spend and I'll keep count."
- assertVisible:
    text: "left of ₹.* today"
```

`app/e2e/README.md`:

````markdown
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
````

- [ ] **Step 2: Screen-level accessibility sweep (APP-29)**

`app/src/a11y.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { EmailForm } from "@/features/auth/components/email-form";
import { CodeForm } from "@/features/auth/components/code-form";
import { IncomeScreen } from "@/features/profile/screens/income-screen";
import { FixedCostsScreen } from "@/features/profile/screens/fixed-costs-screen";
import { SavingsScreen } from "@/features/profile/screens/savings-screen";
import { PersonalityScreen } from "@/features/profile/screens/personality-screen";
import { NotificationsScreen } from "@/features/profile/screens/notifications-screen";
import { MeScreen } from "@/features/profile/screens/me-screen";
import { HomeScreen } from "@/features/home/home-screen";
import { SetupProvider } from "@/features/profile/setup-store";

jest.mock("@/features/profile/api", () => ({ fixedCostApi: { list: jest.fn(() => Promise.resolve([])), add: jest.fn(), patch: jest.fn(), remove: jest.fn() }, profileApi: { get: jest.fn(), put: jest.fn() } }));
jest.mock("@/features/budget/api", () => ({ budgetApi: { getToday: jest.fn(() => Promise.resolve({ date: "2026-10-23", budgetPaise: 59300, spentPaise: 18000, leftPaise: 41300, overPaise: 0, poolOverPaise: 0, mood: "HAPPY", line: "x", daysLeft: 9, cycleStart: "2026-10-01", cycleEnd: "2026-10-31" })), setFirstCycle: jest.fn() } }));
jest.mock("expo-router", () => ({ Redirect: () => null }));

const noop = () => undefined;
const resolve = () => Promise.resolve();
const profile = { incomePaise: 5000000, savingsPaise: 2000000, paydayRule: "FIXED_DAY" as const, paydayDay: 1, personality: "CHILL" as const, morningTime: "08:00", nightTime: "22:00", timezone: "Asia/Kolkata" as const };

const screens: [string, () => React.ReactElement][] = [
  ["EmailForm", () => <EmailForm requestCode={resolve} onSent={noop} />],
  ["CodeForm", () => <CodeForm email="a@b.co" verifyCode={() => Promise.resolve({ accessToken: "A", refreshToken: "R", expiresIn: 1 })} requestCode={resolve} onVerified={noop} />],
  ["Income", () => <IncomeScreen today="2026-10-23" onContinue={noop} />],
  ["FixedCosts", () => <FixedCostsScreen onContinue={noop} onBack={noop} />],
  ["Savings", () => <SavingsScreen today="2026-10-23" fixedCosts={[]} onContinue={noop} onBack={noop} />],
  ["Personality", () => <PersonalityScreen today="2026-10-23" fixedPaise={0} finish={resolve} onDone={noop} onBack={noop} />],
  ["Notifications", () => <NotificationsScreen supported onAllow={resolve} onSkip={noop} />],
  ["Me", () => <MeScreen email="a@b.co" profile={profile} signOut={resolve} />],
  ["Home", () => <HomeScreen now={new Date("2026-10-23T08:00:00Z")} />],
];

describe.each(screens)("%s (APP-29)", (_name, element) => {
  it("every control has an accessible name", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SetupProvider persist={false}>{element()}</SetupProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryAllByRole("button").length).toBeGreaterThan(0));
    const controls = [...screen.queryAllByRole("button"), ...screen.queryAllByRole("radio"), ...screen.queryAllByRole("tab"), ...screen.queryAllByRole("link")];
    const unnamed = controls.filter((c) => {
      const props = c.props as { accessibilityLabel?: string; children?: unknown };
      const name = props.accessibilityLabel ?? (typeof props.children === "string" ? props.children : "");
      return name.trim() === "";
    });
    expect(unnamed).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Web export in CI**

Add to the app CI job after the tests: `- run: npx expo export --platform web`. This fails the build when a phone-only module (SecureStore, notifications) is imported statically by a screen the web build includes. Run it locally first: `cd app && npx expo export --platform web && rm -rf dist`.

- [ ] **Step 4: Docs**

`docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`:
- E2E-01 Checks: `email OTP, income, payday, fixed costs, savings, personality, notification step, first-run Home shows "Day one", the Gullak's hello and the pro-rated day-one budget (BUD-32)`.
- APP-24 row stays; it is now owned by this plan (roadmap below).

`docs/superpowers/plans/README.md`: in the Plan 2 row add `APP-24` to the test IDs and the file name `2026-10-23-plan-02-app-foundation.md`; add to the Delivers cell: "pro-rated first cycle (server), dev OTP endpoint (server)".

`README.md` App section: confirm the SDK number, add "E2E: see `app/e2e/README.md`", and list what the app does after Plan 2 (sign in, setup, Home) and what is disabled until Plan 3 (the + button).

- [ ] **Step 5: Run everything**

Run: `cd app && npm run gen:errors -- --check && npm test && npm run lint && npm run typecheck && npm run format && npx expo export --platform web && rm -rf dist`, then `cd ../server && ./gradlew test`.
Expected: all PASS. Run the Maestro flow on an emulator once and paste the result into the task report.

- [ ] **Step 6: Commit**

```bash
git add app/e2e app/src/a11y.test.tsx .github/workflows/ci.yml README.md docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md docs/superpowers/plans/README.md
git commit -m "test(app): E2E-01 setup flow, accessibility sweep, web export check; docs for Plan 2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the last task

The orchestrating session dispatches the `manager` for a whole-branch review of Plan 2 against spec sections 2.1 (first cycle), 2.6, 2.7, 3, 4.2, 4.4, 4.7 and 4.11, `.claude/design.md` and the standards, with the per-task red-team reports and the ledger's rulings in hand; then writes `docs/reports/<date>-plan-02.md` in the same shape as Plan 1's. Plan 3 (spends) is executed next against this app and server; its first task enables the + button and Home's "Add first spend" and writes the `first-spend-logged` flag.
