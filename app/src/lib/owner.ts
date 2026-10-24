import * as Crypto from "expo-crypto";

/** The cache owner id: SHA-256 of the lower-cased email (never the email itself), or "anon" without one. */
export async function ownerId(email: string | null): Promise<string> {
  if (!email) return "anon";
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, email.trim().toLowerCase());
}
