package in.gullak.budget;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class TodayApiTest extends ApiTest {
    @Autowired CycleRepository cycleRepository;
    @Autowired PlatformTransactionManager txManager;
    // 23 Oct 2026, 09:12 IST and 13:00 IST
    static final Instant COFFEE = Instant.parse("2026-10-23T03:42:00Z");
    static final Instant ZEPTO = Instant.parse("2026-10-23T07:30:00Z");
    static final Instant EARLIER_THIS_CYCLE = Instant.parse("2026-10-10T06:00:00Z");

    @Test
    void exampleDay() throws Exception { // API-TDY-01
        TestUser u = exampleUser();
        seedSpend(u, 966_000, EARLIER_THIS_CYCLE);
        seedSpend(u, 15_000, COFFEE);
        seedSpend(u, 3_000, ZEPTO);
        today(u)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.date").value("2026-10-23"))
            .andExpect(jsonPath("$.budgetPaise").value(59_300))
            .andExpect(jsonPath("$.spentPaise").value(18_000))
            .andExpect(jsonPath("$.leftPaise").value(41_300))
            .andExpect(jsonPath("$.overPaise").value(0))
            .andExpect(jsonPath("$.mood").value("HAPPY"))
            .andExpect(jsonPath("$.line").value("₹413 left for today. Nice and steady."))
            .andExpect(jsonPath("$.daysLeft").value(9))
            .andExpect(jsonPath("$.cycleStart").value("2026-10-01"))
            .andExpect(jsonPath("$.cycleEnd").value("2026-10-31"));
    }

    @Test
    void nervous() throws Exception { // API-TDY-02
        TestUser u = exampleUser();
        seedSpend(u, 966_000, EARLIER_THIS_CYCLE);
        seedSpend(u, 50_500, COFFEE);
        today(u).andExpect(jsonPath("$.mood").value("NERVOUS"));
    }

    @Test
    void fainted() throws Exception { // API-TDY-03
        TestUser u = exampleUser();
        seedSpend(u, 966_000, EARLIER_THIS_CYCLE);
        seedSpend(u, 72_000, COFFEE);
        today(u)
            .andExpect(jsonPath("$.mood").value("FAINTED"))
            .andExpect(jsonPath("$.overPaise").value(12_700))
            .andExpect(jsonPath("$.leftPaise").value(0));
    }

    @Test
    void poolNegative() throws Exception { // API-TDY-06
        TestUser u = exampleUser();
        seedSpend(u, 1_540_000, EARLIER_THIS_CYCLE);
        today(u)
            .andExpect(jsonPath("$.budgetPaise").value(0))
            .andExpect(jsonPath("$.poolOverPaise").value(40_000))
            .andExpect(jsonPath("$.mood").value("FAINTED"));
    }

    @Test
    void personalityChangesTheLine() throws Exception { // API-TDY-07
        TestUser u = exampleUser();
        putProfile(u, EXAMPLE_PROFILE.replace("CHILL", "SAVAGE"));
        today(u).andExpect(jsonPath("$.line").value("₹1,666 left. Hide it before Swiggy smells it."));
    }

    @Test
    void firstCallCreatesTheCycle() throws Exception { // API-TDY-08
        TestUser u = exampleUser();
        today(u).andExpect(status().isOk());
        assertThat(cycleCount(u)).isEqualTo(1);
        today(u);
        assertThat(cycleCount(u)).isEqualTo(1);
    }

    @Test
    void beforeSetup() throws Exception { // API-PRO-11
        TestUser u = signIn();
        today(u)
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("SETUP_INCOMPLETE"));
    }

    @Test
    void fixedCostEditAppliesAtOnce() throws Exception { // BUD-16
        TestUser u = exampleUser();
        String rentId = JsonPath.read(mvc.perform(get("/api/v1/me/fixed-costs").with(auth(u)))
            .andReturn().getResponse().getContentAsString(), "$[0].id");
        today(u).andExpect(jsonPath("$.budgetPaise").value(166_600));
        mvc.perform(patch("/api/v1/me/fixed-costs/" + rentId).with(auth(u))
                .contentType(MediaType.APPLICATION_JSON).content("{\"amountPaise\":1200000}"))
            .andExpect(status().isOk());
        today(u).andExpect(jsonPath("$.budgetPaise").value(144_400));
    }

    @Test
    void incomeEditAppliesAtOnce() throws Exception { // BUD-17
        TestUser u = exampleUser();
        putProfile(u, EXAMPLE_PROFILE.replace("5000000", "5500000")).andExpect(status().isOk());
        today(u).andExpect(jsonPath("$.budgetPaise").value(222_200));
    }

    @Test
    void paydayChangeKeepsTheCurrentCycleThenBridges() throws Exception { // BUD-18, API-PRO-10
        TestUser u = exampleUser();
        today(u).andExpect(jsonPath("$.cycleEnd").value("2026-10-31"));
        putProfile(u, EXAMPLE_PROFILE.replace("\"paydayDay\":1", "\"paydayDay\":7")).andExpect(status().isOk());
        today(u).andExpect(jsonPath("$.cycleStart").value("2026-10-01")).andExpect(jsonPath("$.cycleEnd").value("2026-10-31"));

        u = at(u, "2026-11-02T06:00:00Z");
        today(u).andExpect(jsonPath("$.cycleStart").value("2026-11-01")).andExpect(jsonPath("$.cycleEnd").value("2026-11-06"));

        u = at(u, "2026-11-08T06:00:00Z");
        today(u).andExpect(jsonPath("$.cycleStart").value("2026-11-07")).andExpect(jsonPath("$.cycleEnd").value("2026-12-06"));
    }

    @Test
    void midnightInIndiaNotUtc() throws Exception { // BUD-28
        TestUser u = exampleUser();
        seedSpend(u, 10_000, Instant.parse("2026-10-23T18:29:59Z")); // 23:59:59 IST, 23 Oct
        seedSpend(u, 20_000, Instant.parse("2026-10-23T18:30:01Z")); // 00:00:01 IST, 24 Oct
        u = at(u, "2026-10-23T18:00:00Z");
        today(u).andExpect(jsonPath("$.spentPaise").value(10_000));
        u = at(u, "2026-10-23T19:00:00Z");
        today(u).andExpect(jsonPath("$.date").value("2026-10-24")).andExpect(jsonPath("$.spentPaise").value(20_000));
    }

    @Test
    void deletedAndNonBudgetRowsAreIgnored() throws Exception {
        TestUser u = exampleUser();
        seedSpend(u, 15_000, COFFEE);
        jdbc.sql("update transactions set deleted_at = now() where user_id = ?").param(u.id()).update();
        seedSpend(u, 1_000_000, COFFEE);
        jdbc.sql("update transactions set counts_in_budget = false where user_id = ? and amount_paise = 1000000")
            .param(u.id()).update();
        today(u).andExpect(jsonPath("$.spentPaise").value(0));
    }

    @Test
    void concurrentFirstRequestsCreateOneCycle() throws Exception { // Review focus, I-1
        TestUser u = exampleUser();
        ExecutorService pool = Executors.newFixedThreadPool(4);
        try {
            CountDownLatch start = new CountDownLatch(1);
            Callable<Integer> call = () -> {
                start.await();
                return today(u).andReturn().getResponse().getStatus();
            };
            List<java.util.concurrent.Future<Integer>> futures = List.of(call, call, call, call).stream()
                .map(pool::submit).toList();
            start.countDown();
            List<Integer> statuses = futures.stream()
                .map(f -> {
                    try {
                        return f.get();
                    } catch (InterruptedException | java.util.concurrent.ExecutionException e) {
                        throw new IllegalStateException(e);
                    }
                })
                .toList();
            assertThat(statuses).containsOnly(200);
            assertThat(cycleCount(u)).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void overlappingCycleInsertIsIgnoredAndHomeStillLoads() throws Exception { // I-1
        TestUser u = exampleUser();
        today(u).andExpect(status().isOk()).andExpect(jsonPath("$.cycleStart").value("2026-10-01"));
        // A racing request that read a different payday would insert 15 Oct - 14 Nov.
        Integer inserted = new TransactionTemplate(txManager).execute(tx -> cycleRepository.insertIfAbsent(
            UUID.randomUUID(), u.id(), LocalDate.of(2026, 10, 15), LocalDate.of(2026, 11, 14)));
        assertThat(inserted).isZero();
        assertThat(cycleCount(u)).isEqualTo(1);
        today(u).andExpect(status().isOk())
            .andExpect(jsonPath("$.cycleStart").value("2026-10-01"))
            .andExpect(jsonPath("$.cycleEnd").value("2026-10-31"));
    }

    @Test
    void databaseRejectsOverlappingCyclesForOneUserOnly() throws Exception { // I-1
        TestUser u = exampleUser();
        TestUser other = exampleUser();
        today(u).andExpect(status().isOk());
        assertThatThrownBy(() -> insertCycle(u, "2026-10-31", "2026-11-30"))
            .isInstanceOf(DataIntegrityViolationException.class);
        insertCycle(u, "2026-11-01", "2026-11-30"); // adjacent, not overlapping
        insertCycle(other, "2026-10-15", "2026-11-14"); // another user's dates are independent
        today(u).andExpect(status().isOk());
    }

    @Test
    void findCoveringPicksTheLatestStartIfTheConstraintEverFails() throws Exception { // I-1 defence in depth
        TestUser u = exampleUser();
        today(u).andExpect(status().isOk());
        new TransactionTemplate(txManager).executeWithoutResult(tx -> {
            // Postgres DDL is transactional: the constraint is back once this rolls back.
            jdbc.sql("alter table cycles drop constraint cycles_no_overlap").update();
            insertCycle(u, "2026-10-15", "2026-11-14");
            assertThat(cycleRepository.findCovering(u.id(), LocalDate.of(2026, 10, 23)))
                .map(CycleEntity::toCycle)
                .contains(new Cycle(LocalDate.of(2026, 10, 15), LocalDate.of(2026, 11, 14)));
            tx.setRollbackOnly();
        });
        assertThat(cycleCount(u)).isEqualTo(1);
    }

    private void insertCycle(TestUser u, String start, String end) {
        jdbc.sql("insert into cycles (id, user_id, start_date, end_date) values (?, ?, ?, ?)")
            .params(UUID.randomUUID(), u.id(), LocalDate.parse(start), LocalDate.parse(end))
            .update();
    }

    @Test
    void anotherUsersSpendsDoNotCount() throws Exception {
        TestUser a = exampleUser();
        TestUser b = exampleUser();
        seedSpend(b, 50_000, COFFEE);
        today(a).andExpect(jsonPath("$.spentPaise").value(0));
    }

    /** Moves the clock and signs the same user in again: access tokens last 15 minutes. */
    private TestUser at(TestUser u, String instant) throws Exception {
        clock.set(Instant.parse(instant));
        return signIn(u.email());
    }

    private ResultActions today(TestUser u) throws Exception {
        return mvc.perform(get("/api/v1/budget/today").with(auth(u)));
    }

    private int cycleCount(TestUser u) {
        return jdbc.sql("select count(*) from cycles where user_id = ?").param(u.id()).query(Integer.class).single();
    }
}
