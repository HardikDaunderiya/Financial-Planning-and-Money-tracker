import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Button } from "./button";
import { Chip } from "./chip";
import { Field } from "./field";
import { Icon } from "./icon";
import { ProgressBar } from "./progress-bar";
import { RadioCard } from "./radio-card";
import { Stepper } from "./stepper";
import { Toast } from "./toast";
import { ErrorState } from "./error-state";
import { touchTarget } from "@/theme";

function minHeightOf(node: { props: { style?: unknown } }): number {
  const flat = Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as {
    minHeight?: number;
  };
  return flat.minHeight ?? 0;
}

describe("UI primitives (APP-29)", () => {
  it("Button is at least 44px tall, has the button role and the title as its label", async () => {
    await render(<Button title="Continue" onPress={() => {}} />);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(minHeightOf(button)).toBeGreaterThanOrEqual(touchTarget);
  });

  it("Button disabled state is exposed and blocks presses", async () => {
    const onPress = jest.fn();
    await render(<Button title="Continue" onPress={onPress} disabled />);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("Button loading keeps the label for screen readers and reports busy", async () => {
    await render(<Button title="Sending" onPress={() => {}} loading />);
    const button = screen.getByRole("button", { name: "Sending" });
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
  });

  it("Chip exposes selected state", async () => {
    await render(<Chip label="Food delivery" selected onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Food delivery" })).toBeSelected();
  });

  it("RadioCard is a radio with checked state and a 44px target", async () => {
    await render(<RadioCard title="1st of the month" checked onPress={() => {}} />);
    const radio = screen.getByRole("radio", { name: "1st of the month" });
    expect(radio).toBeChecked();
    expect(minHeightOf(radio)).toBeGreaterThanOrEqual(touchTarget);
  });

  it("Icon-only controls carry a label: Stepper minus and plus", async () => {
    await render(
      <Stepper
        label="Save every month"
        valuePaise={2000000}
        stepPaise={100000}
        min={0}
        max={3500000}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Save ₹1,000 less")).toBeTruthy();
    expect(screen.getByLabelText("Save ₹1,000 more")).toBeTruthy();
  });

  it("Stepper allows a step that lands between the value and max, and disables at max", async () => {
    const onChange = jest.fn();
    const props = { label: "Save every month", stepPaise: 100000, min: 0, max: 3500000, onChange };
    const { rerender } = await render(<Stepper {...props} valuePaise={3450000} />);
    const more = screen.getByLabelText("Save ₹1,000 more");
    expect(more).toBeEnabled();
    await fireEvent.press(more);
    expect(onChange).toHaveBeenCalledWith(3500000);
    await rerender(<Stepper {...props} valuePaise={3500000} />);
    expect(screen.getByLabelText("Save ₹1,000 more")).toBeDisabled();
  });

  it("Icon is hidden from assistive tech by default", async () => {
    await render(<Icon name="home" />);
    expect(screen.getByTestId("icon-home", { includeHiddenElements: true })).toHaveProp(
      "accessibilityElementsHidden",
      true,
    );
  });

  it("Field links its label and shows an error", async () => {
    await render(
      <Field label="Take-home pay per month" value="" onChangeText={() => {}} error="Enter your salary" />,
    );
    expect(screen.getByLabelText("Take-home pay per month")).toBeTruthy();
    expect(screen.getByText("Enter your salary")).toBeTruthy();
  });

  it("ProgressBar exposes its value", async () => {
    await render(<ProgressBar value={30} label="Budget used" />);
    expect(screen.getByRole("progressbar", { name: "Budget used" })).toHaveAccessibilityValue({
      now: 30,
      min: 0,
      max: 100,
    });
  });

  it("ErrorState has a Retry button", async () => {
    const onRetry = jest.fn();
    await render(<ErrorState onRetry={onRetry} />);
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("Toast (APP-28)", () => {
  it("renders a message and never an action", async () => {
    await render(<Toast message="Could not refresh. Showing saved data." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh. Showing saved data.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
