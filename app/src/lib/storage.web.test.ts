import { tokenStore } from "./storage";

describe("token storage on the web (APP-27, SEC-07)", () => {
  it("keeps the pair in memory only", async () => {
    await tokenStore.save({ accessToken: "ACCESS-abc", refreshToken: "REFRESH-xyz" });
    await expect(tokenStore.load()).resolves.toEqual({
      accessToken: "ACCESS-abc",
      refreshToken: "REFRESH-xyz",
    });
    const everything = [
      ...Object.values(localStorage),
      ...Object.values(sessionStorage),
      document.cookie,
    ].join(" ");
    expect(everything).not.toContain("ACCESS-abc");
    expect(everything).not.toContain("REFRESH-xyz");
  });

  it("clear forgets the pair", async () => {
    await tokenStore.save({ accessToken: "A", refreshToken: "R" });
    await tokenStore.clear();
    await expect(tokenStore.load()).resolves.toBeNull();
  });
});
