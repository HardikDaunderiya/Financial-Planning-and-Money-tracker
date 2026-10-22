package in.gullak.common.error;

import static org.assertj.core.api.Assertions.assertThat;

import com.jayway.jsonpath.JsonPath;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;

class JsonAuthHandlersTest {
    private final JsonAuthHandlers handlers = new JsonAuthHandlers();

    @Test
    void expiredTokenErrorInTheCauseChainIsTokenExpired() throws Exception {
        JwtValidationException cause = new JwtValidationException("Jwt is no longer valid",
            List.of(new OAuth2Error(JsonAuthHandlers.TOKEN_EXPIRED_ERROR)));
        MockHttpServletResponse response = new MockHttpServletResponse();

        handlers.commence(new MockHttpServletRequest(), response, new InvalidBearerTokenException("bad token", cause));

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(code(response)).isEqualTo("TOKEN_EXPIRED");
    }

    @Test
    void otherValidationErrorsAreUnauthenticated() throws Exception {
        JwtValidationException cause = new JwtValidationException("The iss claim is not valid",
            List.of(new OAuth2Error("invalid_token")));
        MockHttpServletResponse response = new MockHttpServletResponse();

        handlers.commence(new MockHttpServletRequest(), response, new InvalidBearerTokenException("bad token", cause));

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(code(response)).isEqualTo("UNAUTHENTICATED");
    }

    @Test
    void theWordExpiredInAMessageIsNotEnough() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        handlers.commence(new MockHttpServletRequest(), response,
            new BadCredentialsException("Jwt expired at 2026-01-01T00:00:00Z"));

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(code(response)).isEqualTo("UNAUTHENTICATED");
    }

    @Test
    void accessDeniedIsForbidden() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        handlers.handle(new MockHttpServletRequest(), response, new AccessDeniedException("nope"));

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(code(response)).isEqualTo("FORBIDDEN");
    }

    private static String code(MockHttpServletResponse response) throws Exception {
        return JsonPath.read(response.getContentAsString(), "$.code");
    }
}
