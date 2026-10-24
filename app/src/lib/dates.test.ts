import { formatDay, formatDayLong, greeting, relativeTime, todayIst } from "./dates";

describe("dates (APP-02)", () => {
  it("runs in a zone that is not UTC, so IST handling is really exercised", () => {
    expect(new Date(0).getTimezoneOffset()).not.toBe(0);
  });

  it("formats a date as Fri, 23 Oct", () => {
    expect(formatDay("2026-10-23")).toBe("Fri, 23 Oct");
    expect(formatDay("2026-11-01")).toBe("Sun, 1 Nov");
  });

  it("formats a long date with the year", () => {
    expect(formatDayLong("2026-10-23")).toBe("Fri, 23 Oct 2026");
  });

  it("gives today in Asia/Kolkata whatever the device zone", () => {
    expect(todayIst(new Date("2026-10-23T19:00:00Z"))).toBe("2026-10-24");
    expect(todayIst(new Date("2026-10-23T18:29:59Z"))).toBe("2026-10-23");
  });

  it("greets by the hour in IST", () => {
    expect(greeting(new Date("2026-10-23T03:30:00Z"))).toBe("Good morning"); // 09:00 IST
    expect(greeting(new Date("2026-10-23T08:00:00Z"))).toBe("Good afternoon"); // 13:30 IST
    expect(greeting(new Date("2026-10-23T14:00:00Z"))).toBe("Good evening"); // 19:30 IST
  });

  it("describes how old a timestamp is", () => {
    const now = new Date("2026-10-23T10:00:00Z").getTime();
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2 hours ago");
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe("yesterday");
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3 days ago");
  });

  it("floors, and says yesterday by IST calendar date", () => {
    const at = new Date("2026-10-23T18:30:00Z").getTime(); // 00:00 IST on the 24th
    const lateSame = at + 23 * 3_600_000 + 59 * 60_000; // 23:59 IST the same date
    expect(relativeTime(at, lateSame)).toBe("23 hours ago");
    expect(relativeTime(at, at + 90 * 60_000 + 59_000)).toBe("1 hour ago");
    const lastNight = new Date("2026-10-24T17:00:00Z").getTime(); // 22:30 IST on the 24th
    const earlyNext = new Date("2026-10-24T19:00:00Z").getTime(); // 00:30 IST on the 25th
    expect(relativeTime(lastNight, earlyNext)).toBe("yesterday");
    const morning = new Date("2026-10-25T04:30:00Z").getTime(); // 10:00 IST on the 25th
    expect(relativeTime(new Date("2026-10-24T00:00:00Z").getTime(), morning)).toBe("yesterday");
  });
});
