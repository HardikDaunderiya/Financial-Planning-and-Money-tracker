package in.gullak.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class IsolationApiTest extends ApiTest {

    @Test
    void fixedCostIdsOfAnotherUserAreNotFound() throws Exception { // API-X-01
        TestUser a = exampleUser();
        TestUser b = exampleUser();
        String id = addFixedCost(a, "Secret", 12_300);
        mvc.perform(patch("/api/v1/me/fixed-costs/" + id).with(auth(b))
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"pwned\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(delete("/api/v1/me/fixed-costs/" + id).with(auth(b))).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(a)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[?(@.name == 'Secret')].amountPaise").value(12_300));
    }

    @Test
    void listsAndTotalsNeverMixUsers() throws Exception { // API-X-01
        TestUser a = exampleUser();
        TestUser b = exampleUser();
        addFixedCost(b, "Only B", 10_000);
        seedSpend(b, 99_900, Instant.parse("2026-10-23T03:00:00Z"));
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(a)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[?(@.name == 'Only B')]").isEmpty());
        mvc.perform(get("/api/v1/budget/today").with(auth(a)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.spentPaise").value(0));
    }

    @Test
    void userIdInTheBodyIsIgnored() throws Exception { // mass assignment
        TestUser a = signIn();
        TestUser b = signIn();
        putProfile(a, EXAMPLE_PROFILE.replace("{", "{\"userId\":\"" + b.id() + "\",")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/me/profile").with(auth(b)))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("SETUP_INCOMPLETE"));
    }

    @Test
    void profilesAreSeparatePerUser() throws Exception { // API-X-01
        TestUser a = exampleUser();
        TestUser b = signIn();
        putProfile(b, EXAMPLE_PROFILE.replace("5000000", "6000000").replace("\"paydayDay\":1", "\"paydayDay\":5"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/v1/me/profile").with(auth(b)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.incomePaise").value(6_000_000))
            .andExpect(jsonPath("$.paydayDay").value(5));
        mvc.perform(get("/api/v1/me/profile").with(auth(a)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.incomePaise").value(5_000_000))
            .andExpect(jsonPath("$.paydayDay").value(1));
    }

    @Test
    void bsRefreshTokenOnlyTouchesBsSessions() throws Exception {
        TestUser a = signIn();
        TestUser b = signIn();
        mvc.perform(post("/api/v1/auth/logout").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + b.refreshToken() + "\"}"))
            .andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + a.refreshToken() + "\"}"))
            .andExpect(status().isOk());
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + b.refreshToken() + "\"}"))
            .andExpect(status().isUnauthorized());
    }

    /** Refresh tokens are bearer secrets: presenting A's token IS being A, so logout revokes A's session. */
    @Test
    void logoutWithAnotherUsersRefreshTokenRevokesThatTokensSession() throws Exception {
        TestUser a = signIn();
        TestUser b = signIn();
        mvc.perform(post("/api/v1/auth/logout").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + a.refreshToken() + "\"}"))
            .andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + a.refreshToken() + "\"}"))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + b.refreshToken() + "\"}"))
            .andExpect(status().isOk());
    }

    @Test
    void todayBudgetIsUnaffectedByAnotherUsersCostsAndSpends() throws Exception { // API-X-01
        TestUser a = exampleUser();
        String before = mvc.perform(get("/api/v1/budget/today").with(auth(a)))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        TestUser b = exampleUser();
        addFixedCost(b, "Only B", 100_000);
        seedSpend(b, 250_000, Instant.parse("2026-10-23T03:00:00Z"));
        String after = mvc.perform(get("/api/v1/budget/today").with(auth(a)))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(after).isEqualTo(before);
    }
}
