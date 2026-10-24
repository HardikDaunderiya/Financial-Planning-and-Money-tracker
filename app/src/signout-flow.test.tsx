import { fireEvent } from "@testing-library/react-native";
import { renderRouter, screen, waitFor } from "expo-router/testing-library";
import React from "react";
import { Pressable, Text } from "react-native";
import { Slot } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OwnedCache } from "@/features/auth/persist-gate";
import { SessionProvider, useSession } from "@/features/auth/session";
import type { TokenStore, Tokens } from "@/lib/storage";

jest.mock("@/features/profile/hooks", () => ({
  useProfile: () => ({ data: { incomePaise: 1 }, isLoading: false, error: null, refetch: jest.fn() }),
}));
jest.mock("@/features/auth/api", () => ({
  authApi: {
    requestCode: jest.fn(() => Promise.resolve()),
    verifyCode: jest.fn(() => Promise.resolve({ accessToken: "A", refreshToken: "R", expiresIn: 900 })),
    logout: jest.fn(() => Promise.resolve()),
  },
}));

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

function Home() {
  const { signOut } = useSession();
  return (
    <>
      <Text>home screen</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={() => void signOut()}>
        <Text>Sign out</Text>
      </Pressable>
    </>
  );
}

function routes(tokens: TokenStore) {
  return {
    _layout: () => {
      const { Gate, Navigation } = require("./navigation") as typeof import("./navigation");
      return (
        <SafeAreaProvider>
          <SessionProvider store={tokens} logout={() => Promise.resolve()}>
            <OwnedCache>
              <Gate fontsLoaded fontError={null}>
                <Navigation />
              </Gate>
            </OwnedCache>
          </SessionProvider>
        </SafeAreaProvider>
      );
    },
    index: require("../app/index").default as React.ComponentType,
    login: require("../app/login").default as React.ComponentType,
    "login-code": require("../app/login-code").default as React.ComponentType,
    "onboarding/_layout": () => <Slot />,
    "onboarding/income": () => <Text>income screen</Text>,
    "(tabs)/_layout": () => <Slot />,
    "(tabs)/home": Home,
    "+not-found": require("../app/+not-found").default as React.ComponentType,
  };
}

describe("sign in, home, sign out through the real OwnedCache and Navigation (M4)", () => {
  it("lands on home, then on login, with no error and no stale screen", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const view = await renderRouter(routes(store(null)), { initialUrl: "/login-code?email=a@b.com" });
    await fireEvent.changeText(await screen.findByLabelText("6-digit code"), "123456");
    expect(await screen.findByText("home screen")).toBeTruthy();
    expect(view.getPathname()).toBe("/home");

    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByTestId("login")).toBeTruthy();
    await waitFor(() => expect(view.getPathname()).toBe("/login"));
    expect(screen.queryByText("home screen")).toBeNull();
    expect(screen.queryByText(/No connection|Something went wrong/)).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
