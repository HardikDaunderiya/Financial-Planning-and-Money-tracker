package in.gullak.profile;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class FixedCostApiTest extends ApiTest {

    @Test
    void addAndList() throws Exception { // API-FC-01
        TestUser u = signIn();
        addFixedCost(u, "Rent", 1_000_000);
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].name").value("Rent"))
            .andExpect(jsonPath("$[0].amountPaise").value(1_000_000));
    }

    @Test
    void zeroAmountIsValidation() throws Exception { // API-FC-02
        TestUser u = signIn();
        create(u, "{\"name\":\"Rent\",\"amountPaise\":0}").andExpect(status().isBadRequest());
    }

    @Test
    void longNameIsValidation() throws Exception { // API-FC-03
        TestUser u = signIn();
        create(u, "{\"name\":\"" + "x".repeat(61) + "\",\"amountPaise\":100}").andExpect(status().isBadRequest());
    }

    @Test
    void blankNameIsValidation() throws Exception {
        TestUser u = signIn();
        create(u, "{\"name\":\"  \",\"amountPaise\":100}").andExpect(status().isBadRequest());
    }

    @Test
    void editChangesTheAmount() throws Exception { // API-FC-04
        TestUser u = exampleUser();
        String id = addFixedCost(u, "Wi-Fi", 70_000);
        edit(u, id, "{\"amountPaise\":80_000}".replace("_", ""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.amountPaise").value(80_000))
            .andExpect(jsonPath("$.name").value("Wi-Fi"));
    }

    @Test
    void editingAnotherUsersCostIsNotFound() throws Exception { // API-FC-05
        TestUser a = signIn();
        TestUser b = signIn();
        String id = addFixedCost(a, "Rent", 1_000_000);
        edit(b, id, "{\"amountPaise\":1}").andExpect(status().isNotFound());
        mvc.perform(delete("/api/v1/me/fixed-costs/" + id).with(auth(b))).andExpect(status().isNotFound());
    }

    @Test
    void deleteHidesTheCostAndSecondDeleteIsNotFound() throws Exception { // API-FC-06, API-FC-07
        TestUser u = signIn();
        String id = addFixedCost(u, "Gym", 150_000);
        mvc.perform(delete("/api/v1/me/fixed-costs/" + id).with(auth(u))).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(u))).andExpect(jsonPath("$", hasSize(0)));
        mvc.perform(delete("/api/v1/me/fixed-costs/" + id).with(auth(u))).andExpect(status().isNotFound());
    }

    @Test
    void costsThatLeaveNothingToSpendAreRejected() throws Exception { // API-FC-08
        TestUser u = exampleUser();
        create(u, "{\"name\":\"EMI\",\"amountPaise\":1500000}")
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("NOT_POSSIBLE"));
        String id = addFixedCost(u, "Phone bill", 29_900);
        edit(u, id, "{\"amountPaise\":1500000}").andExpect(status().isUnprocessableEntity());
    }

    @Test
    void malformedIdIsValidation() throws Exception {
        TestUser u = signIn();
        edit(u, "not-a-uuid", "{\"amountPaise\":1}").andExpect(status().isBadRequest());
    }

    private org.springframework.test.web.servlet.ResultActions create(TestUser u, String json) throws Exception {
        return mvc.perform(post("/api/v1/me/fixed-costs").with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private org.springframework.test.web.servlet.ResultActions edit(TestUser u, String id, String json) throws Exception {
        return mvc.perform(patch("/api/v1/me/fixed-costs/" + id).with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content(json));
    }
}
