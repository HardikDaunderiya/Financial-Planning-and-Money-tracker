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
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@ExtendWith(OutputCaptureExtension.class)
class LogRedactionApiTest extends ApiTest {

    private static final String NAME_1 = "Landlord Sharma";
    private static final String NAME_2 = "Zebra Tuition Fees";
    private static final String NAME_3 = "Quokka Rent";
    private static final String BAD_NAME = "Wombat\\u0000Club";
    private static final long INCOME = 7_654_321;
    private static final long SAVINGS = 1_234_567;
    private static final long COST_1 = 2_345_678;
    private static final long COST_2 = 3_456_789;
    private static final long COST_PATCHED = 2_468_013;
    private static final long BAD_AMOUNT = 9_182_736;
    private static final long SPEND = 4_567_891;
    private static final String JSON = MediaType.APPLICATION_JSON_VALUE;

    private static final String PROFILE = EXAMPLE_PROFILE
        .replace("5000000", String.valueOf(INCOME)).replace("2000000", String.valueOf(SAVINGS));

    @Test
    void everyEndpointAndErrorPathLeavesNoSensitiveDataInTheLogs(CapturedOutput out) throws Exception { // LOG-05, SEC-01
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();

        requestCode(email, ip).andExpect(status().isNoContent());
        String otpCode = mailer.lastCodeFor(email);
        String verified = verifyCode(email, otpCode, ip).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        TestUser u = new TestUser(
            jdbc.sql("select id from users where email = ?").param(email).query(UUID.class).single(),
            email, JsonPath.read(verified, "$.accessToken"), JsonPath.read(verified, "$.refreshToken"));

        // 409 before setup
        mvc.perform(get("/api/v1/me/profile").with(auth(u)))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SETUP_INCOMPLETE"));
        mvc.perform(get("/api/v1/budget/today").with(auth(u))).andExpect(status().isConflict());

        // fixed costs: add, list, edit, remove
        String id1 = addFixedCost(u, NAME_1, COST_1);
        addFixedCost(u, NAME_2, COST_2);
        String id3 = addFixedCost(u, "Temp", 1_000);
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(u))).andExpect(status().isOk());
        mvc.perform(patch("/api/v1/me/fixed-costs/" + id1).with(auth(u)).contentType(JSON)
                .content("{\"name\":\"" + NAME_3 + "\",\"amountPaise\":" + COST_PATCHED + "}"))
            .andExpect(status().isOk());
        mvc.perform(delete("/api/v1/me/fixed-costs/" + id3).with(auth(u))).andExpect(status().isNoContent());

        // profile and today
        putProfile(u, PROFILE).andExpect(status().isOk());
        mvc.perform(get("/api/v1/me/profile").with(auth(u))).andExpect(status().isOk());
        seedSpend(u, SPEND, Instant.parse("2026-10-23T03:00:00Z"));
        mvc.perform(get("/api/v1/budget/today").with(auth(u))).andExpect(status().isOk());

        // error paths: 400 with a name and an amount, 401, 404, 413
        mvc.perform(post("/api/v1/me/fixed-costs").with(auth(u)).contentType(JSON)
                .content("{\"name\":\"" + BAD_NAME + "\",\"amountPaise\":" + BAD_AMOUNT + "}"))
            .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/me/fixed-costs")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/v1/me/fixed-costs/" + UUID.randomUUID()).with(auth(u)))
            .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/me/fixed-costs").with(auth(u)).contentType(JSON)
                .content("{\"name\":\"" + NAME_1 + "\",\"amountPaise\":" + BAD_AMOUNT + ",\"pad\":\""
                    + "a".repeat(70_000) + "\"}"))
            .andExpect(status().isPayloadTooLarge());

        // refresh, logout, reuse
        String refreshed = mvc.perform(post("/api/v1/auth/refresh").contentType(JSON)
                .content("{\"refreshToken\":\"" + u.refreshToken() + "\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String newAccess = JsonPath.read(refreshed, "$.accessToken");
        String newRefresh = JsonPath.read(refreshed, "$.refreshToken");
        mvc.perform(post("/api/v1/auth/logout").contentType(JSON)
                .content("{\"refreshToken\":\"" + newRefresh + "\"}"))
            .andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/refresh").contentType(JSON)
                .content("{\"refreshToken\":\"" + u.refreshToken() + "\"}"))
            .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("TOKEN_REUSED"));

        String logs = String.join("\n", List.of(out.getAll()));
        assertThat(logs).contains("auth.session.revoked");
        assertThat(logs)
            .doesNotContain(email)
            .doesNotContain(otpCode)
            .doesNotContain(u.accessToken())
            .doesNotContain(u.refreshToken())
            .doesNotContain(newAccess)
            .doesNotContain(newRefresh)
            .doesNotContain(NAME_1).doesNotContain(NAME_2).doesNotContain(NAME_3).doesNotContain("Wombat")
            .doesNotContain(String.valueOf(INCOME)).doesNotContain(String.valueOf(SAVINGS))
            .doesNotContain(String.valueOf(COST_1)).doesNotContain(String.valueOf(COST_2))
            .doesNotContain(String.valueOf(COST_PATCHED)).doesNotContain(String.valueOf(BAD_AMOUNT))
            .doesNotContain(String.valueOf(SPEND));
    }

    @Test
    void businessEventsAreLoggedWithIdsOnly(CapturedOutput out) throws Exception { // LOG-03
        TestUser u = exampleUser();
        addFixedCost(u, NAME_1, 123_457);
        seedSpend(u, SPEND, Instant.parse("2026-10-23T03:00:00Z"));
        mvc.perform(get("/api/v1/budget/today").with(auth(u))).andExpect(status().isOk());
        mvc.perform(post("/api/v1/auth/logout").contentType(JSON)
                .content("{\"refreshToken\":\"" + u.refreshToken() + "\"}"))
            .andExpect(status().isNoContent());
        String logs = out.getOut();
        assertThat(logs).contains("auth.otp.requested").contains("auth.otp.verified user=" + u.id());
        assertThat(logs).contains("profile.updated user=" + u.id());
        assertThat(logs).contains("profile.fixed_cost.changed user=" + u.id());
        assertThat(logs).contains("cycle.opened user=" + u.id() + " days=31");
        assertThat(logs).contains("auth.session.revoked user=" + u.id());

        List<String> eventLines = logs.lines()
            .filter(l -> l.matches(".*\\b(auth|profile|cycle)\\.[a-z_.]+( .*|$)"))
            .toList();
        assertThat(eventLines).isNotEmpty();
        for (String line : eventLines) {
            assertThat(line).doesNotContain(NAME_1).doesNotContain("Rent").doesNotContain("Cook")
                .doesNotContain("123457").doesNotContain(String.valueOf(SPEND))
                .doesNotContain("5000000").doesNotContain("2000000").doesNotContain(u.email());
        }
    }

    @Test
    void everyErrorHasTheStandardShape() throws Exception { // ERR-01
        TestUser u = signIn();
        record Probe(MvcResult result, int status) {}
        List<Probe> probes = List.of(
            new Probe(mvc.perform(get("/api/v1/budget/today").with(auth(u))).andReturn(), 409),
            new Probe(mvc.perform(get("/api/v1/budget/today")).andReturn(), 401),
            new Probe(mvc.perform(get("/api/v1/me/fixed-costs/not-a-uuid").with(auth(u))).andReturn(), 405),
            new Probe(mvc.perform(post("/api/v1/auth/refresh").contentType(JSON).content("{}")).andReturn(), 400),
            new Probe(mvc.perform(put("/api/v1/me/profile").with(auth(u)).contentType(JSON).content("{\"incomePaise\":\"x\"}"))
                .andReturn(), 400));
        for (Probe p : probes) {
            String body = p.result().getResponse().getContentAsString();
            assertThat(p.result().getResponse().getStatus()).isEqualTo(p.status());
            assertThat((String) JsonPath.read(body, "$.code")).isNotBlank();
            assertThat((String) JsonPath.read(body, "$.message")).isNotBlank();
            assertThat(body).doesNotContain("Exception").doesNotContain("at in.gullak");
        }
    }
}
