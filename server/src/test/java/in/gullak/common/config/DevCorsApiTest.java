package in.gullak.common.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;

import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.ActiveProfiles;

/** The browser build talks to a local server only under the `local` profile; every other profile sends no CORS headers. */
class DevCorsApiTest {

    @Nested
    @ActiveProfiles({"test", "local"})
    class UnderLocal extends ApiTest {
        @Test
        void theExpoWebDevServerMayCallTheApi() throws Exception {
            mvc.perform(options("/api/v1/auth/otp/request")
                    .header("Origin", "http://localhost:8082")
                    .header("Access-Control-Request-Method", "POST")
                    .header("Access-Control-Request-Headers", "content-type"))
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:8082"));
        }

        @Test
        void anyOtherOriginGetsNoCorsHeaders() throws Exception {
            mvc.perform(options("/api/v1/auth/otp/request")
                    .header("Origin", "https://evil.example")
                    .header("Access-Control-Request-Method", "POST"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        }
    }

    @Nested
    class OutsideLocal extends ApiTest {
        @Test
        void noOriginIsAllowed() throws Exception {
            mvc.perform(options("/api/v1/auth/otp/request")
                    .header("Origin", "http://localhost:8082")
                    .header("Access-Control-Request-Method", "POST"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        }
    }
}
