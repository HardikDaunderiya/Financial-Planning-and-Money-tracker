package in.gullak.budget;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/** Spec 2.1: the first cycle after setup is pro-rated by the days left in it. */
final class FirstCycle {
    private FirstCycle() {}

    /**
     * The pool for a first cycle budgeted from {@code today}, rounded down to whole rupees, or null when today
     * is the cycle's first day (nothing to pro-rate).
     */
    static Long proRate(long monthlySpendablePaise, LocalDate today, Cycle cycle) {
        int daysLeft = (int) ChronoUnit.DAYS.between(today, cycle.end()) + 1;
        if (daysLeft >= cycle.days()) {
            return null;
        }
        long pool = Math.max(0, monthlySpendablePaise) * daysLeft / cycle.days();
        return pool / 100 * 100;
    }
}
