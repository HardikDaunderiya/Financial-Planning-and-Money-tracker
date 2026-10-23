import { ApiError, NetworkError, UnknownError } from "./api-errors";
import { createApi, type ApiWithSession } from "./api";
import type { TokenStore, Tokens } from "./storage";

type FakeResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

function json(status: number, body: unknown): FakeResponse {
  return {
    status,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? "application/json" : null) },
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}
function html(status: number): FakeResponse {
  return {
    status,
    headers: { get: () => "text/html" },
    text: () => Promise.resolve("<html>Bad gateway</html>"),
  };
}
function empty(status: number): FakeResponse {
  return { status, headers: { get: () => null }, text: () => Promise.resolve("") };
}

function memoryStore(
  initial: Tokens | null = { accessToken: "A1", refreshToken: "R1" },
): TokenStore & { tokens: Tokens | null } {
  const s = {
    tokens: initial,
    load: () => Promise.resolve(s.tokens),
    save: (t: Tokens) => {
      s.tokens = t;
      return Promise.resolve();
    },
    clear: () => {
      s.tokens = null;
      return Promise.resolve();
    },
  };
  return s;
}

type Call = { url: string; init: RequestInit };

function setup(
  script: (call: Call, n: number) => FakeResponse | Promise<FakeResponse>,
  store = memoryStore(),
) {
  const calls: Call[] = [];
  const onSignedOut = jest.fn();
  const fetchFn = jest.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(script({ url, init }, calls.length));
  });
  const api: ApiWithSession = createApi({
    baseUrl: "http://test.local/api/v1",
    tokens: store,
    onSignedOut,
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  return { api, calls, store, onSignedOut };
}

function header(call: Call | undefined, name: string): string | undefined {
  return (call?.init.headers as Record<string, string> | undefined)?.[name];
}

describe("api client (ERR-12)", () => {
  it("maps a 404 to ApiError NOT_FOUND", async () => {
    const { api } = setup(() => json(404, { code: "NOT_FOUND", message: "Fixed cost not found" }));
    await expect(api.get("/me/fixed-costs/x")).rejects.toMatchObject({
      name: "ApiError",
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("carries validation fields", async () => {
    const { api } = setup(() =>
      json(400, {
        code: "VALIDATION",
        message: "Check the highlighted fields",
        fields: [{ field: "amountPaise", message: "must be positive" }],
      }),
    );
    const err = await api.post("/me/fixed-costs", { amountPaise: 0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).fields).toEqual([{ field: "amountPaise", message: "must be positive" }]);
  });

  it("maps a network drop to NetworkError", async () => {
    const { api } = setup(() => {
      throw new TypeError("Network request failed");
    });
    await expect(api.get("/budget/today")).rejects.toBeInstanceOf(NetworkError);
  });

  it("maps an HTML error page to UnknownError with the status", async () => {
    const { api } = setup(() => html(502));
    const err = await api.get("/budget/today").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownError);
    expect((err as UnknownError).status).toBe(502);
  });

  it("returns undefined for 204", async () => {
    const { api } = setup(() => empty(204));
    await expect(api.post("/auth/logout", { refreshToken: "R1" }, { auth: false })).resolves.toBeUndefined();
  });

  it("sends the bearer token, JSON headers and a request id", async () => {
    const { api, calls } = setup(() => json(200, { ok: true }));
    await api.get("/budget/today");
    expect(calls[0]?.url).toBe("http://test.local/api/v1/budget/today");
    expect(header(calls[0], "Authorization")).toBe("Bearer A1");
    expect(header(calls[0], "Content-Type")).toBe("application/json");
    expect(header(calls[0], "X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends no Authorization header on public calls", async () => {
    const { api, calls } = setup(() => empty(204));
    await api.post("/auth/otp/request", { email: "a@b.c" }, { auth: false });
    expect(header(calls[0], "Authorization")).toBeUndefined();
  });

  it("never sends the token in the URL", async () => {
    const { api, calls } = setup(() => json(200, {}));
    await api.get("/budget/today");
    expect(calls[0]?.url).not.toContain("A1");
  });
});

describe("token refresh", () => {
  it("refreshes once on TOKEN_EXPIRED, saves the pair and retries with the new token", async () => {
    const { api, calls, store } = setup((call, n) => {
      if (call.url.endsWith("/auth/refresh")) {
        return json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 });
      }
      return n === 1
        ? json(401, { code: "TOKEN_EXPIRED", message: "Sign in again" })
        : json(200, { budgetPaise: 1 });
    });
    await expect(api.get("/budget/today")).resolves.toEqual({ budgetPaise: 1 });
    expect(calls.map((c) => c.url.replace("http://test.local/api/v1", ""))).toEqual([
      "/budget/today",
      "/auth/refresh",
      "/budget/today",
    ]);
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({ refreshToken: "R1" });
    expect(header(calls[2], "Authorization")).toBe("Bearer A2");
    expect(store.tokens).toEqual({ accessToken: "A2", refreshToken: "R2" });
  });

  it("concurrentExpiredRequestsRefreshOnce", async () => {
    let refreshes = 0;
    const { api, calls } = setup((call) => {
      if (call.url.endsWith("/auth/refresh")) {
        refreshes += 1;
        return json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 });
      }
      const auth = header(call, "Authorization");
      return auth === "Bearer A2"
        ? json(200, { ok: true })
        : json(401, { code: "TOKEN_EXPIRED", message: "x" });
    });
    await Promise.all([api.get("/budget/today"), api.get("/me/profile"), api.get("/me/fixed-costs")]);
    expect(refreshes).toBe(1);
    expect(calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("signs out when the refresh is rejected", async () => {
    const { api, store, onSignedOut } = setup((call) => {
      if (call.url.endsWith("/auth/refresh")) return json(401, { code: "TOKEN_REUSED", message: "x" });
      return json(401, { code: "TOKEN_EXPIRED", message: "x" });
    });
    await expect(api.get("/budget/today")).rejects.toMatchObject({ code: "TOKEN_REUSED" });
    expect(store.tokens).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("does not refresh without a stored session", async () => {
    const { api, calls } = setup(
      () => json(401, { code: "UNAUTHENTICATED", message: "x" }),
      memoryStore(null),
    );
    await expect(api.get("/budget/today")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(calls).toHaveLength(1);
  });

  it("leaves the session alone when the refresh fails on the network", async () => {
    const { api, store, onSignedOut } = setup((call) => {
      if (call.url.endsWith("/auth/refresh")) throw new TypeError("offline");
      return json(401, { code: "TOKEN_EXPIRED", message: "x" });
    });
    await expect(api.get("/budget/today")).rejects.toBeInstanceOf(NetworkError);
    expect(store.tokens).not.toBeNull();
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});

describe("refresh races and failures", () => {
  it("a late 401 after a settled refresh retries with the rotated pair and never spends the old refresh token twice", async () => {
    let release: (r: FakeResponse) => void = () => undefined;
    const late = new Promise<FakeResponse>((resolve) => (release = resolve));
    const refreshBodies: string[] = [];
    const { api } = setup((call) => {
      if (call.url.endsWith("/auth/refresh")) {
        refreshBodies.push(call.init.body as string);
        return json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 });
      }
      if (header(call, "Authorization") === "Bearer A2") return json(200, { ok: true });
      if (call.url.endsWith("/slow")) return late;
      return json(401, { code: "TOKEN_EXPIRED", message: "x" });
    });
    const slow = api.get("/slow");
    await new Promise<void>((r) => setImmediate(r));
    await api.get("/fast");
    release(json(401, { code: "TOKEN_EXPIRED", message: "x" }));
    await expect(slow).resolves.toEqual({ ok: true });
    expect(refreshBodies).toHaveLength(1);
  });

  it("keeps the session when the refresh answers 500", async () => {
    const { api, store, onSignedOut } = setup((call) =>
      call.url.endsWith("/auth/refresh")
        ? json(500, { code: "INTERNAL", message: "boom" })
        : json(401, { code: "TOKEN_EXPIRED", message: "x" }),
    );
    await expect(api.get("/budget/today")).rejects.toMatchObject({ status: 500 });
    expect(store.tokens).toEqual({ accessToken: "A1", refreshToken: "R1" });
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("signOut during a refresh leaves the store empty, discards the stale pair and revokes the latest token", async () => {
    let release: (r: FakeResponse) => void = () => undefined;
    const gate = new Promise<FakeResponse>((resolve) => (release = resolve));
    const { api, store } = setup((call) =>
      call.url.endsWith("/auth/refresh") ? gate : json(401, { code: "TOKEN_EXPIRED", message: "x" }),
    );
    const request = api.get("/budget/today").catch(() => undefined);
    await new Promise<void>((r) => setImmediate(r));
    const logout = jest.fn(() => Promise.resolve());
    const out = api.session.signOut(logout);
    release(json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 }));
    await Promise.all([request, out]);
    expect(store.tokens).toBeNull();
    expect(logout).toHaveBeenCalledWith("R2");
  });
});
