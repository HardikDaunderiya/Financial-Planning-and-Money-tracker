import { act, render, screen } from "@testing-library/react-native";
import React from "react";
import { processColor } from "react-native";
import * as Reanimated from "react-native-reanimated";
import { getAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { Gullak } from "./gullak";
import { fromServerMood, moodFor } from "./moods";
import { stageFor } from "./stage";

jest.mock("react-native-reanimated", () => ({
  ...jest.requireActual("react-native-reanimated"),
  __esModule: true,
  useReducedMotion: jest.fn(() => false),
  useAnimatedProps: jest.fn(jest.requireActual("react-native-reanimated").useAnimatedProps),
  cancelAnimation: jest.fn(jest.requireActual("react-native-reanimated").cancelAnimation),
}));
/** react-native-svg hands the host the processed colour object, not the hex string. */
const paint = (hex: string) => ({ type: 0, payload: processColor(hex) });
const mockedReduceMotion = useReducedMotion as jest.Mock;

describe("moodFor (APP-12)", () => {
  it.each([
    [0, 1000, 0, "happy"],
    [490, 1000, 0, "happy"],
    [499, 1000, 0, "happy"],
    [500, 1000, 0, "calm"],
    [799, 1000, 0, "calm"],
    [800, 1000, 0, "nervous"],
    [1000, 1000, 0, "nervous"],
    [1001, 1000, 0, "fainted"],
    [0, 0, 0, "nervous"],
    [1, 0, 0, "fainted"],
    [0, 1000, 1, "fainted"],
    [0, -5, 0, "fainted"],
  ] as const)("spent %i of %i, pool over %i → %s", (spentPaise, budgetPaise, poolOverPaise, mood) => {
    const result = moodFor({ budgetPaise, spentPaise, poolOverPaise });
    expect(result).toBe(mood);
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

describe("Gullak animation", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Reanimated's jest view of a host's current animated style and animatedProps. */
  const animated = (testID: string) =>
    (getAnimatedStyle as unknown as (component: unknown) => Record<string, unknown>)(
      screen.getByTestId(testID),
    );
  /**
   * react-native-svg hosts do not surface animatedProps in jest, so read the values the latest render handed to
   * useAnimatedProps. Order in gullak.tsx: eyes open, eyes closed, sweat, confetti, coin.
   */
  const layerIndex = { sweat: 2, confetti: 3, coin: 4 } as const;
  const opacityOf = (layer: keyof typeof layerIndex) => {
    const calls = (Reanimated.useAnimatedProps as jest.Mock).mock.calls as [() => { opacity: number }][];
    const updater = calls[calls.length - 5 + layerIndex[layer]]?.[0];
    return updater ? updater().opacity : Number.NaN;
  };
  const transformOf = (key: string) =>
    (animated("gullak-animated").transform as Record<string, unknown>[] | undefined)?.find((t) => key in t)?.[
      key
    ];
  const translateY = () => transformOf("translateY");
  const rotate = () => transformOf("rotate");
  const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));

  it("keeps the idle bounce going after a coin event settles", async () => {
    const { rerender } = await render(<Gullak mood="happy" stage="clay" reduceMotion={false} />);
    await rerender(
      <Gullak mood="happy" stage="clay" reduceMotion={false} event={{ kind: "coin", key: 1 }} />,
    );
    await advance(2000);
    const seen = new Set<unknown>();
    for (let i = 0; i < 6; i++) {
      await advance(200);
      seen.add(translateY());
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it("fainted reaches -14deg once the spring settles", async () => {
    const { rerender } = await render(<Gullak mood="happy" stage="clay" reduceMotion={false} />);
    await rerender(<Gullak mood="fainted" stage="clay" reduceMotion={false} />);
    await advance(3000);
    expect(rotate()).toBe("-14deg");
  });

  it("a new event key replays and the same key does not", async () => {
    const { rerender } = await render(<Gullak mood="happy" stage="clay" reduceMotion={false} />);
    await rerender(
      <Gullak mood="happy" stage="clay" reduceMotion={false} event={{ kind: "coin", key: 1 }} />,
    );
    await advance(1500);
    expect(opacityOf("coin")).toBe(0);
    await rerender(
      <Gullak mood="happy" stage="clay" reduceMotion={false} event={{ kind: "coin", key: 1 }} />,
    );
    await advance(30);
    expect(opacityOf("coin")).toBe(0);
    await rerender(
      <Gullak mood="happy" stage="clay" reduceMotion={false} event={{ kind: "coin", key: 2 }} />,
    );
    await advance(30);
    expect(opacityOf("coin")).toBeGreaterThan(0);
  });

  it("an event present at mount does not play", async () => {
    await render(<Gullak mood="happy" stage="clay" reduceMotion={false} event={{ kind: "coin", key: 7 }} />);
    await advance(30);
    expect(opacityOf("coin")).toBe(0);
  });

  it("a celebrate event raises the confetti then returns it to the mood's value", async () => {
    const { rerender } = await render(<Gullak mood="happy" stage="clay" reduceMotion={false} />);
    expect(opacityOf("confetti")).toBe(0);
    await rerender(
      <Gullak mood="happy" stage="clay" reduceMotion={false} event={{ kind: "celebrate", key: 1 }} />,
    );
    await advance(100);
    expect(opacityOf("confetti")).toBe(1);
    await advance(1500);
    expect(opacityOf("confetti")).toBe(0);
  });

  it("renders no coin and no animated gullak under Reduce Motion", async () => {
    const { rerender } = await render(<Gullak mood="happy" stage="clay" reduceMotion />);
    await rerender(<Gullak mood="happy" stage="clay" reduceMotion event={{ kind: "coin", key: 1 }} />);
    expect(screen.queryByTestId("gullak-coin")).toBeNull();
    expect(screen.queryByTestId("gullak-animated")).toBeNull();
  });

  it.each([
    ["happy", "Gullak, happy"],
    ["calm", "Gullak, calm"],
    ["nervous", "Gullak, nervous and sweating"],
    ["fainted", "Gullak, fainted"],
    ["celebrating", "Gullak, celebrating"],
  ] as const)("the animated %s Gullak is labelled for screen readers", async (mood, label) => {
    await render(<Gullak mood={mood} stage="clay" reduceMotion={false} />);
    expect(screen.getByTestId("gullak-animated")).toHaveProp("accessibilityLabel", label);
  });

  it("the sweat drop pulses when nervous and is hidden otherwise", async () => {
    const { rerender } = await render(<Gullak mood="nervous" stage="clay" reduceMotion={false} />);
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) {
      await advance(150);
      seen.add(opacityOf("sweat"));
    }
    expect(seen.size).toBeGreaterThan(2);
    await rerender(<Gullak mood="happy" stage="clay" reduceMotion={false} />);
    await advance(500);
    expect(opacityOf("sweat")).toBe(0);
  });

  it("cancels every animation on unmount", async () => {
    const cancel = Reanimated.cancelAnimation as jest.Mock;
    const { unmount } = await render(<Gullak mood="nervous" stage="clay" reduceMotion={false} />);
    cancel.mockClear();
    await unmount();
    expect(cancel.mock.calls.length).toBeGreaterThanOrEqual(7);
  });
});
