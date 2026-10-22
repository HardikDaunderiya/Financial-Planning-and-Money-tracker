package in.gullak.budget;

public record DailyBudget(
    long spendablePaise,
    long poolPaise,
    long budgetPaise,
    long spentTodayPaise,
    long leftPaise,
    long overPaise,
    long poolOverPaise,
    int percentUsed,
    Mood mood) {}
