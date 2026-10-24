package in.gullak.budget;

import in.gullak.common.error.ValidationException;
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
import org.springframework.transaction.annotation.Transactional;

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

    /** One transaction so every figure comes from the same snapshot; read-write because it may open a cycle. */
    @Transactional
    public TodayResponse today(UUID userId) {
        Profile profile = profiles.get(userId);
        LocalDate today = Ist.today(clock);
        long fixed = fixedCosts.totalFor(userId);
        CurrentCycle current = cycles.current(userId, today, profile, spendable(profile, fixed));
        return compute(userId, profile, today, fixed, current);
    }

    @Transactional
    public TodayResponse setFirstCyclePool(UUID userId, long moneyLeftPaise) {
        Profile profile = profiles.get(userId);
        LocalDate today = Ist.today(clock);
        long fixed = fixedCosts.totalFor(userId);
        CurrentCycle current = cycles.current(userId, today, profile, spendable(profile, fixed));
        if (moneyLeftPaise > profile.incomePaise()) {
            throw new ValidationException("moneyLeftPaise", "Can't be more than your monthly income");
        }
        // "Money left" is money in hand now, so the pinned pool also holds what this cycle already spent.
        long spentSoFar = totals.spent(userId, Ist.startOf(current.cycle().start()), Ist.startOf(today.plusDays(1)));
        cycles.setFirstCyclePool(userId, current, moneyLeftPaise + spentSoFar);
        return compute(userId, profile, today, fixed, cycles.current(userId, today, profile, spendable(profile, fixed)));
    }

    private static long spendable(Profile profile, long fixed) {
        return profile.incomePaise() - fixed - profile.savingsPaise();
    }

    private TodayResponse compute(UUID userId, Profile profile, LocalDate today, long fixed, CurrentCycle current) {
        Cycle cycle = current.cycle();
        long before = totals.spent(userId, Ist.startOf(cycle.start()), Ist.startOf(today));
        long spentToday = totals.spent(userId, Ist.startOf(today), Ist.startOf(today.plusDays(1)));
        int daysLeft = (int) ChronoUnit.DAYS.between(today, cycle.end()) + 1;
        BudgetInput input = current.poolOverridePaise() != null
            ? BudgetInput.ofSpendable(current.poolOverridePaise(), before, spentToday, daysLeft)
            : new BudgetInput(profile.incomePaise(), fixed, profile.savingsPaise(), before, spentToday, daysLeft);
        DailyBudget b = BudgetCalculator.compute(input);
        return new TodayResponse(today, b.budgetPaise(), b.spentTodayPaise(), b.leftPaise(), b.overPaise(),
            b.poolOverPaise(), b.mood(), GullakLines.line(profile.personality(), b.mood(), b.leftPaise(), b.totalOverPaise()), daysLeft,
            cycle.start(), cycle.end());
    }
}
