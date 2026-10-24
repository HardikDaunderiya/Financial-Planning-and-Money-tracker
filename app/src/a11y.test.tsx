import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CodeForm } from "@/features/auth/components/code-form";
import { EmailForm } from "@/features/auth/components/email-form";
import { HomeScreen } from "@/features/home/home-screen";
import { FixedCostsScreen } from "@/features/profile/screens/fixed-costs-screen";
import { IncomeScreen } from "@/features/profile/screens/income-screen";
import { MeScreen } from "@/features/profile/screens/me-screen";
import { NotificationsScreen } from "@/features/profile/screens/notifications-screen";
import { PersonalityScreen } from "@/features/profile/screens/personality-screen";
import { SavingsScreen } from "@/features/profile/screens/savings-screen";
import { SetupProvider } from "@/features/profile/setup-store";
import { touchTarget } from "@/theme";

jest.mock("@/features/profile/api", () => ({
  fixedCostApi: {
    list: jest.fn(() => Promise.resolve([{ id: "1", name: "Rent", amountPaise: 1000000, sortOrder: 0 }])),
    add: jest.fn(),
    patch: jest.fn(),
    remove: jest.fn(),
  },
  profileApi: { get: jest.fn(), put: jest.fn() },
}));
jest.mock("@/features/budget/api", () => ({
  budgetApi: {
    getToday: jest.fn(() =>
      Promise.resolve({
        date: "2026-10-23",
        budgetPaise: 59300,
        spentPaise: 18000,
        leftPaise: 41300,
        overPaise: 0,
        poolOverPaise: 0,
        mood: "HAPPY",
        line: "x",
        daysLeft: 9,
        cycleStart: "2026-10-01",
        cycleEnd: "2026-10-31",
      }),
    ),
    setFirstCycle: jest.fn(),
  },
}));
jest.mock("expo-router", () => ({ Redirect: () => null }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const noop = () => undefined;
const resolve = () => Promise.resolve();
const profile = {
  incomePaise: 5000000,
  savingsPaise: 2000000,
  paydayRule: "FIXED_DAY" as const,
  paydayDay: 1,
  personality: "CHILL" as const,
  morningTime: "08:00",
  nightTime: "22:00",
  timezone: "Asia/Kolkata" as const,
};

const screens: [string, () => React.ReactElement][] = [
  ["EmailForm", () => <EmailForm requestCode={resolve} onSent={noop} />],
  [
    "CodeForm",
    () => (
      <CodeForm
        email="a@b.co"
        verifyCode={() => Promise.resolve({ accessToken: "A", refreshToken: "R", expiresIn: 1 })}
        requestCode={resolve}
        onVerified={noop}
      />
    ),
  ],
  ["Income", () => <IncomeScreen today="2026-10-23" onContinue={noop} />],
  ["FixedCosts", () => <FixedCostsScreen onContinue={noop} onBack={noop} />],
  ["Savings", () => <SavingsScreen today="2026-10-23" fixedCosts={[]} onContinue={noop} onBack={noop} />],
  [
    "Personality",
    () => (
      <PersonalityScreen today="2026-10-23" fixedPaise={0} finish={resolve} onDone={noop} onBack={noop} />
    ),
  ],
  ["Notifications", () => <NotificationsScreen supported onAllow={resolve} onSkip={noop} />],
  ["Me", () => <MeScreen email="a@b.co" profile={profile} signOut={resolve} />],
  ["Home", () => <HomeScreen now={new Date("2026-10-23T08:00:00Z")} />],
];

type Control = ReturnType<typeof screen.queryAllByRole>[number];
type Box = { minHeight?: number; height?: number; minWidth?: number; width?: number };

function nameOf(c: Control): string {
  const props = c.props as { accessibilityLabel?: string; children?: unknown };
  return (props.accessibilityLabel ?? (typeof props.children === "string" ? props.children : "")).trim();
}

function controlsOnScreen(): Control[] {
  return [
    ...screen.queryAllByRole("button"),
    ...screen.queryAllByRole("radio"),
    ...screen.queryAllByRole("tab"),
    ...screen.queryAllByRole("link"),
  ];
}

/** Names of controls whose height, or width for icon-only ones, is under 44. */
function tooSmall(controls: Control[]): string[] {
  return controls
    .filter((c) => {
      const box = (StyleSheet.flatten(c.props.style as never) ?? {}) as Box;
      const h = Math.max(box.minHeight ?? 0, box.height ?? 0);
      return h < touchTarget;
    })
    .map((c) => nameOf(c) || "(unnamed)");
}

describe("the sweep itself", () => {
  it("flags an unnamed control and a 30px control", async () => {
    await render(
      <>
        <Pressable accessibilityRole="button" style={{ minHeight: 30 }}>
          <Text>x</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Fine" style={{ minHeight: 44 }} />
      </>,
    );
    const controls = controlsOnScreen();
    expect(controls.filter((c) => nameOf(c) === "")).toHaveLength(1);
    expect(tooSmall(controls)).toEqual(["(unnamed)"]);
  });
});

describe.each(screens)("%s (APP-29)", (_name, element) => {
  it("every control has an accessible name and is at least 44px", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <QueryClientProvider client={qc}>
          <SetupProvider persist={false}>{element()}</SetupProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
    await waitFor(() => expect(screen.queryAllByRole("button").length).toBeGreaterThan(0));
    const controls = controlsOnScreen();
    expect(controls.filter((c) => nameOf(c) === "").map((c) => c.type)).toEqual([]);
    expect(tooSmall(controls)).toEqual([]);
  });

  it("sweeps the data-driven controls once the data arrives", async () => {
    if (_name !== "FixedCosts" && _name !== "Home") return;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <QueryClientProvider client={qc}>
          <SetupProvider persist={false}>{element()}</SetupProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
    if (_name === "FixedCosts") {
      expect(await screen.findByLabelText("Edit Rent, ₹10,000")).toBeTruthy();
      expect(screen.getByLabelText(/^Remove /)).toBeTruthy();
    } else {
      expect(await screen.findByText("₹413")).toBeTruthy();
    }
    expect(tooSmall(controlsOnScreen())).toEqual([]);
  });
});
