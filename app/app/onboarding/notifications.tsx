import { useRouter } from "expo-router";
import React from "react";
import { useProfile } from "@/features/profile/hooks";
import { allowNotifications } from "@/features/profile/notifications-flow";
import { NotificationsScreen } from "@/features/profile/screens/notifications-screen";
import { kv, kvKeys } from "@/lib/kv";
import { log } from "@/lib/log";
import { notificationsSupported } from "@/lib/notifications";

export default function NotificationsRoute() {
  const router = useRouter();
  const profile = useProfile();
  const done = async () => {
    await kv.set(kvKeys.notificationsAsked, "1");
    router.replace("/home");
  };
  return (
    <NotificationsScreen
      supported={notificationsSupported}
      onAllow={() => allowNotifications({ profile: profile.data, done })}
      onSkip={() =>
        void done().catch((e: unknown) =>
          log.warn("notifications.done_failed", { reason: e instanceof Error ? e.name : "unknown" }),
        )
      }
    />
  );
}
