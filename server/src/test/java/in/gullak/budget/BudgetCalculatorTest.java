package in.gullak.budget;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import in.gullak.content.Mood;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class BudgetCalculatorTest {
    static final long INCOME = 5_000_000, FIXED = 1_500_000, SAVINGS = 2_000_000;

    static DailyBudget example(long before, long today, int daysLeft) {
        return BudgetCalculator.compute(new BudgetInput(INCOME, FIXED, SAVINGS, before, today, daysLeft));
    }

    @Test
    void spendable() { // BUD-06
        assertThat(example(0, 0, 31).spendablePaise()).isEqualTo(1_500_000);
    }

    @Test
    void exampleDay() { // BUD-07
        DailyBudget b = example(966_000, 18_000, 9);
        assertThat(b.budgetPaise()).isEqualTo(59_300);
        assertThat(b.leftPaise()).isEqualTo(41_300);
        assertThat(b.percentUsed()).isEqualTo(30);
        assertThat(b.mood()).isEqualTo(Mood.HAPPY);
    }

    @Test
    void unspentMoneyRaisesTomorrow() { // BUD-08
        DailyBudget today = example(920_000, 46_000, 10);
        DailyBudget tomorrow = example(920_000 + 46_000, 0, 9);
        assertThat(tomorrow.budgetPaise()).isGreaterThan(today.budgetPaise());
    }

    @Test
    void overspendLowersTomorrow() { // BUD-09
        DailyBudget today = example(966_000, 72_000, 9);
        assertThat(today.overPaise()).isEqualTo(72_000 - 59_300);
        assertThat(today.mood()).isEqualTo(Mood.FAINTED);
        DailyBudget tomorrow = example(966_000 + 72_000, 0, 8);
        assertThat(tomorrow.budgetPaise()).isEqualTo(57_700);
    }

    @Test
    void poolBelowZero() { // BUD-10
        DailyBudget b = example(1_540_000, 0, 11);
        assertThat(b.budgetPaise()).isZero();
        assertThat(b.poolOverPaise()).isEqualTo(40_000);
        assertThat(b.mood()).isEqualTo(Mood.FAINTED);
    }

    @Test
    void zeroSavings() { // BUD-15
        DailyBudget b = BudgetCalculator.compute(new BudgetInput(INCOME, FIXED, 0, 0, 0, 30));
        assertThat(b.spendablePaise()).isEqualTo(3_500_000);
    }

    @Test
    void dayWithNoSpends() { // BUD-20
        DailyBudget b = example(0, 0, 30);
        assertThat(b.leftPaise()).isEqualTo(b.budgetPaise());
        assertThat(b.mood()).isEqualTo(Mood.HAPPY);
    }

    @Test
    void lastDayGetsTheWholePool() { // BUD-21
        DailyBudget b = example(1_410_000, 0, 1);
        assertThat(b.budgetPaise()).isEqualTo(90_000);
    }

    @Test
    void impossibleSetupHasNoBudget() { // BUD-26
        DailyBudget b = BudgetCalculator.compute(new BudgetInput(3_000_000, 1_500_000, 2_000_000, 0, 0, 30));
        assertThat(b.spendablePaise()).isEqualTo(-500_000);
        assertThat(b.budgetPaise()).isZero();
        assertThat(b.mood()).isEqualTo(Mood.FAINTED);
    }

    @Test
    void roundsDown() { // BUD-27
        DailyBudget b = BudgetCalculator.compute(new BudgetInput(100_000, 0, 0, 0, 0, 3));
        assertThat(b.budgetPaise()).isEqualTo(33_300);
    }

    @Test
    void budgetIsWholeRupeesAndTheRemainderStaysInThePool() { // BUD-27
        DailyBudget b = example(966_000, 0, 9);
        assertThat(b.poolPaise()).isEqualTo(534_000);
        assertThat(b.budgetPaise()).isEqualTo(59_300);
        assertThat(b.budgetPaise() % 100).isZero();
    }

    @Test
    void spendingPastAWholeRupeeBudgetIsOverByThePaise() { // BUD-07 (whole-rupee budget)
        DailyBudget b = example(966_000, 59_400, 9);
        assertThat(b.budgetPaise()).isEqualTo(59_300);
        assertThat(b.overPaise()).isEqualTo(100);
        assertThat(b.leftPaise()).isZero();
        assertThat(b.mood()).isEqualTo(Mood.FAINTED);
    }

    @Test
    void poolExactlyZeroWithNothingSpentIsNervousNotFainted() { // BUD-10 (pool at zero)
        DailyBudget b = example(1_500_000, 0, 10);
        assertThat(b.poolPaise()).isZero();
        assertThat(b.budgetPaise()).isZero();
        assertThat(b.leftPaise()).isZero();
        assertThat(b.overPaise()).isZero();
        assertThat(b.mood()).isEqualTo(Mood.NERVOUS);
    }

    @Test
    void tinyPositivePoolBelowOneRupeePerDayIsNervous() { // BUD-10 (pool too small for ₹1 a day)
        DailyBudget b = example(1_499_800, 0, 3);
        assertThat(b.poolPaise()).isEqualTo(200);
        assertThat(b.budgetPaise()).isZero();
        assertThat(b.mood()).isEqualTo(Mood.NERVOUS);
    }

    @Test
    void zeroDaysLeftIsRejected() {
        assertThatThrownBy(() -> new BudgetInput(INCOME, FIXED, SAVINGS, 0, 0, 0))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @ParameterizedTest
    @CsvSource({ // APP-12 (server side)
        "0, HAPPY", "49, HAPPY", "50, CALM", "79, CALM", "80, NERVOUS", "100, NERVOUS", "101, FAINTED"
    })
    void moodBoundaries(int percent, Mood mood) {
        long budget = 100_000;
        long spent = budget * percent / 100;
        DailyBudget b = BudgetCalculator.compute(new BudgetInput(budget, 0, 0, 0, spent, 1));
        assertThat(b.mood()).isEqualTo(mood);
    }

    @Test
    void spendingOneRupeeOverIsFainted() {
        DailyBudget b = BudgetCalculator.compute(new BudgetInput(100_000, 0, 0, 0, 100_100, 1));
        assertThat(b.mood()).isEqualTo(Mood.FAINTED);
        assertThat(b.overPaise()).isEqualTo(100);
    }
}
