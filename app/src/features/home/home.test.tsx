import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiError, NetworkError } from "@/lib/api-errors";
import { todayKey } from "@/features/budget/hooks";
import type { Today } from "@/features/budget/api";
import { budgetApi } from "@/features/budget/api";
import { kv } from "@/lib/kv";
import { HomeScreen } from "./home-screen";

jest.mock("@/features/budget/api", () => ({ budgetApi: { getToday: jest.fn(), setFirstCycle: jest.fn() } }));
jest.mock("@/lib/kv", () => ({
  ...jest.requireActual<typeof import("@/lib/kv")>("@/lib/kv"),
  kv: {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve()),
    remove: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock("expo-router", () => ({ Redirect: () => null }));

// SDK 58 adaptation: Screen and TabBar read safe-area insets, so tests render inside a provider with fixed metrics.
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
function Safe({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>;
}
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

async function renderHome(
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: "offlineFirst", gcTime: Infinity } },
  }),
) {
  await render(
    <Safe>
      <QueryClientProvider client={qc}>
        <HomeScreen now={new Date("2026-10-23T08:00:00Z")} />
      </QueryClientProvider>
    </Safe>,
  );
  return qc;
}

beforeEach(() => {
  mocked.getToday.mockReset();
  onlineManager.setOnline(true);
  (kv.get as jest.Mock).mockResolvedValue(null);
});

describe("Home (APP-11)", () => {
  it("shows a skeleton while loading, then the figures and the personality line (APP-15)", async () => {
    mocked.getToday.mockResolvedValue(exampleDay);
    await renderHome();
    expect(screen.queryByTestId("home-skeleton") ?? screen.queryByText("₹413")).toBeTruthy();
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
    mocked.getToday.mockResolvedValue({
      ...exampleDay,
      spentPaise: 0,
      leftPaise: 59300,
      line: "₹593 left for today. Nice and steady.",
    });
    await renderHome();
    expect(await screen.findByText("Day one")).toBeTruthy();
    expect(screen.getByText("Hi, I'm your Gullak. Log a spend and I'll keep count.")).toBeTruthy();
    expect(screen.getByText("Your streak starts tonight if you stay under")).toBeTruthy();
    expect(screen.queryByText("₹0 spent")).toBeNull();
    expect(screen.getByText("Your spends show up here. Log one as soon as you pay.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add first spend" })).toBeDisabled();
  });

  it("after the first spend was ever logged, zero spent today is not first run", async () => {
    (kv.get as jest.Mock).mockResolvedValue("1");
    mocked.getToday.mockResolvedValue({
      ...exampleDay,
      spentPaise: 0,
      leftPaise: 59300,
      line: "₹593 left for today. Nice and steady.",
    });
    await renderHome();
    expect(await screen.findByText("₹593 left for today. Nice and steady.")).toBeTruthy();
    expect(screen.queryByText("Day one")).toBeNull();
  });

  it("fainted: ₹0 left, the over line, a full red bar", async () => {
    mocked.getToday.mockResolvedValue({
      ...exampleDay,
      spentPaise: 72000,
      leftPaise: 0,
      overPaise: 12700,
      mood: "FAINTED",
      line: "Over by ₹127. Happens. Tomorrow’s a fresh start.",
    });
    await renderHome();
    expect(await screen.findByText("₹0")).toBeTruthy();
    expect(screen.getByText("Over by ₹127. Happens. Tomorrow’s a fresh start.")).toBeTruthy();
    expect(screen.getByLabelText("Gullak, fainted")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Budget used" })).toHaveAccessibilityValue({ now: 100 });
  });

  it("error with no cached data shows Retry, and Retry refetches (ERR-13)", async () => {
    mocked.getToday.mockRejectedValueOnce(new NetworkError("offline")).mockResolvedValueOnce(exampleDay);
    await renderHome();
    await fireEvent.press(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("₹413")).toBeTruthy();
    expect(mocked.getToday).toHaveBeenCalledTimes(2);
  });

  it("offline with cached data shows the figures and 'Updated 2 hours ago'", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, networkMode: "offlineFirst", gcTime: Infinity } },
    });
    qc.setQueryData(todayKey, exampleDay, { updatedAt: new Date("2026-10-23T06:00:00Z").getTime() });
    onlineManager.setOnline(false);
    // Offline, the first attempt still runs (offlineFirst) and fails with a NetworkError.
    mocked.getToday.mockRejectedValue(new NetworkError("offline"));
    await renderHome(qc);
    expect(await screen.findByText("₹413")).toBeTruthy();
    expect(screen.getByText("Updated 2 hours ago")).toBeTruthy();
  });

  it("a failed refresh keeps the cached figures with a passive notice", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, networkMode: "offlineFirst", gcTime: Infinity, staleTime: 0 },
      },
    });
    qc.setQueryData(todayKey, exampleDay, { updatedAt: Date.now() - 10 * 60_000 });
    mocked.getToday.mockRejectedValue(new NetworkError("flaky"));
    await renderHome(qc);
    expect(await screen.findByText("Could not refresh. Showing saved data.")).toBeTruthy();
    expect(screen.getByText("₹413")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("setup incomplete sends the user back to setup", async () => {
    mocked.getToday.mockRejectedValue(new ApiError("SETUP_INCOMPLETE", 409, "Finish setup first"));
    await renderHome();
    expect(await screen.findByTestId("redirect-onboarding")).toBeTruthy();
  });

  it("foregroundRefetchesToday once the last success is older than 30 seconds", async () => {
    let listener: ((s: string) => void) | null = null;
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_t, fn) => {
      listener = fn as (s: string) => void;
      return { remove: jest.fn() };
    });
    mocked.getToday.mockResolvedValue(exampleDay);
    await renderHome();
    await screen.findByText("₹413");
    const real = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(real + 31_000);
    await act(() => listener?.("active"));
    await waitFor(() => expect(mocked.getToday).toHaveBeenCalledTimes(2));
    clock.mockRestore();
    spy.mockRestore();
  });

  it("20 rapid foreground events cause at most one request", async () => {
    let listener: ((s: string) => void) | null = null;
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_t, fn) => {
      listener = fn as (s: string) => void;
      return { remove: jest.fn() };
    });
    mocked.getToday.mockResolvedValue(exampleDay);
    await renderHome();
    await screen.findByText("₹413");
    mocked.getToday.mockClear();
    const real = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(real + 31_000);
    await act(() => {
      for (let i = 0; i < 20; i++) listener?.("active");
    });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(mocked.getToday.mock.calls.length).toBeLessThanOrEqual(1);
    clock.mockRestore();
    spy.mockRestore();
  });

  it("a fresh success skips the foreground refetch", async () => {
    let listener: ((s: string) => void) | null = null;
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_t, fn) => {
      listener = fn as (s: string) => void;
      return { remove: jest.fn() };
    });
    mocked.getToday.mockResolvedValue(exampleDay);
    await renderHome();
    await screen.findByText("₹413");
    mocked.getToday.mockClear();
    await act(() => listener?.("active"));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(mocked.getToday).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
