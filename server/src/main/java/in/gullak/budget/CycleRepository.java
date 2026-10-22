package in.gullak.budget;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CycleRepository extends JpaRepository<CycleEntity, UUID> {

    @Query("select c from CycleEntity c where c.userId = :userId and c.startDate <= :date and c.endDate >= :date")
    Optional<CycleEntity> findCovering(@Param("userId") UUID userId, @Param("date") LocalDate date);

    @Query("select max(c.endDate) from CycleEntity c where c.userId = :userId and c.endDate < :date")
    Optional<LocalDate> latestEndBefore(@Param("userId") UUID userId, @Param("date") LocalDate date);

    /** Native insert that does nothing when another request created the same cycle first. */
    @Modifying
    @Query(value = """
            insert into cycles (id, user_id, start_date, end_date) values (:id, :userId, :start, :end)
            on conflict (user_id, start_date) do nothing
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("userId") UUID userId,
                       @Param("start") LocalDate start, @Param("end") LocalDate end);
}
