package in.gullak.budget;

import java.util.UUID;

/**
 * The cycle a request is working in. {@code poolOverridePaise} is set only on a pro-rated or user-stated
 * first cycle; {@code first} is true when no earlier cycle exists for the user.
 */
public record CurrentCycle(UUID id, Cycle cycle, Long poolOverridePaise, boolean first) {}
