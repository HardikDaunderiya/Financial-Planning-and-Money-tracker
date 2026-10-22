package in.gullak.auth;

import in.gullak.common.error.AuthException;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.GullakException;
import in.gullak.common.log.Events;
import in.gullak.common.web.RateLimiter;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OtpService {
    static final int MAX_ATTEMPTS = 5;
    static final int MAX_DAILY_FAILURES = 10;
    private static final String INVALID = "That code didn't work. Check it or request a new one.";
    private static final Logger log = LoggerFactory.getLogger(OtpService.class);
    private static final Duration WINDOW = Duration.ofMinutes(10);

    private final OtpCodeRepository codes;
    private final UserRepository users;
    private final OtpMailer mailer;
    private final OtpHasher hasher;
    private final RateLimiter limiter;
    private final AuthProperties props;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    OtpService(OtpCodeRepository codes, UserRepository users, OtpMailer mailer, OtpHasher hasher,
               RateLimiter limiter, AuthProperties props, Clock clock) {
        this.codes = codes;
        this.users = users;
        this.mailer = mailer;
        this.hasher = hasher;
        this.limiter = limiter;
        this.props = props;
        this.clock = clock;
    }

    @Transactional
    public void request(String rawEmail, String ip) {
        String email = Emails.normalize(rawEmail);
        limiter.check("otp-request-ip:" + ip, 30, WINDOW);
        limiter.check("otp-request-email:" + email, 5, WINDOW);
        String code = String.format("%06d", random.nextInt(1_000_000));
        Instant now = clock.instant();
        codes.lockEmail(email);
        codes.retireLiveCodes(email, now);
        codes.save(new OtpCodeEntity(email, hasher.hash(email, code), now, now.plus(props.otpTtl())));
        mailer.sendOtp(email, code);
        log.info(Events.AUTH_OTP_REQUESTED);
    }

    @Transactional(noRollbackFor = GullakException.class)
    public UUID verify(String rawEmail, String code, String ip) {
        String email = Emails.normalize(rawEmail);
        limiter.check("otp-verify-ip:" + ip, 30, WINDOW);
        OtpCodeEntity otp = codes.findFirstByEmailAndConsumedAtIsNull(email)
            .orElseThrow(() -> new AuthException(ErrorCode.OTP_INVALID, INVALID));

        Instant now = clock.instant();
        // Counted in the database so restarts and extra instances cannot reset it. The row lock above
        // serialises guesses on the live code, and retired codes no longer change.
        if (codes.failedAttemptsSince(email, now.minus(Duration.ofHours(24))) >= MAX_DAILY_FAILURES) {
            throw new AuthException(ErrorCode.OTP_LOCKED, "Too many tries today. Try again tomorrow.");
        }

        if (otp.getAttempts() >= MAX_ATTEMPTS) {
            throw new AuthException(ErrorCode.OTP_LOCKED, "Too many tries. Request a new code.");
        }
        if (!now.isBefore(otp.getExpiresAt())) {
            throw new AuthException(ErrorCode.OTP_EXPIRED, "That code has expired. Request a new one.");
        }
        if (!hasher.matches(email, code, otp.getCodeHash())) {
            otp.recordFailedAttempt();
            throw new AuthException(ErrorCode.OTP_INVALID, INVALID);
        }
        otp.consume(now);
        users.insertIfAbsent(UUID.randomUUID(), email);
        UUID userId = users.findIdByEmail(email)
            .orElseThrow(() -> new IllegalStateException("user row missing right after insert"));
        log.info("{} user={}", Events.AUTH_OTP_VERIFIED, userId);
        return userId;
    }
}
