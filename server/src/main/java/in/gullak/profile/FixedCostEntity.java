package in.gullak.profile;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Transient;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.UpdateTimestamp;
import org.springframework.data.domain.Persistable;

@Entity
@Table(name = "fixed_costs")
class FixedCostEntity implements Persistable<UUID> {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 60)
    private String name;

    @Column(name = "amount_paise", nullable = false)
    private long amountPaise;

    @Column(nullable = false)
    private boolean active;

    /** Set by the database default so rows created in one request still sort in insert order. */
    @Column(name = "created_at", insertable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    @Transient
    private boolean isNew;

    protected FixedCostEntity() {}

    FixedCostEntity(UUID userId, String name, long amountPaise) {
        this.id = UUID.randomUUID();
        this.isNew = true;
        this.userId = userId;
        this.name = name;
        this.amountPaise = amountPaise;
        this.active = true;
    }

    long getAmountPaise() { return amountPaise; }
    String getName() { return name; }

    void change(String name, long amountPaise) {
        this.name = name;
        this.amountPaise = amountPaise;
    }

    void deactivate() { this.active = false; }

    FixedCost toRecord() { return new FixedCost(id, name, amountPaise); }

    @Override
    public UUID getId() { return id; }

    @Override
    public boolean isNew() { return isNew; }

    @PostLoad
    @PostPersist
    void markNotNew() { this.isNew = false; }
}
