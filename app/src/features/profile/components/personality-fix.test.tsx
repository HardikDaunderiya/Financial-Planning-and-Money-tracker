import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FIRST_CYCLE_NOT_SAVED, FirstCycleNotSavedError } from "../finish-errors";
import { PersonalityScreen } from "../screens/personality-screen";
import { SetupProvider, useSetup, type SetupDraft } from "../setup-store";

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function Seed({ seed }: { seed: Partial<SetupDraft> }) {
  const { set, draft } = useSetup();
  React.useEffect(() => {
    if (draft.incomePaise === 0) set(seed);
  }, [set, draft.incomePaise, seed]);
  return null;
}

async function renderIt(
  seed: Partial<SetupDraft>,
  today = "2026-10-23",
  finish = jest.fn(() => Promise.resolve()),
) {
  const onDone = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SetupProvider persist={false}>
        <Seed seed={seed} />
        <PersonalityScreen
          today={today}
          fixedPaise={1500000}
          finish={finish}
          onDone={onDone}
          onBack={() => {}}
        />
      </SetupProvider>
    </SafeAreaProvider>,
  );
  return { finish, onDone };
}

const base: Partial<SetupDraft> = {
  incomePaise: 5000000,
  payday: { rule: "FIXED_DAY", day: 1 },
  savingsPaise: 2000000,
};

describe("a stale money-left answer is never sent", () => {
  it("sends the answer while the money-left card is visible", async () => {
    const { finish } = await renderIt({ ...base, moneyLeftPaise: 600000 });
    await fireEvent.press(screen.getByRole("button", { name: /Start with/ }));
    await waitFor(() =>
      expect(finish).toHaveBeenCalledWith(expect.objectContaining({ moneyLeftPaise: 600000 })),
    );
  });

  it("sends null when savings now make it not possible", async () => {
    const { finish } = await renderIt({ ...base, savingsPaise: 4000000, moneyLeftPaise: 600000 });
    await fireEvent.press(screen.getByRole("button", { name: /Start with/ }));
    await waitFor(() =>
      expect(finish).toHaveBeenCalledWith(expect.objectContaining({ moneyLeftPaise: null })),
    );
  });

  it("sends null when the stored answer is above the income (M2)", async () => {
    const finish = jest.fn(() => Promise.resolve());
    function TwoStep() {
      const { set, draft } = useSetup();
      React.useEffect(() => {
        if (draft.incomePaise === 0) set({ ...base, incomePaise: 5000000 });
        else if (draft.moneyLeftPaise === null) set({ moneyLeftPaise: 6000000 }); // no income change, so no clamp
      }, [set, draft.incomePaise, draft.moneyLeftPaise]);
      return null;
    }
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <SetupProvider persist={false}>
          <TwoStep />
          <PersonalityScreen
            today="2026-10-23"
            fixedPaise={1500000}
            finish={finish}
            onDone={() => {}}
            onBack={() => {}}
          />
        </SetupProvider>
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByRole("button", { name: /Start with/ }));
    await waitFor(() =>
      expect(finish).toHaveBeenCalledWith(expect.objectContaining({ moneyLeftPaise: null })),
    );
  });

  it("sends null on payday itself, when nothing is pro-rated", async () => {
    const { finish } = await renderIt({ ...base, moneyLeftPaise: 600000 }, "2026-11-01");
    await fireEvent.press(screen.getByRole("button", { name: /Start with/ }));
    await waitFor(() =>
      expect(finish).toHaveBeenCalledWith(expect.objectContaining({ moneyLeftPaise: null })),
    );
  });
});

describe("finishing", () => {
  it("shows the saved-but-override-failed message and keeps the button usable", async () => {
    const finish = jest.fn(() => Promise.reject(new FirstCycleNotSavedError()));
    await renderIt(base, "2026-10-23", finish);
    await fireEvent.press(screen.getByRole("button", { name: /Start with/ }));
    expect(await screen.findByText(FIRST_CYCLE_NOT_SAVED)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start with/ })).toBeEnabled();
  });

  it("renders nothing once finished, so no Start with ₹0 flash after the draft is reset", async () => {
    const { onDone } = await renderIt(base);
    await fireEvent.press(screen.getByRole("button", { name: /Start with/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Start with/ })).toBeNull();
  });
});
