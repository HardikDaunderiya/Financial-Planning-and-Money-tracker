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

describe("RT sign-out leaves nothing", () => {
  it("held: user sign-out clears email, setup draft, token", async () => {
    await render(<Harness />);
    await waitFor(() => expect(ctl).toBeDefined());
    await signInAndSeed("priya@example.com");
    expect((await KEYS_STATE()).kv["gullak.me.email"]).toBe("priya@example.com");
    await act(async () => {
      await ctl.signOut();
      await sleep(1500);
    });
    const s = await KEYS_STATE();
    expect(s.kv["gullak.me.email"]).toBeNull();
    expect(s.kv["gullak.setup-draft"]).toBeNull();
    expect(s.session).toBeNull();
  });

  it("FINDING: after user sign-out gullak.query-cache is gone (no key, and no A figures)", async () => {
    await render(<Harness />);
    await signInAndSeed("priya@example.com");
    expect(await AsyncStorage.getItem("gullak.query-cache")).toContain("A-LINE");
    await act(async () => {
      await ctl.signOut();
      await sleep(2500); // let any throttled persist run after the wipe
    });
    const raw = await AsyncStorage.getItem("gullak.query-cache");
    expect(raw ?? "").not.toContain("A-LINE");
    expect(raw).toBeNull(); // "nothing may remain": the persist subscription re-creates the key
  });

  it("FINDING: forced onSignedOut (refresh rejected) leaves no query-cache key", async () => {
    await render(<Harness />);
    await signInAndSeed("priya@example.com");
    await act(async () => {
      authEvents.emitSignedOut();
      await sleep(2500);
    });
    const s = await KEYS_STATE();
    expect(s.kv["gullak.me.email"]).toBeNull();
    expect(s.kv["gullak.setup-draft"]).toBeNull();
    expect(s.kv["gullak.query-cache"]).toBeNull();
  });

  it("FINDING: signOut() resolves only after the persisted wipe finished (kill-app-right-after-tap safe)", async () => {
    const slow = deferred<void>();
    const removeSpy = jest.spyOn(persister, "removeClient").mockImplementation(() => slow.promise);
    await render(<Harness />);
    await signInAndSeed("priya@example.com");
    let done = false;
    await act(async () => {
      void ctl.signOut().then(() => (done = true));
      await sleep(100);
    });
    const wasDone = done;
    const called = removeSpy.mock.calls.length;
    slow.resolve();
    removeSpy.mockRestore();
    expect(called).toBeGreaterThan(0);
    expect(wasDone).toBe(false); // the cache wipe has not completed, yet sign-out reported done
  });

  it("FINDING: email kv write is awaited before wipe can race: kv email removed even if signIn finishes after a forced sign-out", async () => {
    await render(<Harness />);
    await waitFor(() => expect(ctl).toBeDefined());
    await act(async () => {
      const p = ctl.signIn({ accessToken: "A", refreshToken: "R" }, "late@example.com");
      authEvents.emitSignedOut(); // 401 handling lands mid sign-in
      await p;
      await sleep(200);
    });
    // status ended signedIn with a token the server just refused? at minimum the session must not be signedIn without tokens
    const hasToken = mockSecure.has("gullak.session");
    expect(ctl.status === "signedIn" ? hasToken : true).toBe(true);
  });
});

describe("RT A then B never sees A", () => {
  it("held: A signs out, B signs in: no A line/figures/email render", async () => {
    await render(<Harness />);
    await signInAndSeed("priya@example.com");
    await act(async () => {
      await ctl.signOut();
      await sleep(300);
    });
    getToday.mockResolvedValue(dayB);
    await act(async () => {
      await ctl.signIn({ accessToken: "B", refreshToken: "RB" }, "bob@example.com");
    });
    await waitFor(() => expect(screen.queryByText("B-LINE hello")).toBeTruthy());
    expect(screen.queryByText(A_LINE)).toBeNull();
    expect(screen.queryByText("₹1,234")).toBeNull();
    expect(screen.getByTestId("probe").props.children).toBe("signedIn|bob@example.com");
  });

  it("held: B signing in with no email does not inherit A's email", async () => {
    await render(<Harness />);
    await signInAndSeed("priya@example.com");
    await act(async () => {
      await ctl.signOut();
      await ctl.signIn({ accessToken: "B", refreshToken: "RB" });
    });
    expect(ctl.email).toBeNull();
  });

  it("FINDING: a persister that restores late (after sign-out) does not put A's cache in front of B", async () => {
    // A's cache is on disk; the restore is slow, and the session ends (forced) before it lands.
    const stored = JSON.stringify({
      buster: "",
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: [
          {
            queryKey: ["today"],
            queryHash: '["today"]',
            state: {
              data: dayA,
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: "success",
              fetchStatus: "idle",
            },
          },
        ],
      },
    });
    const gate = deferred<void>();
    const slowPersister = {
      persistClient: persister.persistClient,
      removeClient: persister.removeClient,
      restoreClient: async () => {
        await gate.promise;
        return JSON.parse(stored) as never;
      },
    };
    getToday.mockImplementation(() => new Promise(() => undefined)); // B's own fetch stays pending
    mockSecure.set("gullak.session", JSON.stringify({ accessToken: "A", refreshToken: "RA" }));
    await render(<Harness persist={{ ...persistOptions, persister: slowPersister }} />);
    await act(async () => {
      authEvents.emitSignedOut();
      await sleep(50);
    });
    await act(async () => {
      await ctl.signIn({ accessToken: "B", refreshToken: "RB" }, "bob@example.com");
    });
    await act(async () => {
      gate.resolve();
      await sleep(200);
    });
    expect(screen.queryByText(A_LINE)).toBeNull();
  });
});

describe("RT logs", () => {
  it("held: rendering Home with sensitive line and signing out logs no email, amount or line", async () => {
    const spies = (["debug", "info", "warn", "error", "log"] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    await render(<Harness />);
    await signInAndSeed("priya@example.com");
    await act(async () => {
      await ctl.signOut();
      await sleep(200);
    });
    const out = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    spies.forEach((s) => s.mockRestore());
    expect(out).not.toContain("priya@example.com");
    expect(out).not.toContain("4,321");
    expect(out).not.toContain("A-LINE");
    expect(out).not.toMatch(/ACC|REF/);
    void createLogger;
  });
});
