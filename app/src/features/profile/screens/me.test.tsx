import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { MeScreen } from "./me-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";

// SDK 58 adaptation: Screen and TabBar read safe-area insets, so tests render inside a provider with fixed metrics.
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
function Safe({ children }: { children: React.ReactNode }) {
  return <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>;
}

describe("Me", () => {
  it("shows the email, personality and times, and signs out on confirmation", async () => {
    const signOut = jest.fn(() => Promise.resolve());
    await render(
      <Safe>
        <MeScreen
          email="priya@example.com"
          profile={{
            incomePaise: 5000000,
            savingsPaise: 2000000,
            paydayRule: "FIXED_DAY",
            paydayDay: 1,
            personality: "CHILL",
            morningTime: "08:00",
            nightTime: "22:00",
            timezone: "Asia/Kolkata",
          }}
          signOut={signOut}
        />
      </Safe>,
    );
    expect(screen.getByText("priya@example.com")).toBeTruthy();
    expect(screen.getByText("Chill friend")).toBeTruthy();
    expect(screen.getByText("8:00 am and 10:00 pm")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByText("Sign out of Gullak on this phone?")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Yes, sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});
