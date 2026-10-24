package in.gullak.budget;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class FirstCycleApiTest extends ApiTest {

    @Test
    void midCycleSignupProRatesTheFirstCycle() throws Exception { // BUD-32, API-TDY-08
        TestUser u = newlySetUpUser();
        today(u)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.cycleStart").value("2026-10-01"))
            .andExpect(jsonPath("$.daysLeft").value(9))
            .andExpect(jsonPath("$.budgetPaise").value(48_300))
            .andExpect(jsonPath("$.leftPaise").value(48_300));
        assertThat(poolOverride(u)).isNull(); // computed live from budget_from, never pinned
        assertThat(budgetFrom(u)).isEqualTo("2026-10-23");
    }

    @Test
    void moneyLeftAnswerReplacesThePool() throws Exception { // BUD-32
        TestUser u = newlySetUpUser();
        firstCycle(u, 600_000)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.budgetPaise").value(66_600));
        assertThat(poolOverride(u)).isEqualTo(600_000L);
        today(u).andExpect(jsonPath("$.budgetPaise").value(66_600));
    }

    @Test
    void moneyLeftIsWhatTheUserHasNowSoSpendsSinceSetupAreNotChargedTwice() throws Exception { // BUD-32b
        TestUser u = newlySetUpUser();
        today(u); // setup on 23 Oct: budget_from = 23 Oct
        seedSpend(u, 200_000, Instant.parse("2026-10-23T04:30:00Z")); // 23 Oct, 10:00 IST
        clock.set(Instant.parse("2026-10-24T04:00:00Z"));
        u = signIn(u.email()); // access tokens last 15 minutes
        firstCycle(u, 600_000).andExpect(status().isOk()).andExpect(jsonPath("$.budgetPaise").value(75_000)); // (800,000 - 200,000) / 8
        assertThat(poolOverride(u)).isEqualTo(800_000L);
    }

    @Test
    void aSpendBeforeSetupDoesNotReduceTheFirstCycleBudget() throws Exception { // BUD-32c
        TestUser u = newlySetUpUser();
        seedSpend(u, 200_000, Instant.parse("2026-10-20T10:00:00Z"));
        today(u).andExpect(jsonPath("$.budgetPaise").value(48_300)).andExpect(jsonPath("$.leftPaise").value(48_300));
        firstCycle(u, 600_000).andExpect(jsonPath("$.budgetPaise").value(66_600));
        assertThat(poolOverride(u)).isEqualTo(600_000L);
    }

    @Test
    void moneyLeftAfterASpendTodayIsSharedOverTheDaysLeft() throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        seedSpend(u, 20_000, Instant.parse("2026-10-23T03:42:00Z")); // today, 09:12 IST
        firstCycle(u, 600_000).andExpect(status().isOk())
            .andExpect(jsonPath("$.budgetPaise").value(68_800)) // (600,000 + 20,000) / 9 = 68,888 -> Rs 688
            .andExpect(jsonPath("$.leftPaise").value(48_800));
    }

    @Test
    void moneyLeftCanBeZero() throws Exception {
        TestUser u = newlySetUpUser();
        firstCycle(u, 0).andExpect(status().isOk()).andExpect(jsonPath("$.budgetPaise").value(0)).andExpect(jsonPath("$.mood").value("NERVOUS"));
    }

    @Test
    void moneyLeftIsValidated() throws Exception {
        TestUser u = newlySetUpUser();
        firstCycle(u, -1).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        firstCycle(u, 10_000_000_001L).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{\"moneyLeftPaise\":6000.5}"))
            .andExpect(status().isBadRequest());
        firstCycle(u, 5_000_001).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"))
            .andExpect(jsonPath("$.fields[0].field").value("moneyLeftPaise"))
            .andExpect(jsonPath("$.fields[0].message").value("Can't be more than your monthly income"));
        mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{\"moneyLeftPaise\":\"6000\"}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    @Test
    void signupOnPaydayGetsTheFullMonth() throws Exception {
        clock.set(Instant.parse("2026-11-01T04:00:00Z"));
        TestUser u = newlySetUpUser();
        today(u).andExpect(jsonPath("$.budgetPaise").value(50_000)).andExpect(jsonPath("$.daysLeft").value(30));
        assertThat(poolOverride(u)).isNull();
        assertThat(budgetFrom(u)).isNull(); // created on its own first day
    }

    @Test
    void spendsSinceSetupComeOutOfTheProRatedPool() throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        seedSpend(u, 200_000, Instant.parse("2026-10-23T04:30:00Z")); // setup day, after setup
        clock.set(Instant.parse("2026-10-24T04:00:00Z"));
        u = signIn(u.email());
        today(u).andExpect(jsonPath("$.budgetPaise").value(29_400)); // (435,400 - 200,000) / 8 = 29,425 -> Rs 294
    }

    @Test
    void withoutAnAnswerEditsDuringTheFirstCycleChangeTheBudget() throws Exception {
        TestUser u = newlySetUpUser();
        today(u).andExpect(jsonPath("$.budgetPaise").value(48_300));
        addFixedCost(u, "Gym", 150_000); // spendable 1,500,000 -> 1,350,000; x 9/31 = 391,935 -> 391,900; / 9
        today(u).andExpect(jsonPath("$.budgetPaise").value(43_500));
        assertThat(poolOverride(u)).isNull();
    }

    @Test
    void withAnAnswerEditsDuringTheFirstCycleKeepThePool() throws Exception { // the user said what they have
        TestUser u = newlySetUpUser();
        firstCycle(u, 600_000).andExpect(jsonPath("$.budgetPaise").value(66_600));
        addFixedCost(u, "Gym", 150_000);
        today(u).andExpect(jsonPath("$.budgetPaise").value(66_600));
    }

    @Test
    void overrideIsRejectedAfterTheFirstCycle() throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        clock.set(Instant.parse("2026-11-05T04:00:00Z"));
        u = signIn(u.email()); // access tokens last 15 minutes
        today(u).andExpect(jsonPath("$.cycleStart").value("2026-11-01"));
        firstCycle(u, 600_000).andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("FIRST_CYCLE_OVER"));
    }

    @Test
    void secondCycleUsesTheNormalFormula() throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        clock.set(Instant.parse("2026-11-01T04:00:00Z"));
        u = signIn(u.email()); // access tokens last 15 minutes
        today(u).andExpect(jsonPath("$.budgetPaise").value(50_000));
        assertThat(jdbc.sql("select pool_override_paise from cycles where user_id = ? and start_date = '2026-11-01'").param(u.id()).query(Long.class).optional()).isEmpty();
    }

    @Test
    void anotherUsersOverrideIsSeparate() throws Exception {
        TestUser a = newlySetUpUser();
        TestUser b = newlySetUpUser();
        firstCycle(a, 900_000).andExpect(status().isOk());
        today(b).andExpect(jsonPath("$.budgetPaise").value(48_300));
    }

    @Test
    void maturedExampleUserIsNotProRated() throws Exception { // the seeded cycle from exampleUser() keeps Plan 1's numbers
        TestUser u = exampleUser();
        today(u).andExpect(jsonPath("$.budgetPaise").value(166_600));
    }

    private ResultActions firstCycle(TestUser u, long paise) throws Exception {
        return mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content("{\"moneyLeftPaise\":" + paise + "}"));
    }

    private ResultActions today(TestUser u) throws Exception {
        return mvc.perform(get("/api/v1/budget/today").with(auth(u)));
    }

    private String budgetFrom(TestUser u) {
        return jdbc.sql("select budget_from::text from cycles where user_id = ? order by start_date desc limit 1")
            .param(u.id()).query(String.class).optional().orElse(null);
    }

    private Long poolOverride(TestUser u) {
        return jdbc.sql("select pool_override_paise from cycles where user_id = ? order by start_date desc limit 1")
            .param(u.id()).query(Long.class).optional().orElse(null);
    }
}
