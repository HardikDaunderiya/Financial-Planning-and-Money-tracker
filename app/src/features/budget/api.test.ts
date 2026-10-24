import { UnknownError } from "@/lib/api-errors";
import { api } from "@/lib/client";
import { budgetApi } from "./api";

jest.mock("@/lib/client", () => ({ api: { get: jest.fn(), put: jest.fn() } }));

const put = api.put as jest.Mock;
const ok = {
  date: "2026-10-23",
  budgetPaise: 59300,
  spentPaise: 0,
  leftPaise: 59300,
  overPaise: 0,
  poolOverPaise: 0,
  mood: "HAPPY",
  line: "₹593 left for today",
  daysLeft: 9,
  cycleStart: "2026-10-01",
  cycleEnd: "2026-10-31",
};

describe("budgetApi.setFirstCycle", () => {
  it("returns a validated Today", async () => {
    put.mockResolvedValue({ ...ok, line: "‮hi" });
    await expect(budgetApi.setFirstCycle(100)).resolves.toEqual({ ...ok, line: "hi" });
  });
  it("throws UnknownError on a malformed response", async () => {
    put.mockResolvedValue({ ...ok, daysLeft: 0 });
    await expect(budgetApi.setFirstCycle(100)).rejects.toThrow(UnknownError);
    put.mockResolvedValue({ ...ok, leftPaise: "x" });
    await expect(budgetApi.setFirstCycle(100)).rejects.toThrow(UnknownError);
  });
});
