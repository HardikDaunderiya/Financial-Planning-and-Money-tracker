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

describe("RT deep link while signed out", () => {
  it("held: /me and /home land on login, nothing rendered", async () => {
    jest.isolateModules(() => undefined);
    const Slot = () => require("expo-router").Slot as React.ComponentType;
    const routes = () => ({
      _layout: require("../../app/_layout").default as React.ComponentType,
      index: require("../../app/index").default as React.ComponentType,
      login: require("../../app/login").default as React.ComponentType,
      "login-code": require("../../app/login-code").default as React.ComponentType,
      "(tabs)/_layout": Slot(),
      "(tabs)/home": () => <RNText>home screen</RNText>,
      "(tabs)/me": () => <RNText>me screen</RNText>,
      "+not-found": () => <RNText>not found</RNText>,
    });
    await renderRouter(routes(), { initialUrl: "/me" });
    await waitFor(() => expect(rscreen).toHavePathname("/login"));
    expect(rscreen.queryByText("me screen")).toBeNull();
  });
});
