package in.gullak.content;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.budget.BudgetCalculator;
import in.gullak.budget.BudgetInput;
import in.gullak.budget.DailyBudget;
import in.gullak.profile.Personality;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

class GullakLinesTest {
    static final DailyBudget HAPPY = BudgetCalculator.compute(new BudgetInput(5_000_000, 1_500_000, 2_000_000, 966_000, 18_000, 9));
    static final DailyBudget OVER = BudgetCalculator.compute(new BudgetInput(5_000_000, 1_500_000, 2_000_000, 966_000, 72_000, 9));
    static final DailyBudget POOL_GONE = BudgetCalculator.compute(new BudgetInput(5_000_000, 1_500_000, 2_000_000, 1_540_000, 0, 11));

    @Test
    void chillHappyLineMatchesTheMockup() {
        assertThat(GullakLines.line(Personality.CHILL, HAPPY)).isEqualTo("₹413 left for today. Nice and steady.");
    }

    @Test
    void chillOverLineMatchesTheMockup() {
        assertThat(GullakLines.line(Personality.CHILL, OVER)).isEqualTo("Over by ₹126. Happens. Tomorrow’s a fresh start.");
    }

    @Test
    void poolGoneUsesThePoolOverspend() {
        assertThat(GullakLines.line(Personality.CHILL, POOL_GONE)).startsWith("Over by ₹400.");
    }

    @ParameterizedTest
    @EnumSource(Personality.class)
    void everyPersonalityHasEveryMood(Personality p) {
        assertThat(GullakLines.line(p, HAPPY)).isNotBlank().doesNotContain("{");
        assertThat(GullakLines.line(p, OVER)).isNotBlank().doesNotContain("{");
    }
}
