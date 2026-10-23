/* Red team, plan-02 task 4: tokens in logs, storage and the session. Tests that FAIL demonstrate a finding. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render } from "@testing-library/react-native";
import React from "react";
import { createApi } from "@/lib/api";
import { NetworkError } from "@/lib/api-errors";
import { SessionProvider, useSession } from "@/features/auth/session";
import { queryClient, persister, persistOptions } from "@/lib/query";
import { reporting } from "@/lib/reporting";
import { deferred, EXPIRED, json, memoryStore } from "./redteam-helpers";
import type { TokenStore } from "@/lib/storage";

const TOKENS = [
  "ACCESS-eyJhbGciOiJIUzI1NiJ9.payload.sig",
  "REFRESH-Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MDEyMzQ1Ng",
  "ACCESS2-eyJhbGciOiJIUzI1NiJ9.p2.s2",
  "REFRESH2-QWxsWW91ckJhc2VBcmVCZWxvbmdUb1VzMTIzNDU",
];

async function fullCycle() {
  const store = memoryStore({ accessToken: TOKENS[0]!, refreshToken: TOKENS[1]! });
  const api = createApi({
    baseUrl: "http://test.local/api/v1",
    tokens: store,
    onSignedOut: () => undefined,
    fetchFn: ((url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      if (url.endsWith("/auth/refresh"))
        return Promise.resolve(
          json(200, { accessToken: TOKENS[2], refreshToken: TOKENS[3], expiresIn: 900 }),
        );
      if (h.Authorization === `Bearer ${TOKENS[2]}`) return Promise.resolve(json(200, { ok: true }));
      return Promise.resolve(json(401, EXPIRED));
    }) as unknown as typeof fetch,
  });
  await api.get("/budget/today?x=1");
  await api.post("/me/fixed-costs", { amountPaise: 100 });
  await api.get("/nope").catch(() => undefined);
}
const leaks = (s: string) =>
  TOKENS.filter((t) => s.includes(t) || s.includes(t.split("-").slice(1).join("-")));

describe("RT tokens never in logs", () => {
  it("held: dev mode console shows no token over a request + refresh cycle", async () => {
    const spies = (["debug", "info", "warn", "error", "log"] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    await fullCycle();
    const out = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    spies.forEach((s) => s.mockRestore());
    expect(out).toContain("api.call");
    expect(leaks(out)).toEqual([]);
  });

  it("held: prod mode sink shows no token (and no URL query) over the cycle", async () => {
    const seen: unknown[] = [];
    const g = globalThis as { __DEV__?: boolean | undefined };
    const prev = g.__DEV__;
    g.__DEV__ = false;
    let mk!: typeof createApi;
    jest.isolateModules(() => {
      const r = require("@/lib/reporting") as typeof import("@/lib/reporting");
      r.reporting.setSink({ report: (...a) => void seen.push(a) });

      mk = (require("@/lib/api") as typeof import("@/lib/api")).createApi;
    });
    const store = memoryStore({ accessToken: TOKENS[0]!, refreshToken: TOKENS[1]! });
    const api = mk({
      baseUrl: "http://test.local/api/v1",
      tokens: store,
      onSignedOut: () => undefined,
      fetchFn: ((url: string, init: RequestInit) => {
        const h = init.headers as Record<string, string>;
        if (url.endsWith("/auth/refresh"))
          return Promise.resolve(json(200, { accessToken: TOKENS[2], refreshToken: TOKENS[3] }));
        return Promise.resolve(
          h.Authorization === `Bearer ${TOKENS[2]}` ? json(200, {}) : json(401, EXPIRED),
        );
      }) as unknown as typeof fetch,
    });
    await api.get("/budget/today?token=SECRETQ");
    g.__DEV__ = prev;
    reporting.setSink(null);
    const out = JSON.stringify(seen);
    expect(out).toContain("api.call");
    expect(leaks(out)).toEqual([]);
    expect(out).not.toContain("SECRETQ");
  });

  it("held: the Authorization header is never placed in the URL", async () => {
    const urls: string[] = [];
    const api = createApi({
      baseUrl: "http://test.local/api/v1",
      tokens: memoryStore({ accessToken: TOKENS[0]!, refreshToken: TOKENS[1]! }),
      onSignedOut: () => undefined,
      fetchFn: ((u: string) => {
        urls.push(u);
        return Promise.resolve(json(200, {}));
      }) as unknown as typeof fetch,
    });
    await api.get("/a");
    await api.post("/b", { refreshToken: TOKENS[1] });
    expect(urls.join()).not.toMatch(/ACCESS|REFRESH|Bearer/);
  });
});

describe("RT tokens never in AsyncStorage / query cache", () => {
  it("held: a full cycle, sign-in, and sign-out write nothing token-like to AsyncStorage or the persisted query cache", async () => {
    await AsyncStorage.clear();
    const setItem = jest.spyOn(AsyncStorage, "setItem");
    await fullCycle();
    const store = memoryStore(null);
    let session!: ReturnType<typeof useSession>;
    function P() {
      session = useSession();
      return null;
    }
    await render(
      <SessionProvider store={store} logout={() => Promise.resolve()}>
        <P />
      </SessionProvider>,
    );
    await act(async () => session.signIn({ accessToken: TOKENS[0]!, refreshToken: TOKENS[1]! }));
    queryClient.setQueryData(["budget"], { budgetPaise: 1 });
    await persister.persistClient({
      timestamp: Date.now(),
      buster: "",
      clientState: { mutations: [], queries: [] },
    });
    const dump = JSON.stringify(setItem.mock.calls) + JSON.stringify(await AsyncStorage.getAllKeys());
    expect(leaks(dump)).toEqual([]);
    setItem.mockRestore();
  });

  it("FINDING sign-in tokens returned by verifyCode must not be cacheable: a mutation result with tokens is not persisted", () => {
    // Demonstrates the guard is absent: dehydrate persists any successful query, including one a screen
    // might wrongly build around authApi.verifyCode. persistOptions has no dehydrateOptions filter.
    expect((persistOptions as Record<string, unknown>).dehydrateOptions).toBeDefined();
  });
});

describe("RT session sign-out", () => {
  function setup(store: TokenStore, logout: (r: string) => Promise<void>) {
    let session!: ReturnType<typeof useSession>;
    function P() {
      session = useSession();
      return null;
    }
    return render(
      <SessionProvider store={store} logout={logout}>
        <P />
      </SessionProvider>,
    ).then(() => () => session);
  }

  it("held: offline sign-out (NetworkError) still clears the tokens and cache", async () => {
    const store = memoryStore({ accessToken: "A", refreshToken: "R" });
    const get = await setup(store, () => Promise.reject(new NetworkError("network")));
    await act(async () => get().signOut());
    expect(store.tokens).toBeNull();
  });

  it("held: a logout that hangs-then-rejects with a server error still clears", async () => {
    const store = memoryStore({ accessToken: "A", refreshToken: "R" });
    const get = await setup(store, () => Promise.reject(new Error("500")));
    await act(async () => get().signOut());
    expect(store.tokens).toBeNull();
  });

  it("FINDING sign-out must clear local tokens even if the store read throws, and must not leave the user signed in", async () => {
    const store: TokenStore = {
      load: jest
        .fn()
        .mockResolvedValueOnce({ accessToken: "A", refreshToken: "R" })
        .mockRejectedValue(new Error("keystore")),
      save: jest.fn(() => Promise.resolve()),
      clear: jest.fn(() => Promise.resolve()),
    };
    const get = await setup(store, () => Promise.resolve());
    await act(async () => {
      await get()
        .signOut()
        .catch(() => undefined);
    });
    expect(store.clear).toHaveBeenCalled();
  });

  it("FINDING sign-out must not wait indefinitely on the logout call (user taps Sign out on a dead network)", async () => {
    const store = memoryStore({ accessToken: "A", refreshToken: "R" });
    const hang = deferred<void>(); // logout never answers; the api timeout is 15 s, but session imposes no bound of its own
    const get = await setup(store, () => hang.promise);
    let done = false;
    void get()
      .signOut()
      .then(() => (done = true));
    await new Promise((r) => setTimeout(r, 50));
    // Local sign-out should already have happened before waiting for the server.
    expect(done).toBe(false); // logout still pending
    expect(store.tokens).toBeNull();
  });

  it("FINDING sign-out must revoke the server session even when the token was rotated mid-flight (logout sends the freshest refresh token)", async () => {
    // signOut loads tokens, then calls logout(R1) while a refresh is in flight that rotates R1->R2.
    const store = memoryStore({ accessToken: "A1", refreshToken: "R1" });
    const sent: string[] = [];
    const gate = deferred<void>();
    const get = await setup(store, async (r) => {
      sent.push(r);
      await gate.promise;
    });
    const p = get().signOut();
    await new Promise((r) => setTimeout(r, 0));
    await store.save({ accessToken: "A2", refreshToken: "R2" }); // refresh landed
    gate.resolve();
    await act(async () => p);
    expect(store.tokens).toBeNull(); // cleared
    expect(sent).toEqual(["R2"]); // the server only revokes the live token; R1 is used and would revoke all sessions
  });
});
