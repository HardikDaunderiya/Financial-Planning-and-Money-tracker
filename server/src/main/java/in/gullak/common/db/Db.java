package in.gullak.common.db;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

public final class Db {
    private Db() {}

    /** For JdbcClient aggregate queries: drivers bind OffsetDateTime reliably; Instant is not supported everywhere. */
    public static OffsetDateTime ts(Instant instant) {
        return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
