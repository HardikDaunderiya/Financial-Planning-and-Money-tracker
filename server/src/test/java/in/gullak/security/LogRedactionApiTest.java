package in.gullak.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;

@ExtendWith(OutputCaptureExtension.class)
class LogRedactionApiTest extends ApiTest {

    @Test
    void aFullSessionLeavesNoSensitiveDataInTheLogs(CapturedOutput out) throws Exception { // LOG-05, SEC-01
        TestUser u = exampleUser();
        addFixedCost(u, "Landlord Sharma", 1_234_500);
        seedSpend(u, 777_700, Instant.parse("2026-10-23T03:00:00Z"));
        mvc.perform(get("/api/v1/budget/today").with(auth(u)));
        String refreshed = mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + u.refreshToken() + "\"}"))
            .andReturn().getResponse().getContentAsString();
        String newAccess = JsonPath.read(refreshed, "$.accessToken");

        String logs = out.getOut() + out.getErr();
        assertThat(logs)
            .doesNotContain(u.email())
            .doesNotContain(u.accessToken())
            .doesNotContain(u.refreshToken())
            .doesNotContain(newAccess)
            .doesNotContain("Landlord Sharma")
            .doesNotContain("1234500")
            .doesNotContain("777700")
            .doesNotContain("5000000");
    }

    @Test
    void businessEventsAreLoggedWithIdsOnly(CapturedOutput out) throws Exception { // LOG-03
        TestUser u = exampleUser();
        mvc.perform(get("/api/v1/budget/today").with(auth(u)));
        String logs = out.getOut();
        assertThat(logs).contains("auth.otp.requested").contains("auth.otp.verified user=" + u.id());
        assertThat(logs).contains("profile.updated user=" + u.id());
        assertThat(logs).contains("profile.fixed_cost.changed user=" + u.id());
        assertThat(logs).contains("cycle.opened user=" + u.id() + " days=31");
    }

    @Test
    void everyErrorHasTheStandardShape() throws Exception { // ERR-01
        TestUser u = signIn();
        String[] bodies = {
            mvc.perform(get("/api/v1/budget/today").with(auth(u))).andReturn().getResponse().getContentAsString(),
            mvc.perform(get("/api/v1/budget/today")).andReturn().getResponse().getContentAsString(),
            mvc.perform(get("/api/v1/me/fixed-costs/not-a-uuid").with(auth(u))).andReturn().getResponse().getContentAsString(),
            mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andReturn().getResponse().getContentAsString()
        };
        for (String body : bodies) {
            assertThat((String) JsonPath.read(body, "$.code")).isNotBlank();
            assertThat((String) JsonPath.read(body, "$.message")).isNotBlank();
            assertThat(body).doesNotContain("Exception").doesNotContain("at in.gullak");
        }
    }
}
