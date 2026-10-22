package in.gullak.auth;

import in.gullak.common.web.SingleLineText;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
class AuthController {
    record OtpRequest(@NotBlank @Email @Size(max = 254) String email) {}

    record OtpVerify(
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Pattern(regexp = "\\d{6}") String code,
        @Size(max = 60) @SingleLineText String device) {}

    record RefreshRequest(@NotBlank @Size(max = 100) String refreshToken) {}

    private final OtpService otp;
    private final TokenService tokens;

    AuthController(OtpService otp, TokenService tokens) {
        this.otp = otp;
        this.tokens = tokens;
    }

    @PostMapping("/otp/request")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void request(@Valid @RequestBody OtpRequest body, HttpServletRequest http) {
        otp.request(body.email(), http.getRemoteAddr());
    }

    @PostMapping("/otp/verify")
    TokenPair verify(@Valid @RequestBody OtpVerify body, HttpServletRequest http) {
        return tokens.issue(otp.verify(body.email(), body.code(), http.getRemoteAddr()), body.device());
    }

    @PostMapping("/refresh")
    TokenPair refresh(@Valid @RequestBody RefreshRequest body) {
        return tokens.refresh(body.refreshToken());
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void logout(@Valid @RequestBody RefreshRequest body) {
        tokens.logout(body.refreshToken());
    }
}
