import { messageFor } from "./errors";
import { ERROR_CODES } from "./error-codes";
import { createLogger } from "./log";

describe("error messages (ERR-16)", () => {
  it("every server code has a message", () => {
    for (const code of ERROR_CODES) {
      expect(messageFor(code)).not.toBe("");
    }
  });

  it("an unknown code gets the generic message and is logged at WARN", () => {
    const warn = jest.fn();
    expect(messageFor("BRAND_NEW_A", { warn })).toBe("Something went wrong. Try again in a moment.");
    expect(warn).toHaveBeenCalledWith("error.unmapped", { errorCode: "BRAND_NEW_A" });
  });

  it("the production sink receives the code under errorCode", () => {
    const events: { level: string; event: string; data?: Record<string, unknown> | undefined }[] = [];
    const logger = createLogger({
      dev: false,
      console: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      sink: { report: (level, event, data) => void events.push({ level, event, data }) },
    });
    messageFor("BRAND_NEW", logger);
    expect(events).toEqual([{ level: "warn", event: "error.unmapped", data: { errorCode: "BRAND_NEW" } }]);
  });

  it("warns only once per code", () => {
    const warn = jest.fn();
    messageFor("ONCE_ONLY", { warn });
    messageFor("ONCE_ONLY", { warn });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a hostile code is logged as invalid", () => {
    const events: { data?: Record<string, unknown> | undefined }[] = [];
    const logger = createLogger({
      dev: false,
      console: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      sink: { report: (_l, _e, data) => void events.push({ data }) },
    });
    messageFor("a@b.com", logger);
    expect(events[0]?.data).toEqual({ errorCode: "invalid" });
  });
});
