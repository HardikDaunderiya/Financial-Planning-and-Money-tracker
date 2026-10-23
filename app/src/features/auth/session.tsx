import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { createTokenOwner, type SessionControl } from "@/lib/api";
import { api, authEvents } from "@/lib/client";
import { log } from "@/lib/log";
import { queryClient } from "@/lib/query";
import type { TokenStore, Tokens } from "@/lib/storage";
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
  /** Tests inject a store; the app uses the API client's own session so token ownership stays in one place. */
  store?: TokenStore;
  /** An explicit session control, e.g. `createApi(...).session`, shared with the API client that refreshes. */
  control?: SessionControl;
  logout?: (refreshToken: string) => Promise<void>;
};

export function SessionProvider({ children, store, control: given, logout = authApi.logout }: Props) {
  const control: SessionControl = useMemo(
    () => given ?? (store ? createTokenOwner(store) : api.session),
    [given, store],
  );
  const [status, setStatus] = useState<SessionStatus>("loading");

  useEffect(() => {
    let alive = true;
    control
      .current()
      .then((t) => alive && setStatus(t ? "signedIn" : "signedOut"))
      .catch((e: unknown) => {
        log.warn("session.load_failed", { reason: e instanceof Error ? e.name : "unknown" });
        if (alive) setStatus("signedOut");
      });
    return () => {
      alive = false;
    };
  }, [control]);

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
      await control.signIn(tokens);
      setStatus("signedIn");
      log.info("auth.signed_in");
    },
    [control],
  );

  const signOut = useCallback(async () => {
    await control.signOut(logout, () => {
      queryClient.clear();
      setStatus("signedOut");
    });
    log.info("auth.signed_out");
  }, [control, logout]);

  const value = useMemo(() => ({ status, signIn, signOut }), [status, signIn, signOut]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const s = use(SessionContext);
  if (!s) throw new Error("useSession needs a SessionProvider");
  return s;
}
