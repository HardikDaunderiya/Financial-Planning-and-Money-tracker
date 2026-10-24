export type Mood = "happy" | "calm" | "nervous" | "fainted" | "celebrating";

export type ServerMood = "HAPPY" | "CALM" | "NERVOUS" | "FAINTED";

/** Spec 2.6: 0–49 happy, 50–79 calm, 80–100 nervous, over 100 fainted. The server is the authority; this mirrors it for optimistic updates. */
export function moodFor(percentUsed: number): Mood {
  if (percentUsed > 100) return "fainted";
  if (percentUsed >= 80) return "nervous";
  if (percentUsed >= 50) return "calm";
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
