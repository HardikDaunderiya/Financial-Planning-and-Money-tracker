package in.gullak.budget;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CycleRepository extends JpaRepository<CycleEntity, UUID> {

    @Query("""
            select c from CycleEntity c where c.userId = :userId and c.startDate <= :date and c.endDate >= :date
            order by c.startDate desc
            """)
    List<CycleEntity> findAllCovering(@Param("userId") UUID userId, @Param("date") LocalDate date);

    /**
     * The cycle covering {@code date}. The cycles_no_overlap constraint allows at most one; should that
     * ever fail, the latest-starting cycle wins instead of the read throwing and breaking Home.
     */
    default Optional<CycleEntity> findCovering(UUID userId, LocalDate date) {
        return findAllCovering(userId, date).stream().findFirst();
    }

    @Query("select max(c.endDate) from CycleEntity c where c.userId = :userId and c.endDate < :date")
    Optional<LocalDate> latestEndBefore(@Param("userId") UUID userId, @Param("date") LocalDate date);

    /**
     * Native insert that does nothing when another request created the same or an overlapping cycle first.
     * No conflict target on purpose: a targeted ON CONFLICT does not cover the cycles_no_overlap exclusion.
     */
    @Modifying
    @Query(value = """
            insert into cycles (id, user_id, start_date, end_date, pool_override_paise, budget_from)
            values (:id, :userId, :start, :end, :pool, :budgetFrom)
            on conflict do nothing
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("userId") UUID userId,
                       @Param("start") LocalDate start, @Param("end") LocalDate end, @Param("pool") Long pool,
                       @Param("budgetFrom") LocalDate budgetFrom);

    @Query("select count(c) from CycleEntity c where c.userId = :userId and c.endDate < :start")
    long countEndingBefore(@Param("userId") UUID userId, @Param("start") LocalDate start);

    /** Only an open cycle of the caller; returns 0 rows when it is closed or not theirs. */
    @Modifying(clearAutomatically = true)
    @Query(value = """
            update cycles set pool_override_paise = :pool, updated_at = now()
            where id = :id and user_id = :userId and closed_at is null
            """, nativeQuery = true)
    int setPoolOverride(@Param("id") UUID id, @Param("userId") UUID userId, @Param("pool") long pool);
}
