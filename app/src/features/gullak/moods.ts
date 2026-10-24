export type Mood = "happy" | "calm" | "nervous" | "fainted" | "celebrating";

export type ServerMood = "HAPPY" | "CALM" | "NERVOUS" | "FAINTED";

export type MoodInput = { budgetPaise: number; spentPaise: number; poolOverPaise: number };

/**
 * Mirrors the server (spec 2.6): fainted when spent exceeds the budget or the pool is over;
 * otherwise nervous when there is no budget; otherwise floor(spent x 100 / budget): 0-49 happy, 50-79 calm, 80-100 nervous.
 * The server is the authority; this is for optimistic updates. Never divides by zero, so never NaN.
 */
export function moodFor({ budgetPaise, spentPaise, poolOverPaise }: MoodInput): Mood {
  if (spentPaise > budgetPaise || poolOverPaise > 0) return "fainted";
  if (budgetPaise <= 0) return "nervous";
  const percent = Math.floor((spentPaise * 100) / budgetPaise);
  if (percent >= 80) return "nervous";
  if (percent >= 50) return "calm";
  return "happy";
}

export function fromServerMood(mood: ServerMood): Mood {
  switch (mood) {
    case "HAPPY":
      return "happy";
    case "CALM":
      return "calm";
    case "NERVOUS":
      return "nervous";
    case "FAINTED":
      return "fainted";
  }
}

export const moodLabels: Record<Mood, string> = {
  happy: "Gullak, happy",
  calm: "Gullak, calm",
  nervous: "Gullak, nervous and sweating",
  fainted: "Gullak, fainted",
  celebrating: "Gullak, celebrating",
};
