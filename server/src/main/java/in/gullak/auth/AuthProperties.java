package in.gullak.auth;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("gullak.auth")
public record AuthProperties(
    @NotNull @Size(min = 32) String jwtSecret,
    @NotNull @Size(min = 32) String otpPepper,
    @NotNull Duration accessTtl,
    @NotNull Duration refreshTtl,
    @NotNull Duration otpTtl,
    @Positive int verifyEmailLimit,
    @NotNull Duration verifyEmailWindow) {}
