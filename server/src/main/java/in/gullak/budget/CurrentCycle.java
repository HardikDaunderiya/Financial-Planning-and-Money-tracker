package in.gullak.budget;

import java.time.LocalDate;
import java.util.UUID;

/**
 * The cycle a request is working in. {@code poolOverridePaise} is set only when the user answered "money left"
 * in their first cycle. {@code budgetFrom} is set only on a first cycle created mid-cycle: the day budgeting
 * started (null means the cycle's own first day). {@code first} is true when no earlier cycle exists.
 */
public record CurrentCycle(UUID id, Cycle cycle, Long poolOverridePaise, LocalDate budgetFrom, boolean first) {}
