import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTokenOwner, type SessionControl } from "@/lib/api";
import { api, authEvents } from "@/lib/client";
import { kv, kvKeys } from "@/lib/kv";
import { log } from "@/lib/log";
import { cancelGullak } from "@/lib/notifications";
import { closePersistence, openPersistence, persister, queryClient } from "@/lib/query";
import type { TokenStore, Tokens } from "@/lib/storage";
import { authApi } from "./api";

export type SessionStatus = "loading" | "signedOut" | "signedIn";

export type Session = {
  status: SessionStatus;
  /** The signed-in user's email, kept on the device only to show on Me. */
  email: string | null;
  signIn: (tokens: Tokens, email?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

type Props = {
  children: React.ReactNode;
  /** Tests inject a store; the app uses the API client's own session so token ownership stays in one place. */
  store?: TokenStore;
  /** An explicit session control, e.g. `createApi(...).session`, shared with the API client that refreshes. */
  control?: SessionControl;
  logout?: (refreshToken: string) => Promise<void>;
  /** Removes the persisted query cache; runs on every sign-out path so the next user never sees these figures. */
  wipeCache?: () => Promise<void>;
};

const defaultWipe = async () => {
  await persister.removeClient();
};

export function SessionProvider({
  children,
  store,
  control: given,
  logout = authApi.logout,
  wipeCache = defaultWipe,
}: Props) {
  const control: SessionControl = useMemo(
    () => given ?? (store ? createTokenOwner(store) : api.session),
    [given, store],
  );
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [email, setEmail] = useState<string | null>(null);

  // The disk half of forgetting a user: persisted query cache, setup answers, email, per-user flags, and the
  // daily messages Gullak scheduled on this phone. Never throws.
  const wipeDisk = useCallback(async () => {
    const results = await Promise.allSettled([
      kv.remove(kvKeys.setupDraft),
      kv.remove(kvKeys.email),
      kv.remove(kvKeys.firstSpend),
      kv.remove(kvKeys.notificationsAsked),
      wipeCache(),
      cancelGullak(),
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        log.warn("session.wipe_failed", { reason: r.reason instanceof Error ? r.reason.name : "unknown" });
      }
    }
  }, [wipeCache]);

  // Everything tied to the departing user goes: in-memory query cache plus the disk half. Callers await it so
  // sign-out finishes only when storage is clean.
  const forget = useCallback(async () => {
    closePersistence();
    queryClient.clear();
    setEmail(null);
    setStatus("signedOut");
    await wipeDisk();
  }, [wipeDisk]);

  // Hydration runs once per control; it reads the latest callbacks through a ref so inline props never re-run it.
  const hydrateWith = useRef({ logout, wipeDisk });
  useEffect(() => {
    hydrateWith.current = { logout, wipeDisk };
  });

  useEffect(() => {
    let alive = true;
    control
      .current()
      .then(async (stored) => {
        // The keychain outlives an iOS reinstall but AsyncStorage does not: a session without the first-run
        // marker belongs to a previous install, so it is dropped (M7).
        let t = stored;
        // Read AsyncStorage directly: a failed read means "unknown" and must not look like "missing".
        let missing = false;
        try {
          missing = (await AsyncStorage.getItem(`gullak.${kvKeys.installed}`)) == null;
        } catch (e) {
          log.warn("session.marker_read_failed", { reason: e instanceof Error ? e.name : "unknown" });
        }
        if (missing) {
          if (t) {
            t = null;
            await control.signOut(hydrateWith.current.logout).catch(() => undefined);
          }
          try {
            await AsyncStorage.setItem(`gullak.${kvKeys.installed}`, "1");
          } catch (e) {
            log.warn("session.marker_write_failed", { reason: e instanceof Error ? e.name : "unknown" });
          }
        }
        const saved = t ? await kv.get(kvKeys.email) : null;
        if (!alive) return;
        setEmail(saved);
        setStatus(t ? "signedIn" : "signedOut");
        // Signed out at launch: nothing from a previous session may linger on disk (a web reload, a failed wipe).
        if (!t) void hydrateWith.current.wipeDisk();
      })
      .catch((e: unknown) => {
        log.warn("session.load_failed", { reason: e instanceof Error ? e.name : "unknown" });
        if (alive) setStatus("signedOut");
      });
    return () => {
      alive = false;
    };
  }, [control]);

  useEffect(() => authEvents.onSignedOut(() => void forget()), [forget]);

  const signIn = useCallback(
    async (tokens: Tokens, who?: string) => {
      await control.signIn(tokens);
      openPersistence();
      if (who) {
        await kv.set(kvKeys.email, who);
        setEmail(who);
      }
      setStatus("signedIn");
      log.info("auth.signed_in");
    },
    [control],
  );

  const signOut = useCallback(async () => {
    let wiped: Promise<void> = Promise.resolve();
    await control.signOut(logout, () => {
      wiped = forget();
    });
    await wiped;
    log.info("auth.signed_out");
  }, [control, logout, forget]);

  const value = useMemo(() => ({ status, email, signIn, signOut }), [status, email, signIn, signOut]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const s = use(SessionContext);
  if (!s) throw new Error("useSession needs a SessionProvider");
  return s;
}
