package in.gullak.budget;

import in.gullak.content.Mood;

/** The money rules of spec section 2.1. Pure: no clock, no database. */
public final class BudgetCalculator {
    private BudgetCalculator() {}

    public static DailyBudget compute(BudgetInput in) {
        long spendable = in.incomePaise() - in.fixedPaise() - in.savingsPaise();
        long pool = spendable - in.spentBeforeTodayPaise();
        long budget = pool > 0 ? pool / in.daysLeftIncludingToday() / 100 * 100 : 0;
        long spent = in.spentTodayPaise();
        long left = Math.max(0, budget - spent);
        long over = Math.max(0, spent - budget);
        long poolOver = Math.max(0, -pool);
        int percent = budget > 0 ? (int) Math.min(999, spent * 100 / budget) : (spent > 0 ? 999 : 0);
        Mood mood = pool < 0 || over > 0 ? Mood.FAINTED
            : budget == 0 ? Mood.NERVOUS
            : percent < 50 ? Mood.HAPPY
            : percent < 80 ? Mood.CALM
            : Mood.NERVOUS;
        return new DailyBudget(spendable, pool, budget, spent, left, over, poolOver, percent, mood);
    }
}
