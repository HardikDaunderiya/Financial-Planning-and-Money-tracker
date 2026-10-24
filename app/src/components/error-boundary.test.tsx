import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { AppErrorBoundary } from "./error-boundary";

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error("render failed");
  return <Text>fine</Text>;
}

describe("AppErrorBoundary (ERR-15)", () => {
  it("shows the fallback with Retry, reports the error, and recovers", async () => {
    const report = jest.fn();
    let explode = true;
    const { rerender } = await render(
      <AppErrorBoundary report={report}>
        <Bomb explode={explode} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(report).toHaveBeenCalledWith("boundary.caught", { message: "render failed" });
    explode = false;
    await rerender(
      <AppErrorBoundary report={report}>
        <Bomb explode={explode} />
      </AppErrorBoundary>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("fine")).toBeTruthy();
  });
});
