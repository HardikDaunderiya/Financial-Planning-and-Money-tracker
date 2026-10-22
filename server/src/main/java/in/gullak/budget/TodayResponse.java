package in.gullak.budget;

import java.time.LocalDate;

public record TodayResponse(
    LocalDate date,
    long budgetPaise,
    long spentPaise,
    long leftPaise,
    long overPaise,
    long poolOverPaise,
    Mood mood,
    String line,
    int daysLeft,
    LocalDate cycleStart,
    LocalDate cycleEnd) {}
