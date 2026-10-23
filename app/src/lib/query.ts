import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { QueryClient, onlineManager } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
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

/** The cache survives restarts so Home can show "Updated 2 hours ago" (APP-11). Tokens are never in it. */
export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "gullak.query-cache",
});

/** Only settled, non-auth queries are written to disk, so nothing token-bearing is ever persisted. */
export const persistOptions = {
  persister,
  maxAge: WEEK,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { state: { status: string }; queryKey: readonly unknown[] }) =>
      query.state.status === "success" && query.queryKey[0] !== "auth",
  },
};

export function wireOnlineManager(): void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
  );
}
