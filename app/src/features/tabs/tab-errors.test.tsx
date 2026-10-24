import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary as goals } from "../../../app/(tabs)/goals";
import { ErrorBoundary as home } from "../../../app/(tabs)/home";
import { ErrorBoundary as insights } from "../../../app/(tabs)/insights";
import { ErrorBoundary as me } from "../../../app/(tabs)/me";

describe("tab route error boundaries (ERR-15)", () => {
  it.each([
    ["home", home],
    ["insights", insights],
    ["goals", goals],
    ["me", me],
  ])("%s renders the fallback with Retry", async (_n, Boundary) => {
    const retry = jest.fn(() => Promise.resolve());
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <Boundary error={new Error("x")} retry={retry} />
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
