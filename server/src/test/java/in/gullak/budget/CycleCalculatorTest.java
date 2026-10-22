package in.gullak.budget;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.profile.PaydayRule;
import java.time.LocalDate;
import java.time.YearMonth;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class CycleCalculatorTest {

    @Test
    void fixedPaydayOnTheFirst() { // BUD-01
        Cycle c = CycleCalculator.containing(LocalDate.of(2026, 10, 23), PaydayRule.FIXED_DAY, 1);
        assertThat(c).isEqualTo(new Cycle(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31)));
        assertThat(c.days()).isEqualTo(31);
    }

    @Test
    void midMonthPayday() { // BUD-02
        Cycle c = CycleCalculator.containing(LocalDate.of(2026, 11, 20), PaydayRule.FIXED_DAY, 15);
        assertThat(c).isEqualTo(new Cycle(LocalDate.of(2026, 11, 15), LocalDate.of(2026, 12, 14)));
        assertThat(c.days()).isEqualTo(30);
    }

    @Test
    void dateBeforeThisMonthsPaydayBelongsToLastMonthsCycle() { // BUD-02
        Cycle c = CycleCalculator.containing(LocalDate.of(2026, 11, 10), PaydayRule.FIXED_DAY, 15);
        assertThat(c).isEqualTo(new Cycle(LocalDate.of(2026, 10, 15), LocalDate.of(2026, 11, 14)));
    }

    @Test
    void february() { // BUD-03
        Cycle c = CycleCalculator.containing(LocalDate.of(2027, 2, 10), PaydayRule.FIXED_DAY, 1);
        assertThat(c).isEqualTo(new Cycle(LocalDate.of(2027, 2, 1), LocalDate.of(2027, 2, 28)));
        assertThat(c.days()).isEqualTo(28);
    }

    @Test
    void lastWorkingDayFallingOnASaturday() { // BUD-04
        assertThat(CycleCalculator.payday(YearMonth.of(2026, 10), PaydayRule.LAST_WORKING_DAY, null))
            .isEqualTo(LocalDate.of(2026, 10, 30));
        Cycle c = CycleCalculator.containing(LocalDate.of(2026, 11, 5), PaydayRule.LAST_WORKING_DAY, null);
        assertThat(c).isEqualTo(new Cycle(LocalDate.of(2026, 10, 30), LocalDate.of(2026, 11, 29)));
    }

    @Test
    void lastWorkingDayOnAWeekday() { // BUD-05
        assertThat(CycleCalculator.payday(YearMonth.of(2026, 12), PaydayRule.LAST_WORKING_DAY, null))
            .isEqualTo(LocalDate.of(2026, 12, 31));
        Cycle c = CycleCalculator.containing(LocalDate.of(2026, 12, 15), PaydayRule.LAST_WORKING_DAY, null);
        assertThat(c).isEqualTo(new Cycle(LocalDate.of(2026, 11, 30), LocalDate.of(2026, 12, 30)));
    }

    @ParameterizedTest
    @CsvSource({
        "2026-10-01, 2026-10-01, 2026-10-31",
        "2026-10-31, 2026-10-01, 2026-10-31",
        "2026-11-01, 2026-11-01, 2026-11-30",
        "2026-12-31, 2026-12-01, 2026-12-31",
        "2027-01-01, 2027-01-01, 2027-01-31"
    })
    void paydayItselfStartsANewCycle(LocalDate date, LocalDate start, LocalDate end) {
        assertThat(CycleCalculator.containing(date, PaydayRule.FIXED_DAY, 1)).isEqualTo(new Cycle(start, end));
    }

    @Test
    void lastWorkingDayOnSundayMovesToFriday() {
        // 31 May 2026 is a Sunday
        assertThat(CycleCalculator.payday(YearMonth.of(2026, 5), PaydayRule.LAST_WORKING_DAY, null))
            .isEqualTo(LocalDate.of(2026, 5, 29));
    }
}
