import { installGlobalHandlers } from "./unhandled";

type Tracker = { onUnhandled: (id: number, reason: unknown) => void };

describe("global handlers (ERR-18)", () => {
  it("an unhandled rejection is logged and the app keeps running", () => {
    const error = jest.fn();
    const held: { tracker: Tracker | null } = { tracker: null };
    installGlobalHandlers({
      log: { error },
      hermes: {
        enablePromiseRejectionTracker: (o) => {
          held.tracker = o;
        },
      },
      errorUtils: null,
    });
    const t = held.tracker;
    expect(t).not.toBeNull();
    expect(() => t?.onUnhandled(1, new Error("boom"))).not.toThrow();
    expect(error).toHaveBeenCalledWith("promise.unhandled", { kind: "Error" });
  });

  it("falls back to the window event on web", () => {
    const error = jest.fn();
    const listeners: Record<string, (e: { reason: unknown }) => void> = {};
    installGlobalHandlers({
      log: { error },
      hermes: null,
      errorUtils: null,
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      },
    });
    listeners["unhandledrejection"]?.({ reason: "nope" });
    expect(error).toHaveBeenCalledWith("promise.unhandled", { kind: "non-error" });
  });

  it("uncaught JS errors are logged and passed to the previous handler", () => {
    const error = jest.fn();
    const previous = jest.fn();
    let handler: ((e: Error, fatal?: boolean) => void) | null = null;
    installGlobalHandlers({
      log: { error },
      hermes: null,
      errorUtils: {
        getGlobalHandler: () => previous,
        setGlobalHandler: (h) => {
          handler = h;
        },
      },
    });
    (handler as ((e: Error, fatal?: boolean) => void) | null)?.(new Error("crash"), true);
    expect(error).toHaveBeenCalledWith("js.uncaught", { kind: "Error", fatal: true });
    expect(previous).toHaveBeenCalled();
  });

  it("never logs the message text of an error", () => {
    const error = jest.fn();
    const held: { tracker: Tracker | null } = { tracker: null };
    installGlobalHandlers({
      log: { error },
      hermes: {
        enablePromiseRejectionTracker: (o) => {
          held.tracker = o;
        },
      },
      errorUtils: null,
    });
    class PaymentFailed extends Error {
      override name = "PaymentFailed";
    }
    held.tracker?.onUnhandled(1, new PaymentFailed("rahul@example.com owes 4500"));
    expect(error).toHaveBeenCalledWith("promise.unhandled", { kind: "PaymentFailed" });
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/rahul|4500/);
  });
});
