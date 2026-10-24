import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react-native";
import React from "react";
import { budgetApi } from "@/features/budget/api";
import { ApiError } from "@/lib/api-errors";
import { profileApi, type Profile } from "./api";
import { useFinishSetup } from "./hooks";
import { FIRST_CYCLE_NOT_SAVED, FirstCycleNotSavedError } from "./finish-errors";

jest.mock("@/features/budget/api", () => ({ budgetApi: { getToday: jest.fn(), setFirstCycle: jest.fn() } }));
jest.mock("./api", () => ({
  ...jest.requireActual("./api"),
  profileApi: { get: jest.fn(), put: jest.fn() },
}));

const profile: Profile = {
  incomePaise: 5000000,
  savingsPaise: 2000000,
  paydayRule: "FIXED_DAY",
  paydayDay: 1,
  personality: "CHILL",
  morningTime: "08:00",
  nightTime: "22:00",
  timezone: "Asia/Kolkata",
};
const input = { ...profile, moneyLeftPaise: null as number | null };

const put = profileApi.put as jest.Mock;
const setFirstCycle = budgetApi.setFirstCycle as jest.Mock;

async function setup() {
  const qc = new QueryClient();
  const invalidate = jest.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = await renderHook(() => useFinishSetup(), { wrapper });
  return { hook, invalidate };
}

beforeEach(() => {
  jest.clearAllMocks();
  put.mockResolvedValue(profile);
  setFirstCycle.mockResolvedValue({ date: "2026-10-23" });
});

describe("useFinishSetup", () => {
  it("puts the profile, then the first cycle", async () => {
    const order: string[] = [];
    put.mockImplementation(() => {
      order.push("profile");
      return Promise.resolve(profile);
    });
    setFirstCycle.mockImplementation(() => {
      order.push("first-cycle");
      return Promise.resolve({});
    });
    const { hook } = await setup();
    await act(() => hook.result.current({ ...input, moneyLeftPaise: 600000 }));
    expect(order).toEqual(["profile", "first-cycle"]);
    expect(setFirstCycle).toHaveBeenCalledWith(600000);
    expect(put).toHaveBeenCalledWith(expect.not.objectContaining({ moneyLeftPaise: expect.anything() }));
  });

  it("makes no override call when moneyLeftPaise is null, and invalidates today", async () => {
    const { hook, invalidate } = await setup();
    await act(() => hook.result.current(input));
    expect(setFirstCycle).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["today"] });
  });

  it("an override failure keeps the profile saved: the retry sends only the override", async () => {
    setFirstCycle.mockRejectedValueOnce(new ApiError("INTERNAL", 500, "x"));
    const { hook } = await setup();
    let caught: unknown;
    await act(async () => {
      try {
        await hook.result.current({ ...input, moneyLeftPaise: 600000 });
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBeInstanceOf(FirstCycleNotSavedError);
    expect((caught as Error).message).toBe(FIRST_CYCLE_NOT_SAVED);
    expect(FIRST_CYCLE_NOT_SAVED).toBe("Saved, but we couldn't set your money left. Try again");
    expect(put).toHaveBeenCalledTimes(1);
    await act(() => hook.result.current({ ...input, moneyLeftPaise: 600000 }));
    expect(put).toHaveBeenCalledTimes(1);
    expect(setFirstCycle).toHaveBeenCalledTimes(2);
  });
});
