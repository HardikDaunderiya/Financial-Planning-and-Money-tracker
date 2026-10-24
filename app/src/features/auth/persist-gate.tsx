import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import React, { useEffect, useMemo, useState } from "react";
import { ownerId } from "@/lib/owner";
import { persistOptionsFor, queryClient } from "@/lib/query";
import { useSession } from "./session";

/**
 * The persisted cache belongs to one user. It is mounted only after the session has hydrated and only while
 * signed in, with the owner's id as the buster, so a restore for anyone else is discarded. Signed out, a plain
 * provider is used and nothing is read from or written to disk.
 */
export function OwnedCache({
  children,
  client = queryClient,
}: {
  children: React.ReactNode;
  client?: QueryClient;
}) {
  const { status, email } = useSession();
  const [owner, setOwner] = useState<{ email: string | null; id: string } | null>(null);
  const signedIn = status === "signedIn";

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void ownerId(email).then((id) => alive && setOwner({ email, id }));
    return () => {
      alive = false;
    };
  }, [signedIn, email]);

  const options = useMemo(
    () => (signedIn && owner && owner.email === email ? persistOptionsFor(owner.id) : null),
    [signedIn, owner, email],
  );

  if (status === "loading") return null;
  if (!signedIn) return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  if (!options) return null; // the owner id is a few milliseconds away; the splash is still up
  return (
    <PersistQueryClientProvider client={client} persistOptions={options}>
      {children}
    </PersistQueryClientProvider>
  );
}
