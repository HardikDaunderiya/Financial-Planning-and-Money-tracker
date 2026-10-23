package in.gullak.budget;

import in.gullak.profile.PaydayRule;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;

public final class CycleCalculator {
    private CycleCalculator() {}

    public static LocalDate payday(YearMonth month, PaydayRule rule, Integer day) {
        return switch (rule) {
            case FIXED_DAY -> month.atDay(day);
            case LAST_WORKING_DAY -> {
                LocalDate d = month.atEndOfMonth();
                while (d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY) {
                    d = d.minusDays(1);
                }
                yield d;
            }
        };
    }

    /** The cycle that contains {@code date}: from a payday to the day before the next one. */
    public static Cycle containing(LocalDate date, PaydayRule rule, Integer day) {
        YearMonth month = YearMonth.from(date);
        LocalDate thisPayday = payday(month, rule, day);
        if (!date.isBefore(thisPayday)) {
            return new Cycle(thisPayday, payday(month.plusMonths(1), rule, day).minusDays(1));
        }
        return new Cycle(payday(month.minusMonths(1), rule, day), thisPayday.minusDays(1));
    }
}
