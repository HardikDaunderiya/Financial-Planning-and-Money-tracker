import type { Mood } from "./moods";
import type { Stage } from "./stage";

export const stagePaint: Record<
  Stage,
  { body: string; neck: string; rim: string; band: string; bandDash: string }
> = {
  clay: { body: "#C0622F", neck: "#A24F22", rim: "#D57A45", band: "#C0622F", bandDash: "0 100" },
  painted: { body: "#C0622F", neck: "#A24F22", rim: "#D57A45", band: "#F6E3D7", bandDash: "6 6" },
  gold: { body: "#D9A21B", neck: "#B8860B", rim: "#EBC04F", band: "#FFF3C4", bandDash: "6 6" },
  diamond: { body: "#7FB7D9", neck: "#5B97BC", rim: "#A8D2EC", band: "#FFFFFF", bandDash: "2 5" },
};

const dotEyes = "M47 66h.01M73 66h.01";
const smileEyes = "M41 68q6-8 12 0M67 68q6-8 12 0";

export type Face = { eyes: string; mouth: string; mouthFill: string; brows: string; cheeks: number };

export const faces: Record<Mood, Face> = {
  happy: { eyes: smileEyes, mouth: "M50 80q10 11 20 0", mouthFill: "none", brows: "", cheeks: 1 },
  calm: { eyes: dotEyes, mouth: "M52 82q8 5 16 0", mouthFill: "none", brows: "", cheeks: 0.6 },
  nervous: {
    eyes: dotEyes,
    mouth: "M49 86q5.5-5 11 0q5.5 5 11 0",
    mouthFill: "none",
    brows: "M40 61l11-4M80 61l-11-4",
    cheeks: 0,
  },
  fainted: {
    eyes: "M42 61l10 10M52 61l-10 10M68 61l10 10M78 61l-10 10",
    mouth: "M60 80a5 6 0 1 0 0.01 0",
    mouthFill: "none",
    brows: "",
    cheeks: 0,
  },
  celebrating: { eyes: smileEyes, mouth: "M48 78q12 16 24 0z", mouthFill: "#2A1F1A", brows: "", cheeks: 1 },
};

/** Closed eyes for the blink: two short horizontal strokes at eye height. */
export const closedEyes = "M42 67h10M68 67h10";

export const ink = "#2A1F1A";
export const sweatBlue = "#5B9BD5";
export const gold = "#E0A02F";
export const coinEdge = "#B8860B";
export const slotInk = "#3A1A0C";
export const highlight = "#FFFFFF";
export const cheekPink = "#F28B82";
export const confettiGreen = "#2F7D4F";
export const confettiRust = "#B94A22";
