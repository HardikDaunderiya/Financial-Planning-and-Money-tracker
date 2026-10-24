import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { TabBar } from "./tab-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

// SDK 58 adaptation: Screen and TabBar read safe-area insets, so tests render inside a provider with fixed metrics.
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
function Safe({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>;
}

function props(index: number) {
  const navigate = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  return {
    navigate,
    p: {
      state: {
        index,
        routes: [
          { key: "home", name: "home" },
          { key: "insights", name: "insights" },
          { key: "goals", name: "goals" },
          { key: "me", name: "me" },
        ],
      },
      navigation: { navigate, emit },
      descriptors: {},
    },
  };
}

describe("TabBar", () => {
  it("has the four tabs, the centre add button, and marks the current tab", async () => {
    const { p } = props(0);
    await render(
      <Safe>
        <TabBar {...p} />
      </Safe>,
    );
    expect(screen.getByRole("tab", { name: "Home" })).toBeSelected();
    expect(screen.getByRole("tab", { name: "Insights" })).not.toBeSelected();
    expect(screen.getByRole("tab", { name: "Goals" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Me" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a spend" })).toBeDisabled();
  });

  it("navigates on tap", async () => {
    const { p, navigate } = props(0);
    await render(
      <Safe>
        <TabBar {...p} />
      </Safe>,
    );
    await fireEvent.press(screen.getByRole("tab", { name: "Goals" }));
    expect(navigate).toHaveBeenCalledWith("goals");
  });
});
