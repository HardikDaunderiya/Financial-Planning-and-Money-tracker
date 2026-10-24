import { act, render, screen } from "@testing-library/react-native";
import React from "react";
import { UndoBar } from "./undo-bar";

describe("UndoBar", () => {
  afterEach(() => jest.useRealTimers());

  it("expires once, 5 seconds after it appeared, even if the callback changes on re-render", async () => {
    jest.useFakeTimers();
    const first = jest.fn();
    const second = jest.fn();
    await render(<UndoBar message="Rent removed" onUndo={() => {}} onExpire={first} />);
    await act(() => {
      jest.advanceTimersByTime(3000);
      return Promise.resolve();
    });
    await screen.rerender(<UndoBar message="Rent removed" onUndo={() => {}} onExpire={second} />);
    await act(() => {
      jest.advanceTimersByTime(1999);
      return Promise.resolve();
    });
    expect(second).not.toHaveBeenCalled();
    await act(() => {
      jest.advanceTimersByTime(1);
      return Promise.resolve();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
