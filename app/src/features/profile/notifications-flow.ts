import { log } from "@/lib/log";
import { askPermission, scheduleDaily } from "@/lib/notifications";
import type { Personality } from "./api";

type Schedule = { morningTime: string; nightTime: string; personality: Personality };

/** Asks for permission, schedules the daily messages, then moves on. Never rejects: setup must always finish. */
export async function allowNotifications(opts: {
  profile: Schedule | null | undefined;
  done: () => Promise<void>;
  ask?: () => Promise<boolean>;
  schedule?: (s: Schedule) => Promise<void>;
}): Promise<void> {
  const ask = opts.ask ?? (() => askPermission());
  const schedule = opts.schedule ?? ((s: Schedule) => scheduleDaily(s));
  try {
    if ((await ask()) && opts.profile) {
      await schedule({
        morningTime: opts.profile.morningTime,
        nightTime: opts.profile.nightTime,
        personality: opts.profile.personality,
      });
    }
  } catch (e) {
    log.warn("notifications.schedule_failed", { reason: e instanceof Error ? e.name : "unknown" });
  }
  try {
    await opts.done();
  } catch (e) {
    log.warn("notifications.done_failed", { reason: e instanceof Error ? e.name : "unknown" });
  }
}
