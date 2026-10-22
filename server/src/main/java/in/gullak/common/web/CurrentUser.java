package in.gullak.common.web;

import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

public final class CurrentUser {
    private CurrentUser() {}

    /** The only source of a user id on the server. */
    public static UUID id(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
