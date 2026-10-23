import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { NetworkError } from "@/lib/api-errors";
import { authEvents } from "@/lib/client";
import { log } from "@/lib/log";
import { queryClient } from "@/lib/query";
import { tokenStore, type TokenStore, type Tokens } from "@/lib/storage";
import { authApi } from "./api";

export type SessionStatus = "loading" | "signedOut" | "signedIn";

export type Session = {
  status: SessionStatus;
  signIn(tokens: Tokens): Promise<void>;
  signOut(): Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

type Props = {
  children: React.ReactNode;
  store?: TokenStore;
  logout?: (refreshToken: string) => Promise<void>;
};

export function SessionProvider({ children, store = tokenStore, logout = authApi.logout }: Props) {
  const [status, setStatus] = useState<SessionStatus>("loading");

  useEffect(() => {
    let alive = true;
    store
      .load()
      .then((t) => alive && setStatus(t ? "signedIn" : "signedOut"))
      .catch((e: unknown) => {
        log.warn("session.load_failed", { reason: e instanceof Error ? e.name : "unknown" });
        if (alive) setStatus("signedOut");
      });
    return () => {
      alive = false;
    };
  }, [store]);

  useEffect(
    () =>
      authEvents.onSignedOut(() => {
        queryClient.clear();
        setStatus("signedOut");
      }),
    [],
  );

  const signIn = useCallback(
    async (tokens: Tokens) => {
      await store.save(tokens);
      setStatus("signedIn");
      log.info("auth.signed_in");
    },
    [store],
  );

  const signOut = useCallback(async () => {
    const t = await store.load();
    if (t) {
      try {
        await logout(t.refreshToken);
      } catch (e) {
        // The local sign-out still happens; the server token expires on its own within 30 days.
        log.warn(e instanceof NetworkError ? "auth.logout_offline" : "auth.logout_rejected", {
          reason: e instanceof Error ? e.name : "unknown",
        });
      }
    }
    await store.clear();
    queryClient.clear();
    setStatus("signedOut");
    log.info("auth.signed_out");
  }, [store, logout]);

  const value = useMemo(() => ({ status, signIn, signOut }), [status, signIn, signOut]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const s = use(SessionContext);
  if (!s) throw new Error("useSession needs a SessionProvider");
  return s;
}
