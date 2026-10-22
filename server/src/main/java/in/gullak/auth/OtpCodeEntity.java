package in.gullak.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "otp_codes")
class OtpCodeEntity {
    @Id
    private UUID id;

    @Column(nullable = false, length = 254)
    private String email;

    @Column(name = "code_hash", nullable = false, length = 64)
    private String codeHash;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(nullable = false)
    private int attempts;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    protected OtpCodeEntity() {}

    OtpCodeEntity(String email, String codeHash, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.email = email;
        this.codeHash = codeHash;
        this.expiresAt = expiresAt;
    }

    String getCodeHash() { return codeHash; }
    Instant getExpiresAt() { return expiresAt; }
    int getAttempts() { return attempts; }

    void recordFailedAttempt() { attempts++; }
    void consume(Instant at) { consumedAt = at; }
}
