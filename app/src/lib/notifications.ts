import type { Personality } from "@/features/profile/api";
import { Platform } from "react-native";
import { log } from "./log";

export const CHANNEL_ID = "default";

export type NotificationsApi = {
  /** Android 13+ shows no permission prompt until a channel exists; a no-op elsewhere. */
  ensureChannelAsync(): Promise<void>;
  getPermissionsAsync(): Promise<{ granted: boolean }>;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  getAllScheduledNotificationsAsync(): Promise<{ identifier: string }[]>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  scheduleNotificationAsync(request: {
    identifier: string;
    content: { title: string; body: string };
    trigger: { type: "daily"; hour: number; minute: number; channelId: string };
  }): Promise<string>;
};

/** Static per-personality copy; no amounts, because the message is scheduled hours ahead (spec 2.7). */
export const notificationCopy: Record<
  Personality,
  { morning: { title: string; body: string }; night: { title: string; body: string } }
> = {
  CHILL: {
    morning: { title: "Morning", body: "Your number for today is ready" },
    night: { title: "How did today go?", body: "Your report card is in" },
  },
  SAVAGE: {
    morning: { title: "Wake up", body: "Your budget is waiting. So is Swiggy." },
    night: { title: "Report card time", body: "Brace yourself" },
  },
  MOM: {
    morning: { title: "Beta", body: "Check your budget before you leave the house" },
    night: { title: "Did you eat?", body: "Also, your report card is ready" },
  },
  HYPE: {
    morning: { title: "New day, new number", body: "Let's go" },
    night: { title: "Day done", body: "Come see your score" },
  },
};

function realApi(): NotificationsApi {
  // Imported lazily so the web build never loads expo-notifications (it is phone-only).
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- phone-only module, kept out of the web bundle
  const N = require("expo-notifications") as typeof import("expo-notifications");
  return {
    ensureChannelAsync: async () => {
      if (Platform.OS !== "android") return;
      await N.setNotificationChannelAsync(CHANNEL_ID, {
        name: "Daily messages",
        importance: N.AndroidImportance.DEFAULT,
      });
    },
    getPermissionsAsync: () => N.getPermissionsAsync(),
    requestPermissionsAsync: () => N.requestPermissionsAsync(),
    getAllScheduledNotificationsAsync: () => N.getAllScheduledNotificationsAsync(),
    cancelScheduledNotificationAsync: (id) => N.cancelScheduledNotificationAsync(id),
    scheduleNotificationAsync: (req) =>
      N.scheduleNotificationAsync({
        identifier: req.identifier,
        content: req.content,
        trigger: {
          type: N.SchedulableTriggerInputTypes.DAILY,
          hour: req.trigger.hour,
          minute: req.trigger.minute,
          channelId: req.trigger.channelId,
        },
      }),
  };
}

export const notificationsSupported = process.env.EXPO_OS !== "web";

export async function askPermission(api: NotificationsApi = realApi()): Promise<boolean> {
  await api.ensureChannelAsync();
  const current = await api.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await api.requestPermissionsAsync();
  log.info("notifications.permission", { granted: asked.granted });
  return asked.granted;
}

function parse(t: string): { hour: number; minute: number } {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return { hour: h, minute: m };
}

/** Cancels every scheduled notification Gullak made (identifiers start with "gullak."). Does nothing on web. */
export async function cancelGullak(api?: NotificationsApi): Promise<void> {
  if (!api && !notificationsSupported) return;
  const a = api ?? realApi();
  const existing = await a.getAllScheduledNotificationsAsync();
  for (const n of existing)
    if (n.identifier.startsWith("gullak.")) await a.cancelScheduledNotificationAsync(n.identifier);
}

/** Replaces Gullak's two daily messages. Does nothing without permission. */
export async function scheduleDaily(
  opts: { morningTime: string; nightTime: string; personality: Personality },
  api: NotificationsApi = realApi(),
): Promise<void> {
  if (!(await api.getPermissionsAsync()).granted) return;
  await api.ensureChannelAsync();
  await cancelGullak(api);
  const copy = notificationCopy[opts.personality];
  await api.scheduleNotificationAsync({
    identifier: "gullak.morning",
    content: copy.morning,
    trigger: { type: "daily", ...parse(opts.morningTime), channelId: CHANNEL_ID },
  });
  await api.scheduleNotificationAsync({
    identifier: "gullak.night",
    content: copy.night,
    trigger: { type: "daily", ...parse(opts.nightTime), channelId: CHANNEL_ID },
  });
  log.info("notifications.scheduled", { count: 2 });
}
