/* Red team, plan-02 task 6: sign-in screens, gate, protected routes, error boundary. Tests that FAIL demonstrate a finding. */
/* eslint-disable @typescript-eslint/require-await -- act() callbacks resolve deferreds synchronously */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { renderRouter, screen as rscreen } from "expo-router/testing-library";
import React from "react";
import { Text } from "react-native";
import { AppErrorBoundary, RouteErrorFallback } from "@/components/error-boundary";
import { CodeForm } from "@/features/auth/components/code-form";
import { EmailForm } from "@/features/auth/components/email-form";
import { ApiError } from "@/lib/api-errors";
import { createLogger } from "@/lib/log";
import { deferred } from "./redteam-helpers";

let mockTokens: { accessToken: string; refreshToken: string } | null = null;
jest.mock("@/lib/storage", () => ({
  tokenStore: {
    load: () => Promise.resolve(mockTokens),
    save: (t: { accessToken: string; refreshToken: string }) => {
      mockTokens = t;
      return Promise.resolve();
    },
    clear: () => {
      mockTokens = null;
      return Promise.resolve();
    },
  },
}));
jest.mock("@/features/profile/hooks", () => ({
  useProfile: () => ({ data: { incomePaise: 1 }, isLoading: false, error: null, refetch: jest.fn() }),
}));

jest.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));

const pair = { accessToken: "A", refreshToken: "R", expiresIn: 900 };

async function email(raw: string) {
  const requestCode = jest.fn(() => Promise.resolve());
  const onSent = jest.fn();
  await render(<EmailForm requestCode={requestCode} onSent={onSent} />);
  await fireEvent.changeText(screen.getByLabelText("Email"), raw);
  await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
  return { requestCode, onSent };
}

describe("RT email entry", () => {
  it("held: leading/trailing unicode spaces (NBSP, ideographic, U+2003) are trimmed", async () => {
    const { requestCode } = await email(" 　 A@B.com  ");
    await waitFor(() => expect(requestCode).toHaveBeenCalledWith("a@b.com"));
  });
  it("held: uppercase is lowercased", async () => {
    const { requestCode } = await email("PRIYA@EXAMPLE.COM");
    await waitFor(() => expect(requestCode).toHaveBeenCalledWith("priya@example.com"));
  });
  it("held: two @ rejected without a request", async () => {
    const { requestCode } = await email("a@b@c.com");
    expect(requestCode).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
  });
  it("held: embedded space/newline rejected", async () => {
    const { requestCode } = await email("a b@c.com\nx");
    expect(requestCode).not.toHaveBeenCalled();
  });
  it("FINDING: zero-width characters inside the email are not rejected or stripped", async () => {
    const { requestCode } = await email("pri​ya@exam‍ple.com");
    expect(requestCode).not.toHaveBeenCalled();
  });
  it("FINDING: 300-character email is sent to the server (no client length cap)", async () => {
    const { requestCode } = await email(`${"a".repeat(290)}@x.com`);
    expect(requestCode).not.toHaveBeenCalled();
  });
  it("FINDING: a right-to-left override in the email is sent", async () => {
    const { requestCode } = await email("a‮bc@x.com");
    expect(requestCode).not.toHaveBeenCalled();
  });
  it("held: double tap on Send code sends once", async () => {
    const d = deferred<void>();
    const requestCode = jest.fn(() => d.promise);
    await render(<EmailForm requestCode={requestCode} onSent={() => undefined} />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "a@b.com");
    const btn = screen.getByRole("button", { name: "Send code" });
    await fireEvent.press(btn);
    await fireEvent.press(btn);
    await act(async () => d.resolve());
    expect(requestCode).toHaveBeenCalledTimes(1);
  });
  it("FINDING: keyboard Send (submitEditing) while a request is in flight does not re-send", async () => {
    const d = deferred<void>();
    const requestCode = jest.fn(() => d.promise);
    await render(<EmailForm requestCode={requestCode} onSent={() => undefined} />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "a@b.com");
    await fireEvent(screen.getByLabelText("Email"), "submitEditing");
    await fireEvent(screen.getByLabelText("Email"), "submitEditing");
    await act(async () => d.resolve());
    expect(requestCode).toHaveBeenCalledTimes(1);
  });
});

async function code(
  verifyCode = jest.fn(() => Promise.resolve(pair)),
  requestCode = jest.fn(() => Promise.resolve()),
) {
  const onVerified = jest.fn();
  const utils = await render(
    <CodeForm email="a@b.com" verifyCode={verifyCode} requestCode={requestCode} onVerified={onVerified} />,
  );
  const input = () => screen.getByLabelText("6-digit code");
  return { verifyCode, requestCode, onVerified, input, ...utils };
}

describe("RT code entry", () => {
  it("held (ruling 8: NFKC): full-width digits are normalised and submitted as ASCII", async () => {
    const { verifyCode, input } = await code();
    await fireEvent.changeText(input(), "１２３４５６");
    await waitFor(() => expect(verifyCode).toHaveBeenCalledWith("a@b.com", "123456"));
  });
  it("held: Arabic-Indic digits are not submitted", async () => {
    const { verifyCode, input } = await code();
    await fireEvent.changeText(input(), "١٢٣٤٥٦");
    expect(verifyCode).not.toHaveBeenCalled();
  });
  it("held: letters only never submit", async () => {
    const { verifyCode, input } = await code();
    await fireEvent.changeText(input(), "abcdef");
    expect(verifyCode).not.toHaveBeenCalled();
  });
  it("held: spaced/dashed paste '123 456' submits 123456", async () => {
    const { verifyCode, input } = await code();
    await fireEvent.changeText(input(), "123 456");
    await waitFor(() => expect(verifyCode).toHaveBeenCalledWith("a@b.com", "123456"));
  });
  it("FINDING: pasted text mixing letters and 7+ digits is silently cut to 6 digits and submitted", async () => {
    const { verifyCode, input } = await code();
    await fireEvent.changeText(input(), "order 12-3456-789 ref");
    expect(verifyCode).not.toHaveBeenCalled();
  });
  it("held (ruling 8): 7+ digits are rejected, never truncated or sent", async () => {
    const { verifyCode, input } = await code();
    await fireEvent.changeText(input(), "12345678901");
    expect(await screen.findByText("Enter the 6-digit code")).toBeTruthy();
    expect(verifyCode).not.toHaveBeenCalled();
  });
  it("held: rapid repeated full-code input verifies once while pending", async () => {
    const d = deferred<typeof pair>();
    const { verifyCode, input } = await code(jest.fn(() => d.promise));
    await fireEvent.changeText(input(), "123456");
    await fireEvent.changeText(input(), "123456");
    await fireEvent.changeText(input(), "654321");
    expect(verifyCode).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(pair));
  });
  it("held: re-render while verify pending still calls onVerified once", async () => {
    const d = deferred<typeof pair>();
    const verify = jest.fn(() => d.promise);
    const onVerified = jest.fn();
    const el = (k: number) => (
      <CodeForm
        email="a@b.com"
        verifyCode={verify}
        requestCode={() => Promise.resolve()}
        onVerified={onVerified}
        key="x"
        data-k={k}
      />
    );
    const r = await render(el(1));
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "123456");
    await r.rerender(el(2));
    await r.rerender(el(3));
    await act(async () => d.resolve(pair));
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it("held: unmount mid-verify does not call onVerified or throw", async () => {
    const d = deferred<typeof pair>();
    const { onVerified, unmount, input } = await code(jest.fn(() => d.promise));
    await fireEvent.changeText(input(), "123456");
    await unmount();
    await act(async () => d.resolve(pair));
    expect(onVerified).not.toHaveBeenCalled();
  });
  it("FINDING: Resend can be tapped while a verify is in flight (new code would invalidate the one being checked)", async () => {
    const d = deferred<typeof pair>();
    const { requestCode, input } = await code(jest.fn(() => d.promise));
    await fireEvent.changeText(input(), "123456");
    await fireEvent.press(screen.getByRole("button", { name: "Resend code" }));
    expect(requestCode).not.toHaveBeenCalled();
    await act(async () => d.resolve(pair));
  });
  it("held: rapid Resend taps send one request", async () => {
    const d = deferred<void>();
    const { requestCode } = await code(
      undefined,
      jest.fn(() => d.promise),
    );
    const b = screen.getByRole("button", { name: "Resend code" });
    await fireEvent.press(b);
    await fireEvent.press(b);
    await fireEvent.press(b);
    await act(async () => d.resolve());
    expect(requestCode).toHaveBeenCalledTimes(1);
  });
  it("FINDING: resend finishing while a verify is pending wipes the typed code and un-busies the form", async () => {
    const d = deferred<typeof pair>();
    const { input } = await code(jest.fn(() => d.promise));
    await fireEvent.changeText(input(), "123456");
    await act(async () => await fireEvent.press(screen.getByRole("button", { name: "Resend code" })));
    // verify still pending, so the form must still be busy (input locked)
    expect(input().props.editable).toBe(false);
    await act(async () => d.resolve(pair));
  });
  it("held: OTP_LOCKED locks input and shows the mapped message, never server text", async () => {
    const { input } = await code(
      jest.fn(() => Promise.reject(new ApiError("OTP_LOCKED", 429, "SERVER-SECRET-TEXT 555"))),
    );
    await fireEvent.changeText(input(), "123456");
    expect(await screen.findByText(/Too many tries/)).toBeTruthy();
    expect(screen.queryByText(/SERVER-SECRET/)).toBeNull();
    expect(input().props.editable).toBe(false);
    expect(screen.getByRole("button", { name: "Send a new code" })).toBeTruthy();
  });
  it("held: wrong code clears the boxes so it is not retained on screen", async () => {
    const { input } = await code(jest.fn(() => Promise.reject(new ApiError("OTP_INVALID", 400, "x"))));
    await fireEvent.changeText(input(), "123456");
    await screen.findByText(/not right/);
    expect(screen.getByTestId("code-box-0")).toHaveTextContent("");
  });
});

describe("RT hostile deep-link params on the code screen", () => {
  afterEach(() => jest.dontMock("expo-router"));

  it("held: HTML in the email param renders as inert text", async () => {
    const html = "<script>alert(1)</script><img src=x onerror=alert(1)>";
    await render(
      <CodeForm email={html} verifyCode={jest.fn()} requestCode={jest.fn()} onVerified={jest.fn()} />,
    );
    expect(screen.getByText(new RegExp("Sent to <script>"))).toBeTruthy();
  });
  it("FINDING: the code screen accepts an unvalidated 10,000-char email param and would POST it", async () => {
    // a deep link to /login-code?email=<10k> should be rejected like the email form does
    const long = "x".repeat(10000);
    const verify = jest.fn(() => Promise.resolve(pair));
    jest.isolateModules(() => undefined);
    await render(
      <CodeForm email={long} verifyCode={verify} requestCode={jest.fn()} onVerified={jest.fn()} />,
    );
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "123456");
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("RT routes (real _layout and screens)", () => {
  const Mod = () => require("../../app/_layout").default as React.ComponentType;
  const routes = () => ({
    _layout: Mod(),
    index: require("../../app/index").default as React.ComponentType,
    login: require("../../app/login").default as React.ComponentType,
    "login-code": require("../../app/login-code").default as React.ComponentType,
    "onboarding/_layout": () => {
      const Slot = require("expo-router").Slot as React.ComponentType;
      return <Slot />;
    },
    "onboarding/income": () => <Text>income screen</Text>,
    "(tabs)/_layout": () => {
      const Slot = require("expo-router").Slot as React.ComponentType;
      return <Slot />;
    },
    "(tabs)/home": () => <Text>home screen</Text>,
    "+not-found": () => <Text>not found</Text>,
  });
  beforeEach(() => {
    mockTokens = null;
  });

  it("held: signed out, deep link to a (tabs) screen lands on login", async () => {
    await renderRouter(routes(), { initialUrl: "/home" });
    await waitFor(() => expect(rscreen).toHavePathname("/login"));
    expect(rscreen.queryByText("home screen")).toBeNull();
  });
  it("held: signed out, deep link to /onboarding/income lands on login", async () => {
    await renderRouter(routes(), { initialUrl: "/onboarding/income" });
    await waitFor(() => expect(rscreen).toHavePathname("/login"));
    expect(rscreen.queryByText("income screen")).toBeNull();
  });
  it("held: signed in, deep link to /login does not show login", async () => {
    mockTokens = { accessToken: "A", refreshToken: "R" };
    await renderRouter(routes(), { initialUrl: "/login" });
    await waitFor(() => expect(rscreen).not.toHavePathname("/login"));
    expect(rscreen.queryByTestId("login")).toBeNull();
  });
  it("held: signed in, deep link to /login-code?email=x does not show code screen", async () => {
    mockTokens = { accessToken: "A", refreshToken: "R" };
    await renderRouter(routes(), { initialUrl: "/login-code?email=a@b.com" });
    await waitFor(() => expect(rscreen.queryByTestId("login-code")).toBeNull());
  });
  it("held: signed out, /login-code with no email redirects to /login", async () => {
    await renderRouter(routes(), { initialUrl: "/login-code" });
    await waitFor(() => expect(rscreen).toHavePathname("/login"));
  });
  it("held: signed out, /login-code with an array email param does not crash the app", async () => {
    await renderRouter(routes(), { initialUrl: "/login-code?email=a@b.com&email=c@d.com" });
    // reaching here without a thrown render error is the pass condition
    expect(true).toBe(true);
  });
  it("FINDING: /login-code with array email param is passed as an array to the code form", async () => {
    await renderRouter(routes(), { initialUrl: "/login-code?email=a@b.com&email=c@d.com" });
    expect(rscreen.queryByTestId("login-code")).toBeNull();
  });
  it("FINDING: /login-code with a hostile (non-email) param is accepted instead of sent back to /login", async () => {
    await renderRouter(routes(), { initialUrl: "/login-code?email=%3Cb%3Ehi%3C%2Fb%3E" });
    await waitFor(() => expect(rscreen).toHavePathname("/login"));
  });
});

function Bomb({ msg }: { msg: string }): React.ReactElement {
  throw new Error(msg);
}

describe("RT error boundary", () => {
  const SECRET = "user priya@example.com code 123456 token eyJhbGciOiJIUzI1NiJ9.abc.def amount ₹4,500";
  beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("held: boundary fallback never shows the error text", async () => {
    await render(
      <AppErrorBoundary report={() => undefined}>
        <Bomb msg={SECRET} />
      </AppErrorBoundary>,
    );
    expect(screen.queryByText(/priya|123456|eyJ|4,500/)).toBeNull();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });
  it("held: route fallback never shows the error text", async () => {
    await render(<RouteErrorFallback error={new Error(SECRET)} retry={() => Promise.resolve()} />);
    expect(screen.queryByText(/priya|123456|eyJ|4,500/)).toBeNull();
  });

  function capture(dev: boolean) {
    const calls: unknown[] = [];
    const con = {
      debug: (...a: unknown[]) => calls.push(a),
      info: (...a: unknown[]) => calls.push(a),
      warn: (...a: unknown[]) => calls.push(a),
      error: (...a: unknown[]) => calls.push(a),
    };
    const lg = createLogger({
      dev,
      console: con,
      sink: { report: (...a: unknown[]) => calls.push(a) },
    });
    return { calls, lg };
  }
  it("held: dev console and prod sink drop email, 6-digit code, JWT and amount from an error message", async () => {
    for (const dev of [true, false]) {
      const { calls, lg } = capture(dev);
      lg.error("boundary.caught", { message: SECRET });
      expect(JSON.stringify(calls)).not.toMatch(/priya|123456|eyJ|4,500/);
    }
  });
  it("FINDING: an opaque refresh token inside an error message reaches the log (dev console and prod sink)", async () => {
    const refresh = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MDEyMzQ1Ng";
    for (const dev of [true, false]) {
      const { calls, lg } = capture(dev);
      lg.error("boundary.caught", { message: `refresh failed for ${refresh}` });
      expect(JSON.stringify(calls)).not.toContain(refresh);
    }
  });
  it("held: sign-in flow logs nothing containing the email or code (dev console)", async () => {
    const spies = (["debug", "info", "warn", "error", "log"] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { input } = await code(
      jest.fn(() => Promise.reject(new ApiError("OTP_INVALID", 400, "bad 123456 a@b.com"))),
    );
    await fireEvent.changeText(input(), "123456");
    await screen.findByText(/not right/);
    const out = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(out).not.toMatch(/123456|a@b\.com/);
  });
});
