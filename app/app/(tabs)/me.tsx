import React from "react";
import { useSession } from "@/features/auth/session";
import { useProfile } from "@/features/profile/hooks";
import { MeScreen } from "@/features/profile/screens/me-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function MeRoute() {
  const { email, signOut } = useSession();
  const profile = useProfile();
  return <MeScreen email={email} profile={profile.data} signOut={signOut} />;
}
