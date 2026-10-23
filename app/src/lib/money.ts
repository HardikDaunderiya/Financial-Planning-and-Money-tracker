const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** The largest amount any field accepts: ₹99,99,999 (7 digits), the same cap as the server. */
export const MAX_AMOUNT_PAISE = 9_999_999_00;

/** Whole rupees with Indian grouping: 10000000 paise → "₹1,00,000". Paise are dropped, never rounded up. A zero amount never shows a minus. */
export function formatRupees(paise: number): string {
  const whole = Math.trunc(Math.abs(paise) / 100);
  return `${paise < 0 && whole !== 0 ? "−" : ""}₹${rupees.format(whole)}`;
}

/** Typed rupees → paise. Keeps digits only (so "₹50,000.75" is ₹50,000), caps at 7 digits. */
export function parseRupeesToPaise(text: string): number {
  const digits = text.split(".")[0]?.replace(/\D/g, "") ?? "";
  if (digits === "") return 0;
  const trimmed = digits.replace(/^0+/, "");
  if (trimmed === "") return 0;
  const capped = trimmed.slice(0, 7);
  return Number.parseInt(capped, 10) * 100;
}
