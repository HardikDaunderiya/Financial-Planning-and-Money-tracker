package in.gullak.profile;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Transient;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;
import org.hibernate.annotations.UpdateTimestamp;
import org.springframework.data.domain.Persistable;

@Entity
@Table(name = "profiles")
class ProfileEntity implements Persistable<UUID> {
    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "income_paise", nullable = false)
    private long incomePaise;

    @Column(name = "savings_paise", nullable = false)
    private long savingsPaise;

    @Enumerated(EnumType.STRING)
    @Column(name = "payday_rule", nullable = false, length = 20)
    private PaydayRule paydayRule;

    @Column(name = "payday_day")
    private Integer paydayDay;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Personality personality;

    @Column(name = "morning_time", nullable = false)
    private LocalTime morningTime;

    @Column(name = "night_time", nullable = false)
    private LocalTime nightTime;

    @Column(nullable = false, length = 40)
    private String timezone;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    @Transient
    private boolean isNew;

    protected ProfileEntity() {}

    ProfileEntity(UUID userId) {
        this.userId = userId;
        this.isNew = true;
    }

    void apply(Profile p) {
        this.incomePaise = p.incomePaise();
        this.savingsPaise = p.savingsPaise();
        this.paydayRule = p.paydayRule();
        this.paydayDay = p.paydayDay();
        this.personality = p.personality();
        this.morningTime = p.morningTime();
        this.nightTime = p.nightTime();
        this.timezone = p.timezone();
    }

    Profile toProfile() {
        return new Profile(userId, incomePaise, savingsPaise, paydayRule, paydayDay, personality,
            morningTime, nightTime, timezone);
    }

    @Override
    public UUID getId() { return userId; }

    @Override
    public boolean isNew() { return isNew; }

    @PostLoad
    @PostPersist
    void markNotNew() { this.isNew = false; }
}
