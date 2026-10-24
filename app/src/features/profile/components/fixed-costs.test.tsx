import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiError, NetworkError } from "@/lib/api-errors";
import { fixedCostApi } from "../api";
import { FixedCostsScreen } from "../screens/fixed-costs-screen";

jest.mock("../api", () => ({
  fixedCostApi: { list: jest.fn(), add: jest.fn(), patch: jest.fn(), remove: jest.fn() },
  profileApi: { get: jest.fn(), put: jest.fn() },
}));
const mocked = fixedCostApi as jest.Mocked<typeof fixedCostApi>;

// SDK 58 adaptation: Screen reads safe-area insets, so tests render inside a provider with fixed metrics.
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderScreen(onContinue = jest.fn()) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={qc}>
        <FixedCostsScreen onContinue={onContinue} onBack={() => {}} />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  return onContinue;
}

let nextId = 1;
beforeEach(() => {
  nextId = 1;
  jest.useRealTimers();
  mocked.list.mockResolvedValue([]);
  mocked.add.mockImplementation((b) => Promise.resolve({ id: `fc-${nextId++}`, ...b }));
  mocked.patch.mockImplementation((id, b) =>
    Promise.resolve({ id, name: b.name ?? "Rent", amountPaise: b.amountPaise ?? 0 }),
  );
  mocked.remove.mockResolvedValue(undefined);
});

describe("Setup 2: fixed costs (APP-24)", () => {
  it("adds a preset and shows the total", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Add Rent, ₹10,000" }));
    expect(await screen.findByText("Rent")).toBeTruthy();
    expect(screen.getByTestId("fixed-total")).toHaveTextContent("₹10,000");
    expect(mocked.add).toHaveBeenCalledWith({ name: "Rent", amountPaise: 1000000 });
  });

  it("adds a custom cost with a typed name and amount", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Add another" }));
    await fireEvent.changeText(screen.getByLabelText("Name"), "Society maintenance");
    await fireEvent.changeText(screen.getByLabelText("Amount per month"), "2,500");
    await fireEvent.press(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Society maintenance")).toBeTruthy();
    expect(mocked.add).toHaveBeenCalledWith({ name: "Society maintenance", amountPaise: 250000 });
  });

  it("edits an amount in place", async () => {
    mocked.list.mockResolvedValue([{ id: "fc-9", name: "Rent", amountPaise: 1000000 }]);
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Edit Rent, ₹10,000" }));
    await fireEvent.changeText(screen.getByLabelText("Amount per month"), "12000");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith("fc-9", { name: "Rent", amountPaise: 1200000 }),
    );
  });

  it("removes with a 5-second undo", async () => {
    jest.useFakeTimers();
    mocked.list.mockResolvedValue([{ id: "fc-9", name: "Rent", amountPaise: 1000000 }]);
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Remove rent" }));
    expect(screen.queryByText("Rent")).toBeNull();
    expect(screen.getByText("Rent removed")).toBeTruthy();
    expect(mocked.remove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Rent")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Remove rent" }));
    await act(() => {
      jest.advanceTimersByTime(5000);
      return Promise.resolve();
    });
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledWith("fc-9"));
  });

  it("Add another hides when every preset is used", async () => {
    mocked.list.mockResolvedValue(
      ["Rent", "Cook", "Maid", "Monthly groceries", "Wi-Fi", "Phone bill", "EMI", "Gym"].map((name, i) => ({
        id: `p${i}`,
        name,
        amountPaise: 100,
      })),
    );
    await renderScreen();
    expect(await screen.findByText("Gym")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Add .*, ₹/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Add another" })).toBeTruthy(); // custom is always possible
  });

  it("a failed load shows Retry (ERR-13)", async () => {
    mocked.list.mockRejectedValueOnce(new NetworkError("offline")).mockResolvedValueOnce([]);
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Add another")).toBeTruthy();
  });

  it("a rejected preset add shows why", async () => {
    mocked.add.mockRejectedValueOnce(
      new ApiError("NOT_POSSIBLE", 422, "Savings and fixed costs leave nothing to spend. Save ₹0 or less."),
    );
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Add EMI, ₹4,500" }));
    expect(await screen.findByText("Those numbers do not add up")).toBeTruthy();
  });

  it("Continue is allowed with no fixed costs", async () => {
    const onContinue = await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });
});
