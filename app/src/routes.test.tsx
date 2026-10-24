import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFixedCosts, useFinishSetup, useProfile } from "@/features/profile/hooks";
import { SetupProvider } from "@/features/profile/setup-store";

jest.mock("@/features/profile/hooks", () => ({
  useProfile: jest.fn(),
  useFixedCosts: jest.fn(),
  useFinishSetup: jest.fn(() => jest.fn()),
}));
jest.mock("@/features/auth/session", () => ({
  useSession: () => ({ email: "priya@example.com", signOut: jest.fn(() => Promise.resolve()) }),
}));
jest.mock("expo-router", () => {
  const { Text: T } = require("react-native") as typeof import("react-native");
  return {
    useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
    Redirect: ({ href }: { href: string }) => <T>{`redirect ${href}`}</T>,
  };
});
jest.mock("expo-router/stack", () => {
  const { Text: T } = require("react-native") as typeof import("react-native");
  return { Stack: () => <T>setup stack</T> };
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const Safe = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
);

const profile = {
  incomePaise: 5000000,
  savingsPaise: 2000000,
  paydayRule: "FIXED_DAY",
  paydayDay: 1,
  personality: "CHILL",
  morningTime: "08:00",
  nightTime: "22:00",
  timezone: "Asia/Kolkata",
};

describe("personality route waits for fixed costs (M3)", () => {
  const Route = () => {
    const Real = require("../app/onboarding/personality").default as React.ComponentType;
    return <Real />;
  };
  const renderRoute = () =>
    render(
      <Safe>
        <SetupProvider persist={false}>
          <Route />
        </SetupProvider>
      </Safe>,
    );

  it("shows a skeleton, not a figure computed with 0, while fixed costs load", async () => {
    (useFixedCosts as jest.Mock).mockReturnValue({ data: undefined, isLoading: true, error: null });
    await renderRoute();
    expect(screen.getByTestId("personality-loading")).toBeTruthy();
    expect(screen.queryByText(/Start with/)).toBeNull();
  });

  it("shows an error with Retry when fixed costs fail to load", async () => {
    const refetch = jest.fn();
    (useFixedCosts as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("x"),
      refetch,
    });
    await renderRoute();
    expect(screen.queryByText(/Start with/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the screen once fixed costs are known", async () => {
    (useFixedCosts as jest.Mock).mockReturnValue({
      data: [{ id: "1", name: "Rent", amountPaise: 1000000 }],
      isLoading: false,
      error: null,
    });
    (useFinishSetup as jest.Mock).mockReturnValue(jest.fn());
    await renderRoute();
    expect(screen.getByRole("button", { name: /Start with/ })).toBeTruthy();
  });
});

describe("Me route (M5)", () => {
  const Route = () => {
    const Real = require("../app/(tabs)/me").default as React.ComponentType;
    return <Real />;
  };

  it("shows a skeleton while the profile loads", async () => {
    (useProfile as jest.Mock).mockReturnValue({ data: undefined, isLoading: true, error: null });
    await render(
      <Safe>
        <Route />
      </Safe>,
    );
    expect(screen.getByTestId("me-loading")).toBeTruthy();
    expect(screen.getByText("priya@example.com")).toBeTruthy();
  });

  it("shows an error with Retry when the profile fails, and sign-out stays available", async () => {
    const refetch = jest.fn();
    (useProfile as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("x"),
      refetch,
    });
    await render(
      <Safe>
        <Route />
      </Safe>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("shows the profile when loaded", async () => {
    (useProfile as jest.Mock).mockReturnValue({ data: profile, isLoading: false, error: null });
    await render(
      <Safe>
        <Route />
      </Safe>,
    );
    expect(screen.getByText("8:00 am and 10:00 pm")).toBeTruthy();
    expect(screen.queryByTestId("me-loading")).toBeNull();
  });
});

describe("onboarding layout (M8)", () => {
  const Layout = () => {
    const Real = require("../app/onboarding/_layout").default as React.ComponentType;
    return <Real />;
  };

  it("sends a user who already has a profile to home", async () => {
    (useProfile as jest.Mock).mockReturnValue({ data: profile, isLoading: false, error: null });
    await render(<Layout />);
    expect(screen.getByText("redirect /home")).toBeTruthy();
    expect(screen.queryByText("setup stack")).toBeNull();
  });

  it("lets a user without a profile through", async () => {
    (useProfile as jest.Mock).mockReturnValue({ data: null, isLoading: false, error: null });
    await render(<Layout />);
    expect(screen.getByText("setup stack")).toBeTruthy();
  });

  it("does not pull a user out of setup when their own finish saves the profile", async () => {
    const state: { data: unknown } = { data: null };
    (useProfile as jest.Mock).mockImplementation(() => ({ data: state.data, isLoading: false, error: null }));
    const view = await render(<Layout />);
    expect(screen.getByText("setup stack")).toBeTruthy();
    state.data = profile;
    await view.rerender(<Layout />);
    expect(screen.getByText("setup stack")).toBeTruthy();
    expect(screen.queryByText("redirect /home")).toBeNull();
  });

  it("waits quietly while the profile is unknown", async () => {
    (useProfile as jest.Mock).mockReturnValue({ data: undefined, isLoading: true, error: null });
    await render(<Layout />);
    expect(screen.getByText("setup stack")).toBeTruthy();
    expect(screen.queryByText(/redirect/)).toBeNull();
  });
});
