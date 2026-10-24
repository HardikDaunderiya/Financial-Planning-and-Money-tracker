package in.gullak.budget;

import in.gullak.common.money.Money;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

public record FirstCycleRequest(@NotNull @PositiveOrZero @Max(Money.MAX_INCOME_PAISE) Long moneyLeftPaise) {}
