package in.gullak.profile;

import in.gullak.common.money.Money;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import java.time.LocalTime;

public record ProfileRequest(
    @NotNull @Positive @Max(Money.MAX_INCOME_PAISE) Long incomePaise,
    @NotNull @PositiveOrZero @Max(Money.MAX_INCOME_PAISE) Long savingsPaise,
    @NotNull PaydayRule paydayRule,
    @Min(1) @Max(28) Integer paydayDay,
    @NotNull Personality personality,
    @NotNull LocalTime morningTime,
    @NotNull LocalTime nightTime,
    @NotNull @Pattern(regexp = "Asia/Kolkata", message = "Only Asia/Kolkata is supported for now") String timezone) {}
