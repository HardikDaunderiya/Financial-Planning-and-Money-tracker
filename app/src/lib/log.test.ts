import { createLogger, redact } from "./log";
import type { ReportingSink } from "./reporting";

type Captured = { level: string; event: string; data?: Record<string, unknown> | undefined };

function sink(): ReportingSink & { events: Captured[] } {
  const events: Captured[] = [];
  return { events, report: (level, event, data) => void events.push({ level, event, data }) };
}

function quietConsole() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe("logger (LOG-08)", () => {
  it("in development everything prints to the console", () => {
    const console = quietConsole();
    const s = sink();
    const log = createLogger({ dev: true, console, sink: s });
    log.debug("screen.view", { route: "/" });
    log.info("api.call", { route: "/budget/today", status: 200 });
    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(s.events).toHaveLength(0);
  });

  it("in production debug is dropped and info and above reach the sink", () => {
    const console = quietConsole();
    const s = sink();
    const log = createLogger({ dev: false, console, sink: s });
    log.debug("screen.view", { route: "/" });
    log.info("api.call", { route: "/budget/today", status: 200 });
    log.warn("error.unmapped", { errorCode: "NEW_CODE" });
    log.error("boundary.caught", { message: "boom" });
    expect(console.debug).not.toHaveBeenCalled();
    expect(s.events.map((e) => e.level)).toEqual(["info", "warn", "error"]);
  });

  it("never throws when the sink or the console throws", () => {
    const boom = () => {
      throw new Error("boom");
    };
    const bad = createLogger({ dev: false, console: quietConsole(), sink: { report: boom } });
    expect(() => bad.error("x", { route: "/" })).not.toThrow();
    const badConsole = createLogger({
      dev: true,
      console: { debug: boom, info: boom, warn: boom, error: boom },
    });
    expect(() => badConsole.info("x", { route: "/" })).not.toThrow();
  });

  it("never throws when the sink getter throws", () => {
    const log = createLogger({
      dev: false,
      console: quietConsole(),
      sink: () => {
        throw new Error("boom");
      },
    });
    expect(() => log.warn("x")).not.toThrow();
  });
});

describe("redaction (LOG-09)", () => {
  it("passes only allow-listed keys with primitive values", () => {
    const out = redact({
      route: "/transactions",
      method: "POST",
      status: 201,
      ms: 40,
      count: 3,
      attempt: 2,
      id: "abc",
      reason: "timeout",
      key: "k",
      granted: true,
      fatal: false,
      kind: "ok",
      screen: "home",
      amountPaise: 25000,
      merchant: "Third Wave",
      email: "priya@example.com",
      accessToken: "eyJabc",
      refreshToken: "abc",
      code: "123456",
      anything: "else",
    });
    expect(out).toEqual({
      route: "/transactions",
      method: "POST",
      status: 201,
      ms: 40,
      count: 3,
      attempt: 2,
      id: "abc",
      reason: "timeout",
      key: "k",
      granted: true,
      fatal: false,
      kind: "ok",
      screen: "home",
    });
  });

  it("drops arrays, objects, null and undefined under any key", () => {
    expect(redact({ route: ["priya@example.com", { a: 1 }] })).toEqual({});
    expect(redact({ kind: { value: 25000 } })).toEqual({});
    expect(redact({ id: null, status: undefined })).toEqual({});
  });

  it("drops string values that look like an email, a JWT, a 6-digit code or an amount", () => {
    expect(redact({ message: "sent to priya@example.com" })).toEqual({});
    expect(redact({ message: "token eyJhbGciOi.eyJzdWIi.sig" })).toEqual({});
    expect(redact({ message: "code 123456" })).toEqual({});
    expect(redact({ message: "Rs 250" })).toEqual({});
    expect(redact({ message: "paid rs.250" })).toEqual({});
    expect(redact({ message: "INR 1,000" })).toEqual({});
    expect(redact({ message: "spent ₹250" })).toEqual({});
    expect(redact({ message: "status 200" })).toEqual({ message: "status 200" });
  });

  it.each(["123 456", "123-456", "1 2 3 4 5 6", "Rs250", "INR1000", "eyJhbGciOiJIUzI1NiJ9", "a@b.com"])(
    "drops %s under message and under id",
    (value) => {
      expect(redact({ message: value })).toEqual({});
      expect(redact({ id: value })).toEqual({});
    },
  );

  it("drops a huge string quickly, before any regex runs", () => {
    const started = Date.now();
    expect(redact({ message: "a".repeat(1_000_000) })).toEqual({});
    expect(redact({ message: "a@".repeat(500_000) })).toEqual({});
    expect(Date.now() - started).toBeLessThan(50);
  });

  it("errorCode passes only when it looks like a code, else becomes invalid", () => {
    expect(redact({ errorCode: "OTP_INVALID" })).toEqual({ errorCode: "OTP_INVALID" });
    expect(redact({ errorCode: "a@b.com" })).toEqual({ errorCode: "invalid" });
    expect(redact({ errorCode: "x".repeat(70) })).toEqual({ errorCode: "invalid" });
  });

  it("survives a cyclic object and a throwing getter", () => {
    const cyclic: Record<string, unknown> = { route: "/" };
    cyclic.self = cyclic;
    expect(redact(cyclic)).toEqual({ route: "/" });
    const hostile = {
      route: "/",
      get id(): string {
        throw new Error("boom");
      },
    };
    expect(() => redact(hostile)).not.toThrow();
    expect(redact(hostile)).toEqual({ route: "/" });
    expect(redact({ nested: cyclic })).toEqual({});
  });

  it("ignores __proto__ and does not pollute", () => {
    const evil = JSON.parse('{"__proto__": {"polluted": true}, "route": "/"}') as Record<string, unknown>;
    const out = redact(evil);
    expect(out).toEqual({ route: "/" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("the sink never receives an unredacted field", () => {
    const s = sink();
    const log = createLogger({ dev: false, console: quietConsole(), sink: s });
    log.info("spend.created", { id: "abc", amountPaise: 25000 });
    expect(s.events[0]?.data).toEqual({ id: "abc" });
  });
});
