import { render, screen } from "@testing-library/react-native";
import React from "react";
import { processColor } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Gullak } from "./gullak";
import { fromServerMood, moodFor } from "./moods";
import { stageFor } from "./stage";

jest.mock("react-native-reanimated", () => ({
  ...jest.requireActual("react-native-reanimated"),
  __esModule: true,
  useReducedMotion: jest.fn(() => false),
}));
/** react-native-svg hands the host the processed colour object, not the hex string. */
const paint = (hex: string) => ({ type: 0, payload: processColor(hex) });
const mockedReduceMotion = useReducedMotion as jest.Mock;

describe("moodFor (APP-12)", () => {
  it.each([
    [0, "happy"],
    [49, "happy"],
    [50, "calm"],
    [79, "calm"],
    [80, "nervous"],
    [100, "nervous"],
    [101, "fainted"],
  ])("%i% used → %s", (percent, mood) => {
    expect(moodFor(percent)).toBe(mood);
  });

  it("maps the server's enum", () => {
    expect(fromServerMood("HAPPY")).toBe("happy");
    expect(fromServerMood("NERVOUS")).toBe("nervous");
    expect(fromServerMood("FAINTED")).toBe("fainted");
  });
});

describe("stageFor (XP-09 mirror)", () => {
  it.each([
    [1, "clay"],
    [4, "clay"],
    [5, "painted"],
    [9, "painted"],
    [10, "gold"],
    [19, "gold"],
    [20, "diamond"],
    [40, "diamond"],
  ])("level %i → %s", (level, stage) => {
    expect(stageFor(level)).toBe(stage);
  });
});

describe("Gullak", () => {
  it("renders a still with no animation when Reduce Motion is on (APP-13)", async () => {
    await render(<Gullak mood="happy" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-still")).toBeTruthy();
    expect(screen.queryByTestId("gullak-animated")).toBeNull();
  });

  it("reads the system Reduce Motion setting", async () => {
    mockedReduceMotion.mockReturnValueOnce(true);
    await render(<Gullak mood="happy" stage="clay" />);
    expect(screen.getByTestId("gullak-still")).toBeTruthy();
  });

  it("animates when motion is allowed", async () => {
    await render(<Gullak mood="happy" stage="clay" reduceMotion={false} />);
    expect(screen.getByTestId("gullak-animated")).toBeTruthy();
  });

  it.each([
    ["happy", "Gullak, happy"],
    ["calm", "Gullak, calm"],
    ["nervous", "Gullak, nervous and sweating"],
    ["fainted", "Gullak, fainted"],
    ["celebrating", "Gullak, celebrating"],
  ] as const)("labels the %s mood for screen readers", async (mood, label) => {
    await render(<Gullak mood={mood} stage="clay" reduceMotion />);
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it("the fainted Gullak is tilted even as a still", async () => {
    await render(<Gullak mood="fainted" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-still")).toHaveStyle({ transform: [{ rotate: "-14deg" }] });
  });

  it("shows the sweat drop only when nervous, confetti only when celebrating, stars only when fainted", async () => {
    const { rerender } = await render(<Gullak mood="nervous" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-sweat")).toHaveProp("opacity", 1);
    expect(screen.getByTestId("gullak-confetti")).toHaveProp("opacity", 0);
    await rerender(<Gullak mood="celebrating" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-confetti")).toHaveProp("opacity", 1);
    expect(screen.getByTestId("gullak-sweat")).toHaveProp("opacity", 0);
    await rerender(<Gullak mood="fainted" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-stars")).toHaveProp("opacity", 1);
  });

  it("a coin event renders the falling coin (APP-14, component half)", async () => {
    const { rerender } = await render(<Gullak mood="happy" stage="clay" reduceMotion={false} />);
    expect(screen.queryByTestId("gullak-coin")).toBeNull();
    await rerender(
      <Gullak mood="happy" stage="clay" reduceMotion={false} event={{ kind: "coin", key: 1 }} />,
    );
    expect(screen.getByTestId("gullak-coin")).toBeTruthy();
  });

  it("paints each stage with its own body colour", async () => {
    const { rerender } = await render(<Gullak mood="happy" stage="clay" reduceMotion />);
    expect(screen.getByTestId("gullak-body")).toHaveProp("fill", paint("#C0622F"));
    await rerender(<Gullak mood="happy" stage="gold" reduceMotion />);
    expect(screen.getByTestId("gullak-body")).toHaveProp("fill", paint("#D9A21B"));
    await rerender(<Gullak mood="happy" stage="diamond" reduceMotion />);
    expect(screen.getByTestId("gullak-body")).toHaveProp("fill", paint("#7FB7D9"));
  });
});
