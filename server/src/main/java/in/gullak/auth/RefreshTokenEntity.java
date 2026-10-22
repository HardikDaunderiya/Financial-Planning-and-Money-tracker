package in.gullak.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "refresh_tokens")
class RefreshTokenEntity {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(length = 60)
    private String device;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "used_at")
    private Instant usedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    protected RefreshTokenEntity() {}

    RefreshTokenEntity(UUID userId, String tokenHash, UUID familyId, String device, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.familyId = familyId;
        this.device = device;
        this.expiresAt = expiresAt;
    }

    UUID getId() { return id; }
    UUID getUserId() { return userId; }
    UUID getFamilyId() { return familyId; }
    String getDevice() { return device; }
    Instant getExpiresAt() { return expiresAt; }
    boolean isSpent() { return usedAt != null || revokedAt != null; }
}
