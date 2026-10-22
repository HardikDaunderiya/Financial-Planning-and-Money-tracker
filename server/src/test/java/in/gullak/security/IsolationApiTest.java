package in.gullak.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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
            .andExpect(jsonPath("$[?(@.name == 'Secret')].amountPaise").value(12_300));
    }

    @Test
    void listsAndTotalsNeverMixUsers() throws Exception { // API-X-01
        TestUser a = exampleUser();
        TestUser b = exampleUser();
        addFixedCost(b, "Only B", 10_000);
        seedSpend(b, 99_900, Instant.parse("2026-10-23T03:00:00Z"));
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(a)))
            .andExpect(jsonPath("$[?(@.name == 'Only B')]").isEmpty());
        mvc.perform(get("/api/v1/budget/today").with(auth(a)))
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
}
