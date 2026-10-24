import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { budgetApi } from "@/features/budget/api";
import { OwnedCache } from "@/features/auth/persist-gate";
import { SessionProvider } from "@/features/auth/session";
import { HomeScreen } from "@/features/home/home-screen";
import { useProfile } from "@/features/profile/hooks";
import { persister } from "@/lib/query";
import type { TokenStore } from "@/lib/storage";

jest.mock("expo-router", () => ({ Redirect: () => null }));
jest.mock("@/features/profile/hooks", () => ({ useProfile: jest.fn() }));
jest.mock("@/features/budget/api", () => ({ budgetApi: { getToday: jest.fn(), setFirstCycle: jest.fn() } }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const signedIn: TokenStore = {
  load: () => Promise.resolve({ accessToken: "A", refreshToken: "R" }),
  save: () => Promise.resolve(),
  clear: () => Promise.resolve(),
};

function Index() {
  const Real = require("../app/index").default as React.ComponentType;
  return <Real />;
}

/** The persisted cache is still being read from disk: TanStack reports every query as idle until it is done. */
async function renderWhileRestoring(child: React.ReactNode) {
  const restore = jest.spyOn(persister, "restoreClient").mockReturnValue(new Promise(() => undefined));
  const client = new QueryClient({
    defaultOptions: { queries: { networkMode: "offlineFirst", retry: false } },
  });
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SessionProvider store={signedIn} logout={() => Promise.resolve()}>
        <OwnedCache client={client}>{child}</OwnedCache>
      </SessionProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(restore).toHaveBeenCalled());
  return restore;
}

afterEach(() => jest.restoreAllMocks());

describe("while the saved cache is restoring (I1)", () => {
  it("the index route shows the skeleton, never 'No connection'", async () => {
    (useProfile as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: jest.fn(),
    });
    await renderWhileRestoring(<Index />);
    expect(await screen.findByTestId("profile-loading")).toBeTruthy();
    expect(screen.queryByText(/No connection/)).toBeNull();
  });

  it("Home shows its skeleton, never an error", async () => {
    (budgetApi.getToday as jest.Mock).mockReturnValue(new Promise(() => undefined));
    await renderWhileRestoring(<HomeScreen now={new Date("2026-10-23T08:00:00Z")} />);
    expect(await screen.findByTestId("home-skeleton")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
