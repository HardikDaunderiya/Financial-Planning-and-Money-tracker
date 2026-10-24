import type { TokenStore, Tokens } from "@/lib/storage";

export type FakeResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};
export function json(status: number, body: unknown): FakeResponse {
  return {
    status,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? "application/json" : null) },
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}
export function raw(status: number, contentType: string | null, text: string): FakeResponse {
  return { status, headers: { get: () => contentType }, text: () => Promise.resolve(text) };
}
export function memoryStore(
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
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
export const flush = () => new Promise<void>((r) => setImmediate(r));
export const EXPIRED = { code: "TOKEN_EXPIRED", message: "Sign in again" };
