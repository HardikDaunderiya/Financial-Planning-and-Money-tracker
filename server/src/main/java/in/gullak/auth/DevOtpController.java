package in.gullak.auth;

import in.gullak.common.error.NotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Local development only: returns the last sign-in code the in-memory mailer "sent" to an address, so the
 * app and the Maestro flows can sign in without a real mailbox. Never registered under test or prod
 * (DevOtpApiTest pins the profile). Sits under /api/v1/auth so the public auth matcher covers it.
 */
@RestController
@RequestMapping("/api/v1/auth/dev")
@Profile("local")
class DevOtpController {
    record Body(@NotBlank @Email String email) {}

    record Code(String code) {}

    private final InMemoryOtpMailer mailer;

    DevOtpController(InMemoryOtpMailer mailer) {
        this.mailer = mailer;
    }

    @PostMapping("/otp")
    Code last(@Valid @RequestBody Body body) {
        String code = mailer.lastCodeFor(body.email());
        if (code == null) {
            throw new NotFoundException("Code");
        }
        return new Code(code);
    }
}
