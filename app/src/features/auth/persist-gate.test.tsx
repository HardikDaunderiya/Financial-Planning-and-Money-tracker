/* eslint-disable react-hooks/globals -- the test reads the session from a probe component */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { ownerId } from "@/lib/owner";
import type { TokenStore, Tokens } from "@/lib/storage";
import { OwnedCache } from "./persist-gate";
import { SessionProvider, useSession } from "./session";

function store(initial: Tokens | null): TokenStore {
  let t = initial;
  return {
    load: () => Promise.resolve(t),
    save: (n) => {
      t = n;
      return Promise.resolve();
    },
    clear: () => {
      t = null;
      return Promise.resolve();
    },
  };
}

let ctl: ReturnType<typeof useSession>;
function Shown({ fetchToday }: { fetchToday: () => Promise<string> }) {
  ctl = useSession();
  const q = useQuery({ queryKey: ["today"], queryFn: fetchToday });
  return <Text testID="shown">{`${ctl.status}|${q.data ?? "-"}`}</Text>;
}

async function cacheOf(owner: string, line: string) {
  await AsyncStorage.setItem(
    "gullak.query-cache",
    JSON.stringify({
      buster: owner,
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: [
          {
            queryKey: ["today"],
            queryHash: '["today"]',
            state: {
              data: line,
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: "success",
              fetchStatus: "idle",
            },
          },
        ],
      },
    }),
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem("gullak.installed", "1"); // a returning install, so stored sessions are trusted
});

describe("OwnedCache", () => {
  it("ownerId is a stable hash of the lower-cased email, never the email, and anon without one", async () => {
    const a = await ownerId("Priya@Example.com");
    expect(a).toBe(await ownerId("priya@example.com"));
    expect(a).not.toContain("priya");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await ownerId(null)).toBe("anon");
  });

  it("restores the cache of the same owner", async () => {
    await cacheOf(await ownerId("priya@example.com"), "A-LINE");
    await AsyncStorage.setItem("gullak.me.email", "priya@example.com");
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    await render(
      <SessionProvider
        store={store({ accessToken: "A", refreshToken: "R" })}
        logout={() => Promise.resolve()}
      >
        <OwnedCache client={qc}>
          <Shown fetchToday={() => new Promise(() => undefined)} />
        </OwnedCache>
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("shown")).toHaveTextContent("signedIn|A-LINE"));
  });

  it("never renders A's cache for B (owner mismatch is discarded)", async () => {
    await cacheOf(await ownerId("priya@example.com"), "A-LINE");
    await AsyncStorage.setItem("gullak.me.email", "bob@example.com");
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    await render(
      <SessionProvider
        store={store({ accessToken: "B", refreshToken: "R" })}
        logout={() => Promise.resolve()}
      >
        <OwnedCache client={qc}>
          <Shown fetchToday={() => new Promise(() => undefined)} />
        </OwnedCache>
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("shown")).toHaveTextContent("signedIn|-"));
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(screen.getByTestId("shown")).toHaveTextContent("signedIn|-");
    expect(
      JSON.stringify(
        qc
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain("A-LINE");
  });

  it("signed out: A's cache on disk is not restored, and B signing in afterwards does not see it", async () => {
    await cacheOf(await ownerId("priya@example.com"), "A-LINE");
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    await render(
      <SessionProvider store={store(null)} logout={() => Promise.resolve()}>
        <OwnedCache client={qc}>
          <Shown fetchToday={() => new Promise(() => undefined)} />
        </OwnedCache>
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("shown")).toHaveTextContent("signedOut|-"));
    await act(async () => {
      await ctl.signIn({ accessToken: "B", refreshToken: "RB" }, "bob@example.com");
    });
    await waitFor(() => expect(screen.getByTestId("shown")).toHaveTextContent("signedIn|-"));
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(screen.getByTestId("shown")).toHaveTextContent("signedIn|-");
  });

  it("after A's blob is discarded for B, B's next cache change is persisted", async () => {
    await cacheOf(await ownerId("priya@example.com"), "A-LINE");
    await AsyncStorage.setItem("gullak.me.email", "bob@example.com");
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    await render(
      <SessionProvider
        store={store({ accessToken: "B", refreshToken: "R" })}
        logout={() => Promise.resolve()}
      >
        <OwnedCache client={qc}>
          <Shown fetchToday={() => Promise.resolve("B-LINE")} />
        </OwnedCache>
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("shown")).toHaveTextContent("signedIn|B-LINE"));
    await act(() => new Promise((r) => setTimeout(r, 1400)));
    const raw = await AsyncStorage.getItem("gullak.query-cache");
    expect(raw).toContain("B-LINE");
    expect(raw).not.toContain("A-LINE");
    expect(raw).toContain(await ownerId("bob@example.com"));
  });
});
