package in.gullak.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.jayway.jsonpath.JsonPath;
import in.gullak.TestcontainersConfiguration;
import in.gullak.support.TestClockConfig;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

/** API-X-08 over a real socket: a chunked body has no Content-Length, so only the wrapped stream can stop it. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, TestClockConfig.class})
class ChunkedBodyApiTest {
    @LocalServerPort int port;

    @Test
    void chunkedBodyOverTheLimitIs413WithTheStandardShape() throws Exception {
        byte[] body = ("{\"email\":\"a@example.test\",\"pad\":\"" + "a".repeat(70_000) + "\"}")
            .getBytes(StandardCharsets.UTF_8);
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/otp/request"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(body)))
            .build();
        HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(413);
        assertThat((String) JsonPath.read(response.body(), "$.code")).isEqualTo("TOO_LARGE");
    }
}
