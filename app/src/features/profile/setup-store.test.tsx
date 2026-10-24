import { act, render, screen, waitFor } from "@testing-library/react-native";
import React, { useEffect } from "react";
import { Text } from "react-native";
import { kv } from "@/lib/kv";
import { emptyDraft, paydayIsComplete, SetupProvider, useSetup } from "./setup-store";

jest.mock("@/lib/kv", () => ({
  ...jest.requireActual<typeof import("@/lib/kv")>("@/lib/kv"),
  kv: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));
const mocked = kv as jest.Mocked<typeof kv>;

let api: ReturnType<typeof useSetup> | null = null;
function Probe() {
  const setup = useSetup();
  useEffect(() => {
    api = setup;
  });
  return <Text testID="d">{setup.hydrated ? JSON.stringify(setup.draft) : "loading"}</Text>;
}

beforeEach(() => {
  api = null;
  jest.clearAllMocks();
  mocked.get.mockResolvedValue(null);
  mocked.set.mockResolvedValue(undefined);
  mocked.remove.mockResolvedValue(undefined);
});

describe("setup draft store", () => {
  it("hydrates a saved draft over the defaults", async () => {
    mocked.get.mockResolvedValue(JSON.stringify({ incomePaise: 5000000 }));
    await render(
      <SetupProvider>
        <Probe />
      </SetupProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("d")).toHaveTextContent(/"incomePaise":5000000/));
    expect(screen.getByTestId("d")).toHaveTextContent(/"personality":"CHILL"/);
  });

  it("drops a corrupt draft and still hydrates", async () => {
    mocked.get.mockResolvedValue("{not json");
    await render(
      <SetupProvider>
        <Probe />
      </SetupProvider>,
    );
    await waitFor(() => expect(api?.hydrated).toBe(true));
    expect(mocked.remove).toHaveBeenCalledWith("setup-draft");
    expect(api?.draft).toEqual(emptyDraft);
  });

  it("persists changes and clears on reset", async () => {
    await render(
      <SetupProvider>
        <Probe />
      </SetupProvider>,
    );
    await waitFor(() => expect(api?.hydrated).toBe(true));
    await act(() => {
      api?.set({ savingsPaise: 100 });
      return Promise.resolve();
    });
    expect(mocked.set).toHaveBeenCalledWith("setup-draft", expect.stringContaining('"savingsPaise":100'));
    await act(() => {
      api?.reset();
      return Promise.resolve();
    });
    expect(mocked.remove).toHaveBeenCalledWith("setup-draft");
    expect(api?.draft).toEqual(emptyDraft);
  });

  it("clamps the money-left answer to the income whenever income changes (M2)", async () => {
    await render(
      <SetupProvider persist={false}>
        <Probe />
      </SetupProvider>,
    );
    await act(() => {
      api?.set({ incomePaise: 5_000_000 });
      return Promise.resolve();
    });
    await act(() => {
      api?.set({ moneyLeftPaise: 600_000 });
      return Promise.resolve();
    });
    await act(() => {
      api?.set({ incomePaise: 400_000 });
      return Promise.resolve();
    });
    expect(api?.draft.moneyLeftPaise).toBe(400_000);
    await act(() => {
      api?.set({ incomePaise: 9_000_000 });
      return Promise.resolve();
    });
    expect(api?.draft.moneyLeftPaise).toBe(400_000);
  });

  it("leaves an unanswered money-left alone when income changes (M2)", async () => {
    await render(
      <SetupProvider persist={false}>
        <Probe />
      </SetupProvider>,
    );
    await act(() => {
      api?.set({ incomePaise: 400_000 });
      return Promise.resolve();
    });
    expect(api?.draft.moneyLeftPaise).toBeNull();
  });

  it("paydayIsComplete needs a day for a fixed day", () => {
    expect(paydayIsComplete(null)).toBe(false);
    expect(paydayIsComplete({ rule: "FIXED_DAY", day: null })).toBe(false);
    expect(paydayIsComplete({ rule: "FIXED_DAY", day: 5 })).toBe(true);
    expect(paydayIsComplete({ rule: "LAST_WORKING_DAY" })).toBe(true);
  });

  it("keeps valid hydrated fields and drops invalid ones one by one", async () => {
    mocked.get.mockResolvedValue(
      JSON.stringify({
        incomePaise: -5,
        payday: { rule: "FIXED_DAY", day: 40 },
        savingsPaise: 200,
        moneyLeftPaise: "lots",
        personality: "PIRATE",
        morningTime: "8am",
        nightTime: "21:30",
      }),
    );
    await render(
      <SetupProvider>
        <Probe />
      </SetupProvider>,
    );
    await waitFor(() => expect(api?.hydrated).toBe(true));
    expect(api?.draft).toEqual({ ...emptyDraft, savingsPaise: 200, nightTime: "21:30" });
  });

  it("does not write before hydration and does not rewrite the empty draft after reset", async () => {
    await render(
      <SetupProvider>
        <Probe />
      </SetupProvider>,
    );
    await waitFor(() => expect(api?.hydrated).toBe(true));
    expect(mocked.set).not.toHaveBeenCalled();
    await act(() => {
      api?.set({ savingsPaise: 100 });
      return Promise.resolve();
    });
    await waitFor(() => expect(mocked.set).toHaveBeenCalledTimes(1));
    await act(() => {
      api?.reset();
      return Promise.resolve();
    });
    expect(mocked.remove).toHaveBeenCalledWith("setup-draft");
    expect(mocked.set).toHaveBeenCalledTimes(1);
  });
});
