package in.gullak.budget;

import in.gullak.common.db.Db;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Read-only totals over the transactions table for the budget. Plan 3 adds refunds and spread spends. */
@Repository
class SpendTotalsRepository {
    private final JdbcClient jdbc;

    SpendTotalsRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    long spent(UUID userId, Instant fromInclusive, Instant toExclusive) {
        return jdbc.sql("""
                select coalesce(sum(amount_paise), 0) from transactions
                where user_id = ? and direction = 'debit' and counts_in_budget and not spread_over_cycle
                  and deleted_at is null and occurred_at >= ? and occurred_at < ?
                """)
            .params(userId, Db.ts(fromInclusive), Db.ts(toExclusive))
            .query(Long.class)
            .single();
    }
}
