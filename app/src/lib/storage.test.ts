import * as SecureStore from "expo-secure-store";
import { tokenStore } from "./storage";

jest.mock("expo-secure-store", () => {
  const m = new Map<string, string>();
  return {
    getItemAsync: (k: string) => Promise.resolve(m.get(k) ?? null),
    setItemAsync: (k: string, v: string) => Promise.resolve(void m.set(k, v)),
    deleteItemAsync: (k: string) => Promise.resolve(void m.delete(k)),
    __map: m,
  };
});

const map = (SecureStore as unknown as { __map: Map<string, string> }).__map;

describe("token storage on the phone (APP-27)", () => {
  beforeEach(() => map.clear());

  it("round-trips a token pair through SecureStore", async () => {
    await tokenStore.save({ accessToken: "A", refreshToken: "R" });
    expect([...map.keys()]).toEqual(["gullak.session"]);
    await expect(tokenStore.load()).resolves.toEqual({ accessToken: "A", refreshToken: "R" });
  });

  it("clear removes the pair", async () => {
    await tokenStore.save({ accessToken: "A", refreshToken: "R" });
    await tokenStore.clear();
    await expect(tokenStore.load()).resolves.toBeNull();
  });

  it("a corrupt value reads as signed out", async () => {
    map.set("gullak.session", "{not json");
    await expect(tokenStore.load()).resolves.toBeNull();
  });
});
