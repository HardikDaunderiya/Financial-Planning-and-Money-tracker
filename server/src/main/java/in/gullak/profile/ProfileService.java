package in.gullak.profile;

import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.GullakException;
import in.gullak.common.error.UnprocessableException;
import in.gullak.common.error.ValidationException;
import in.gullak.common.log.Events;
import in.gullak.common.money.RupeeFormat;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProfileService {
    private static final Logger log = LoggerFactory.getLogger(ProfileService.class);

    private final ProfileRepository profiles;
    private final FixedCostRepository fixedCosts;

    ProfileService(ProfileRepository profiles, FixedCostRepository fixedCosts) {
        this.profiles = profiles;
        this.fixedCosts = fixedCosts;
    }

    @Transactional(readOnly = true)
    public Profile get(UUID userId) {
        return profiles.findById(userId)
            .map(ProfileEntity::toProfile)
            .orElseThrow(() -> new GullakException(ErrorCode.SETUP_INCOMPLETE, HttpStatus.CONFLICT, "Finish setup first"));
    }

    @Transactional
    public Profile put(UUID userId, ProfileRequest r) {
        Integer day = switch (r.paydayRule()) {
            case FIXED_DAY -> {
                if (r.paydayDay() == null) {
                    throw new ValidationException("paydayDay", "Pick the day your salary arrives");
                }
                yield r.paydayDay();
            }
            case LAST_WORKING_DAY -> null;
        };
        requireSomethingToSpend(r.incomePaise(), fixedCosts.totalActive(userId), r.savingsPaise());
        Profile p = new Profile(userId, r.incomePaise(), r.savingsPaise(), r.paydayRule(), day,
            r.personality(), r.morningTime(), r.nightTime(), r.timezone());
        ProfileEntity entity = profiles.findById(userId).orElseGet(() -> new ProfileEntity(userId));
        entity.apply(p);
        profiles.save(entity);
        log.info("{} user={}", Events.PROFILE_UPDATED, userId);
        return p;
    }

    /** Called by fixed-cost changes; does nothing before setup. */
    void checkWithFixedTotal(UUID userId, long newFixedTotal) {
        profiles.findById(userId).ifPresent(p ->
            requireSomethingToSpend(p.toProfile().incomePaise(), newFixedTotal, p.toProfile().savingsPaise()));
    }

    static void requireSomethingToSpend(long income, long fixed, long savings) {
        if (income - fixed - savings <= 0) {
            long maxSavings = Math.max(0, income - fixed - 100);
            throw new UnprocessableException(ErrorCode.NOT_POSSIBLE,
                "Savings and fixed costs leave nothing to spend. Save " + RupeeFormat.format(maxSavings) + " or less.");
        }
    }
}
