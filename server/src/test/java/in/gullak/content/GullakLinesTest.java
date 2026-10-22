package in.gullak.content;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.budget.BudgetCalculator;
import in.gullak.budget.BudgetInput;
import in.gullak.budget.DailyBudget;
import in.gullak.budget.Mood;
import in.gullak.profile.Personality;
import org.junit.jupiter.api.Test;

class GullakLinesTest {
    static final DailyBudget HAPPY = BudgetCalculator.compute(new BudgetInput(5_000_000, 1_500_000, 2_000_000, 966_000, 18_000, 9));
    static final DailyBudget OVER = BudgetCalculator.compute(new BudgetInput(5_000_000, 1_500_000, 2_000_000, 966_000, 72_000, 9));
    static final DailyBudget POOL_GONE = BudgetCalculator.compute(new BudgetInput(5_000_000, 1_500_000, 2_000_000, 1_540_000, 0, 11));

    /** A fixture whose budget is ₹1,000 a day, with the given spend today. */
    static DailyBudget withSpend(long spentToday) {
        return BudgetCalculator.compute(new BudgetInput(100_000, 0, 0, 0, spentToday, 1));
    }

    /** A fixture whose mood is the given one; the assertion guards the fixture itself. */
    static DailyBudget withMood(Mood mood) {
        long spent = switch (mood) {
            case HAPPY -> 0;
            case CALM -> 60_000;
            case NERVOUS -> 90_000;
            case FAINTED -> 110_000;
        };
        DailyBudget b = withSpend(spent);
        assertThat(b.mood()).isEqualTo(mood);
        return b;
    }

    @Test
    void chillHappyLineMatchesTheMockup() {
        assertThat(GullakLines.line(Personality.CHILL, HAPPY)).isEqualTo("₹413 left for today. Nice and steady.");
    }

    @Test
    void chillOverLineMatchesTheMockup() {
        assertThat(GullakLines.line(Personality.CHILL, OVER)).isEqualTo("Over by ₹127. Happens. Tomorrow’s a fresh start.");
    }

    @Test
    void poolGoneUsesThePoolOverspend() {
        assertThat(GullakLines.line(Personality.CHILL, POOL_GONE)).startsWith("Over by ₹400.");
    }

    @Test
    void faintedOverFigureIsTodaysOverspendPlusThePoolDeficit() { // BUD-10 shape
        DailyBudget b = BudgetCalculator.compute(new BudgetInput(5_000_000, 1_500_000, 2_000_000, 1_540_000, 10_000, 11));
        assertThat(b.overPaise()).isEqualTo(10_000);
        assertThat(b.poolOverPaise()).isEqualTo(40_000);
        assertThat(GullakLines.line(Personality.CHILL, b)).startsWith("Over by ₹500.");
    }

    @Test
    void hypeCalmLineHasNoFullStopOnItsSingleSentence() {
        assertThat(GullakLines.line(Personality.HYPE, withMood(Mood.CALM))).isEqualTo("₹400 left and you’re cruising");
    }

    @Test
    void everyPersonalityHasEveryMood() { // APP-12 (server side)
        for (Personality p : Personality.values()) {
            for (Mood mood : Mood.values()) {
                String line = GullakLines.line(p, withMood(mood));
                assertThat(line).as("%s / %s", p, mood).isNotBlank().doesNotContain("{");
            }
        }
    }
}
