package in.gullak.budget;

import in.gullak.content.Mood;

public record DailyBudget(
    long spendablePaise,
    long poolPaise,
    long budgetPaise,
    long spentTodayPaise,
    long leftPaise,
    long overPaise,
    long poolOverPaise,
    int percentUsed,
    Mood mood) {

    /** What the Gullak calls "over": today's overspend plus any deficit in the cycle's pool. */
    public long totalOverPaise() {
        return overPaise + poolOverPaise;
    }
}
