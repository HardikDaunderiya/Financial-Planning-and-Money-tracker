package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.common.error.JsonAuthHandlers;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

class ExpiryValidatorTest {
    private static final Instant NOW = Instant.parse("2026-10-23T10:00:00Z");
    private final JwtConfig.ExpiryValidator validator =
        new JwtConfig.ExpiryValidator(Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void missingExpIsInvalid() {
        assertThat(codes(validator.validate(jwt().build()))).containsExactly(OAuth2ErrorCodes.INVALID_TOKEN);
    }

    @Test
    void futureNotBeforeIsInvalid() {
        Jwt token = jwt().expiresAt(NOW.plus(Duration.ofMinutes(15))).notBefore(NOW.plusSeconds(1)).build();
        assertThat(codes(validator.validate(token))).containsExactly(OAuth2ErrorCodes.INVALID_TOKEN);
    }

    @Test
    void nowEqualToExpIsExpired() {
        assertThat(codes(validator.validate(jwt().expiresAt(NOW).build())))
            .containsExactly(JsonAuthHandlers.TOKEN_EXPIRED_ERROR);
    }

    @Test
    void oneSecondBeforeExpIsValid() {
        assertThat(validator.validate(jwt().expiresAt(NOW.plusSeconds(1)).build()).hasErrors()).isFalse();
    }

    private static Jwt.Builder jwt() {
        return Jwt.withTokenValue("t").header("alg", "HS256").subject("00000000-0000-0000-0000-000000000001");
    }

    private static java.util.List<String> codes(OAuth2TokenValidatorResult result) {
        return result.getErrors().stream().map(OAuth2Error::getErrorCode).toList();
    }
}
