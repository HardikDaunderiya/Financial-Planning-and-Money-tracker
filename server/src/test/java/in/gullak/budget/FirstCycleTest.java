package in.gullak.budget;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class FirstCycleTest {
    private static final Cycle OCTOBER = new Cycle(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31));

    @Test
    void proRatesByDaysLeftAndRoundsDownToWholeRupees() { // BUD-32
        assertThat(FirstCycle.proRate(1_500_000, LocalDate.of(2026, 10, 23), OCTOBER)).isEqualTo(435_400L);
    }

    @Test
    void signingUpOnPaydayIsNotProRated() {
        assertThat(FirstCycle.proRate(1_500_000, LocalDate.of(2026, 10, 1), OCTOBER)).isNull();
    }

    @Test
    void lastDayOfTheCycleGetsOneDaysShare() {
        assertThat(FirstCycle.proRate(1_500_000, LocalDate.of(2026, 10, 31), OCTOBER)).isEqualTo(48_300L);
    }

    @Test
    void nothingToSpendGivesZero() {
        assertThat(FirstCycle.proRate(-5, LocalDate.of(2026, 10, 23), OCTOBER)).isEqualTo(0L);
    }
}
