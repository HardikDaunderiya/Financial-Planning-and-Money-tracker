import { act, render, screen, waitFor } from "@testing-library/react-native";
import React, { useEffect } from "react";
import { Text } from "react-native";
import { kv } from "@/lib/kv";
import { emptyDraft, paydayIsComplete, SetupProvider, useSetup } from "./setup-store";

jest.mock("@/lib/kv", () => ({ kv: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } }));
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

  it("paydayIsComplete needs a day for a fixed day", () => {
    expect(paydayIsComplete(null)).toBe(false);
    expect(paydayIsComplete({ rule: "FIXED_DAY", day: null })).toBe(false);
    expect(paydayIsComplete({ rule: "FIXED_DAY", day: 5 })).toBe(true);
    expect(paydayIsComplete({ rule: "LAST_WORKING_DAY" })).toBe(true);
  });
});
