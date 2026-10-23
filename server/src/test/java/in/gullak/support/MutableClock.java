package in.gullak.support;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

public class MutableClock extends Clock {
    public static final Instant DEFAULT = Instant.parse("2026-10-23T08:00:00Z");
    private volatile Instant now = DEFAULT;

    public void set(Instant instant) { this.now = instant; }
    public void advance(Duration duration) { this.now = now.plus(duration); }
    public void reset() { this.now = DEFAULT; }

    @Override public ZoneId getZone() { return ZoneOffset.UTC; }
    @Override public Clock withZone(ZoneId zone) { return Clock.fixed(now, zone); }
    @Override public Instant instant() { return now; }
}
