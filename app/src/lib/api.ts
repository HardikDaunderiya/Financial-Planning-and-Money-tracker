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

export type ApiDeps = {
  baseUrl: string;
  tokens: TokenStore;
  /** Called once when a refresh is rejected: the session is gone. */
  onSignedOut: () => void;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

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
  return (raw as unknown[]).filter(isFieldError).map((f) => ({ field: f.field, message: f.message }));
}

export function createApi(deps: ApiDeps): Api {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  let refreshing: Promise<Tokens> | null = null;

  async function send(
    method: HttpMethod,
    path: string,
    body: unknown,
    accessToken: string | null,
    signal?: AbortSignal,
  ): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Request-Id": randomUUID(),
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    signal?.addEventListener("abort", () => controller.abort());
    const started = Date.now();
    let res: { status: number; headers: { get(name: string): string | null }; text(): Promise<string> };
    try {
      res = await fetchFn(`${deps.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (signal?.aborted) throw e;
      throw new NetworkError(e instanceof Error && e.name === "AbortError" ? "timeout" : "network");
    }
    clearTimeout(timer);
    const text = await res.text();
    log.info("api.call", { route: routeOf(path), method, status: res.status, ms: Date.now() - started });
    if (res.status === 204 || text === "") return { status: res.status, data: undefined };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new UnknownError(`Unexpected ${contentType || "response"}`, res.status);
    }
    try {
      return { status: res.status, data: JSON.parse(text) as unknown };
    } catch {
      throw new UnknownError("Response was not JSON", res.status);
    }
  }

  function toError(status: number, data: unknown): Error {
    const b = (data ?? {}) as ErrorBody;
    if (typeof b.code === "string") {
      return new ApiError(
        b.code,
        status,
        typeof b.message === "string" ? b.message : "",
        fieldsOf(b.fields),
        typeof b.errorId === "string" ? b.errorId : undefined,
      );
    }
    return new UnknownError(`HTTP ${status}`, status);
  }

  async function refresh(current: Tokens): Promise<Tokens> {
    const { status, data } = await send(
      "POST",
      "/auth/refresh",
      { refreshToken: current.refreshToken },
      null,
    );
    if (status >= 400) {
      const err = toError(status, data);
      if (err instanceof ApiError) {
        await deps.tokens.clear();
        deps.onSignedOut();
      }
      throw err;
    }
    const pair = data as Partial<Tokens>;
    if (typeof pair.accessToken !== "string" || typeof pair.refreshToken !== "string") {
      throw new UnknownError("Refresh gave no tokens", status);
    }
    const next = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    await deps.tokens.save(next);
    return next;
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const auth = options.auth ?? true;
    const stored = auth ? await deps.tokens.load() : null;
    let { status, data } = await send(method, path, body, stored?.accessToken ?? null, options.signal);
    if (status === 401 && auth && stored && (data as ErrorBody | undefined)?.code === "TOKEN_EXPIRED") {
      refreshing ??= refresh(stored).finally(() => {
        refreshing = null;
      });
      const fresh = await refreshing;
      ({ status, data } = await send(method, path, body, fresh.accessToken, options.signal));
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
  };
}
