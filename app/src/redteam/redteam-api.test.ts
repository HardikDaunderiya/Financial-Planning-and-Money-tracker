/* Red team, plan-02 task 4: attacks on the API client. Tests that FAIL demonstrate a finding. */
import { createApi } from "@/lib/api";
import { ApiError, NetworkError, UnknownError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { deferred, EXPIRED, flush, json, memoryStore, raw, type FakeResponse } from "./redteam-helpers";

type Call = { url: string; init: RequestInit };
const path = (c: Call) => c.url.replace("http://test.local/api/v1", "");
const auth = (c: Call) => (c.init.headers as Record<string, string>).Authorization;

function setup(
  script: (c: Call, n: number) => FakeResponse | Promise<FakeResponse>,
  store = memoryStore(),
  timeoutMs?: number,
) {
  const calls: Call[] = [];
  const onSignedOut = jest.fn();
  const fetchFn = jest.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(script({ url, init }, calls.length));
  });
  const api = createApi({
    baseUrl: "http://test.local/api/v1",
    tokens: store,
    onSignedOut,
    fetchFn: fetchFn as unknown as typeof fetch,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  return { api, calls, store, onSignedOut, fetchFn };
}

describe("RT refresh: reuse of a refresh token (server revokes ALL sessions on reuse)", () => {
  it("FINDING stale request that expires after another request already rotated must not refresh with the old refresh token", async () => {
    // X and Y both load pair (A1,R1). Y's 401 arrives first, refreshes to (A2,R2). X's 401 arrives later.
    const gateX = deferred<FakeResponse>();
    const refreshBodies: string[] = [];
    const { api } = setup((c) => {
      if (path(c) === "/auth/refresh") {
        refreshBodies.push(c.init.body as string);
        return json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 });
      }
      if (auth(c) === "Bearer A2") return json(200, { ok: true });
      if (path(c) === "/slow") return gateX.promise;
      return json(401, EXPIRED);
    });
    const x = api.get("/slow");
    await flush();
    await api.get("/fast"); // refresh happens: R1 consumed
    gateX.resolve(json(401, EXPIRED)); // late 401 for the stale token
    await x.catch(() => undefined);
    // Secure behaviour: reuse the already-rotated pair; never send R1 twice (server would answer TOKEN_REUSED and revoke every session).
    expect(refreshBodies.filter((b) => b.includes("R1"))).toHaveLength(1);
  });

  it("FINDING a refresh finishing after signOut must not resurrect the tokens", async () => {
    const gate = deferred<FakeResponse>();
    const store = memoryStore();
    const { api } = setup((c) => {
      if (path(c) === "/auth/refresh") return gate.promise;
      return json(401, EXPIRED);
    }, store);
    const p = api.get("/budget/today").catch(() => undefined);
    await flush();
    await store.clear(); // user taps Sign out (SessionProvider.signOut ends with store.clear())
    gate.resolve(json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 }));
    await p;
    expect(store.tokens).toBeNull();
  });

  it("FINDING a refresh from the old session must not overwrite a newer sign-in", async () => {
    const gate = deferred<FakeResponse>();
    const store = memoryStore();
    const { api } = setup((c) => {
      if (path(c) === "/auth/refresh") return gate.promise;
      return json(401, EXPIRED);
    }, store);
    const p = api.get("/budget/today").catch(() => undefined);
    await flush();
    await store.save({ accessToken: "NEW-A", refreshToken: "NEW-R" }); // signIn(new pair)
    gate.resolve(json(200, { accessToken: "OLD-A2", refreshToken: "OLD-R2", expiresIn: 900 }));
    await p;
    expect(store.tokens).toEqual({ accessToken: "NEW-A", refreshToken: "NEW-R" });
  });

  it("held: concurrent expired requests share one refresh and the retried request that is expired again does not loop", async () => {
    let refreshes = 0;
    const { api, calls } = setup((c) => {
      if (path(c) === "/auth/refresh") {
        refreshes += 1;
        return json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 });
      }
      return json(401, EXPIRED); // even the new token is "expired"
    });
    const results = await Promise.allSettled([api.get("/a"), api.get("/b"), api.get("/c")]);
    expect(refreshes).toBe(1);
    expect(calls).toHaveLength(7);
    results.forEach((r) => expect(r.status).toBe("rejected"));
  });

  it("held: refresh is never attempted for public calls or when no tokens exist", async () => {
    const { api, calls } = setup(() => json(401, EXPIRED), memoryStore(null));
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiError);
    await expect(api.post("/auth/otp/verify", {}, { auth: false })).rejects.toBeInstanceOf(ApiError);
    expect(calls.every((c) => path(c) !== "/auth/refresh")).toBe(true);
  });
});

describe("RT refresh: hostile or broken /auth/refresh answers", () => {
  it.each([
    ["empty 200 body", () => raw(200, null, "")],
    ["JSON null", () => json(200, null)],
    ["204", () => raw(204, null, "")],
  ])("FINDING %s gives a typed UnknownError, not a TypeError", async (_n, resp) => {
    const { api } = setup((c) => (path(c) === "/auth/refresh" ? resp() : json(401, EXPIRED)));
    const err = await api.get("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownError);
  });

  it("held: HTML 200, non-JSON and token-less objects leave stored tokens untouched and throw UnknownError", async () => {
    for (const resp of [
      raw(200, "text/html", "<html>captive portal</html>"),
      raw(200, "application/json", "{not json"),
      json(200, {}),
      json(200, { accessToken: 5, refreshToken: {} }),
    ]) {
      const store = memoryStore();
      const { api, onSignedOut } = setup(
        (c) => (path(c) === "/auth/refresh" ? resp : json(401, EXPIRED)),
        store,
      );
      await expect(api.get("/x")).rejects.toBeInstanceOf(UnknownError);
      expect(store.tokens).toEqual({ accessToken: "A1", refreshToken: "R1" });
      expect(onSignedOut).not.toHaveBeenCalled();
    }
  });

  it("FINDING empty-string tokens in a 200 refresh are rejected, not saved", async () => {
    const store = memoryStore();
    const { api } = setup(
      (c) =>
        path(c) === "/auth/refresh" ? json(200, { accessToken: "", refreshToken: "" }) : json(401, EXPIRED),
      store,
    );
    await api.get("/x").catch(() => undefined);
    expect(store.tokens).toEqual({ accessToken: "A1", refreshToken: "R1" });
  });

  it.each([
    [500, { code: "INTERNAL", message: "boom" }],
    [429, { code: "RATE_LIMITED", message: "slow" }],
    [503, { code: "INTERNAL", message: "deploy" }],
  ])(
    "FINDING a transient %s on /auth/refresh must not sign the user out or wipe tokens",
    async (status, body) => {
      const store = memoryStore();
      const { api, onSignedOut } = setup(
        (c) => (path(c) === "/auth/refresh" ? json(status, body) : json(401, EXPIRED)),
        store,
      );
      await api.get("/x").catch(() => undefined);
      expect(onSignedOut).not.toHaveBeenCalled();
      expect(store.tokens).not.toBeNull();
    },
  );

  it("held: TOKEN_REUSED / UNAUTHENTICATED on refresh clears tokens and signs out once", async () => {
    const store = memoryStore();
    const { api, onSignedOut } = setup(
      (c) =>
        path(c) === "/auth/refresh" ? json(401, { code: "TOKEN_REUSED", message: "x" }) : json(401, EXPIRED),
      store,
    );
    await Promise.allSettled([api.get("/a"), api.get("/b")]);
    expect(store.tokens).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("held: network drop during refresh keeps tokens", async () => {
    const store = memoryStore();
    const { api } = setup((c) => {
      if (path(c) === "/auth/refresh") throw new TypeError("Network request failed");
      return json(401, EXPIRED);
    }, store);
    await expect(api.get("/x")).rejects.toBeInstanceOf(NetworkError);
    expect(store.tokens).not.toBeNull();
  });
});

describe("RT hostile error bodies", () => {
  it("held: prototype-pollution keys in the body do not pollute or crash", async () => {
    const body =
      '{"code":"VALIDATION","message":"m","__proto__":{"polluted":1},"fields":[{"field":"__proto__","message":"x","constructor":{"prototype":{"p":1}}}]}';
    const { api } = setup(() => raw(400, "application/json", body));
    const err = (await api.get("/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).p).toBeUndefined();
  });

  it("held: code values like __proto__/constructor/toString map to the generic message", () => {
    for (const code of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(messageFor(code, { warn: () => undefined })).toBe(
        "Something went wrong. Try again in a moment.",
      );
    }
  });

  it("held: an HTML 200 on a normal call is UnknownError, a JSON array error body is UnknownError", async () => {
    const a = setup(() => raw(200, "text/html", "<script>alert(1)</script>"));
    await expect(a.api.get("/x")).rejects.toBeInstanceOf(UnknownError);
    const b = setup(() => json(500, [1, 2]));
    await expect(b.api.get("/x")).rejects.toBeInstanceOf(UnknownError);
  });

  it("FINDING server-supplied message and field messages are bounded before reaching the UI", async () => {
    const huge = "A".repeat(5_000_000);
    const { api } = setup(() =>
      json(400, { code: "VALIDATION", message: huge, fields: [{ field: "f", message: huge }] }),
    );
    const err = (await api.get("/x").catch((e: unknown) => e)) as ApiError;
    expect(err.message.length).toBeLessThanOrEqual(1000);
    expect(err.fields[0]!.message.length).toBeLessThanOrEqual(1000);
  });

  it("FINDING the content-type reflected into UnknownError.message is bounded", async () => {
    const { api } = setup(() => raw(200, "x".repeat(100_000), "hi"));
    const err = (await api.get("/x").catch((e: unknown) => e)) as UnknownError;
    expect(err.message.length).toBeLessThanOrEqual(200);
  });

  it("FINDING a FieldError with a huge array is capped", async () => {
    const fields = Array.from({ length: 100_000 }, () => ({ field: "a", message: "b" }));
    const { api } = setup(() => json(400, { code: "VALIDATION", message: "m", fields }));
    const err = (await api.get("/x").catch((e: unknown) => e)) as ApiError;
    expect(err.fields.length).toBeLessThanOrEqual(100);
  });
});

describe("RT abort and timeout", () => {
  afterEach(() => jest.useRealTimers());

  it("FINDING an already-aborted caller signal must not send the request", async () => {
    const { api, fetchFn } = setup(() => json(200, {}));
    const ac = new AbortController();
    ac.abort();
    await api.get("/budget/today", { signal: ac.signal }).catch(() => undefined);
    const sent = fetchFn.mock.calls.length > 0 && !(fetchFn.mock.calls[0]![1].signal as AbortSignal).aborted;
    expect(sent).toBe(false);
  });

  it("FINDING a body that stalls after headers is cut off by the timeout", async () => {
    jest.useFakeTimers();
    const stall: FakeResponse = {
      status: 200,
      headers: { get: () => "application/json" },
      text: () => new Promise<string>(() => undefined), // slow-loris: never finishes
    };
    const { api } = setup(() => stall, memoryStore(), 1000);
    let settled = false;
    void api.get("/x").then(
      () => (settled = true),
      () => (settled = true),
    );
    await jest.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(true);
  });

  it("FINDING listeners added to a long-lived caller signal are removed when the request ends", async () => {
    const ac = new AbortController();
    const add = jest.spyOn(ac.signal, "addEventListener");
    const remove = jest.spyOn(ac.signal, "removeEventListener");
    const { api } = setup(() => json(200, {}));
    for (let i = 0; i < 50; i++) await api.get("/x", { signal: ac.signal });
    expect(remove.mock.calls.length).toBeGreaterThanOrEqual(add.mock.calls.length);
  });

  it("held: a timeout surfaces as NetworkError and a caller abort is not reported as one", async () => {
    const ac = new AbortController();
    const fetchFn = jest.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_r, rej) =>
          init.signal!.addEventListener("abort", () =>
            rej(Object.assign(new Error("a"), { name: "AbortError" })),
          ),
        ),
    );
    const api = createApi({
      baseUrl: "http://t",
      tokens: memoryStore(),
      onSignedOut: jest.fn(),
      fetchFn: fetchFn as unknown as typeof fetch,
      timeoutMs: 20,
    });
    await expect(api.get("/x")).rejects.toBeInstanceOf(NetworkError);
    const p = api.get("/x", { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.not.toBeInstanceOf(NetworkError);
  });
});
