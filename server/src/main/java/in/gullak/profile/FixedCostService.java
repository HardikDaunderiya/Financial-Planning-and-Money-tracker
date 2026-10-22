package in.gullak.profile;

import in.gullak.common.error.NotFoundException;
import in.gullak.common.log.Events;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FixedCostService {
    private static final Logger log = LoggerFactory.getLogger(FixedCostService.class);

    private final FixedCostRepository repo;
    private final ProfileService profiles;

    FixedCostService(FixedCostRepository repo, ProfileService profiles) {
        this.repo = repo;
        this.profiles = profiles;
    }

    @Transactional(readOnly = true)
    public long totalFor(UUID userId) {
        return repo.totalActive(userId);
    }

    @Transactional(readOnly = true)
    List<FixedCost> list(UUID userId) {
        return repo.findByUserIdAndActiveTrueOrderByCreatedAtAsc(userId).stream().map(FixedCostEntity::toRecord).toList();
    }

    @Transactional
    FixedCost add(UUID userId, FixedCostRequest r) {
        profiles.checkWithFixedTotal(userId, repo.totalActive(userId) + r.amountPaise());
        FixedCostEntity created = repo.save(new FixedCostEntity(userId, r.name().trim(), r.amountPaise()));
        FixedCost result = created.toRecord();
        log.info("{} user={} id={} action=add", Events.FIXED_COST_CHANGED, userId, result.id());
        return result;
    }

    @Transactional
    FixedCost edit(UUID userId, UUID id, FixedCostPatch p) {
        FixedCostEntity current = repo.findByIdAndUserIdAndActiveTrue(id, userId)
            .orElseThrow(() -> new NotFoundException("Fixed cost"));
        String name = p.name() != null ? p.name().trim() : current.getName();
        long amount = p.amountPaise() != null ? p.amountPaise() : current.getAmountPaise();
        profiles.checkWithFixedTotal(userId, repo.totalActive(userId) - current.getAmountPaise() + amount);
        current.change(name, amount);
        log.info("{} user={} id={} action=edit", Events.FIXED_COST_CHANGED, userId, id);
        return current.toRecord();
    }

    @Transactional
    void remove(UUID userId, UUID id) {
        FixedCostEntity current = repo.findByIdAndUserIdAndActiveTrue(id, userId)
            .orElseThrow(() -> new NotFoundException("Fixed cost"));
        current.deactivate();
        log.info("{} user={} id={} action=remove", Events.FIXED_COST_CHANGED, userId, id);
    }
}
