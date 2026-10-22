package in.gullak.profile;

import in.gullak.common.money.Money;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/** Every field optional; a null field keeps its current value. */
public record FixedCostPatch(
    @Size(min = 1, max = 60) @Pattern(regexp = ".*\\S.*", message = "must not be blank") String name,
    @Positive @Max(Money.MAX_AMOUNT_PAISE) Long amountPaise) {}
