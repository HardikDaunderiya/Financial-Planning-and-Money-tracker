import { createLogger, redact } from "./log";
import type { ReportingSink } from "./reporting";

function sink(): ReportingSink & {
  events: { level: string; event: string; data?: Record<string, unknown> | undefined }[];
} {
  const events: { level: string; event: string; data?: Record<string, unknown> | undefined }[] = [];
  return { events, report: (level, event, data) => void events.push({ level, event, data }) };
}

describe("logger (LOG-08)", () => {
  it("in development everything prints to the console", () => {
    const console = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const s = sink();
    const log = createLogger({ dev: true, console, sink: s });
    log.debug("screen.view", { route: "/" });
    log.info("api.call", { route: "/budget/today", status: 200 });
    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(s.events).toHaveLength(0);
  });

  it("in production debug is dropped and info and above reach the sink", () => {
    const console = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const s = sink();
    const log = createLogger({ dev: false, console, sink: s });
    log.debug("screen.view", { route: "/" });
    log.info("api.call", { route: "/budget/today", status: 200 });
    log.warn("error.unmapped", { code: "NEW_CODE" });
    log.error("boundary.caught", { message: "boom" });
    expect(console.debug).not.toHaveBeenCalled();
    expect(s.events.map((e) => e.level)).toEqual(["info", "warn", "error"]);
  });
});

describe("redaction (LOG-09)", () => {
  it("drops amounts, merchant text, emails, tokens and codes from any field", () => {
    const out = redact({
      route: "/transactions",
      amountPaise: 25000,
      merchant: "Third Wave",
      email: "priya@example.com",
      accessToken: "eyJabc",
      refreshToken: "abc",
      code: "123456",
      nested: { merchantName: "Zepto", total: 300, kind: "ok" },
      status: 201,
    });
    expect(out).toEqual({ route: "/transactions", nested: { kind: "ok" }, status: 201 });
  });

  it("drops string values that look like an email, a JWT or a 6-digit code", () => {
    expect(redact({ message: "sent to priya@example.com" })).toEqual({});
    expect(redact({ message: "token eyJhbGciOi.eyJzdWIi.sig" })).toEqual({});
    expect(redact({ message: "code 123456" })).toEqual({});
    expect(redact({ message: "status 200" })).toEqual({ message: "status 200" });
  });

  it("the sink never receives an unredacted field", () => {
    const s = sink();
    const log = createLogger({
      dev: false,
      console: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      sink: s,
    });
    log.info("spend.created", { id: "abc", amountPaise: 25000 });
    expect(s.events[0]?.data).toEqual({ id: "abc" });
  });
});
