package in.gullak.budget;

public record BudgetInput(
    long incomePaise,
    long fixedPaise,
    long savingsPaise,
    long spentBeforeTodayPaise,
    long spentTodayPaise,
    int daysLeftIncludingToday) {

    /** A cycle whose pool is pinned (the first cycle): the pool is the spendable amount, nothing is subtracted. */
    public static BudgetInput ofSpendable(long spendablePaise, long spentBeforeTodayPaise, long spentTodayPaise, int daysLeftIncludingToday) {
        return new BudgetInput(spendablePaise, 0, 0, spentBeforeTodayPaise, spentTodayPaise, daysLeftIncludingToday);
    }

    public BudgetInput {
        if (daysLeftIncludingToday < 1) {
            throw new IllegalArgumentException("daysLeftIncludingToday must be at least 1");
        }
    }
}
