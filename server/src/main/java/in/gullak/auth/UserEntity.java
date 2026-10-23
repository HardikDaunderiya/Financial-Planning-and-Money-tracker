package in.gullak.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

/** Read-only here: rows are created by {@link UserRepository#insertIfAbsent} so concurrent sign-ins never clash. */
@Entity
@Table(name = "users")
class UserEntity {
    @Id
    private UUID id;

    @Column(nullable = false, unique = true, length = 254)
    private String email;

    @Column(nullable = false, length = 16)
    private String status;

    protected UserEntity() {}

    UUID getId() { return id; }
    String getStatus() { return status; }
}
