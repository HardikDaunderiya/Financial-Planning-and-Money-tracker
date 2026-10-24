package in.gullak.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;

@ActiveProfiles({"test", "local"})
class DevOtpLocalApiTest extends ApiTest {

    @Test
    void underLocalTheRouteReturnsTheLastCode() throws Exception {
        String email = uniqueEmail();
        requestCode(email, freshIp()).andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/dev/otp").with(freshIp()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(mailer.lastCodeFor(email)));
    }

    @Test
    void anEmailWithNoCodeIsNotFound() throws Exception {
        mvc.perform(post("/api/v1/auth/dev/otp").with(freshIp()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + uniqueEmail() + "\"}"))
            .andExpect(status().isNotFound());
    }
}
