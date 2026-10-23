package in.gullak.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Test;

class HardeningApiTest extends ApiTest {

    @Test
    void anonymousActuatorPathsOtherThanHealthAreNotFound() throws Exception { // API-X-11
        for (String p : new String[] {"/actuator", "/actuator/env", "/actuator/heapdump", "/actuator/beans"}) {
            mvc.perform(get(p)).andExpect(status().isNotFound());
        }
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }
}
