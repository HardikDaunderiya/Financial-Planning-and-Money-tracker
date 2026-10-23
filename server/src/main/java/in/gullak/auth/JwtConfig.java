package in.gullak.auth;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import in.gullak.common.error.JsonAuthHandlers;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

@Configuration
class JwtConfig {
    static final String ISSUER = "gullak";

    @Bean
    SecretKey jwtKey(AuthProperties props) {
        return new SecretKeySpec(props.jwtSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    @Bean
    JwtEncoder jwtEncoder(SecretKey jwtKey) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(jwtKey));
    }

    /** Accepts only HS256 with our key, so {@code alg: none} and foreign signatures fail before claims are read. */
    @Bean
    JwtDecoder jwtDecoder(SecretKey jwtKey, Clock clock) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(jwtKey).macAlgorithm(MacAlgorithm.HS256).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
            new ExpiryValidator(clock), new JwtIssuerValidator(ISSUER)));
        return decoder;
    }

    /**
     * Zero-skew time check on the injected clock. A passed {@code exp} is reported with
     * {@link JsonAuthHandlers#TOKEN_EXPIRED_ERROR} so the entry point can tell expiry apart by type.
     * A missing {@code exp} or a future {@code nbf} is an invalid token.
     */
    static final class ExpiryValidator implements OAuth2TokenValidator<Jwt> {
        private final Clock clock;

        ExpiryValidator(Clock clock) {
            this.clock = clock;
        }

        @Override
        public OAuth2TokenValidatorResult validate(Jwt jwt) {
            Instant now = clock.instant();
            Instant expiresAt = jwt.getExpiresAt();
            if (expiresAt == null) {
                return OAuth2TokenValidatorResult.failure(
                    new OAuth2Error(OAuth2ErrorCodes.INVALID_TOKEN, "Jwt has no exp claim", null));
            }
            if (!now.isBefore(expiresAt)) {
                return OAuth2TokenValidatorResult.failure(
                    new OAuth2Error(JsonAuthHandlers.TOKEN_EXPIRED_ERROR, "Jwt has expired", null));
            }
            Instant notBefore = jwt.getNotBefore();
            if (notBefore != null && now.isBefore(notBefore)) {
                return OAuth2TokenValidatorResult.failure(
                    new OAuth2Error(OAuth2ErrorCodes.INVALID_TOKEN, "Jwt is not yet valid", null));
            }
            return OAuth2TokenValidatorResult.success();
        }
    }
}
