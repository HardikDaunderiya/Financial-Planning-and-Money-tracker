package in.gullak.budget;

import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.UnprocessableException;
import in.gullak.common.log.Events;
import in.gullak.profile.Profile;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CycleService {
    private static final Logger log = LoggerFactory.getLogger(CycleService.class);

    private final CycleRepository cycles;

    CycleService(CycleRepository cycles) {
        this.cycles = cycles;
    }

    /**
     * The cycle covering {@code today}, created on first use. After a payday change the current cycle
     * keeps its end date; the next one starts the day after it and ends the day before the new payday.
     * A user's very first cycle, created mid-cycle, gets a pro-rated pool (spec 2.1).
     */
    @Transactional
    public CurrentCycle current(UUID userId, LocalDate today, Profile profile, long monthlySpendablePaise) {
        Optional<CycleEntity> existing = cycles.findCovering(userId, today);
        if (existing.isPresent()) {
            return toCurrent(userId, existing.get());
        }
        Cycle natural = CycleCalculator.containing(today, profile.paydayRule(), profile.paydayDay());
        LocalDate start = cycles.latestEndBefore(userId, today)
            .map(end -> end.plusDays(1))
            .filter(s -> s.isAfter(natural.start()))
            .orElse(natural.start());
        Cycle cycle = new Cycle(start, natural.end());
        boolean first = cycles.countEndingBefore(userId, cycle.start()) == 0;
        Long pool = first ? FirstCycle.proRate(monthlySpendablePaise, today, cycle) : null;
        if (cycles.insertIfAbsent(UUID.randomUUID(), userId, cycle.start(), cycle.end(), pool) == 1) {
            log.info("{} user={} days={} proRated={}", Events.CYCLE_OPENED, userId, cycle.days(), pool != null);
        }
        return cycles.findCovering(userId, today)
            .map(e -> toCurrent(userId, e))
            .orElseGet(() -> new CurrentCycle(null, cycle, pool, first));
    }

    /** Pins the pool of the caller's first, still-open cycle to what they said they have left. */
    @Transactional
    public void setFirstCyclePool(UUID userId, CurrentCycle current, long poolPaise) {
        if (!current.first() || current.id() == null || cycles.setPoolOverride(current.id(), userId, poolPaise) == 0) {
            throw new UnprocessableException(ErrorCode.FIRST_CYCLE_OVER, "Your first cycle has ended, so this can no longer be changed");
        }
        log.info("{} user={} cycle={}", Events.CYCLE_POOL_SET, userId, current.id());
    }

    private CurrentCycle toCurrent(UUID userId, CycleEntity e) {
        return new CurrentCycle(e.getId(), e.toCycle(), e.getPoolOverridePaise(), cycles.countEndingBefore(userId, e.getStartDate()) == 0);
    }
}
