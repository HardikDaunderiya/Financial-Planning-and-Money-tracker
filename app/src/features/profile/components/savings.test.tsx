import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";

import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SavingsScreen } from "../screens/savings-screen";
import { SetupProvider, useSetup } from "../setup-store";

// SDK 58 adaptation: Screen reads safe-area insets, so tests render inside a provider with fixed metrics.
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function Draft() {
  const { draft } = useSetup();
  return <Text testID="draft">{JSON.stringify(draft)}</Text>;
}

async function renderSavings(onContinue = jest.fn()) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SetupProvider persist={false}>
        <Seed />
        <SavingsScreen
          today="2026-10-23"
          fixedCosts={[
            { id: "a", name: "Rent", amountPaise: 1000000 },
            { id: "b", name: "Cook", amountPaise: 200000 },
            { id: "c", name: "Maid", amountPaise: 150000 },
            { id: "d", name: "Monthly groceries", amountPaise: 150000 },
          ]}
          onContinue={onContinue}
          onBack={() => {}}
        />
        <Draft />
      </SetupProvider>
    </SafeAreaProvider>,
  );
  return onContinue;
}

function Seed() {
  const { set, draft } = useSetup();
  React.useEffect(() => {
    if (draft.incomePaise === 0)
      set({ incomePaise: 5000000, payday: { rule: "FIXED_DAY", day: 1 }, savingsPaise: 2000000 });
  }, [set, draft.incomePaise]);
  return null;
}

describe("Setup 3: savings (APP-20)", () => {
  it("shows Doable with the per-day figure for the example user", async () => {
    await renderSavings();
    expect(screen.getByText("Doable")).toBeTruthy();
    expect(screen.getByText("You keep ₹500 a day for everything else")).toBeTruthy();
    expect(screen.getByText("Per day in November (30 days)")).toBeTruthy();
    expect(screen.getByText("Rent, cook, maid, monthly groceries")).toBeTruthy();
  });

  it("stepping up to ₹28,000 is tight; ₹35,000 is not possible and disables Continue", async () => {
    await renderSavings();
    for (let i = 0; i < 8; i++) await fireEvent.press(screen.getByLabelText("Save ₹1,000 more"));
    expect(screen.getByText("Possible, but tight")).toBeTruthy();
    expect(screen.getByText("₹233 a day covers chai and the metro, not much else")).toBeTruthy();
    for (let i = 0; i < 7; i++) await fireEvent.press(screen.getByLabelText("Save ₹1,000 more"));
    expect(screen.getByText("Not possible")).toBeTruthy();
    expect(screen.getByText("Only ₹35,000 is left after essentials. Try ₹27,000 or less.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lower your savings to continue" })).toBeDisabled();
  });

  it("typed amounts (APP-21): tapping the number opens a field; non-digits stripped; capped at the maximum", async () => {
    await renderSavings();
    await fireEvent.press(screen.getByLabelText("Save every month, ₹20,000, tap to type an amount"));
    await fireEvent.changeText(screen.getByLabelText("Save every month"), "₹2a5,000");
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("draft")).toHaveTextContent(/"savingsPaise":2500000/);
    await fireEvent.press(screen.getByLabelText("Save every month, ₹25,000, tap to type an amount"));
    await fireEvent.changeText(screen.getByLabelText("Save every month"), "99999999");
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("draft")).toHaveTextContent(/"savingsPaise":3500000/); // income − fixed
  });

  it("money left until payday is pre-filled from BUD-32 and editable", async () => {
    await renderSavings();
    expect(screen.getByText("Left until payday")).toBeTruthy();
    expect(screen.getByText("₹4,354")).toBeTruthy();
    expect(screen.getByText("That's ₹483 a day until Sat, 31 Oct")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Change" }));
    await fireEvent.changeText(screen.getByLabelText("Money left until payday"), "6000");
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("That's ₹666 a day until Sat, 31 Oct")).toBeTruthy();
    expect(screen.getByTestId("draft")).toHaveTextContent(/"moneyLeftPaise":600000/);
  });

  it("Set savings later saves ₹0 and shows the nudge", async () => {
    const onContinue = await renderSavings();
    await fireEvent.press(screen.getByRole("button", { name: "Set savings later" }));
    expect(screen.getByText("No savings this month. Set a target later from Me.")).toBeTruthy();
    expect(screen.getByTestId("draft")).toHaveTextContent(/"savingsPaise":0/);
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });
});

describe("Setup 3: money left cap", () => {
  it("caps a typed money-left figure at the monthly income, as the server does", async () => {
    await renderSavings();
    await fireEvent.press(screen.getByRole("button", { name: "Change" }));
    await fireEvent.changeText(screen.getByLabelText("Money left until payday"), "9999999");
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("draft")).toHaveTextContent(/"moneyLeftPaise":5000000/);
  });
});
