/* Red team, plan-02 task 10: Home, Me, sign-out wipe. Tests that FAIL demonstrate a finding. */

/* eslint-disable @typescript-eslint/no-unused-vars, import/first, react-hooks/globals -- shared scaffold of the three red-team files; mocks must precede imports */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { renderRouter, screen as rscreen } from "expo-router/testing-library";
import React from "react";
import { AppState, Text as RNText } from "react-native";
import { SessionProvider, useSession } from "@/features/auth/session";
import type { Today } from "@/features/budget/api";
import { HomeScreen } from "@/features/home/home-screen";
import { MeScreen } from "@/features/profile/screens/me-screen";
import { authEvents } from "@/lib/client";
import { createLogger } from "@/lib/log";
import { persistOptions, persister, queryClient } from "@/lib/query";
import { deferred } from "./redteam-helpers";

const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: (k: string) => Promise.resolve(mockSecure.get(k) ?? null),
  setItemAsync: (k: string, v: string) => {
    mockSecure.set(k, v);
    return Promise.resolve();
  },
  deleteItemAsync: (k: string) => {
    mockSecure.delete(k);
    return Promise.resolve();
  },
}));
jest.mock("@/features/budget/api", () => ({ budgetApi: { getToday: jest.fn(), setFirstCycle: jest.fn() } }));
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));
import { budgetApi } from "@/features/budget/api";
import { tokenStore } from "@/lib/storage";
const getToday = budgetApi.getToday as jest.Mock;

const A_LINE = "A-LINE Priya owes ₹4,321 to Raj";
const dayA: Today = {
  date: "2026-10-23",
  budgetPaise: 123400,
  spentPaise: 56700,
  leftPaise: 66700,
  overPaise: 0,
  poolOverPaise: 0,
  mood: "HAPPY",
  line: A_LINE,
  daysLeft: 9,
  cycleStart: "2026-10-01",
  cycleEnd: "2026-10-31",
};
const dayB: Today = { ...dayA, budgetPaise: 77700, spentPaise: 100, leftPaise: 77600, line: "B-LINE hello" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const keys = ["gullak.query-cache", "gullak.me.email", "gullak.setup-draft"];
const KEYS_STATE = async () => ({
  kv: Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await AsyncStorage.getItem(k)]))),
  session: mockSecure.get("gullak.session") ?? null,
});

let ctl: ReturnType<typeof useSession>;
function Probe() {
  ctl = useSession();
  return <RNText testID="probe">{`${ctl.status}|${ctl.email ?? "-"}`}</RNText>;
}
function OnlyWhenSignedIn() {
  const { status } = useSession(); // the real Navigation unmounts (tabs) when signed out
  return status === "signedIn" ? <HomeScreen now={new Date("2026-10-23T08:00:00Z")} /> : null;
}
const logoutMock = jest.fn(() => Promise.resolve());
function Harness({ persist = persistOptions }: { persist?: typeof persistOptions }) {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persist}>
      <SessionProvider store={tokenStore} logout={logoutMock}>
        <Probe />
        <OnlyWhenSignedIn />
      </SessionProvider>
    </PersistQueryClientProvider>
  );
}

async function signInAndSeed(who: string, tokens = { accessToken: "ACC", refreshToken: "REF" }) {
  await act(async () => {
    await ctl.signIn(tokens, who);
  });
  await AsyncStorage.setItem("gullak.setup-draft", JSON.stringify({ income: 99999 }));
  await waitFor(() => expect(screen.queryByText(A_LINE)).toBeTruthy());
  await act(async () => {
    await sleep(1300); // persister throttle is 1s
  });
}

beforeEach(async () => {
  mockSecure.clear();
  await AsyncStorage.clear();
  queryClient.clear();
  logoutMock.mockClear();
  getToday.mockReset();
  getToday.mockResolvedValue(dayA);
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

describe("RT hostile server payloads on Home", () => {
  const wrap = (data: unknown) => {
    getToday.mockResolvedValue(data);
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, networkMode: "offlineFirst", gcTime: Infinity } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <HomeScreen now={new Date("2026-10-23T08:00:00Z")} />
      </QueryClientProvider>,
    );
  };
  beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => undefined));

  it("held: HTML in the line renders as plain text", async () => {
    await wrap({ ...dayA, line: "<script>alert(1)</script><img src=x onerror=alert(1)>" });
    expect(await screen.findByText("<script>alert(1)</script><img src=x onerror=alert(1)>")).toBeTruthy();
  });

  it("FINDING: a 2,000-char line is capped (numberOfLines or truncated) so it cannot push the figures off screen", async () => {
    const long = "word ".repeat(400);
    await wrap({ ...dayA, line: long });
    // Fix round 1 (ruling 3): the line is capped at 280 characters with an ellipsis, so the full text is gone.
    const node = await screen.findByText(/^word word/);
    const capped = node.props.numberOfLines !== undefined || String(node.props.children).length <= 280;
    expect(capped).toBe(true);
  });

  it("FINDING: an RTL override (U+202E) in the line cannot reverse the surrounding text", async () => {
    const evil = "‮₹413 left‬";
    await wrap({ ...dayA, line: evil });
    await screen.findByText("left of", { exact: false });
    expect(JSON.stringify(screen.toJSON()).includes("\u202E")).toBe(false); // bidi controls should be stripped
  });

  it("held: budget 0 and spent 0 renders without NaN/Infinity", async () => {
    await wrap({ ...dayA, budgetPaise: 0, spentPaise: 0, leftPaise: 0 });
    await screen.findByText("left of ₹0 today");
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/NaN|Infinity/);
  });

  it("FINDING: negative daysLeft is not shown as '-3 days left'", async () => {
    // Fix round 1 (ruling 3): daysLeft < 1 is an UnknownError, so Home shows the error state with Retry.
    await wrap({ ...dayA, daysLeft: -3 });
    await screen.findByRole("button", { name: "Retry" });
    expect(JSON.stringify(screen.toJSON())).not.toContain("-3 days");
  });

  it("FINDING: NaN-like fields (strings/null) do not render 'NaN' or 'undefined'", async () => {
    await wrap({ ...dayA, leftPaise: "abc", spentPaise: null, daysLeft: "x", budgetPaise: "NaN" });
    await waitFor(() => expect(screen.queryByTestId("home-skeleton")).toBeNull());
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/NaN|undefined|null/);
  });

  it("FINDING: an unknown mood does not crash Home (falls back to a safe Gullak)", async () => {
    await wrap({ ...dayA, mood: "ECSTATIC" });
    await waitFor(() => expect(screen.queryByTestId("home-skeleton")).toBeNull());
    expect(screen.queryByTestId("home")).toBeTruthy();
    expect(screen.getByText("₹667")).toBeTruthy();
  });

  it("FINDING: a malformed cycleEnd date does not crash Home", async () => {
    await wrap({ ...dayA, cycleEnd: "not-a-date", date: "garbage" });
    await waitFor(() => expect(screen.queryByTestId("home-skeleton")).toBeNull());
    expect(screen.queryByTestId("home")).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/Invalid|undefined/);
  });

  it("held: a date in another year still formats (no crash)", async () => {
    await wrap({ ...dayA, date: "1999-01-02", cycleEnd: "2031-12-31" });
    expect(await screen.findByText("₹667")).toBeTruthy();
  });

  it("FINDING: response with leftPaise at Number.MAX_SAFE_INTEGER stays sane (no exponent notation)", async () => {
    await wrap({ ...dayA, leftPaise: 1e21 });
    await waitFor(() => expect(screen.queryByTestId("home-skeleton")).toBeNull());
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/e\+|E\+/);
  });
});

describe("RT Me sign-out taps", () => {
  it("held: double-tap on 'Yes, sign out' calls signOut once", async () => {
    const d = deferred<void>();
    const signOut = jest.fn(() => d.promise);
    await render(<MeScreen email="a@b.com" profile={null} signOut={signOut} />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    const yes = screen.getByRole("button", { name: "Yes, sign out" });
    await fireEvent.press(yes);
    await fireEvent.press(yes);
    expect(signOut).toHaveBeenCalledTimes(1);
    d.resolve();
  });

  it("held: sign-out while offline (logout rejects with a network error) still clears locally", async () => {
    const { NetworkError } = require("@/lib/api-errors") as typeof import("@/lib/api-errors");
    logoutMock.mockRejectedValueOnce(new (NetworkError as new () => Error)());
    onlineManager.setOnline(false);
    await render(<Harness />);
    await act(async () => {
      await ctl.signIn({ accessToken: "A", refreshToken: "R" }, "priya@example.com");
    });
    await act(async () => {
      await ctl.signOut();
      await sleep(100);
    });
    expect(ctl.status).toBe("signedOut");
    expect(mockSecure.has("gullak.session")).toBe(false);
    expect(await AsyncStorage.getItem("gullak.me.email")).toBeNull();
  });

  it("FINDING: email with RTL override / 10k chars on Me is bounded", async () => {
    const evil = "‮evil@example.com" + "x".repeat(10000);
    await render(<MeScreen email={evil} profile={null} signOut={jest.fn()} />);
    const node = screen.getByText(/evil@example\.com/);
    expect(node.props.numberOfLines !== undefined || String(node.props.children).length < 300).toBe(true);
  });
});

describe("RT Home foreground refetch", () => {
  it("FINDING: 20 rapid AppState active flips send at most 2 requests", async () => {
    let handler: ((s: string) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_t: string, h: (s: string) => void) => {
      handler = h;
      return { remove: () => undefined };
    }) as never);
    getToday.mockImplementation(() => new Promise((r) => setTimeout(() => r(dayA), 50)));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    await render(
      <QueryClientProvider client={qc}>
        <HomeScreen now={new Date("2026-10-23T08:00:00Z")} />
      </QueryClientProvider>,
    );
    await act(async () => {
      await sleep(100);
    });
    getToday.mockClear();
    await act(async () => {
      for (let i = 0; i < 20; i++) {
        handler?.("background");
        handler?.("active");
      }
      await sleep(300);
    });
    expect(getToday.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("RT Me sign-out failure (kept last: an unhandled rejection poisons later tests)", () => {
  it("FINDING: a rejecting signOut leaves Me usable and does not raise an unhandled rejection", async () => {
    const signOut = jest.fn(() => Promise.reject(new Error("boom")));
    const unhandled: unknown[] = [];
    const h = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", h);
    await render(<MeScreen email="a@b.com" profile={null} signOut={signOut} />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    await fireEvent.press(screen.getByRole("button", { name: "Yes, sign out" }));
    await act(async () => {
      await sleep(50);
    });
    process.off("unhandledRejection", h);
    expect(unhandled).toEqual([]);
  });
});
