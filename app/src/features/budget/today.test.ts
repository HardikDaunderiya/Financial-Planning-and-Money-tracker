import { UnknownError } from "@/lib/api-errors";
import { parseToday } from "./today";

const ok = {
  date: "2026-10-23",
  budgetPaise: 59300,
  spentPaise: 18000,
  leftPaise: 41300,
  overPaise: 0,
  poolOverPaise: 0,
  mood: "HAPPY",
  line: "₹413 left for today.",
  daysLeft: 9,
  cycleStart: "2026-10-01",
  cycleEnd: "2026-10-31",
};

describe("parseToday", () => {
  it("passes a good response through", () => {
    expect(parseToday(ok)).toEqual(ok);
  });
  it("maps an unknown mood to NERVOUS and warns with kind unknown_mood", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseToday({ ...ok, mood: "ECSTATIC" }).mood).toBe("NERVOUS");
    expect(JSON.stringify(warn.mock.calls)).toContain("unknown_mood");
    warn.mockRestore();
  });
  it.each([
    ["bad date", { date: "garbage" }],
    ["bad cycle end", { cycleEnd: "not-a-date" }],
    ["cycle reversed", { cycleStart: "2026-11-02" }],
    ["daysLeft 0", { daysLeft: 0 }],
    ["daysLeft negative", { daysLeft: -3 }],
    ["string money", { leftPaise: "abc" }],
    ["null money", { spentPaise: null }],
    ["negative money", { budgetPaise: -1 }],
    ["fraction", { budgetPaise: 1.5 }],
    ["unsafe", { leftPaise: 1e21 }],
    ["line not a string", { line: 4 }],
  ])("rejects %s as UnknownError", (_n, patch) => {
    expect(() => parseToday({ ...ok, ...patch })).toThrow(UnknownError);
  });
  it("rejects a non-object", () => {
    expect(() => parseToday(null)).toThrow(UnknownError);
  });
  it("strips bidi controls and caps the line at 280 characters with an ellipsis", () => {
    expect(parseToday({ ...ok, line: "‮₹413 left‬⁦x⁩" }).line).toBe("₹413 leftx");
    const line = parseToday({ ...ok, line: "word ".repeat(400) }).line;
    expect(line.length).toBe(280);
    expect(line.endsWith("…")).toBe(true);
  });
});
