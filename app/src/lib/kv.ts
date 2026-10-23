import AsyncStorage from "@react-native-async-storage/async-storage";
import { log } from "./log";

/** Per-device flags such as "first spend logged" or "notifications asked". Never secrets, never money. */
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
