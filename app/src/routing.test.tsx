import { renderRouter, screen } from "expo-router/testing-library";
import React from "react";
import { Text } from "react-native";
import { useProfile } from "@/features/profile/hooks";
import { SessionProvider } from "@/features/auth/session";
import type { TokenStore, Tokens } from "@/lib/storage";

jest.mock("@/features/profile/hooks", () => ({ useProfile: jest.fn() }));
const mockedUseProfile = useProfile as jest.Mock;

function store(initial: Tokens | null): TokenStore {
  let t = initial;
  return {
    load: () => Promise.resolve(t),
    save: (n) => {
      t = n;
      return Promise.resolve();
    },
    clear: () => {
      t = null;
      return Promise.resolve();
    },
  };
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
    const view = await renderRouter(tree(store(null)), { initialUrl: "/" });
    expect(await screen.findByText("login screen")).toBeTruthy();
    expect(view.getPathname()).toBe("/login");
  });

  it("signed in without a profile goes to setup", async () => {
    mockedUseProfile.mockReturnValue({ data: null, isLoading: false, error: null, refetch: jest.fn() });
    await renderRouter(tree(store({ accessToken: "A", refreshToken: "R" })), { initialUrl: "/" });
    expect(await screen.findByText("income screen")).toBeTruthy();
  });

  it("signed in with a profile goes home", async () => {
    mockedUseProfile.mockReturnValue({
      data: { incomePaise: 1 },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
    await renderRouter(tree(store({ accessToken: "A", refreshToken: "R" })), { initialUrl: "/" });
    expect(await screen.findByText("home screen")).toBeTruthy();
  });

  it("a failed profile load shows Retry instead of guessing", async () => {
    const refetch = jest.fn();
    mockedUseProfile.mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch });
    await renderRouter(tree(store({ accessToken: "A", refreshToken: "R" })), { initialUrl: "/" });
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
