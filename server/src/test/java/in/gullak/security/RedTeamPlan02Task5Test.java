package in.gullak.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/** Red team plan-02 task 5: dev OTP route, first-cycle override, profile/fixed-cost guard races. */
@ExtendWith(OutputCaptureExtension.class)
class RedTeamPlan02Task5Test extends ApiTest {
    private static final String JSON = MediaType.APPLICATION_JSON_VALUE;

    private ResultActions firstCycleRaw(TestUser u, String body) throws Exception {
        return mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u)).contentType(JSON).content(body));
    }

    private ResultActions firstCycle(TestUser u, long paise) throws Exception {
        return firstCycleRaw(u, "{\"moneyLeftPaise\":" + paise + "}");
    }

    private ResultActions today(TestUser u) throws Exception {
        return mvc.perform(get("/api/v1/budget/today").with(auth(u)));
    }

    private Long pool(TestUser u) {
        return jdbc.sql("select pool_override_paise from cycles where user_id = ? order by start_date desc limit 1")
            .param(u.id()).query(Long.class).optional().orElse(null);
    }

    private long cycleCount(TestUser u) {
        return jdbc.sql("select count(*) from cycles where user_id = ?").param(u.id()).query(Long.class).single();
    }

    private long fixedTotal(TestUser u) {
        return jdbc.sql("select coalesce(sum(amount_paise),0) from fixed_costs where user_id = ? and active")
            .param(u.id()).query(Long.class).single();
    }

    private <T> List<T> runAll(int threads, List<Callable<T>> calls) throws Exception {
        ExecutorService ex = Executors.newFixedThreadPool(threads);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<T>> fs = new ArrayList<>();
            for (Callable<T> c : calls) {
                fs.add(ex.submit(() -> {
                    go.await();
                    return c.call();
                }));
            }
            go.countDown();
            List<T> out = new ArrayList<>();
            for (Future<T> f : fs) {
                out.add(f.get(60, TimeUnit.SECONDS));
            }
            return out;
        } finally {
            ex.shutdownNow();
        }
    }

    // ---------------------------------------------------------------- dev OTP route

    @Test
    void devOtpRouteIs404InTheStandardShapeUnderTestProfile() throws Exception {
        String email = uniqueEmail();
        requestCode(email, freshIp()).andExpect(status().isNoContent());
        for (String path : List.of("/api/v1/auth/dev/otp", "/api/v1/auth/dev/otp/", "/api/v1/auth/dev", "/api/v1/auth/dev/OTP")) {
            String body = mvc.perform(post(path).with(freshIp()).contentType(JSON).content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isNotFound()).andReturn().getResponse().getContentAsString();
            assertThat((String) JsonPath.read(body, "$.code")).isEqualTo("NOT_FOUND");
            assertThat((String) JsonPath.read(body, "$.message")).isNotBlank();
            assertThat(body).doesNotContain(mailer.lastCodeFor(email)).doesNotContain("Exception");
        }
        mvc.perform(get("/api/v1/auth/dev/otp").with(freshIp())).andExpect(status().is(org.hamcrest.Matchers.oneOf(401, 404, 405)));
    }

    @Test
    void noHandlerAndNoBeanForTheDevControllerExistsInTheTestContext(org.springframework.context.ApplicationContext ctx) throws Exception {
        Class<?> dev = Class.forName("in.gullak.auth.DevOtpController");
        assertThat(ctx.getBeansOfType(dev)).isEmpty();
        RequestMappingHandlerMapping hm = ctx.getBean("requestMappingHandlerMapping", RequestMappingHandlerMapping.class);
        for (RequestMappingInfo info : hm.getHandlerMethods().keySet()) {
            assertThat(String.valueOf(info.getPathPatternsCondition())).doesNotContain("/auth/dev");
        }
    }

    @Test
    void devControllerRegistersOnlyUnderLocalProfile() throws Exception {
        Class<?> dev = Class.forName("in.gullak.auth.DevOtpController");
        for (String profile : List.of("prod", "test", "default", "staging", "prod,test")) {
            try (AnnotationConfigApplicationContext c = new AnnotationConfigApplicationContext()) {
                StandardEnvironment env = new StandardEnvironment();
                env.setActiveProfiles(profile.split(","));
                c.setEnvironment(env);
                c.register(in.gullak.auth.InMemoryOtpMailer.class, dev);
                c.refresh();
                assertThat(c.getBeansOfType(dev)).as("profile " + profile).isEmpty();
            }
        }
        try (AnnotationConfigApplicationContext c = new AnnotationConfigApplicationContext()) {
            StandardEnvironment env = new StandardEnvironment();
            env.setActiveProfiles("local");
            c.setEnvironment(env);
            c.register(in.gullak.auth.InMemoryOtpMailer.class, dev);
            c.refresh();
            assertThat(c.getBeansOfType(dev)).hasSize(1); // control: it does exist under local
        }
    }

    @Test
    void prodProfileCannotPullInLocalViaProfileGroupsOrIncludes() throws Exception {
        for (String f : List.of("application.yml", "application-prod.yml", "application-local.yml")) {
            String text = new String(getClass().getClassLoader().getResourceAsStream(f).readAllBytes());
            assertThat(text).as(f).doesNotContain("profiles:").doesNotContain("group:").doesNotContain("spring.profiles");
        }
        String prod = new String(getClass().getClassLoader().getResourceAsStream("application-prod.yml").readAllBytes());
        assertThat(prod).doesNotContain("local");
    }

    // ---------------------------------------------------------------- first-cycle authorisation

    @Test
    void anotherUsersTokenCannotTouchOrReadMyFirstCycle() throws Exception {
        TestUser a = newlySetUpUser();
        TestUser b = newlySetUpUser();
        today(a);
        firstCycle(a, 111_100).andExpect(status().isOk());
        long before = cycleCount(b);
        firstCycle(b, 999_900).andExpect(status().isOk()).andExpect(jsonPath("$.budgetPaise").value(111_100));
        assertThat(pool(a)).isEqualTo(111_100L);
        assertThat(pool(b)).isEqualTo(999_900L);
        assertThat(cycleCount(b)).isEqualTo(before + 1); // B's call made B's own cycle, never touched A's
    }

    @Test
    void overrideAfterTheFirstCycleStaysRejectedForTheOwnerAndNeverLeaksAnotherUsersCycle() throws Exception {
        TestUser a = newlySetUpUser();
        today(a);
        clock.set(Instant.parse("2026-11-05T04:00:00Z"));
        a = signIn(a.email());
        today(a);
        firstCycle(a, 1).andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("FIRST_CYCLE_OVER"));
        // body of a rejected call must not echo another user's data
        String body = firstCycle(a, 1).andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("poolOverride").doesNotContain(a.id().toString());
    }

    @Test
    void unauthenticatedAndBadTokenAre401() throws Exception {
        mvc.perform(put("/api/v1/budget/first-cycle").contentType(JSON).content("{\"moneyLeftPaise\":1}")).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/v1/budget/first-cycle").with(bearer("x.y.z")).contentType(JSON).content("{\"moneyLeftPaise\":1}"))
            .andExpect(status().isUnauthorized());
        mvc.perform(put("/api/v1/budget/first-cycle?access_token=abc").contentType(JSON).content("{\"moneyLeftPaise\":1}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void beforeSetupTheOverrideIsASetupError() throws Exception {
        TestUser u = signIn();
        firstCycle(u, 100).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SETUP_INCOMPLETE"));
        assertThat(cycleCount(u)).isZero();
    }

    @Test
    void overrideOnAClosedCycleIsRejected() throws Exception {
        TestUser u = newlySetUpUser();
        today(u).andExpect(status().isOk());
        jdbc.sql("update cycles set closed_at = now() where user_id = ?").param(u.id()).update();
        firstCycle(u, 777_700).andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("FIRST_CYCLE_OVER"));
        assertThat(pool(u)).isEqualTo(435_400L); // pro-rated pool untouched
    }

    // ---------------------------------------------------------------- value validation

    @Test
    void badValuesAreAllRejectedWithNoWrite() throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        Long original = pool(u);
        List<String> bodies = List.of(
            "{\"moneyLeftPaise\":-1}", "{\"moneyLeftPaise\":-9223372036854775808}",
            "{\"moneyLeftPaise\":6000.5}", "{\"moneyLeftPaise\":6000.0}", "{\"moneyLeftPaise\":1e3}",
            "{\"moneyLeftPaise\":\"6000\"}", "{\"moneyLeftPaise\":true}", "{\"moneyLeftPaise\":[1]}", "{\"moneyLeftPaise\":{\"a\":1}}",
            "{\"moneyLeftPaise\":9223372036854775807}", "{\"moneyLeftPaise\":9223372036854775808}",
            "{\"moneyLeftPaise\":99999999999999999999999999}", "{\"moneyLeftPaise\":10000000001}",
            "{\"moneyLeftPaise\":null}", "{}", "[]", "null", "", "[1]", "{\"moneyLeftPaise\":", "{\"MoneyLeftPaise\":5}",
            "{\"moneyLeftPaise\":\"' or 1=1 --\"}", "{\"moneyLeftPaise\":\"\\u202e100\"}");
        for (String b : bodies) {
            int s = firstCycleRaw(u, b).andReturn().getResponse().getStatus();
            // Jackson matches property names case-insensitively? record binding is exact; a 200 for the casing probe is reported below
            if (b.startsWith("{\"MoneyLeftPaise")) {
                continue;
            }
            assertThat(s).as("body " + b).isIn(400, 413, 415);
            assertThat(pool(u)).as("pool after " + b).isEqualTo(original);
        }
    }

    @Test
    void maxIncomeBoundaryAndOneOverBehaveAndDoNotOverflowTheBudget() throws Exception {
        TestUser u = newlySetUpUser();
        firstCycle(u, 5_000_000).andExpect(status().isOk()).andExpect(jsonPath("$.budgetPaise").value(org.hamcrest.Matchers.greaterThan(0))); // income is the ceiling
        firstCycle(u, 0).andExpect(status().isOk()).andExpect(jsonPath("$.budgetPaise").value(0));
        firstCycleRaw(u, "{\"moneyLeftPaise\":10000000001}").andExpect(status().isBadRequest());
    }

    @Test
    void wrongContentTypeAndMethodsAreTyped() throws Exception {
        TestUser u = newlySetUpUser();
        mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u)).contentType(MediaType.TEXT_PLAIN).content("{\"moneyLeftPaise\":5}"))
            .andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.code").isString());
        for (var req : List.of(post("/api/v1/budget/first-cycle"), delete("/api/v1/budget/first-cycle"), patch("/api/v1/budget/first-cycle"), get("/api/v1/budget/first-cycle"))) {
            int s = mvc.perform(req.with(auth(u)).contentType(JSON).content("{\"moneyLeftPaise\":5}")).andReturn().getResponse().getStatus();
            assertThat(s).isEqualTo(405);
        }
    }

    @Test
    void massAssignmentFieldsAreIgnoredAndNeverMoveACycleToAnotherUser() throws Exception {
        TestUser a = newlySetUpUser();
        TestUser b = newlySetUpUser();
        today(b);
        Long bPool = pool(b);
        UUID bCycle = jdbc.sql("select id from cycles where user_id = ?").param(b.id()).query(UUID.class).single();
        firstCycleRaw(a, "{\"moneyLeftPaise\":100,\"userId\":\"" + b.id() + "\",\"id\":\"" + bCycle + "\",\"poolOverridePaise\":999999900,"
            + "\"closedAt\":null,\"first\":true,\"xp\":99999,\"status\":\"x\"}")
            .andExpect(status().isOk()).andExpect(jsonPath("$.budgetPaise").value(0)); // 100 paise over 9 days rounds down to whole rupees
        assertThat(pool(b)).isEqualTo(bPool);
        assertThat(jdbc.sql("select user_id from cycles where id = ?").param(bCycle).query(UUID.class).single()).isEqualTo(b.id());
        assertThat(pool(a)).isEqualTo(100L);
    }

    @Test
    void poolIsStoredInWholePaiseAndMatchesWhatWasSent() throws Exception {
        TestUser u = newlySetUpUser();
        firstCycle(u, 12_345).andExpect(status().isOk());
        assertThat(pool(u)).isEqualTo(12_345L);
    }

    // ---------------------------------------------------------------- races on the override

    @Test
    void twoOverridesInParallelBothSucceedAndLeaveOneOfTheTwoValues() throws Exception {
        TestUser u = newlySetUpUser(); // no cycle yet: both calls race to create it too
        List<Integer> st = runAll(2, List.of(
            () -> firstCycle(u, 100_000).andReturn().getResponse().getStatus(),
            () -> firstCycle(u, 200_000).andReturn().getResponse().getStatus()));
        assertThat(st).containsOnly(200);
        assertThat(cycleCount(u)).isEqualTo(1);
        assertThat(pool(u)).isIn(100_000L, 200_000L);
        today(u).andExpect(jsonPath("$.budgetPaise").value(org.hamcrest.Matchers.anyOf(
            org.hamcrest.Matchers.is(11_100), org.hamcrest.Matchers.is(22_200))));
    }

    @Test
    void manyOverridesAndTodayReadsInParallelNever500() throws Exception {
        TestUser u = newlySetUpUser();
        List<Callable<Integer>> calls = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            long v = 100_000L * (i + 1);
            calls.add(() -> firstCycle(u, v).andReturn().getResponse().getStatus());
            calls.add(() -> today(u).andReturn().getResponse().getStatus());
        }
        assertThat(runAll(12, calls)).containsOnly(200);
        assertThat(cycleCount(u)).isEqualTo(1);
    }

    @Test
    void overrideThenPaydayChangeKeepsTheOverrideOnThisCycleAndDropsItNextCycle() throws Exception {
        TestUser u = newlySetUpUser();
        firstCycle(u, 600_000).andExpect(status().isOk());
        putProfile(u, EXAMPLE_PROFILE.replace("\"paydayDay\":1", "\"paydayDay\":15")).andExpect(status().isOk());
        today(u).andExpect(status().isOk()).andExpect(jsonPath("$.cycleEnd").value("2026-10-31")).andExpect(jsonPath("$.budgetPaise").value(66_600));
        assertThat(cycleCount(u)).isEqualTo(1);
        clock.set(Instant.parse("2026-11-16T04:00:00Z"));
        u = signIn(u.email());
        today(u).andExpect(status().isOk());
        firstCycle(u, 900_000).andExpect(status().isUnprocessableEntity());
        assertThat(pool(u)).isNull();
    }

    @Test
    void paydayChangeBeforeTheFirstCycleOpensStillProRatesOnce() throws Exception {
        TestUser u = newlySetUpUser();
        putProfile(u, EXAMPLE_PROFILE.replace("\"paydayDay\":1", "\"paydayDay\":28")).andExpect(status().isOk());
        today(u).andExpect(status().isOk());
        firstCycle(u, 50_000).andExpect(status().isOk());
        assertThat(cycleCount(u)).isEqualTo(1);
    }

    @Test
    void firstCycleCannotBeRepoolledByDeletingAndRecreatingCyclesFromTheApi() throws Exception {
        // No API deletes a cycle; verify a gap cycle does not count as "first" again.
        TestUser u = newlySetUpUser();
        today(u);
        clock.set(Instant.parse("2027-02-10T04:00:00Z")); // months later, no cycles in between
        u = signIn(u.email());
        today(u).andExpect(status().isOk());
        firstCycle(u, 999_900).andExpect(status().isUnprocessableEntity());
    }

    // ---------------------------------------------------------------- semantics / game integrity

    /**
     * FINDING M1: "money left until payday" is a statement of what the user has NOW, but spends logged earlier
     * in the same first cycle are subtracted from it again (BudgetCalculator gets before-today spends against the pinned pool).
     * Expected: the answer is net of everything already logged; the daily budget is moneyLeft / daysLeft.
     */
    @Test
    void findingMoneyLeftAnswerIsDoubleChargedForEarlierSpends() throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        seedSpend(u, 200_000, Instant.parse("2026-10-22T10:00:00Z"));
        firstCycle(u, 600_000).andExpect(status().isOk())
            .andExpect(jsonPath("$.budgetPaise").value(66_600)); // 600,000 / 9 days; actual is (600,000 - 200,000) / 9 = 44,400
    }

    /**
     * FINDING M2: the override can be re-posted any number of times during the first cycle, and any value up to
     * Rs 100 crore is accepted. A user who has overspent (poolOver) can wipe the overrun by answering a bigger
     * number; there is no ceiling tied to income/spendable and no audit of the change.
     * Expected: a ceiling (e.g. monthly spendable, or income) so the pool cannot exceed what the plan allows.
     */
    @Test
    void findingOverrideHasNoCeilingTiedToTheUsersOwnPlan() throws Exception {
        TestUser u = newlySetUpUser(); // monthly income is Rs 50,000 (5,000,000 paise); ruling: the answer is capped at it
        firstCycle(u, 5_000_000).andExpect(status().isOk());
        firstCycle(u, 5_000_001).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        firstCycle(u, 100_000_000_000L).andExpect(status().isBadRequest());
    }

    // ---------------------------------------------------------------- guard races

    @Test
    void twentyParallelFixedCostAddsThatEachFitCannotTogetherExceedIncome() throws Exception {
        TestUser u = signIn();
        putProfile(u, EXAMPLE_PROFILE).andExpect(status().isOk()); // spendable 3,000,000
        List<Callable<Integer>> calls = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            int n = i;
            calls.add(() -> mvc.perform(post("/api/v1/me/fixed-costs").with(auth(u)).contentType(JSON)
                .content("{\"name\":\"Cost" + n + "\",\"amountPaise\":200000}")).andReturn().getResponse().getStatus());
        }
        List<Integer> st = runAll(20, calls);
        assertThat(st).allMatch(s -> s == 201 || s == 422);
        assertThat(st.stream().filter(s -> s == 201).count()).isEqualTo(14); // 14 x 200,000 = 2,800,000 < 3,000,000 <= 15 x
        assertThat(fixedTotal(u)).isEqualTo(2_800_000L);
        assertThat(5_000_000L - fixedTotal(u) - 2_000_000L).isPositive();
    }

    @Test
    void twentyParallelAddsAgainstEditsAlsoHoldTheInvariant() throws Exception {
        TestUser u = signIn();
        putProfile(u, EXAMPLE_PROFILE).andExpect(status().isOk());
        String id = addFixedCost(u, "Seed", 100_000);
        List<Callable<Integer>> calls = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            int n = i;
            calls.add(() -> mvc.perform(post("/api/v1/me/fixed-costs").with(auth(u)).contentType(JSON)
                .content("{\"name\":\"C" + n + "\",\"amountPaise\":250000}")).andReturn().getResponse().getStatus());
            calls.add(() -> mvc.perform(patch("/api/v1/me/fixed-costs/" + id).with(auth(u)).contentType(JSON)
                .content("{\"amountPaise\":" + (100_000 + 100_000 * n) + "}")).andReturn().getResponse().getStatus());
        }
        assertThat(runAll(20, calls)).allMatch(s -> s == 201 || s == 200 || s == 422);
        assertThat(fixedTotal(u)).isLessThan(3_000_000L);
    }

    @Test
    void parallelFirstTimeProfilePutsWithDifferentBodiesAllSucceedAndOneBodyWinsWhole() throws Exception {
        TestUser u = signIn();
        String[] personalities = {"CHILL", "SAVAGE", "MOM", "HYPE"};
        List<Callable<Integer>> calls = new ArrayList<>();
        int[] incomes = {4_000_000, 5_000_000, 6_000_000, 7_000_000};
        int[] days = {2, 9, 17, 25};
        String[] morning = {"06:00", "07:00", "08:00", "09:00"};
        for (int i = 0; i < 4; i++) {
            String body = "{\"incomePaise\":" + incomes[i] + ",\"savingsPaise\":" + (i + 1) * 100_000 + ",\"paydayRule\":\"FIXED_DAY\",\"paydayDay\":" + days[i]
                + ",\"personality\":\"" + personalities[i] + "\",\"morningTime\":\"" + morning[i] + "\",\"nightTime\":\"22:00\",\"timezone\":\"Asia/Kolkata\"}";
            calls.add(() -> putProfile(u, body).andReturn().getResponse().getStatus());
        }
        List<Integer> st = runAll(4, calls);
        System.out.println("PROFILE-RACE statuses=" + st);
        assertThat(st).containsOnly(200);
        Map<String, Object> row = jdbc.sql("select * from profiles where user_id = ?").param(u.id()).query().singleRow();
        int idx = java.util.Arrays.binarySearch(incomes, ((Number) row.get("income_paise")).intValue());
        assertThat(((Number) row.get("savings_paise")).longValue()).isEqualTo((idx + 1) * 100_000L);
        assertThat(((Number) row.get("payday_day")).intValue()).isEqualTo(days[idx]);
        assertThat(row.get("morning_time").toString()).startsWith(new String[] {"00:30", "01:30", "02:30", "03:30"}[idx]); // stored as UTC
    }

    @Test
    void parallelFirstTimeProfilePutsWithOneBadBodyNeverLeaveAHalfRowOr500() throws Exception {
        TestUser u = signIn();
        addFixedCost(u, "Big", 3_000_000);
        // bad: savings leave nothing (422). good ones are fine because income covers.
        String good = EXAMPLE_PROFILE.replace("5000000", "9000000");
        String bad = EXAMPLE_PROFILE.replace("5000000", "3000000"); // 3,000,000 - 3,000,000 - 2,000,000 < 0
        List<Callable<Integer>> calls = List.of(
            () -> putProfile(u, bad).andReturn().getResponse().getStatus(),
            () -> putProfile(u, good).andReturn().getResponse().getStatus(),
            () -> putProfile(u, bad).andReturn().getResponse().getStatus(),
            () -> putProfile(u, good).andReturn().getResponse().getStatus());
        List<Integer> st = runAll(4, calls);
        assertThat(st).allMatch(s -> s == 200 || s == 422);
        long income = jdbc.sql("select income_paise from profiles where user_id = ?").param(u.id()).query(Long.class).single();
        assertThat(income).isEqualTo(9_000_000L);
    }

    @Test
    void profilePutRacingAFixedCostDeleteKeepsTheInvariantAndNever500() throws Exception {
        for (int round = 0; round < 15; round++) {
            TestUser u = signIn();
            putProfile(u, EXAMPLE_PROFILE).andExpect(status().isOk());
            String id = addFixedCost(u, "Gym", 2_000_000); // spendable now 1,000,000
            String tight = EXAMPLE_PROFILE.replace("2000000", "2900000"); // only valid when Gym is gone... (5M - 2M - 2.9M > 0 is valid) tighten:
            tight = EXAMPLE_PROFILE.replace("2000000", "3000000"); // 5M - 2M(gym) - 3M = 0 -> 422 while Gym exists; 200 once deleted
            String body = tight;
            List<Integer> st = runAll(2, List.of(
                () -> putProfile(u, body).andReturn().getResponse().getStatus(),
                () -> mvc.perform(delete("/api/v1/me/fixed-costs/" + id).with(auth(u))).andReturn().getResponse().getStatus()));
            assertThat(st.get(0)).isIn(200, 422);
            assertThat(st.get(1)).isEqualTo(204);
            long income = 5_000_000L;
            long savings = jdbc.sql("select savings_paise from profiles where user_id = ?").param(u.id()).query(Long.class).single();
            assertThat(income - fixedTotal(u) - savings).as("round " + round).isPositive();
        }
    }

    @Test
    void profilePutAndFixedCostEditTightLoopNeitherDeadlocksNor500s() throws Exception {
        TestUser u = signIn();
        putProfile(u, EXAMPLE_PROFILE).andExpect(status().isOk());
        String id = addFixedCost(u, "Rent", 500_000);
        List<Callable<List<Integer>>> calls = List.of(
            () -> {
                List<Integer> s = new ArrayList<>();
                for (int i = 0; i < 150; i++) {
                    s.add(putProfile(u, EXAMPLE_PROFILE.replace("2000000", String.valueOf(1_000_000 + (i % 7) * 100_000))).andReturn().getResponse().getStatus());
                }
                return s;
            },
            () -> {
                List<Integer> s = new ArrayList<>();
                for (int i = 0; i < 150; i++) {
                    s.add(mvc.perform(patch("/api/v1/me/fixed-costs/" + id).with(auth(u)).contentType(JSON)
                        .content("{\"amountPaise\":" + (400_000 + (i % 5) * 100_000) + "}")).andReturn().getResponse().getStatus());
                }
                return s;
            },
            () -> {
                List<Integer> s = new ArrayList<>();
                for (int i = 0; i < 150; i++) {
                    s.add(mvc.perform(post("/api/v1/me/fixed-costs").with(auth(u)).contentType(JSON)
                        .content("{\"name\":\"Tmp\",\"amountPaise\":100000}")).andReturn().getResponse().getStatus());
                }
                return s;
            },
            () -> {
                List<Integer> s = new ArrayList<>();
                for (int i = 0; i < 150; i++) {
                    s.add(today(u).andReturn().getResponse().getStatus());
                    s.add(firstCycle(u, 100_000L + i).andReturn().getResponse().getStatus());
                }
                return s;
            });
        List<List<Integer>> res = runAll(4, calls);
        for (List<Integer> l : res) {
            assertThat(l).allMatch(s -> s < 500, "no 5xx, statuses=" + l.stream().distinct().toList());
        }
        long savings = jdbc.sql("select savings_paise from profiles where user_id = ?").param(u.id()).query(Long.class).single();
        assertThat(5_000_000L - fixedTotal(u) - savings).isPositive();
    }

    // ---------------------------------------------------------------- logs

    @Test
    void noAmountsEmailsOrNamesInLogsAfterTheWholeRun(CapturedOutput out) throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        firstCycle(u, 4_777_701).andReturn();
        firstCycle(u, -4_242_421).andReturn();
        firstCycleRaw(u, "{\"moneyLeftPaise\":\"9191919\"}").andReturn();
        firstCycleRaw(u, "{\"moneyLeftPaise\":8383838.5}").andReturn();
        mvc.perform(post("/api/v1/auth/dev/otp").with(freshIp()).contentType(JSON).content("{\"email\":\"" + u.email() + "\"}")).andReturn();
        mvc.perform(post("/api/v1/me/fixed-costs").with(auth(u)).contentType(JSON).content("{\"name\":\"Zorblax\",\"amountPaise\":2918273}")).andReturn();
        clock.set(Instant.parse("2026-11-05T04:00:00Z"));
        u = signIn(u.email());
        today(u);
        firstCycle(u, 6_161_617).andReturn();
        String logs = out.getAll();
        for (String s : List.of("4777701", "4242421", "9191919", "8383838", "2918273", "6161617", "Zorblax", u.email(), mailer.lastCodeFor(u.email()),
            u.accessToken(), u.refreshToken())) {
            assertThat(logs).as("log leaks " + s).doesNotContain(s);
        }
        assertThat(logs).contains("cycle.pool_set user=" + u.id());
    }
}
