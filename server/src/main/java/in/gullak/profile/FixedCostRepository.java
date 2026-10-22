package in.gullak.profile;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface FixedCostRepository extends JpaRepository<FixedCostEntity, UUID> {

    List<FixedCostEntity> findByUserIdAndActiveTrueOrderByCreatedAtAsc(UUID userId);

    Optional<FixedCostEntity> findByIdAndUserIdAndActiveTrue(UUID id, UUID userId);

    @Query("select coalesce(sum(f.amountPaise), 0) from FixedCostEntity f where f.userId = :userId and f.active = true")
    long totalActive(@Param("userId") UUID userId);
}
