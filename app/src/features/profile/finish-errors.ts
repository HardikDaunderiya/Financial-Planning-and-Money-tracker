export const FIRST_CYCLE_NOT_SAVED = "Saved, but we couldn't set your money left. Try again";

/** The profile is saved but the money-left override failed; retrying sends only the override. */
export class FirstCycleNotSavedError extends Error {
  constructor() {
    super(FIRST_CYCLE_NOT_SAVED);
    this.name = "FirstCycleNotSavedError";
  }
}
