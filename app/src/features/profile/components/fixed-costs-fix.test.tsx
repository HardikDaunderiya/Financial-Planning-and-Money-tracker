import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api-errors";
import { fixedCostApi } from "../api";
import { FixedCostsScreen } from "../screens/fixed-costs-screen";

jest.mock("../api", () => ({
  fixedCostApi: { list: jest.fn(), add: jest.fn(), patch: jest.fn(), remove: jest.fn() },
  profileApi: { get: jest.fn(), put: jest.fn() },
}));
const mocked = fixedCostApi as jest.Mocked<typeof fixedCostApi>;

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const rent = { id: "fc-1", name: "Rent", amountPaise: 1000000 };
const cook = { id: "fc-2", name: "Cook", amountPaise: 200000 };

async function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const onContinue = jest.fn();
  const onBack = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={qc}>
        <FixedCostsScreen onContinue={onContinue} onBack={onBack} />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  return { onContinue, onBack };
}

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
    return Promise.resolve();
  });

beforeEach(() => {
  jest.useRealTimers();
  mocked.list.mockReset().mockResolvedValue([rent]);
  mocked.add.mockReset().mockImplementation((b) => Promise.resolve({ id: "new", ...b }));
  mocked.patch
    .mockReset()
    .mockImplementation((id, b) =>
      Promise.resolve({ id, name: b.name ?? "Rent", amountPaise: b.amountPaise ?? 0 }),
    );
  mocked.remove.mockReset().mockResolvedValue(undefined);
});
afterEach(() => jest.useRealTimers());

describe("a pending removal is never lost", () => {
  it("Continue during the undo window commits the removal once, then navigates", async () => {
    jest.useFakeTimers();
    const { onContinue } = await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Remove rent" }));
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1));
    expect(mocked.remove).toHaveBeenCalledTimes(1);
    expect(mocked.remove).toHaveBeenCalledWith("fc-1");
    await advance(6000);
    expect(mocked.remove).toHaveBeenCalledTimes(1);
  });

  it("a failed commit on Continue stays, restores the item and shows the error", async () => {
    jest.useFakeTimers();
    mocked.remove.mockRejectedValueOnce(new ApiError("INTERNAL", 500, "boom"));
    const { onContinue } = await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Remove rent" }));
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Something went wrong. Try again in a moment.")).toBeTruthy();
    expect(screen.getByText("Rent")).toBeTruthy();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("unmounting during the undo window (Back) commits the removal once", async () => {
    jest.useFakeTimers();
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Remove rent" }));
    await screen.unmount();
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledTimes(1));
    await advance(6000);
    expect(mocked.remove).toHaveBeenCalledTimes(1);
  });

  it("going to the background during the undo window commits the removal once", async () => {
    jest.useFakeTimers();
    let handler: (s: AppStateStatus) => void = () => undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_t, h) => {
      handler = h;
      return { remove: () => undefined };
    });
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Remove rent" }));
    await act(() => {
      handler("background");
      return Promise.resolve();
    });
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledTimes(1));
    await advance(6000);
    expect(mocked.remove).toHaveBeenCalledTimes(1);
  });

  it("removing A then B within the window commits A at once and gives B its own 5 seconds", async () => {
    jest.useFakeTimers();
    mocked.list.mockResolvedValue([rent, cook]);
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Remove rent" }));
    await advance(1000);
    await fireEvent.press(screen.getByRole("button", { name: "Remove cook" }));
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledWith("fc-1"));
    expect(mocked.remove).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(screen.queryByText("Rent")).toBeNull();
    await advance(2900);
    expect(mocked.remove).toHaveBeenCalledTimes(1);
    await advance(100);
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledWith("fc-2"));
    expect(mocked.remove).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Rent")).toBeNull();
  });

  it("Continue is disabled while a fixed-cost mutation is in flight", async () => {
    let release: () => void = () => undefined;
    mocked.add.mockImplementationOnce(
      (b) => new Promise((resolve) => (release = () => resolve({ id: "new", ...b }))),
    );
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Add EMI, ₹4,500" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled());
    await act(() => {
      release();
      return Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });
});

describe("rollback and NOT_FOUND", () => {
  it("a failed remove restores the item in its place", async () => {
    jest.useFakeTimers();
    mocked.list.mockResolvedValue([rent, cook]);
    mocked.remove.mockRejectedValueOnce(new ApiError("INTERNAL", 500, "boom"));
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Remove rent" }));
    await advance(5000);
    expect(await screen.findByText("Something went wrong. Try again in a moment.")).toBeTruthy();
    const names = screen.getAllByText(/^(Rent|Cook)$/).map((n) => n.props.children as string);
    expect(names).toEqual(["Rent", "Cook"]);
  });

  it("a remove that finds nothing counts as done and refetches", async () => {
    jest.useFakeTimers();
    mocked.list.mockResolvedValueOnce([rent]).mockResolvedValue([]);
    mocked.remove.mockRejectedValueOnce(new ApiError("NOT_FOUND", 404, "gone"));
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Remove rent" }));
    await advance(5000);
    await waitFor(() => expect(mocked.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("That no longer exists")).toBeNull();
    expect(screen.queryByText("Rent")).toBeNull();
  });
});

describe("amount field", () => {
  it("a pasted 2500.50 saves 2500 rupees", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Add another" }));
    await fireEvent.changeText(screen.getByLabelText("Name"), "Maintenance");
    await fireEvent.changeText(screen.getByLabelText("Amount per month"), "2500.50");
    await fireEvent.press(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(mocked.add).toHaveBeenCalledWith({ name: "Maintenance", amountPaise: 250000 }),
    );
  });

  it("a pasted 12345678 shows and saves 1234567 rupees", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Add another" }));
    await fireEvent.changeText(screen.getByLabelText("Name"), "Big");
    await fireEvent.changeText(screen.getByLabelText("Amount per month"), "12345678");
    expect(screen.getByLabelText("Amount per month")).toHaveDisplayValue("1234567");
    await fireEvent.press(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mocked.add).toHaveBeenCalledWith({ name: "Big", amountPaise: 123456700 }));
  });
});

describe("errors are kept separate", () => {
  it("a failed patch then a successful one leaves no banner", async () => {
    mocked.patch.mockRejectedValueOnce(new ApiError("NOT_POSSIBLE", 422, "x"));
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Edit Rent, ₹10,000" }));
    await fireEvent.changeText(screen.getByLabelText("Amount per month"), "12000");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Those numbers do not add up")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("Those numbers do not add up")).toBeNull());
    expect(mocked.patch).toHaveBeenCalledTimes(2);
  });

  it("the form error is not shown when the edit form reopens", async () => {
    mocked.patch.mockRejectedValueOnce(new ApiError("NOT_POSSIBLE", 422, "x"));
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Edit Rent, ₹10,000" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Those numbers do not add up")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    await fireEvent.press(screen.getByRole("button", { name: "Edit Rent, ₹10,000" }));
    expect(screen.queryByText("Those numbers do not add up")).toBeNull();
  });

  it("a rejected add in the open form keeps what was typed", async () => {
    mocked.add.mockRejectedValueOnce(new ApiError("NOT_POSSIBLE", 422, "x"));
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Add another" }));
    await fireEvent.changeText(screen.getByLabelText("Name"), "Society");
    await fireEvent.changeText(screen.getByLabelText("Amount per month"), "2500");
    await fireEvent.press(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Those numbers do not add up")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toHaveDisplayValue("Society");
    expect(screen.getByLabelText("Amount per month")).toHaveDisplayValue("2500");
  });
});

describe("one add at a time", () => {
  it("a double tap on a preset adds it once and the chips disable", async () => {
    let release: () => void = () => undefined;
    mocked.add.mockImplementationOnce(
      (b) => new Promise((resolve) => (release = () => resolve({ id: "new", ...b }))),
    );
    await renderScreen();
    const chip = await screen.findByRole("button", { name: "Add EMI, ₹4,500" });
    await fireEvent.press(chip);
    await fireEvent.press(chip);
    await fireEvent.press(screen.getByRole("button", { name: "Add Cook, ₹2,000" }));
    expect(mocked.add).toHaveBeenCalledTimes(1);
    await act(() => {
      release();
      return Promise.resolve();
    });
  });
});
