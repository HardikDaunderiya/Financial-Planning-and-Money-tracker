package in.gullak.budget;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;

/** Read-only here: rows are created by {@link CycleRepository#insertIfAbsent} so concurrent first requests make one. */
@Entity
@Table(name = "cycles")
class CycleEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "end_date", nullable = false)
    private LocalDate endDate;

    protected CycleEntity() {}

    Cycle toCycle() { return new Cycle(startDate, endDate); }
}
