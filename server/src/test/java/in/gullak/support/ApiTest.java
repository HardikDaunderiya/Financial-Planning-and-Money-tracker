package in.gullak.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import in.gullak.TestcontainersConfiguration;
import in.gullak.auth.InMemoryOtpMailer;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, TestClockConfig.class})
public abstract class ApiTest {
    @Autowired protected MockMvc mvc;
    @Autowired protected MutableClock clock;
    @Autowired protected JdbcClient jdbc;
    @Autowired protected InMemoryOtpMailer mailer;

    private static final AtomicInteger NEXT_IP = new AtomicInteger(1);

    @BeforeEach
    void resetClock() {
        clock.reset();
    }

    /** Each caller gets its own IP so per-IP rate limits never leak between tests. */
    protected static RequestPostProcessor freshIp() {
        int n = NEXT_IP.getAndIncrement();
        String ip = "10." + ((n >> 16) & 255) + "." + ((n >> 8) & 255) + "." + (n & 255);
        return request -> {
            request.setRemoteAddr(ip);
            return request;
        };
    }

    protected static String uniqueEmail() {
        return "user-" + UUID.randomUUID() + "@example.test";
    }

    protected ResultActions requestCode(String email, RequestPostProcessor ip) throws Exception {
        return mvc.perform(post("/api/v1/auth/otp/request").with(ip)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"email\":\"" + email + "\"}"));
    }

    protected ResultActions verifyCode(String email, String code, RequestPostProcessor ip) throws Exception {
        return mvc.perform(post("/api/v1/auth/otp/verify").with(ip)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"email\":\"" + email + "\",\"code\":\"" + code + "\",\"device\":\"test\"}"));
    }
}
