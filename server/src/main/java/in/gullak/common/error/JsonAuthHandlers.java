package in.gullak.common.error;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Locale;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

/** Writes 401 and 403 responses from the security filters in the standard error shape. */
@Component
public class JsonAuthHandlers implements AuthenticationEntryPoint, AccessDeniedHandler {

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException ex)
            throws IOException {
        String detail = ex.getMessage() == null ? "" : ex.getMessage().toLowerCase(Locale.ROOT);
        if (detail.contains("expired")) {
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

    private static void write(HttpServletResponse response, int status, ErrorCode code, String message)
            throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"code\":\"" + code.name() + "\",\"message\":\"" + message + "\"}");
    }
}
