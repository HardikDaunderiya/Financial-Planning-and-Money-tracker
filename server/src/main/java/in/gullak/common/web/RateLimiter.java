package in.gullak.common.web;

import in.gullak.common.error.RateLimitedException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Component;

/**
 * Fixed-window limiter in memory. Correct for one server instance; Plan 9 revisits it if we run more.
 */
@Component
public class RateLimiter {
    private record Window(Instant start, Duration length, int count) {}

    private final Clock clock;
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();
    private final AtomicInteger calls = new AtomicInteger();

    public RateLimiter(Clock clock) {
        this.clock = clock;
    }

    public void check(String key, int limit, Duration window) {
        Instant now = clock.instant();
        Window w = windows.compute(key, (k, old) ->
            old == null || !now.isBefore(old.start().plus(old.length()))
                ? new Window(now, window, 1)
                : new Window(old.start(), old.length(), old.count() + 1));
        if (calls.incrementAndGet() % 1000 == 0) {
            windows.entrySet().removeIf(e -> !now.isBefore(e.getValue().start().plus(e.getValue().length())));
        }
        if (w.count() > limit) {
            throw new RateLimitedException();
        }
    }
}
