package in.gullak.profile;

import in.gullak.common.web.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/me/profile")
class ProfileController {
    private final ProfileService profiles;

    ProfileController(ProfileService profiles) {
        this.profiles = profiles;
    }

    @GetMapping
    ProfileResponse get(@AuthenticationPrincipal Jwt jwt) {
        return ProfileResponse.from(profiles.get(CurrentUser.id(jwt)));
    }

    @PutMapping
    ProfileResponse put(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ProfileRequest body) {
        return ProfileResponse.from(profiles.put(CurrentUser.id(jwt), body));
    }
}
