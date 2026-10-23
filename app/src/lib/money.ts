const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Whole rupees with Indian grouping: 10000000 paise → "₹1,00,000". Paise are dropped, never rounded up. */
export function formatRupees(paise: number): string {
  const whole = Math.trunc(Math.abs(paise) / 100);
  return `${paise < 0 ? "−" : ""}₹${rupees.format(whole)}`;
}
