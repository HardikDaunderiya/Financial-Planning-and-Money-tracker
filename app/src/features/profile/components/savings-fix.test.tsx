import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SavingsScreen } from "../screens/savings-screen";
import { SetupProvider, useSetup, type SetupDraft } from "../setup-store";

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function Draft() {
  const { draft } = useSetup();
  return <Text testID="draft">{JSON.stringify(draft)}</Text>;
}

function Seed({ seed }: { seed: Partial<SetupDraft> }) {
  const { set, draft } = useSetup();
  React.useEffect(() => {
    if (draft.incomePaise === 0) set(seed);
  }, [set, draft.incomePaise, seed]);
  return null;
}

const base: Partial<SetupDraft> = {
  incomePaise: 5000000,
  payday: { rule: "FIXED_DAY", day: 1 },
  savingsPaise: 2000000,
};
const example = [{ id: "a", name: "Rent", amountPaise: 1500000 }];

async function renderSavings(
  opts: { seed?: Partial<SetupDraft>; costs?: { id: string; name: string; amountPaise: number }[] } = {},
) {
  const onContinue = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SetupProvider persist={false}>
        <Seed seed={opts.seed ?? base} />
        <SavingsScreen
          today="2026-10-23"
          fixedCosts={opts.costs ?? example}
          onContinue={onContinue}
          onBack={() => {}}
        />
        <Draft />
      </SetupProvider>
    </SafeAreaProvider>,
  );
  return onContinue;
}

describe("typed values are never lost (savings)", () => {
  it("commits while typing: Continue without Done keeps the typed value", async () => {
    const onContinue = await renderSavings();
    await fireEvent.press(screen.getByLabelText("Save every month, ₹20,000, tap to type an amount"));
    await fireEvent.changeText(screen.getByLabelText("Save every month"), "25000");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
    expect(screen.getByTestId("draft")).toHaveTextContent(/"savingsPaise":2500000/);
  });

  it("Cancel restores the value the field opened with and closes it", async () => {
    await renderSavings();
    await fireEvent.press(screen.getByLabelText("Save every month, ₹20,000, tap to type an amount"));
    await fireEvent.changeText(screen.getByLabelText("Save every month"), "25000");
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("draft")).toHaveTextContent(/"savingsPaise":2000000/);
    expect(screen.getByLabelText("Save every month, ₹20,000, tap to type an amount")).toBeTruthy();
  });

  it("an empty field commits nothing", async () => {
    await renderSavings();
    await fireEvent.press(screen.getByLabelText("Save every month, ₹20,000, tap to type an amount"));
    await fireEvent.changeText(screen.getByLabelText("Save every month"), "");
    expect(screen.getByTestId("draft")).toHaveTextContent(/"savingsPaise":2000000/);
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("draft")).toHaveTextContent(/"savingsPaise":2000000/);
  });
});

describe("typed values are never lost (money left)", () => {
  it("commits while typing, then Continue keeps it", async () => {
    const onContinue = await renderSavings();
    await fireEvent.press(screen.getByRole("button", { name: "Change" }));
    await fireEvent.changeText(screen.getByLabelText("Money left until payday"), "6000");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
    expect(screen.getByTestId("draft")).toHaveTextContent(/"moneyLeftPaise":600000/);
  });

  it("Cancel goes back to our guess when nothing was edited before", async () => {
    await renderSavings();
    await fireEvent.press(screen.getByRole("button", { name: "Change" }));
    await fireEvent.changeText(screen.getByLabelText("Money left until payday"), "6000");
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("draft")).toHaveTextContent(/"moneyLeftPaise":null/);
    expect(screen.getByText("₹4,354")).toBeTruthy();
  });

  it("Cancel goes back to the earlier edited figure", async () => {
    await renderSavings({ seed: { ...base, moneyLeftPaise: 300000 } });
    await fireEvent.press(screen.getByRole("button", { name: "Change" }));
    await fireEvent.changeText(screen.getByLabelText("Money left until payday"), "6000");
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("draft")).toHaveTextContent(/"moneyLeftPaise":300000/);
  });

  it("an empty field commits nothing", async () => {
    await renderSavings({ seed: { ...base, moneyLeftPaise: 300000 } });
    await fireEvent.press(screen.getByRole("button", { name: "Change" }));
    await fireEvent.changeText(screen.getByLabelText("Money left until payday"), "");
    expect(screen.getByTestId("draft")).toHaveTextContent(/"moneyLeftPaise":300000/);
  });
});

describe("the not-possible line", () => {
  it("under ₹7,500 left after essentials says to lower fixed costs, never Try ₹0", async () => {
    await renderSavings({
      seed: { ...base, incomePaise: 1000000, savingsPaise: 0 },
      costs: [
        { id: "a", name: "Rent", amountPaise: 600000 },
        { id: "b", name: "Cook", amountPaise: 300000 },
      ],
    });
    // ₹10,000 − ₹9,000 = ₹1,000 left, ₹33 a day: tight; push savings to make it impossible
    await fireEvent.press(screen.getByLabelText("Save every month, ₹0, tap to type an amount"));
    await fireEvent.changeText(screen.getByLabelText("Save every month"), "1000");
    expect(
      screen.getByText("Only ₹1,000 is left after essentials. Lower your fixed costs to continue."),
    ).toBeTruthy();
    expect(screen.queryByText(/Try ₹0/)).toBeNull();
    expect(screen.getByRole("button", { name: "Lower your fixed costs to continue" })).toBeDisabled();
  });

  it("fixed costs above the salary never print a negative amount", async () => {
    await renderSavings({
      seed: { ...base, incomePaise: 1000000, savingsPaise: 0 },
      costs: [{ id: "a", name: "Rent", amountPaise: 1200000 }],
    });
    expect(screen.getByText("Your fixed costs are more than your salary")).toBeTruthy();
    expect(screen.queryByText(/Only −|Only ₹-/)).toBeNull();
    expect(screen.getByRole("button", { name: "Lower your fixed costs to continue" })).toBeDisabled();
  });
});
