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
        assertThat(poolOverride(u)).isEqualTo(435_400L);
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
    void moneyLeftCanBeZero() throws Exception {
        TestUser u = newlySetUpUser();
        firstCycle(u, 0).andExpect(status().isOk()).andExpect(jsonPath("$.budgetPaise").value(0)).andExpect(jsonPath("$.mood").value("NERVOUS"));
    }

    @Test
    void moneyLeftIsValidated() throws Exception {
        TestUser u = newlySetUpUser();
        firstCycle(u, -1).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{\"moneyLeftPaise\":\"6000\"}"))
            .andExpect(status().isBadRequest());
        mvc.perform(put("/api/v1/budget/first-cycle").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void signupOnPaydayGetsTheFullMonth() throws Exception {
        clock.set(Instant.parse("2026-11-01T04:00:00Z"));
        TestUser u = newlySetUpUser();
        today(u).andExpect(jsonPath("$.budgetPaise").value(50_000)).andExpect(jsonPath("$.daysLeft").value(30));
        assertThat(poolOverride(u)).isNull();
    }

    @Test
    void spendsInTheFirstCycleComeOutOfTheProRatedPool() throws Exception {
        TestUser u = newlySetUpUser();
        today(u);
        seedSpend(u, 200_000, Instant.parse("2026-10-22T10:00:00Z")); // yesterday
        today(u).andExpect(jsonPath("$.budgetPaise").value(26_100)); // (435,400 − 200,000) ÷ 9 = 26,155 → ₹261
    }

    @Test
    void editsDuringTheFirstCycleKeepThePool() throws Exception { // decided in Plan 2: the user said what they have
        TestUser u = newlySetUpUser();
        today(u);
        addFixedCost(u, "Gym", 150_000);
        today(u).andExpect(jsonPath("$.budgetPaise").value(48_300));
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

    private Long poolOverride(TestUser u) {
        return jdbc.sql("select pool_override_paise from cycles where user_id = ? order by start_date desc limit 1")
            .param(u.id()).query(Long.class).optional().orElse(null);
    }
}
