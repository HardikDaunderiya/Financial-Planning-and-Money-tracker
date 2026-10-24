import AsyncStorage from "@react-native-async-storage/async-storage";
import { log } from "./log";

/** Keys that other modules must be able to clear (the session clears setup answers on sign-out). */
export const kvKeys = { setupDraft: "setup-draft" } as const;

/**
 * Per-device flags such as "first spend logged" or "notifications asked", and the half-finished setup answers,
 * which are cleared on sign-out. Never tokens or other secrets.
 */
export const kv = {
  async get(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(`gullak.${key}`);
    } catch (e) {
      log.warn("kv.read_failed", { key, reason: e instanceof Error ? e.name : "unknown" });
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(`gullak.${key}`, value);
    } catch (e) {
      log.warn("kv.write_failed", { key, reason: e instanceof Error ? e.name : "unknown" });
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(`gullak.${key}`);
    } catch (e) {
      log.warn("kv.remove_failed", { key, reason: e instanceof Error ? e.name : "unknown" });
    }
  },
};
