const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const EMAIL_MAX = 254;

const EDGE_INVISIBLE =
  /^[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069\s]+|[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069\s]+$/g;

/** Invisible characters and whitespace at either end are dropped; any inside stay so validation rejects the address. */
export function normaliseEmail(raw: string): string {
  return raw.replace(EDGE_INVISIBLE, "").toLowerCase();
}

/** True for one string of at most 254 characters that looks like an email once normalised. */
/** Zero-width characters and bidi controls inside an address are invisible, so they are never valid. */
const INVISIBLE = /[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/;

export function isValidEmail(clean: string): boolean {
  return clean.length <= EMAIL_MAX && EMAIL.test(clean) && !INVISIBLE.test(clean);
}
