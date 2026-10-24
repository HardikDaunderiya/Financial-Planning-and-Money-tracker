import {
  askPermission,
  cancelGullak,
  notificationCopy,
  scheduleDaily,
  type NotificationsApi,
} from "./notifications";

function fakeApi(
  granted = true,
): NotificationsApi & { scheduled: unknown[]; cancelled: string[]; calls: string[] } {
  const scheduled: unknown[] = [];
  const cancelled: string[] = [];
  const calls: string[] = [];
  return {
    scheduled,
    cancelled,
    calls,
    ensureChannelAsync: () => {
      calls.push("channel");
      return Promise.resolve();
    },
    getPermissionsAsync: () => Promise.resolve({ granted }),
    requestPermissionsAsync: () => {
      calls.push("request");
      return Promise.resolve({ granted });
    },
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

describe("Android channel (I5)", () => {
  it("creates the channel before asking for permission", async () => {
    const api = { ...fakeApi(true), getPermissionsAsync: () => Promise.resolve({ granted: false }) };
    await expect(askPermission(api)).resolves.toBe(true);
    expect(api.calls).toEqual(["channel", "request"]);
  });

  it("creates the channel before scheduling, and the daily triggers use it", async () => {
    const api = fakeApi();
    await scheduleDaily({ morningTime: "08:00", nightTime: "22:30", personality: "CHILL" }, api);
    expect(api.calls[0]).toBe("channel");
    for (const req of api.scheduled)
      expect(req).toEqual(
        expect.objectContaining({ trigger: expect.objectContaining({ channelId: "default" }) }),
      );
  });

  it("the real api creates 'default' (Daily messages) on Android only", async () => {
    const N = jest.requireMock<{
      setNotificationChannelAsync: jest.Mock;
      getPermissionsAsync: jest.Mock;
      requestPermissionsAsync: jest.Mock;
    }>("expo-notifications");
    N.setNotificationChannelAsync = jest.fn(() => Promise.resolve(null));
    N.getPermissionsAsync = jest.fn(() => Promise.resolve({ granted: false }));
    N.requestPermissionsAsync = jest.fn(() => Promise.resolve({ granted: true }));
    Object.assign(N, { AndroidImportance: { DEFAULT: 3 } });
    const rn = jest.requireActual<{ Platform: { OS: string } }>("react-native");
    const original = rn.Platform.OS;
    try {
      rn.Platform.OS = "android";
      await askPermission();
      expect(N.setNotificationChannelAsync).toHaveBeenCalledWith("default", {
        name: "Daily messages",
        importance: 3,
      });
      expect(N.setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(
        N.requestPermissionsAsync.mock.invocationCallOrder[0] ?? 0,
      );
      N.setNotificationChannelAsync.mockClear();
      rn.Platform.OS = "ios";
      await askPermission();
      expect(N.setNotificationChannelAsync).not.toHaveBeenCalled();
    } finally {
      rn.Platform.OS = original;
    }
  });
});

describe("cancelGullak (I2)", () => {
  it("cancels only Gullak's own scheduled notifications", async () => {
    const api = fakeApi();
    await cancelGullak(api);
    expect(api.cancelled).toEqual(["gullak.morning"]);
  });
});
