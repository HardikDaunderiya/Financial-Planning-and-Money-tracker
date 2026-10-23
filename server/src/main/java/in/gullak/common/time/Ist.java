package in.gullak.common.time;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/** Every V1 user lives in India; days start and end in Asia/Kolkata. */
public final class Ist {
    public static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");

    private Ist() {}

    public static LocalDate today(Clock clock) {
        return LocalDate.ofInstant(clock.instant(), ZONE);
    }

    public static Instant startOf(LocalDate date) {
        return date.atStartOfDay(ZONE).toInstant();
    }
}
