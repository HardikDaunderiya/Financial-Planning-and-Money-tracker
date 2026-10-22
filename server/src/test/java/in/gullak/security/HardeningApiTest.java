package in.gullak.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class HardeningApiTest extends ApiTest {

    @Test
    void oversizedBodyWithoutDeclaredLengthIsAlso413() throws Exception { // API-X-08 (chunked)
        byte[] body = ("{\"email\":\"" + uniqueEmail() + "\",\"pad\":\"" + "a".repeat(70_000) + "\"}")
            .getBytes(StandardCharsets.UTF_8);
        mvc.perform(post("/api/v1/auth/otp/request").with(freshIp())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(request -> {
                    request.removeHeader("Content-Length");
                    request.setContent(body);
                    return request;
                }))
            .andExpect(status().isPayloadTooLarge())
            .andExpect(jsonPath("$.code").value("TOO_LARGE"));
    }

    @Test
    void anonymousActuatorPathsOtherThanHealthAreNotFound() throws Exception { // API-X-11
        for (String p : new String[] {"/actuator/env", "/actuator/heapdump", "/actuator/beans"}) {
            mvc.perform(get(p)).andExpect(status().isNotFound());
        }
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }
}
