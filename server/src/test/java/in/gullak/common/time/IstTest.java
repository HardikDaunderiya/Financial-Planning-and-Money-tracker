package in.gullak.common.time;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class IstTest {

    @Test
    void todayIsTheIndianDateNotTheUtcOne() {
        Clock lateEvening = Clock.fixed(Instant.parse("2026-10-23T19:00:00Z"), ZoneOffset.UTC); // 00:30 IST
        assertThat(Ist.today(lateEvening)).isEqualTo(LocalDate.of(2026, 10, 24));
    }

    @Test
    void lastSecondBeforeIndianMidnightIsStillToday() {
        Clock beforeMidnight = Clock.fixed(Instant.parse("2026-10-23T18:29:59Z"), ZoneOffset.UTC); // 23:59:59 IST
        assertThat(Ist.today(beforeMidnight)).isEqualTo(LocalDate.of(2026, 10, 23));
    }

    @Test
    void dayStartsAtIndianMidnight() {
        assertThat(Ist.startOf(LocalDate.of(2026, 10, 24))).isEqualTo(Instant.parse("2026-10-23T18:30:00Z"));
    }
}
