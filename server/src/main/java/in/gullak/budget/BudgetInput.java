package in.gullak.budget;

public record BudgetInput(
    long incomePaise,
    long fixedPaise,
    long savingsPaise,
    long spentBeforeTodayPaise,
    long spentTodayPaise,
    int daysLeftIncludingToday) {

    public BudgetInput {
        if (daysLeftIncludingToday < 1) {
            throw new IllegalArgumentException("daysLeftIncludingToday must be at least 1");
        }
    }
}
