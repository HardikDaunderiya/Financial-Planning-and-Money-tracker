import { log } from "@/lib/log";
import { allowNotifications } from "./notifications-flow";

const profile = { morningTime: "08:00", nightTime: "22:00", personality: "CHILL" as const };

describe("allowNotifications never rejects", () => {
  it("survives a failing done() and logs only a reason", async () => {
    const warn = jest.spyOn(log, "warn").mockImplementation(() => {});
    const done = jest.fn(() => Promise.reject(new Error("storage full")));
    await expect(
      allowNotifications({
        profile,
        done,
        ask: () => Promise.resolve(true),
        schedule: () => Promise.resolve(),
      }),
    ).resolves.toBeUndefined();
    expect(done).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("notifications.done_failed", { reason: "Error" });
    warn.mockRestore();
  });

  it("still finishes when scheduling fails", async () => {
    const warn = jest.spyOn(log, "warn").mockImplementation(() => {});
    const done = jest.fn(() => Promise.resolve());
    await allowNotifications({
      profile,
      done,
      ask: () => Promise.resolve(true),
      schedule: () => Promise.reject(new TypeError("x")),
    });
    expect(done).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("schedules when permission is granted and a profile exists", async () => {
    const schedule = jest.fn(() => Promise.resolve());
    await allowNotifications({
      profile,
      done: () => Promise.resolve(),
      ask: () => Promise.resolve(true),
      schedule,
    });
    expect(schedule).toHaveBeenCalledWith(profile);
  });
});
