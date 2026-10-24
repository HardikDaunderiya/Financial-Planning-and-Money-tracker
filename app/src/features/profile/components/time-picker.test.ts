import { emptyDraft } from "../setup-store";
import { morningOptions, nightOptions } from "./time-picker";

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

describe("quiet hours (spec 2.7: no messages between 23:00 and 07:00)", () => {
  it("morning options run 07:00 to 11:00", () => {
    expect(morningOptions[0]).toBe("07:00");
    expect(morningOptions[morningOptions.length - 1]).toBe("11:00");
  });

  it("night options run 19:00 to 22:30", () => {
    expect(nightOptions[0]).toBe("19:00");
    expect(nightOptions[nightOptions.length - 1]).toBe("22:30");
  });

  it("no option falls inside quiet hours and the defaults are offered", () => {
    for (const t of [...morningOptions, ...nightOptions]) {
      expect(minutes(t)).toBeGreaterThanOrEqual(7 * 60);
      expect(minutes(t)).toBeLessThan(23 * 60);
    }
    expect(morningOptions).toContain(emptyDraft.morningTime);
    expect(nightOptions).toContain(emptyDraft.nightTime);
    expect(emptyDraft.morningTime).toBe("08:00");
    expect(emptyDraft.nightTime).toBe("22:00");
  });
});
