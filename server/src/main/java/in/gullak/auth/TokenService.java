package in.gullak.auth;

import in.gullak.common.error.AuthException;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.GullakException;
import in.gullak.common.log.Events;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TokenService {
    private static final Logger log = LoggerFactory.getLogger(TokenService.class);

    private final JwtEncoder encoder;
    private final RefreshTokenRepository refreshTokens;
    private final AuthProperties props;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    TokenService(JwtEncoder encoder, RefreshTokenRepository refreshTokens, AuthProperties props, Clock clock) {
        this.encoder = encoder;
        this.refreshTokens = refreshTokens;
        this.props = props;
        this.clock = clock;
    }

    @Transactional
    public TokenPair issue(UUID userId, String device) {
        return issueInFamily(userId, device, UUID.randomUUID());
    }

    @Transactional(noRollbackFor = GullakException.class)
    public TokenPair refresh(String refreshToken) {
        RefreshTokenEntity row = refreshTokens.findByTokenHash(sha256(refreshToken))
            .orElseThrow(() -> new AuthException(ErrorCode.UNAUTHENTICATED, "Sign in to continue"));
        UUID userId = row.getUserId();
        UUID familyId = row.getFamilyId();
        String device = row.getDevice();
        Instant now = clock.instant();
        if (row.isSpent()) {
            revokeAllFor(userId, "reuse");
            throw new AuthException(ErrorCode.TOKEN_REUSED, "Please sign in again");
        }
        if (!now.isBefore(row.getExpiresAt())) {
            throw new AuthException(ErrorCode.TOKEN_EXPIRED, "Your session has expired");
        }
        if (refreshTokens.claim(row.getId(), now) == 0) {
            revokeAllFor(userId, "race");
            throw new AuthException(ErrorCode.TOKEN_REUSED, "Please sign in again");
        }
        return issueInFamily(userId, device, familyId);
    }

    @Transactional
    public void logout(String refreshToken) {
        refreshTokens.findByTokenHash(sha256(refreshToken)).ifPresent(row -> {
            UUID userId = row.getUserId();
            refreshTokens.revokeFamily(row.getFamilyId(), clock.instant());
            log.info("{} user={} reason=logout", Events.AUTH_SESSION_REVOKED, userId);
        });
    }

    private TokenPair issueInFamily(UUID userId, String device, UUID familyId) {
        Instant now = clock.instant();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer(JwtConfig.ISSUER)
            .subject(userId.toString())
            .issuedAt(now)
            .expiresAt(now.plus(props.accessTtl()))
            .build();
        String access = encoder.encode(
            JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();

        byte[] raw = new byte[32];
        random.nextBytes(raw);
        String refresh = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        refreshTokens.save(new RefreshTokenEntity(userId, sha256(refresh), familyId, device, now.plus(props.refreshTtl())));
        return new TokenPair(access, refresh, props.accessTtl().toSeconds());
    }

    private void revokeAllFor(UUID userId, String reason) {
        refreshTokens.revokeAllForUser(userId, clock.instant());
        log.warn("{} user={} reason={}", Events.AUTH_SESSION_REVOKED, userId, reason);
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
