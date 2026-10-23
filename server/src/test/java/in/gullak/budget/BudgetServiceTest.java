package in.gullak.budget;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

class BudgetServiceTest {

    /**
     * M-3: profile, fixed-cost total, cycle and both spend sums must come from one snapshot. today() opens a
     * cycle on first use, so it is a read-write transaction, not readOnly.
     */
    @Test
    void todayReadsEverythingInOneReadWriteTransaction() throws Exception {
        Transactional tx = BudgetService.class.getMethod("today", UUID.class).getAnnotation(Transactional.class);
        assertThat(tx).as("@Transactional on BudgetService.today").isNotNull();
        assertThat(tx.readOnly()).isFalse();
    }
}
