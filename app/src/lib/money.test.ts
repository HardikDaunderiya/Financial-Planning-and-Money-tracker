import { formatRupees, parseRupeesToPaise } from "./money";

describe("formatRupees (APP-01)", () => {
  it.each([
    [100000, "₹1,000"],
    [10000000, "₹1,00,000"],
    [0, "₹0"],
    [59333, "₹593"],
    [99, "₹0"],
    [-50, "₹0"],
    [-40050, "−₹400"],
    [1234567800, "₹1,23,45,678"],
  ])("%i paise → %s", (paise, text) => {
    expect(formatRupees(paise)).toBe(text);
  });
});

describe("parseRupeesToPaise", () => {
  it.each([
    ["50000", 5000000],
    ["₹50,000", 5000000],
    ["50,000.75", 5000000],
    ["  1 000 ", 100000],
    ["", 0],
    ["abc", 0],
    ["99999999", 9999999_00],
  ])("%s → %i", (text, paise) => {
    expect(parseRupeesToPaise(text)).toBe(paise);
  });

  it("strips leading zeros before the cap", () => {
    expect(parseRupeesToPaise("0000000123")).toBe(12300);
  });

  it("caps at 7 digits of rupees", () => {
    expect(parseRupeesToPaise("123456789")).toBe(1234567_00);
  });
});
