package in.gullak.common.error;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

/** Writes 401 and 403 responses from the security filters in the standard error shape. */
@Component
public class JsonAuthHandlers implements AuthenticationEntryPoint, AccessDeniedHandler {
    /** OAuth2 error code our JWT validator emits when {@code exp} has passed. */
    public static final String TOKEN_EXPIRED_ERROR = "token_expired";
    private static final int MAX_CAUSE_DEPTH = 10;

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException ex)
            throws IOException {
        if (isExpiredToken(ex)) {
            write(response, 401, ErrorCode.TOKEN_EXPIRED, "Your session has expired");
        } else {
            write(response, 401, ErrorCode.UNAUTHENTICATED, "Sign in to continue");
        }
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException ex)
            throws IOException {
        write(response, 403, ErrorCode.FORBIDDEN, "Not allowed");
    }

    /** True only when the JWT validator reported {@link #TOKEN_EXPIRED_ERROR}; message text is never consulted. */
    private static boolean isExpiredToken(AuthenticationException ex) {
        Throwable t = ex;
        for (int depth = 0; t != null && depth < MAX_CAUSE_DEPTH; depth++, t = t.getCause()) {
            if (t instanceof JwtValidationException invalid
                    && invalid.getErrors().stream().anyMatch(e -> TOKEN_EXPIRED_ERROR.equals(e.getErrorCode()))) {
                return true;
            }
        }
        return false;
    }

    private static void write(HttpServletResponse response, int status, ErrorCode code, String message)
            throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"code\":\"" + code.name() + "\",\"message\":\"" + message + "\"}");
    }
}
