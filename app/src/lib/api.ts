import { randomUUID } from "expo-crypto";
import { ApiError, NetworkError, UnknownError, type FieldError } from "./api-errors";
import { log } from "./log";
import type { TokenStore, Tokens } from "./storage";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestOptions = {
  /** Default true: send the bearer token and refresh it once on TOKEN_EXPIRED. */
  auth?: boolean;
  signal?: AbortSignal;
};

export type Api = {
  request<T>(method: HttpMethod, path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  del<T>(path: string, options?: RequestOptions): Promise<T>;
};

export type SessionControl = {
  /** The stored pair, or null when signed out. */
  current(): Promise<Tokens | null>;
  /** Replaces any session: waits out an in-flight refresh so a stale pair cannot overwrite the new one. */
  signIn(tokens: Tokens): Promise<void>;
  /**
   * Revokes with the freshest refresh token and clears locally. Never fails open: the local pair is
   * cleared even when the store read or the server call fails. `onCleared` fires before the server call.
   */
  signOut(logout: (refreshToken: string) => Promise<void>, onCleared?: () => void): Promise<void>;
};

export type TokenOwner = SessionControl & {
  /** Bumped by every stored-pair change, including a refresh save. */
  generation(): number;
  /** Bumped by signIn, signOut and endSession only: identifies one signed-in session. */
  epoch(): number;
  inflight(): Promise<Tokens> | null;
  setInflight(p: Promise<Tokens> | null): void;
  isSigningOut(): boolean;
  /** Saves a refreshed pair only if nothing changed the session since the refresh started. */
  saveRefreshed(next: Tokens, used: Tokens, startGeneration: number, startEpoch: number): Promise<boolean>;
  /** Clears the session if it is still the one that was rejected. True when this call cleared it. */
  endSession(used: Tokens, startGeneration: number, startEpoch: number): Promise<boolean>;
  /** True once per epoch, when a 401 arrives and nothing is stored. */
  noticeEmpty(startEpoch: number): boolean;
  load(): Promise<Tokens | null>;
};

/** Owns the stored pair, a generation (every change) and an epoch (one per session). Refresh races, spec 4.7. */
export function createTokenOwner(store: TokenStore): TokenOwner {
  let generation = 0;
  let epoch = 0;
  let noticedEpoch = -1;
  let inflight: Promise<Tokens> | null = null;
  let signOutRun: Promise<void> | null = null;
  let clearing: Promise<void> | null = null;
  let ending: Promise<void> | null = null;

  const waitForRefresh = async () => {
    if (inflight) await inflight.catch(() => undefined);
  };
  const stale = (startGeneration: number, startEpoch: number) =>
    generation !== startGeneration || epoch !== startEpoch;
  const sameSession = async (used: Tokens) => {
    const now = await store.load();
    return now !== null && now.refreshToken === used.refreshToken;
  };

  async function runSignOut(logout: (t: string) => Promise<void>, onCleared?: () => void) {
    let markCleared: () => void = () => undefined;
    clearing = new Promise<void>((resolve) => (markCleared = resolve));
    let refreshToken: string | null = null;
    try {
      await waitForRefresh(); // the refresh saves its pair normally, so we revoke the live token
      epoch += 1;
      try {
        refreshToken = (await store.load())?.refreshToken ?? null;
      } catch (e) {
        log.warn("session.read_failed", { reason: e instanceof Error ? e.name : "unknown" });
      }
      generation += 1;
      await store.clear();
      onCleared?.();
    } finally {
      clearing = null;
      markCleared();
    }
    if (refreshToken) {
      try {
        await logout(refreshToken);
      } catch (e) {
        // Local sign-out already happened; the server token expires on its own.
        log.warn(e instanceof NetworkError ? "auth.logout_offline" : "auth.logout_rejected", {
          reason: e instanceof Error ? e.name : "unknown",
        });
      }
    }
  }

  return {
    generation: () => generation,
    epoch: () => epoch,
    inflight: () => inflight,
    setInflight: (p) => {
      inflight = p;
    },
    isSigningOut: () => signOutRun !== null,
    load: () => store.load(),
    current: () => store.load(),
    noticeEmpty(startEpoch) {
      if (epoch !== startEpoch || noticedEpoch === epoch) return false;
      noticedEpoch = epoch;
      return true;
    },
    async saveRefreshed(next, used, startGeneration, startEpoch) {
      if (stale(startGeneration, startEpoch)) return false;
      const same = await sameSession(used);
      if (!same || stale(startGeneration, startEpoch)) return false;
      generation += 1;
      await store.save(next);
      return true;
    },
    async endSession(used, startGeneration, startEpoch) {
      if (stale(startGeneration, startEpoch)) return false;
      const same = await sameSession(used);
      if (!same || stale(startGeneration, startEpoch)) return false;
      generation += 1;
      epoch += 1;
      noticedEpoch = epoch;
      const write = store.clear();
      ending = write.then(
        () => undefined,
        () => undefined,
      );
      await write;
      return true;
    },
    async signIn(tokens) {
      epoch += 1; // invalidates in-flight requests and refreshes of the old session
      await clearing;
      await ending;
      await waitForRefresh();
      generation += 1;
      await store.save(tokens);
    },
    signOut(logout, onCleared) {
      signOutRun ??= runSignOut(logout, onCleared).finally(() => {
        signOutRun = null;
      });
      return signOutRun;
    },
  };
}

export type ApiDeps = {
  baseUrl: string;
  tokens: TokenStore;
  /** Called once when the session is gone: a refresh was rejected or the server said UNAUTHENTICATED. */
  onSignedOut: () => void;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

export type ApiWithSession = Api & { session: SessionControl };

const MESSAGE_MAX = 300;
const FIELDS_MAX = 20;
const SESSION_ENDING_CODES = new Set(["TOKEN_EXPIRED", "TOKEN_REUSED", "UNAUTHENTICATED"]);

type ErrorBody = { code?: unknown; message?: unknown; fields?: unknown; errorId?: unknown };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/me/fixed-costs/3f2…" → "/me/fixed-costs/{id}" so logs never carry ids from URLs. */
function routeOf(path: string): string {
  return path.split("?")[0]?.replace(UUID, "{id}") ?? path;
}

function isFieldError(f: unknown): f is FieldError {
  return (
    typeof f === "object" &&
    f !== null &&
    typeof (f as { field?: unknown }).field === "string" &&
    typeof (f as { message?: unknown }).message === "string"
  );
}

function fieldsOf(raw: unknown): FieldError[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter(isFieldError)
    .slice(0, FIELDS_MAX)
    .map((f) => ({ field: f.field.slice(0, 100), message: f.message.slice(0, MESSAGE_MAX) }));
}

function abortError(): Error {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

function codeOf(data: unknown): unknown {
  return typeof data === "object" && data !== null ? (data as ErrorBody).code : undefined;
}

function toError(status: number, data: unknown): Error {
  const b = (typeof data === "object" && data !== null ? data : {}) as ErrorBody;
  if (typeof b.code === "string") {
    return new ApiError(
      b.code,
      status,
      typeof b.message === "string" ? b.message.slice(0, MESSAGE_MAX) : "",
      fieldsOf(b.fields),
      typeof b.errorId === "string" ? b.errorId.slice(0, 100) : undefined,
    );
  }
  return new UnknownError(`HTTP ${status}`, status);
}

export function createApi(deps: ApiDeps): ApiWithSession {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const owner = createTokenOwner(deps.tokens);

  async function send(
    method: HttpMethod,
    path: string,
    body: unknown,
    accessToken: string | null,
    signal?: AbortSignal,
  ): Promise<{ status: number; data: unknown }> {
    if (signal?.aborted) throw abortError();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Request-Id": randomUUID(),
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(abortError()), { once: true });
    });
    aborted.catch(() => undefined);
    const started = Date.now();
    try {
      let status: number;
      let contentType: string;
      let text: string;
      try {
        const res = await Promise.race([
          fetchFn(`${deps.baseUrl}${path}`, {
            method,
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: controller.signal,
          }),
          aborted,
        ]);
        status = res.status;
        contentType = res.headers.get("content-type") ?? "";
        text = await Promise.race([res.text(), aborted]);
      } catch (e) {
        if (signal?.aborted) throw e;
        throw new NetworkError(timedOut ? "timeout" : "network");
      }
      log.info("api.call", { route: routeOf(path), method, status, ms: Date.now() - started });
      if (status === 204 || text === "") return { status, data: undefined };
      if (!contentType.includes("application/json")) {
        throw new UnknownError(`Unexpected ${contentType.slice(0, 50) || "response"}`, status);
      }
      try {
        return { status, data: JSON.parse(text) as unknown };
      } catch {
        throw new UnknownError("Response was not JSON", status);
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function runRefresh(current: Tokens, startGeneration: number, startEpoch: number): Promise<Tokens> {
    const { status, data } = await send(
      "POST",
      "/auth/refresh",
      { refreshToken: current.refreshToken },
      null,
    );
    if (status >= 400) {
      const err = toError(status, data);
      if (status === 401 && err instanceof ApiError && SESSION_ENDING_CODES.has(err.code)) {
        if (await owner.endSession(current, startGeneration, startEpoch)) deps.onSignedOut();
      }
      throw err;
    }
    const pair = (typeof data === "object" && data !== null ? data : {}) as Partial<Tokens>;
    if (
      typeof pair.accessToken !== "string" ||
      pair.accessToken === "" ||
      typeof pair.refreshToken !== "string" ||
      pair.refreshToken === ""
    ) {
      throw new UnknownError("Refresh gave no tokens", status);
    }
    const next = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    if (await owner.saveRefreshed(next, current, startGeneration, startEpoch)) return next;
    // The session changed while we refreshed: drop this pair, use whatever is stored now.
    const latest = await owner.load();
    if (!latest) throw new ApiError("UNAUTHENTICATED", 401, "");
    return latest;
  }

  /** The pair a request that got TOKEN_EXPIRED should retry with. Never spends a refresh token twice. */
  async function freshTokens(used: Tokens): Promise<Tokens> {
    const running = owner.inflight();
    if (running) return running;
    const current = await owner.load();
    if (!current) throw new ApiError("UNAUTHENTICATED", 401, "");
    const raced = owner.inflight();
    if (raced) return raced;
    if (current.refreshToken !== used.refreshToken) return current;
    if (owner.isSigningOut()) throw new ApiError("UNAUTHENTICATED", 401, "");
    const p = runRefresh(current, owner.generation(), owner.epoch()).finally(() => {
      if (owner.inflight() === p) owner.setInflight(null);
    });
    owner.setInflight(p);
    return p;
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const auth = options.auth ?? true;
    const startEpoch = owner.epoch();
    const stored = auth ? await owner.load() : null;
    const startGeneration = owner.generation();
    let { status, data } = await send(method, path, body, stored?.accessToken ?? null, options.signal);
    if (status === 401 && auth) {
      // The session this request belongs to is gone (sign-out or another account): never retry it.
      const gone = () => new ApiError("UNAUTHENTICATED", 401, "");
      if (owner.epoch() !== startEpoch) throw gone();
      if (!stored) {
        if (owner.noticeEmpty(startEpoch)) deps.onSignedOut();
      } else if (codeOf(data) === "TOKEN_EXPIRED") {
        const fresh = await freshTokens(stored);
        if (owner.epoch() !== startEpoch) throw gone();
        ({ status, data } = await send(method, path, body, fresh.accessToken, options.signal));
      } else if (codeOf(data) === "UNAUTHENTICATED") {
        if (await owner.endSession(stored, startGeneration, startEpoch)) deps.onSignedOut();
      }
    }
    if (status >= 400) throw toError(status, data);
    return data as T;
  }

  return {
    request,
    get: (path, options) => request("GET", path, undefined, options),
    post: (path, body, options) => request("POST", path, body, options),
    put: (path, body, options) => request("PUT", path, body, options),
    patch: (path, body, options) => request("PATCH", path, body, options),
    del: (path, options) => request("DELETE", path, undefined, options),
    session: {
      current: () => owner.current(),
      signIn: (t) => owner.signIn(t),
      signOut: (logout, onCleared) => owner.signOut(logout, onCleared),
    },
  };
}
