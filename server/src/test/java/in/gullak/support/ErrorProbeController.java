package in.gullak.support;

import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.NotFoundException;
import in.gullak.common.error.UnprocessableException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/test-probe")
class ErrorProbeController {
    record ProbeBody(@NotBlank String name, @Positive long amountPaise) {}

    @GetMapping("/ok")
    Map<String, String> ok() {
        return Map.of("ok", "yes");
    }

    @PostMapping("/validate")
    Map<String, String> validate(@Valid @RequestBody ProbeBody body) {
        return Map.of("ok", "yes");
    }

    @GetMapping("/not-found")
    void notFound() {
        throw new NotFoundException("Thing");
    }

    @GetMapping("/not-possible")
    void notPossible() {
        throw new UnprocessableException(ErrorCode.NOT_POSSIBLE, "That plan leaves nothing to spend");
    }

    @GetMapping("/boom")
    void boom() {
        throw new IllegalStateException("secret internal detail");
    }
}
