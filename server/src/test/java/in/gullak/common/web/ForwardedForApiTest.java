package in.gullak.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.TestcontainersConfiguration;
import in.gullak.support.TestClockConfig;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

/** Real Tomcat, because MockMvc never runs the RemoteIpValve. No proxy is trusted by default. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, TestClockConfig.class})
class ForwardedForApiTest {
    @LocalServerPort int port;

    private final HttpClient http = HttpClient.newHttpClient();

    static int requestCode(HttpClient http, int port, String forwardedFor) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth/otp/request"))
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", forwardedFor)
            .POST(HttpRequest.BodyPublishers.ofString(
                "{\"email\":\"user-" + UUID.randomUUID() + "@example.test\"}"))
            .build();
        return http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
    }

    @Test
    void spoofedForwardedForDoesNotResetTheIpLimit() throws Exception {
        for (int i = 0; i < 30; i++) {
            assertThat(requestCode(http, port, "203.0.113." + i)).isEqualTo(204);
        }
        assertThat(requestCode(http, port, "203.0.113.200")).isEqualTo(429);
    }
}
