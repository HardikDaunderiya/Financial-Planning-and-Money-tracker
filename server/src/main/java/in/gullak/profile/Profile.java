package in.gullak.profile;

import java.time.LocalTime;
import java.util.UUID;

public record Profile(
    UUID userId,
    long incomePaise,
    long savingsPaise,
    PaydayRule paydayRule,
    Integer paydayDay,
    Personality personality,
    LocalTime morningTime,
    LocalTime nightTime,
    String timezone) {}
