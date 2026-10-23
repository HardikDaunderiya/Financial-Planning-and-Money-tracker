import { formatDay, formatDayLong, greeting, relativeTime, todayIst } from "./dates";

describe("dates (APP-02)", () => {
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
});
