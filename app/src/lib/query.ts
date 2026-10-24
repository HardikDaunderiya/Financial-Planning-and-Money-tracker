import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { QueryClient, onlineManager } from "@tanstack/react-query";
import type { Persister } from "@tanstack/react-query-persist-client";
import { ApiError } from "./api-errors";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: WEEK,
      networkMode: "offlineFirst", // cached data is served while offline; the fetch pauses
      retry: (count, error) => !(error instanceof ApiError) && count < 2,
    },
    mutations: { networkMode: "online", retry: 0 },
  },
});

const CACHE_KEY = "gullak.query-cache";
const THROTTLE_MS = 1000;

type PersistedClient = Parameters<Persister["persistClient"]>[0];

let open = true;
let pending: PersistedClient | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  timer = null;
  const client = pending;
  pending = null;
  if (open && client) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(client));
}

/**
 * The cache survives restarts so Home can show "Updated 2 hours ago" (APP-11). Tokens are never in it.
 * Writes are throttled by hand so that sign-out can drop a pending write and block later ones: after
 * `closePersistence()` nothing reaches the disk until `openPersistence()` (the next sign-in).
 */
export const persister: Persister = {
  persistClient: (client) => {
    if (!open) return Promise.resolve();
    pending = client;
    timer ??= setTimeout(() => void flush().catch(() => undefined), THROTTLE_MS);
    return Promise.resolve();
  },
  restoreClient: async () => {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as PersistedClient;
    } catch {
      return undefined;
    }
  },
  removeClient: async () => {
    closePersistence();
    await AsyncStorage.removeItem(CACHE_KEY);
  },
};

export function closePersistence(): void {
  open = false;
  pending = null;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function openPersistence(): void {
  open = true;
}

/** Only settled, non-auth queries are written to disk, so nothing token-bearing is ever persisted. */
export function persistOptionsFor(owner: string) {
  return {
    persister,
    maxAge: WEEK,
    // A restore whose owner id differs is discarded by the persist client.
    buster: owner,
    dehydrateOptions: {
      shouldDehydrateQuery: (query: { state: { status: string }; queryKey: readonly unknown[] }) =>
        query.state.status === "success" && query.queryKey[0] !== "auth",
    },
  };
}

export const persistOptions = persistOptionsFor("anon");

export function wireOnlineManager(): void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
  );
}
