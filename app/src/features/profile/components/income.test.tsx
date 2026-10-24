import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { IncomeScreen } from "../screens/income-screen";
import { SetupProvider, useSetup } from "../setup-store";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

// SDK 58 adaptation: Screen reads safe-area insets, so tests render inside a provider with fixed metrics.
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function Draft() {
  const { draft } = useSetup();
  return <Text testID="draft">{JSON.stringify(draft)}</Text>;
}

async function renderIncome(onContinue = jest.fn()) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SetupProvider persist={false}>
        <IncomeScreen today="2026-10-23" onContinue={onContinue} />
        <Draft />
      </SetupProvider>
    </SafeAreaProvider>,
  );
  return onContinue;
}

describe("Setup 1: income and payday (APP-25)", () => {
  it("typedIncomeStripsEverythingButDigits", async () => {
    await renderIncome();
    await fireEvent.changeText(screen.getByLabelText("Take-home pay per month"), "₹50,000.75");
    expect(screen.getByTestId("draft")).toHaveTextContent(/"incomePaise":5000000/);
  });

  it("groups the digits as they are typed", async () => {
    await renderIncome();
    await fireEvent.changeText(screen.getByLabelText("Take-home pay per month"), "50000");
    expect(screen.getByLabelText("Take-home pay per month")).toHaveDisplayValue("50,000");
  });

  it("each payday option updates the cycle line", async () => {
    await renderIncome();
    await fireEvent.press(screen.getByRole("radio", { name: "1st of the month" }));
    expect(screen.getByText("Your budget cycle runs 1 Nov – 30 Nov, then 1 Dec – 31 Dec")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Last working day" }));
    expect(screen.getByText("Your budget cycle runs 30 Oct – 29 Nov, then 30 Nov – 30 Dec")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "7th of the month" }));
    expect(screen.getByText("Your budget cycle runs 7 Nov – 6 Dec, then 7 Dec – 6 Jan")).toBeTruthy();
  });

  it("Another date shows the day select and the line follows the day", async () => {
    await renderIncome();
    expect(screen.queryByText("Day of the month")).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Another date" }));
    expect(screen.getByText("Day of the month")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "15th" }));
    expect(screen.getByText("Your budget cycle runs 15 Nov – 14 Dec, then 15 Dec – 14 Jan")).toBeTruthy();
    expect(screen.getByTestId("draft")).toHaveTextContent(/"day":15/);
  });

  it("Continue needs an income and a payday", async () => {
    const onContinue = await renderIncome();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("Take-home pay per month"), "50000");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("radio", { name: "1st of the month" }));
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("Another date without a day keeps Continue disabled", async () => {
    await renderIncome();
    await fireEvent.changeText(screen.getByLabelText("Take-home pay per month"), "50000");
    await fireEvent.press(screen.getByRole("radio", { name: "Another date" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});
