package in.gullak.auth;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface OtpCodeRepository extends JpaRepository<OtpCodeEntity, UUID> {

    /** At most one live code exists per email; the row lock serialises concurrent guesses. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<OtpCodeEntity> findFirstByEmailAndConsumedAtIsNull(String email);

    /** A new request retires every earlier code, so only the newest one can be used. */
    @Modifying
    @Query("update OtpCodeEntity o set o.consumedAt = :now where o.email = :email and o.consumedAt is null")
    int retireLiveCodes(@Param("email") String email, @Param("now") Instant now);
}
