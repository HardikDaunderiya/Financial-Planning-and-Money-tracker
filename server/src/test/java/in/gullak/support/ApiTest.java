package in.gullak.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.TestcontainersConfiguration;
import in.gullak.auth.InMemoryOtpMailer;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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

    protected TestUser signIn() throws Exception {
        return signIn(uniqueEmail());
    }

    protected TestUser signIn(String email) throws Exception {
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip).andExpect(status().isNoContent());
        String body = verifyCode(email, mailer.lastCodeFor(email), ip)
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        UUID id = jdbc.sql("select id from users where email = ?").param(email).query(UUID.class).single();
        return new TestUser(id, email, JsonPath.read(body, "$.accessToken"), JsonPath.read(body, "$.refreshToken"));
    }

    protected static RequestPostProcessor auth(TestUser user) {
        return bearer(user.accessToken());
    }

    protected static RequestPostProcessor bearer(String token) {
        return request -> {
            request.addHeader("Authorization", "Bearer " + token);
            return request;
        };
    }

    protected static final String EXAMPLE_PROFILE = """
        {"incomePaise":5000000,"savingsPaise":2000000,"paydayRule":"FIXED_DAY","paydayDay":1,
         "personality":"CHILL","morningTime":"08:00","nightTime":"22:00","timezone":"Asia/Kolkata"}
        """;

    protected ResultActions putProfile(TestUser user, String json) throws Exception {
        return mvc.perform(put("/api/v1/me/profile").with(auth(user))
            .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    protected String addFixedCost(TestUser user, String name, long paise) throws Exception {
        String body = mvc.perform(post("/api/v1/me/fixed-costs").with(auth(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"" + name + "\",\"amountPaise\":" + paise + "}"))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }

    /** Signed in, fixed costs and profile saved, no cycle yet: the state right after setup. */
    protected TestUser newlySetUpUser() throws Exception {
        TestUser user = signIn();
        addFixedCost(user, "Rent", 1_000_000);
        addFixedCost(user, "Cook", 200_000);
        addFixedCost(user, "Maid", 150_000);
        addFixedCost(user, "Monthly groceries", 150_000);
        putProfile(user, EXAMPLE_PROFILE).andExpect(status().isOk());
        return user;
    }

    /**
     * The spec's example user, who has been in the 1-31 Oct 2026 cycle since payday: Rs 50,000 income,
     * Rs 15,000 fixed, Rs 20,000 savings. The cycle is seeded so the first cycle is not pro-rated (BUD-32).
     */
    protected TestUser exampleUser() throws Exception {
        TestUser user = newlySetUpUser();
        seedCycle(user, "2026-10-01", "2026-10-31");
        return user;
    }

    protected void seedCycle(TestUser user, String start, String end) {
        jdbc.sql("insert into cycles (id, user_id, start_date, end_date) values (?, ?, ?::date, ?::date)")
            .params(UUID.randomUUID(), user.id(), start, end)
            .update();
    }

    /** Plan 3 adds POST /transactions; until then tests insert spends directly. */
    protected void seedSpend(TestUser user, long paise, Instant at) {
        jdbc.sql("""
                insert into transactions (id, user_id, client_id, amount_paise, direction, occurred_at,
                    category_code, payment_method, source, status)
                values (?, ?, ?, ?, 'debit', ?, 'eating_out', 'upi', 'manual', 'pending')
                """)
            .params(UUID.randomUUID(), user.id(), UUID.randomUUID(), paise, OffsetDateTime.ofInstant(at, ZoneOffset.UTC))
            .update();
    }
}
