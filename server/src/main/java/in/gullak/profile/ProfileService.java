package in.gullak.profile;

import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.GullakException;
import in.gullak.common.error.UnprocessableException;
import in.gullak.common.error.ValidationException;
import in.gullak.common.log.Events;
import in.gullak.common.money.RupeeFormat;
import java.util.Optional;
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

    static final String SAVINGS_MESSAGE = "Savings and fixed costs leave nothing to spend. Save {max} or less.";
    static final String FIXED_COST_MESSAGE = "This cost leaves nothing to spend. Lower it or your savings.";

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
        Profile p = new Profile(userId, r.incomePaise(), r.savingsPaise(), r.paydayRule(), day,
            r.personality(), r.morningTime(), r.nightTime(), r.timezone());
        // Create the row if it is missing, then lock it: the guard runs under the same lock fixed-cost writes
        // take, so the two never interleave. A rejected first-time profile rolls the insert back with the transaction.
        profiles.insertIfAbsent(userId, p.incomePaise(), p.savingsPaise(), p.paydayRule().name(), p.paydayDay(),
            p.personality().name(), p.morningTime(), p.nightTime(), p.timezone());
        ProfileEntity entity = profiles.findByIdForUpdate(userId)
            .orElseThrow(() -> new IllegalStateException("profile row missing after insert"));
        requireSomethingToSpend(p.incomePaise(), fixedCosts.totalActive(userId), p.savingsPaise(), SAVINGS_MESSAGE);
        entity.apply(p);
        profiles.save(entity);
        log.info("{} user={}", Events.PROFILE_UPDATED, userId);
        return p;
    }

    /** Locks the caller's profile row and returns it; empty before setup, when there is nothing to guard. */
    Optional<Profile> lockForGuard(UUID userId) {
        return profiles.findByIdForUpdate(userId).map(ProfileEntity::toProfile);
    }

    static void requireSomethingToSpend(long income, long fixed, long savings, String message) {
        if (income - fixed - savings <= 0) {
            long maxSavings = Math.max(0, income - fixed - 100);
            throw new UnprocessableException(ErrorCode.NOT_POSSIBLE, message.replace("{max}", RupeeFormat.format(maxSavings)));
        }
    }
}
