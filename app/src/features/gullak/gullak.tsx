import React, { useEffect } from "react";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Circle, G, Path } from "react-native-svg";
import { motion } from "@/theme";
import { closedEyes, faces, gold, stagePaint, sweatBlue } from "./drawing";
import { Confetti, GullakStill, GullakSvg, SWEAT_PATH, eyeStroke, type GullakLayers } from "./gullak-still";
import { moodLabels, type Mood } from "./moods";
import type { Stage } from "./stage";

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

export type GullakEvent = { kind: "coin" | "celebrate"; key: number };

export type GullakProps = {
  mood: Mood;
  stage: Stage;
  size?: number;
  /** A new `key` replays the event: a coin drop when a spend is added, a jump with confetti on a win. */
  event?: GullakEvent;
  /** Test and preview override; otherwise the system setting decides. */
  reduceMotion?: boolean;
};

/**
 * Animation gate (expo-animation skill): the idle bounce and blink are the mascot's signature (spec 2.6),
 * kept to 3px and off under Reduce Motion; coin, faint and celebrate are rare, event-driven delight.
 * Everything runs on the UI thread: transform and opacity only.
 */
export function Gullak({ mood, stage, size = 200, event, reduceMotion }: GullakProps) {
  const system = useReducedMotion();
  const reduced = reduceMotion ?? system;
  if (reduced) {
    return <GullakStill mood={mood} stage={stage} size={size} />;
  }
  return <AnimatedGullak mood={mood} stage={stage} size={size} event={event} />;
}

function AnimatedGullak({
  mood,
  stage,
  size,
  event,
}: Required<Pick<GullakProps, "mood" | "stage" | "size">> & { event?: GullakEvent | undefined }) {
  const bounce = useSharedValue(0); // translateY of the whole Gullak
  const tilt = useSharedValue(0); // degrees; -14 when fainted
  const blink = useSharedValue(0); // 0 open, 1 closed
  const sweat = useSharedValue(mood === "nervous" ? 1 : 0);
  const confetti = useSharedValue(mood === "celebrating" ? 1 : 0);
  const coinY = useSharedValue(-24);
  const coinOpacity = useSharedValue(0);

  useEffect(() => {
    if (mood === "fainted") {
      cancelAnimation(bounce);
      cancelAnimation(blink);
      bounce.set(withTiming(0, { duration: motion.base, easing: EASE_OUT }));
      blink.set(0);
      tilt.set(withSpring(-14, { duration: 500, dampingRatio: 0.6 }));
      return;
    }
    tilt.set(withSpring(0, { duration: 400, dampingRatio: 1 }));
    bounce.set(
      withRepeat(
        withSequence(
          withTiming(-3, { duration: motion.gullakIdle / 2, easing: EASE_IN_OUT }),
          withTiming(0, { duration: motion.gullakIdle / 2, easing: EASE_IN_OUT }),
        ),
        -1,
        false,
      ),
    );
    blink.set(
      withRepeat(
        withSequence(withDelay(3400, withTiming(1, { duration: 80 })), withTiming(0, { duration: 100 })),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(bounce);
      cancelAnimation(blink);
    };
  }, [mood, bounce, blink, tilt]);

  useEffect(() => {
    cancelAnimation(sweat);
    if (mood === "nervous") {
      sweat.set(
        withRepeat(
          withSequence(withTiming(1, { duration: 600 }), withTiming(0.4, { duration: 600 })),
          -1,
          true,
        ),
      );
    } else {
      sweat.set(withTiming(0, { duration: motion.fast }));
    }
    confetti.set(withTiming(mood === "celebrating" ? 1 : 0, { duration: motion.base }));
  }, [mood, sweat, confetti]);

  useEffect(() => {
    if (!event) return;
    if (event.kind === "coin") {
      coinY.set(-24);
      coinOpacity.set(
        withSequence(withTiming(1, { duration: 50 }), withDelay(450, withTiming(0, { duration: 100 }))),
      );
      coinY.set(withTiming(26, { duration: 600, easing: EASE_OUT }));
      bounce.set(
        withSequence(
          withTiming(2, { duration: 120, easing: EASE_OUT }),
          withTiming(0, { duration: 200, easing: EASE_OUT }),
        ),
      );
    } else {
      bounce.set(
        withSequence(
          withSpring(-18, { duration: 300, dampingRatio: 0.6 }),
          withSpring(0, { duration: 400, dampingRatio: 0.8 }),
        ),
      );
      confetti.set(
        withSequence(
          withTiming(1, { duration: 100 }),
          withDelay(700, withTiming(mood === "celebrating" ? 1 : 0, { duration: 200 })),
        ),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replay only when the event key changes
  }, [event?.key]);

  const wrapper = useAnimatedStyle(() => ({
    transform: [{ translateY: bounce.get() }, { rotate: `${tilt.get()}deg` }],
  }));
  const eyesOpenProps = useAnimatedProps(() => ({ opacity: 1 - blink.get() }));
  const eyesClosedProps = useAnimatedProps(() => ({ opacity: blink.get() }));
  const sweatProps = useAnimatedProps(() => ({ opacity: sweat.get() }));
  const confettiProps = useAnimatedProps(() => ({ opacity: confetti.get() }));
  const coinProps = useAnimatedProps(() => ({ cy: 20 + coinY.get(), opacity: coinOpacity.get() }));

  const face = faces[mood];
  const layers: GullakLayers = {
    eyesOpen: (
      <AnimatedG animatedProps={eyesOpenProps}>
        <Path d={face.eyes} {...eyeStroke} />
      </AnimatedG>
    ),
    eyesClosed: (
      <AnimatedG animatedProps={eyesClosedProps}>
        <Path d={closedEyes} {...eyeStroke} />
      </AnimatedG>
    ),
    sweat: <AnimatedPath testID="gullak-sweat" d={SWEAT_PATH} fill={sweatBlue} animatedProps={sweatProps} />,
    confetti: (
      <AnimatedG testID="gullak-confetti" animatedProps={confettiProps}>
        <Confetti />
      </AnimatedG>
    ),
    coin:
      event?.kind === "coin" ? (
        <AnimatedCircle
          testID="gullak-coin"
          cx="60"
          r="6"
          fill={gold}
          stroke="#B8860B"
          strokeWidth={1.5}
          animatedProps={coinProps}
        />
      ) : null,
  };

  return (
    <Animated.View
      testID="gullak-animated"
      accessibilityRole="image"
      accessibilityLabel={moodLabels[mood]}
      style={[{ width: size, height: size }, wrapper]}
    >
      <GullakSvg
        size={size}
        paint={stagePaint[stage]}
        face={face}
        eyesClosed={false}
        sweat={mood === "nervous" ? 1 : 0}
        confetti={mood === "celebrating" ? 1 : 0}
        stars={mood === "fainted" ? 1 : 0}
        layers={layers}
      />
    </Animated.View>
  );
}
