import { messageFor } from "./errors";
import { ERROR_CODES } from "./error-codes";

describe("error messages (ERR-16)", () => {
  it("every server code has a message", () => {
    for (const code of ERROR_CODES) {
      expect(messageFor(code)).not.toBe("");
    }
  });

  it("an unknown code gets the generic message and is logged at WARN", () => {
    const warn = jest.fn();
    expect(messageFor("BRAND_NEW", { warn })).toBe("Something went wrong. Try again in a moment.");
    expect(warn).toHaveBeenCalledWith("error.unmapped", { code: "BRAND_NEW" });
  });
});
