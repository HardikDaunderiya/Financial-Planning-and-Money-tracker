import "@testing-library/react-native/matchers";
import { timeoutManager, type ManagedTimerId } from "@tanstack/react-query";

// Reanimated 4 test setup: animations resolve immediately and shared values are plain.
require("react-native-reanimated").setUpTests();

jest.mock("expo-font", () => ({
  ...jest.requireActual("expo-font"),
  useFonts: () => [true, null],
  isLoaded: () => true,
}));

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve(true)),
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("@react-native-community/netinfo", () =>
  require("@react-native-community/netinfo/jest/netinfo-mock.js"),
);
jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: (_algorithm: string, data: string) =>
    Promise.resolve(require("node:crypto").createHash("sha256").update(data).digest("hex") as string),
}));

// expo-notifications is phone-only and registers native listeners on import; app code reaches it through
// lib/notifications (faked in its own tests) and the root layout's handler.
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve("id")),
  SchedulableTriggerInputTypes: { DAILY: "daily" },
}));

// A stored session is only trusted when this install has run before (M7); tests start as a returning install.
beforeEach(async () => {
  const mod = require("@react-native-async-storage/async-storage") as {
    default?: { setItem(k: string, v: string): Promise<void> };
    setItem(k: string, v: string): Promise<void>;
  };
  await (mod.default ?? mod).setItem("gullak.installed", "1");
});

process.env.EXPO_PUBLIC_API_URL = "http://test.local/api/v1";

// The app's shared query client and persister keep timers (garbage collection, the throttled disk write). Settle
// them once the file's tests are done and their trees are unmounted, so no worker is left with an open handle.
afterAll(() => {
  const query = require("@/lib/query") as typeof import("@/lib/query");
  query.queryClient.clear();
  query.closePersistence();
});

// Sign-out clears the query cache while Home is still mounted; unmounting then re-arms the garbage-collection
// timer of the orphaned query (gcTime is a week, so the persisted cache can outlive a restart). Unref TanStack's
// timers in tests so such a timer can never keep a Jest worker alive.
const unref = (t: ReturnType<typeof setTimeout>): ManagedTimerId => {
  (t as { unref?: () => void }).unref?.();
  return t;
};
timeoutManager.setTimeoutProvider({
  setTimeout: (cb, ms) => unref(setTimeout(cb, ms)),
  clearTimeout: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
  setInterval: (cb, ms) => unref(setInterval(cb, ms)),
  clearInterval: (id) => clearInterval(id as unknown as ReturnType<typeof setInterval>),
});
