package in.gullak.budget;

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
     */
    @Transactional
    public Cycle current(UUID userId, LocalDate today, Profile profile) {
        Optional<CycleEntity> existing = cycles.findCovering(userId, today);
        if (existing.isPresent()) {
            return existing.get().toCycle();
        }
        Cycle natural = CycleCalculator.containing(today, profile.paydayRule(), profile.paydayDay());
        LocalDate start = cycles.latestEndBefore(userId, today)
            .map(end -> end.plusDays(1))
            .filter(s -> s.isAfter(natural.start()))
            .orElse(natural.start());
        Cycle cycle = new Cycle(start, natural.end());
        if (cycles.insertIfAbsent(UUID.randomUUID(), userId, cycle.start(), cycle.end()) == 1) {
            log.info("{} user={} days={}", Events.CYCLE_OPENED, userId, cycle.days());
        }
        return cycles.findCovering(userId, today).map(CycleEntity::toCycle).orElse(cycle);
    }
}
