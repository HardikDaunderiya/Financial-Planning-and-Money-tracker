import { notificationCopy, scheduleDaily, type NotificationsApi } from "./notifications";

function fakeApi(granted = true): NotificationsApi & { scheduled: unknown[]; cancelled: string[] } {
  const scheduled: unknown[] = [];
  const cancelled: string[] = [];
  return {
    scheduled,
    cancelled,
    getPermissionsAsync: () => Promise.resolve({ granted }),
    requestPermissionsAsync: () => Promise.resolve({ granted }),
    getAllScheduledNotificationsAsync: () =>
      Promise.resolve([{ identifier: "gullak.morning" }, { identifier: "other.app" }]),
    cancelScheduledNotificationAsync: (id) => {
      cancelled.push(id);
      return Promise.resolve();
    },
    scheduleNotificationAsync: (req) => {
      scheduled.push(req);
      return Promise.resolve("id");
    },
  };
}

describe("daily messages", () => {
  it("schedules a morning and a night message at the chosen times and replaces older ones", async () => {
    const api = fakeApi();
    await scheduleDaily({ morningTime: "08:00", nightTime: "22:30", personality: "CHILL" }, api);
    expect(api.cancelled).toEqual(["gullak.morning"]);
    expect(api.scheduled).toEqual([
      expect.objectContaining({
        identifier: "gullak.morning",
        trigger: expect.objectContaining({ hour: 8, minute: 0 }),
      }),
      expect.objectContaining({
        identifier: "gullak.night",
        trigger: expect.objectContaining({ hour: 22, minute: 30 }),
      }),
    ]);
  });

  it("schedules nothing without permission", async () => {
    const api = fakeApi(false);
    await scheduleDaily({ morningTime: "08:00", nightTime: "22:00", personality: "CHILL" }, api);
    expect(api.scheduled).toHaveLength(0);
  });

  it("copy exists for every personality and never contains an amount", () => {
    for (const p of ["CHILL", "SAVAGE", "MOM", "HYPE"] as const) {
      expect(notificationCopy[p].morning.body).not.toMatch(/₹|\d/);
      expect(notificationCopy[p].night.body).not.toMatch(/₹|\d/);
      expect(notificationCopy[p].morning.title).not.toMatch(/₹|\d/);
      expect(notificationCopy[p].night.title).not.toMatch(/₹|\d/);
    }
  });
});
