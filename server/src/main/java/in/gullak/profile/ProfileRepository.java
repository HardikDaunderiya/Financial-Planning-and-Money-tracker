package in.gullak.profile;

import jakarta.persistence.LockModeType;
import java.time.LocalTime;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface ProfileRepository extends JpaRepository<ProfileEntity, UUID> {

    /** Row lock for guards that read savings and fixed costs together: two writers for one user queue here. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from ProfileEntity p where p.userId = :userId")
    Optional<ProfileEntity> findByIdForUpdate(@Param("userId") UUID userId);

    /** First-time setup without a race: a second first-time PUT finds the row and updates it. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            insert into profiles (user_id, income_paise, savings_paise, payday_rule, payday_day, personality,
                                  morning_time, night_time, timezone)
            values (:userId, :income, :savings, :rule, :day, :personality, :morning, :night, :timezone)
            on conflict (user_id) do nothing
            """, nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("income") long income, @Param("savings") long savings,
                       @Param("rule") String rule, @Param("day") Integer day, @Param("personality") String personality,
                       @Param("morning") LocalTime morning, @Param("night") LocalTime night, @Param("timezone") String timezone);
}
