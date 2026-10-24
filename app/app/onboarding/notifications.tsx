import { useRouter, type Href } from "expo-router";
import React from "react";
import { useProfile } from "@/features/profile/hooks";
import { NotificationsScreen } from "@/features/profile/screens/notifications-screen";
import { kv } from "@/lib/kv";
import { log } from "@/lib/log";
import { askPermission, notificationsSupported, scheduleDaily } from "@/lib/notifications";

export default function NotificationsRoute() {
  const router = useRouter();
  const profile = useProfile();
  const done = async () => {
    await kv.set("notifications-asked", "1");
    router.replace("/home" as unknown as Href);
  };
  return (
    <NotificationsScreen
      supported={notificationsSupported}
      onAllow={async () => {
        try {
          if ((await askPermission()) && profile.data) {
            await scheduleDaily({
              morningTime: profile.data.morningTime,
              nightTime: profile.data.nightTime,
              personality: profile.data.personality,
            });
          }
        } catch (e) {
          log.warn("notifications.schedule_failed", { reason: e instanceof Error ? e.name : "unknown" });
        }
        await done();
      }}
      onSkip={() => void done()}
    />
  );
}
