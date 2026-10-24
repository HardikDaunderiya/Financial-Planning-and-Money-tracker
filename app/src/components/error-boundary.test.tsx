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
    expect(report).toHaveBeenCalledWith("boundary.caught", { kind: "Error" });
    explode = false;
    await rerender(
      <AppErrorBoundary report={report}>
        <Bomb explode={explode} />
      </AppErrorBoundary>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("fine")).toBeTruthy();
  });

  it("Retry on a child that still throws shows the fallback again", async () => {
    const report = jest.fn();
    await render(
      <AppErrorBoundary report={report}>
        <Bomb explode />
      </AppErrorBoundary>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("never logs the error message", async () => {
    const report = jest.fn();
    function Leak(): React.ReactElement {
      throw new Error("secret thing");
    }
    await render(
      <AppErrorBoundary report={report}>
        <Leak />
      </AppErrorBoundary>,
    );
    expect(JSON.stringify(report.mock.calls)).not.toContain("secret");
  });
});
