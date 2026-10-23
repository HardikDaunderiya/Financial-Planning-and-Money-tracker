import { cycleContaining, cycleLine, payday } from "./cycle";

describe("cycle maths (client copy of the server rules)", () => {
  it("BUD-01 fixed payday 1, Oct 2026", () => {
    expect(cycleContaining("2026-10-23", { rule: "FIXED_DAY", day: 1 })).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
      days: 31,
    });
  });

  it("BUD-02 mid-month payday", () => {
    expect(cycleContaining("2026-11-20", { rule: "FIXED_DAY", day: 15 })).toEqual({
      start: "2026-11-15",
      end: "2026-12-14",
      days: 30,
    });
  });

  it("BUD-03 February", () => {
    expect(cycleContaining("2027-02-10", { rule: "FIXED_DAY", day: 1 })).toEqual({
      start: "2027-02-01",
      end: "2027-02-28",
      days: 28,
    });
  });

  it("BUD-04 last working day on a weekend", () => {
    expect(payday("2026-10", { rule: "LAST_WORKING_DAY" })).toBe("2026-10-30");
    expect(cycleContaining("2026-11-10", { rule: "LAST_WORKING_DAY" })).toEqual({
      start: "2026-10-30",
      end: "2026-11-29",
      days: 31,
    });
  });

  it("BUD-05 last working day on a weekday", () => {
    expect(payday("2026-12", { rule: "LAST_WORKING_DAY" })).toBe("2026-12-31");
  });

  it("a date on payday starts a new cycle; the day before belongs to the old one", () => {
    expect(cycleContaining("2026-11-01", { rule: "FIXED_DAY", day: 1 }).start).toBe("2026-11-01");
    expect(cycleContaining("2026-10-31", { rule: "FIXED_DAY", day: 1 }).start).toBe("2026-10-01");
  });

  it("APP-25 cycle line names the next two cycles", () => {
    const today = "2026-10-23";
    expect(cycleLine(today, { rule: "FIXED_DAY", day: 1 })).toBe(
      "Your budget cycle runs 1 Nov – 30 Nov, then 1 Dec – 31 Dec",
    );
    expect(cycleLine(today, { rule: "LAST_WORKING_DAY" })).toBe(
      "Your budget cycle runs 30 Oct – 29 Nov, then 30 Nov – 30 Dec",
    );
    expect(cycleLine(today, { rule: "FIXED_DAY", day: 7 })).toBe(
      "Your budget cycle runs 7 Nov – 6 Dec, then 7 Dec – 6 Jan",
    );
    expect(cycleLine(today, { rule: "FIXED_DAY", day: 15 })).toBe(
      "Your budget cycle runs 15 Nov – 14 Dec, then 15 Dec – 14 Jan",
    );
  });
});
