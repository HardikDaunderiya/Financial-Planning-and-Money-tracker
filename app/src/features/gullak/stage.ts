export type Stage = "clay" | "painted" | "gold" | "diamond";

/** Spec 2.6: clay 1–4, painted 5–9, gold 10–19, diamond 20 and up. */
export function stageFor(level: number): Stage {
  if (level >= 20) return "diamond";
  if (level >= 10) return "gold";
  if (level >= 5) return "painted";
  return "clay";
}

export const stageLabels: Record<Stage, string> = {
  clay: "Clay pot",
  painted: "Painted",
  gold: "Gold",
  diamond: "Diamond",
};
