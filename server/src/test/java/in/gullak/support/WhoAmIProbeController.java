package in.gullak.support;

import in.gullak.common.web.CurrentUser;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class WhoAmIProbeController {
    @GetMapping("/test-probe/whoami")
    @PostMapping("/test-probe/whoami")
    Map<String, String> whoami(@AuthenticationPrincipal Jwt jwt) {
        return Map.of("userId", CurrentUser.id(jwt).toString());
    }
}
