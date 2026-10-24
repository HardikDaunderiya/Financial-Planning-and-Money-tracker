import React from "react";
import { View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import {
  cheekPink,
  closedEyes,
  confettiGreen,
  confettiRust,
  faces,
  gold,
  highlight,
  ink,
  slotInk,
  stagePaint,
  sweatBlue,
} from "./drawing";
import { moodLabels, type Mood } from "./moods";
import type { Stage } from "./stage";

export type GullakStillProps = { mood: Mood; stage: Stage; size?: number };

/** The whole drawing, no animation. The animated Gullak draws the same thing and moves the wrapper and a few layers. */
export function GullakStill({ mood, stage, size = 200 }: GullakStillProps) {
  return (
    <View
      testID="gullak-still"
      accessibilityRole="image"
      accessibilityLabel={moodLabels[mood]}
      style={{ width: size, height: size, transform: [{ rotate: mood === "fainted" ? "-14deg" : "0deg" }] }}
    >
      <GullakSvg size={size} paint={stagePaint[stage]} face={faces[mood]} mood={mood} />
    </View>
  );
}

export const SWEAT_PATH = "M98 34c5 7 6 11 1 13c-5-2-4-6-1-13z";

export const eyeStroke = {
  fill: "none",
  stroke: ink,
  strokeWidth: 3.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** The four confetti pieces; the animated version wraps them in an animated group. */
export function Confetti() {
  return (
    <>
      <Rect x="10" y="20" width="7" height="4" rx="1" fill={gold} transform="rotate(-25 13 22)" />
      <Rect x="100" y="14" width="7" height="4" rx="1" fill={confettiGreen} transform="rotate(30 103 16)" />
      <Rect x="104" y="52" width="6" height="4" rx="1" fill={sweatBlue} transform="rotate(-15 107 54)" />
      <Rect x="6" y="56" width="6" height="4" rx="1" fill={confettiRust} transform="rotate(20 9 58)" />
    </>
  );
}

/** Layers the animated Gullak replaces with Reanimated-driven elements. Absent layers are drawn statically. */
export type GullakLayers = {
  eyesOpen?: React.ReactNode;
  eyesClosed?: React.ReactNode;
  sweat?: React.ReactNode;
  confetti?: React.ReactNode;
  coin?: React.ReactNode;
};

type SvgProps = {
  size: number;
  paint: (typeof stagePaint)[Stage];
  face: (typeof faces)[Mood];
  mood: Mood;
  layers?: GullakLayers;
};

export function GullakSvg({ size, paint, face, mood, layers }: SvgProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Ellipse cx="60" cy="112" rx="34" ry="4" fill={ink} opacity={0.12} />
      <Rect x="42" y="22" width="36" height="18" rx="6" fill={paint.neck} />
      <Rect x="38" y="17" width="44" height="10" rx="5" fill={paint.rim} />
      <Rect x="50" y="20" width="20" height="3.5" rx="1.75" fill={slotInk} />
      {layers?.coin ?? null}
      <Ellipse testID="gullak-body" cx="60" cy="72" rx="46" ry="38" fill={paint.body} />
      <Path
        d="M20 60c13 6 27 9 40 9s27-3 40-9"
        fill="none"
        stroke={paint.band}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={paint.bandDash}
      />
      <Path
        d="M30 92c9 6 19 9 30 9"
        fill="none"
        stroke={highlight}
        strokeOpacity={0.22}
        strokeWidth={4}
        strokeLinecap="round"
      />
      <Circle cx="38" cy="82" r="5" fill={cheekPink} opacity={face.cheeks} />
      <Circle cx="82" cy="82" r="5" fill={cheekPink} opacity={face.cheeks} />
      {face.brows ? (
        <Path d={face.brows} fill="none" stroke={ink} strokeWidth={3} strokeLinecap="round" />
      ) : null}
      {layers?.eyesOpen ?? (
        <G opacity={1}>
          <Path d={face.eyes} {...eyeStroke} />
        </G>
      )}
      {layers?.eyesClosed ?? (
        <G opacity={0}>
          <Path d={closedEyes} {...eyeStroke} />
        </G>
      )}
      <Path
        d={face.mouth}
        fill={face.mouthFill}
        stroke={ink}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {layers?.sweat ?? (
        <Path testID="gullak-sweat" d={SWEAT_PATH} fill={sweatBlue} opacity={mood === "nervous" ? 1 : 0} />
      )}
      {layers?.confetti ?? (
        <G testID="gullak-confetti" opacity={mood === "celebrating" ? 1 : 0}>
          <Confetti />
        </G>
      )}
      <G testID="gullak-stars" opacity={mood === "fainted" ? 1 : 0} fill={gold}>
        <Path d="M28 22l2 4 4 1-4 1-2 4-2-4-4-1 4-1z" />
        <Path d="M92 14l1.5 3 3 1-3 1-1.5 3-1.5-3-3-1 3-1z" />
      </G>
    </Svg>
  );
}
