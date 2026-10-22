package in.gullak.common.web;

import in.gullak.common.error.BodyTooLargeException;
import in.gullak.common.error.ErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Refuses request bodies over {@code gullak.http.max-body-bytes} with 413, before security and parsing.
 * A declared Content-Length is checked up front; a chunked body fails once it passes the limit.
 * Plan 4 statement uploads need a larger limit on their own route.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class BodyLimitFilter extends OncePerRequestFilter {
    private final long maxBytes;

    BodyLimitFilter(@Value("${gullak.http.max-body-bytes}") long maxBytes) {
        this.maxBytes = maxBytes;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getContentLengthLong() > maxBytes) {
            response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            response.setContentType("application/json");
            response.setCharacterEncoding("UTF-8");
            response.getWriter().write("{\"code\":\"" + ErrorCode.TOO_LARGE.name()
                + "\",\"message\":\"That request is too big\"}");
            return;
        }
        chain.doFilter(new Limited(request, maxBytes), response);
    }

    private static final class Limited extends HttpServletRequestWrapper {
        private final long max;
        private ServletInputStream stream;

        Limited(HttpServletRequest request, long max) {
            super(request);
            this.max = max;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (stream == null) {
                stream = new Counting(super.getInputStream(), max);
            }
            return stream;
        }
    }

    private static final class Counting extends ServletInputStream {
        private final ServletInputStream in;
        private final long max;
        private long count;

        Counting(ServletInputStream in, long max) {
            this.in = in;
            this.max = max;
        }

        private void add(long n) throws IOException {
            if (n > 0) {
                count += n;
                if (count > max) {
                    throw new BodyTooLargeException();
                }
            }
        }

        @Override
        public int read() throws IOException {
            int b = in.read();
            add(b < 0 ? 0 : 1);
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            int n = in.read(buf, off, len);
            add(n);
            return n;
        }

        @Override
        public boolean isFinished() {
            return in.isFinished();
        }

        @Override
        public boolean isReady() {
            return in.isReady();
        }

        @Override
        public void setReadListener(ReadListener listener) {
            in.setReadListener(listener);
        }
    }
}
