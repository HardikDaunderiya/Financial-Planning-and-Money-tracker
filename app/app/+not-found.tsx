import { Redirect } from "expo-router";
import React from "react";
import { useSession } from "@/features/auth/session";

/** A path nobody serves, or one the session guards hide, goes to the right front door instead of a dead end. */
export default function NotFound() {
  const { status } = useSession();
  if (status === "loading") return null;
  return <Redirect href={status === "signedOut" ? "/login" : "/"} />;
}
