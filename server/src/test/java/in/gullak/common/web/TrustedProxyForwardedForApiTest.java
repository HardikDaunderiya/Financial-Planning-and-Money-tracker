package in.gullak.common.web;

import static in.gullak.common.web.ForwardedForApiTest.requestCode;
import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.TestcontainersConfiguration;
import in.gullak.support.TestClockConfig;
import java.net.http.HttpClient;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

/** Behind a trusted proxy, each client address from X-Forwarded-For gets its own budget. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, TestClockConfig.class})
@TestPropertySource(properties = "server.tomcat.remoteip.internal-proxies=127\\\\.0\\\\.0\\\\.1")
class TrustedProxyForwardedForApiTest {
    @LocalServerPort int port;

    private final HttpClient http = HttpClient.newHttpClient();

    @Test
    void eachForwardedClientGetsItsOwnBudget() throws Exception {
        for (int i = 0; i < 30; i++) {
            assertThat(requestCode(http, port, "203.0.113.1")).isEqualTo(204);
        }
        for (int i = 0; i < 30; i++) {
            assertThat(requestCode(http, port, "203.0.113.2")).isEqualTo(204);
        }
        assertThat(requestCode(http, port, "203.0.113.1")).isEqualTo(429);
    }
}
