import * as SecureStore from "expo-secure-store";
import { log } from "./log";

export type Tokens = { accessToken: string; refreshToken: string };

export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

const KEY = "gullak.session";

function parse(raw: string | null): Tokens | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Tokens>;
    if (typeof v.accessToken === "string" && typeof v.refreshToken === "string") {
      return { accessToken: v.accessToken, refreshToken: v.refreshToken };
    }
  } catch (e) {
    log.warn("session.corrupt", { reason: e instanceof Error ? e.name : "parse" });
  }
  return null;
}

/** Tokens live in the device keychain / keystore (spec 4.7). */
export const tokenStore: TokenStore = {
  async load() {
    return parse(await SecureStore.getItemAsync(KEY));
  },
  async save(tokens) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY);
  },
};
