import { fireEvent } from "@testing-library/react-native";
import { renderRouter, screen } from "expo-router/testing-library";
import React from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/features/auth/session";
import { ApiError } from "@/lib/api-errors";
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

function routes(session: TokenStore) {
  const Slotted = ({ children }: { children: React.ReactNode }) => (
    <SafeAreaProvider>
      <SessionProvider store={session} logout={() => Promise.resolve()}>
        {children}
      </SessionProvider>
    </SafeAreaProvider>
  );
  const Slot = () => require("expo-router").Slot as React.ComponentType;
  const Passthrough = () => {
    const S = Slot();
    return <S />;
  };
  return {
    _layout: () => {
      const { Gate, Navigation } = require("./navigation") as {
        Gate: React.ComponentType<{
          fontsLoaded: boolean;
          fontError: Error | null;
          children: React.ReactNode;
        }>;
        Navigation: React.ComponentType;
      };
      return (
        <Slotted>
          <Gate fontsLoaded fontError={null}>
            <Navigation />
          </Gate>
        </Slotted>
      );
    },
    index: require("../app/index").default as React.ComponentType,
    login: require("../app/login").default as React.ComponentType,
    "login-code": require("../app/login-code").default as React.ComponentType,
    "onboarding/_layout": Passthrough,
    "onboarding/income": () => <Text>income screen</Text>,
    "(tabs)/_layout": Passthrough,
    "(tabs)/home": () => <Text>home screen</Text>,
    "+not-found": require("../app/+not-found").default as React.ComponentType,
  };
}

describe("Navigation guards", () => {
  it.each(["/home", "/onboarding/income"])("signed out, %s ends on /login", async (url) => {
    const view = await renderRouter(routes(store(null)), { initialUrl: url });
    expect(await screen.findByTestId("login")).toBeTruthy();
    expect(view.getPathname()).toBe("/login");
  });

  it.each(["/login", "/login-code?email=a@b.com"])("signed in, %s ends on home via /", async (url) => {
    const view = await renderRouter(routes(store({ accessToken: "A", refreshToken: "R" })), {
      initialUrl: url,
    });
    expect(await screen.findByText("home screen")).toBeTruthy();
    expect(view.getPathname()).toBe("/home");
  });

  it("signing in from the code screen lands on the index and then home", async () => {
    const view = await renderRouter(routes(store(null)), { initialUrl: "/login-code?email=a@b.com" });
    const input = await screen.findByLabelText("6-digit code");
    await fireEvent.changeText(input, "123456");
    expect(await screen.findByText("home screen")).toBeTruthy();
    expect(view.getPathname()).toBe("/home");
  });

  it("a code screen sign-in that rejects shows the generic message inline", async () => {
    const { authApi } = require("@/features/auth/api") as {
      authApi: { verifyCode: jest.Mock };
    };
    authApi.verifyCode.mockResolvedValueOnce({ accessToken: "A", refreshToken: "R", expiresIn: 900 });
    const failing: TokenStore = {
      ...store(null),
      save: () => Promise.reject(new ApiError("INTERNAL", 500, "x")),
    };
    await renderRouter(routes(failing), { initialUrl: "/login-code?email=a@b.com" });
    await fireEvent.changeText(await screen.findByLabelText("6-digit code"), "123456");
    expect(await screen.findByText("Something went wrong. Try again in a moment.")).toBeTruthy();
  });

  it("an unknown path signed out goes to login, signed in goes home", async () => {
    await renderRouter(routes(store(null)), { initialUrl: "/nope" });
    expect(await screen.findByTestId("login")).toBeTruthy();
  });

  it("an unknown path signed in goes home", async () => {
    await renderRouter(routes(store({ accessToken: "A", refreshToken: "R" })), { initialUrl: "/nope" });
    expect(await screen.findByText("home screen")).toBeTruthy();
  });
});

describe("Gate", () => {
  it("opens when fonts failed and logs fonts.failed with a reason", async () => {
    const { Gate } = require("./navigation") as {
      Gate: React.ComponentType<{
        fontsLoaded: boolean;
        fontError: Error | null;
        children: React.ReactNode;
      }>;
    };
    const { log } = require("@/lib/log") as { log: { error: (...a: unknown[]) => void } };
    const spy = jest.spyOn(log, "error").mockImplementation(() => undefined);
    const { render } =
      require("@testing-library/react-native") as typeof import("@testing-library/react-native");
    await render(
      <SessionProvider store={store(null)} logout={() => Promise.resolve()}>
        <Gate fontsLoaded={false} fontError={new Error("boom")}>
          <Text>open</Text>
        </Gate>
      </SessionProvider>,
    );
    expect(await screen.findByText("open")).toBeTruthy();
    expect(spy).toHaveBeenCalledWith("fonts.failed", { reason: "Error" });
  });
});
