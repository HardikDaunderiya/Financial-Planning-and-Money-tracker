package in.gullak.profile;

import in.gullak.common.money.Money;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record FixedCostRequest(
    @NotBlank @Size(max = 60) String name,
    @NotNull @Positive @Max(Money.MAX_AMOUNT_PAISE) Long amountPaise) {}
