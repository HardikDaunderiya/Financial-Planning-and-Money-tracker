import type { Personality } from "@/features/profile/api";
import { formatRupees } from "@/lib/money";

const happy: Record<Personality, string> = {
  CHILL: "{left} left for today. Nice and steady.",
  SAVAGE: "{left} left. Hide it before Swiggy smells it.",
  MOM: "{left} left, beta. Ghar ka khana tonight, okay?",
  HYPE: "{left} to play with today. Look at you go.",
};

export function sampleLine(personality: Personality, leftPaise: number): string {
  return happy[personality].replace("{left}", formatRupees(leftPaise));
}
