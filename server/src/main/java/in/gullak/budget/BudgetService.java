package in.gullak.budget;

import in.gullak.common.time.Ist;
import in.gullak.content.GullakLines;
import in.gullak.profile.FixedCostService;
import in.gullak.profile.Profile;
import in.gullak.profile.ProfileService;
import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class BudgetService {
    private final ProfileService profiles;
    private final FixedCostService fixedCosts;
    private final CycleService cycles;
    private final SpendTotalsRepository totals;
    private final Clock clock;

    BudgetService(ProfileService profiles, FixedCostService fixedCosts, CycleService cycles,
                  SpendTotalsRepository totals, Clock clock) {
        this.profiles = profiles;
        this.fixedCosts = fixedCosts;
        this.cycles = cycles;
        this.totals = totals;
        this.clock = clock;
    }

    public TodayResponse today(UUID userId) {
        Profile profile = profiles.get(userId);
        LocalDate today = Ist.today(clock);
        Cycle cycle = cycles.current(userId, today, profile);
        long before = totals.spent(userId, Ist.startOf(cycle.start()), Ist.startOf(today));
        long spentToday = totals.spent(userId, Ist.startOf(today), Ist.startOf(today.plusDays(1)));
        int daysLeft = (int) ChronoUnit.DAYS.between(today, cycle.end()) + 1;
        DailyBudget b = BudgetCalculator.compute(new BudgetInput(
            profile.incomePaise(), fixedCosts.totalFor(userId), profile.savingsPaise(), before, spentToday, daysLeft));
        return new TodayResponse(today, b.budgetPaise(), b.spentTodayPaise(), b.leftPaise(), b.overPaise(),
            b.poolOverPaise(), b.mood(), GullakLines.line(profile.personality(), b), daysLeft,
            cycle.start(), cycle.end());
    }
}
