package in.gullak.budget;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

public record Cycle(LocalDate start, LocalDate end) {
    public int days() {
        return (int) ChronoUnit.DAYS.between(start, end) + 1;
    }
}
