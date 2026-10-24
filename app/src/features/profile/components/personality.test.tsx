import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError } from "@/lib/api-errors";
import { PersonalityScreen } from "../screens/personality-screen";
import { SetupProvider, useSetup } from "../setup-store";

// SDK 58 adaptation: Screen reads safe-area insets, so tests render inside a provider with fixed metrics.
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function Seed() {
  const { set, draft } = useSetup();
  React.useEffect(() => {
    if (draft.incomePaise === 0)
      set({ incomePaise: 5000000, payday: { rule: "FIXED_DAY", day: 1 }, savingsPaise: 2000000 });
  }, [set, draft.incomePaise]);
  return null;
}

async function renderIt(finish = jest.fn(() => Promise.resolve()), onDone = jest.fn()) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SetupProvider persist={false}>
        <Seed />
        <PersonalityScreen
          today="2026-10-23"
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

describe("Setup 4: personality and message times", () => {
  it("shows the sample line in the chosen voice (APP-15)", async () => {
    await renderIt();
    expect(screen.getByText("₹483 left for today. Nice and steady.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Savage" }));
    expect(screen.getByText("₹483 left. Hide it before Swiggy smells it.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Indian mom" }));
    expect(screen.getByLabelText("Gullak, nervous and sweating")).toBeTruthy();
  });

  it("the start button names the day-one budget and sends the whole draft", async () => {
    const { finish, onDone } = await renderIt();
    await fireEvent.press(screen.getByRole("button", { name: "9:00 am" }));
    await fireEvent.press(screen.getByRole("button", { name: "Start with ₹483 today" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(finish).toHaveBeenCalledWith({
      incomePaise: 5000000,
      savingsPaise: 2000000,
      paydayRule: "FIXED_DAY",
      paydayDay: 1,
      personality: "CHILL",
      morningTime: "09:00",
      nightTime: "22:00",
      timezone: "Asia/Kolkata",
      moneyLeftPaise: null,
    });
  });

  it("a server rejection shows inline and keeps the draft", async () => {
    const finish = jest.fn(() => Promise.reject(new ApiError("NOT_POSSIBLE", 422, "nope")));
    await renderIt(finish);
    await fireEvent.press(screen.getByRole("button", { name: "Start with ₹483 today" }));
    expect(await screen.findByText("Those numbers do not add up")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start with ₹483 today" })).toBeEnabled();
  });
});
