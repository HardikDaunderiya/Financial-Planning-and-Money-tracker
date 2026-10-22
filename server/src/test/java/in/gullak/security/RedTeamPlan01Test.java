package in.gullak.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Red-team attacks on everything Plan 1 built. A failing test here is an open finding
 * (see docs/reports/red-team/plan-01.md); a passing one is a defended attack kept as a regression.
 */
class RedTeamPlan01Test extends ApiTest {

    // ===================================================================================
    // FINDINGS: these assert the secure behaviour and currently FAIL.
    // ===================================================================================

    /** RT-01 (Medium) API-X-08: a 1 MB JSON body must be refused with 413, even unauthenticated. */
    @Test
    void oneMegabyteJsonBodyOnPublicRouteIs413() throws Exception {
        String padding = "a".repeat(1024 * 1024);
        mvc.perform(post("/api/v1/auth/otp/request").with(freshIp())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + uniqueEmail() + "\",\"pad\":\"" + padding + "\"}"))
            .andExpect(status().is(413));
    }

    /** RT-01 (Medium) API-X-08: same on an authenticated route. */
    @Test
    void oneMegabyteJsonBodyOnFixedCostsIs413() throws Exception {
        TestUser a = signIn();
        String padding = "a".repeat(1024 * 1024);
        mvc.perform(post("/api/v1/me/fixed-costs").with(auth(a))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Rent\",\"amountPaise\":100,\"pad\":\"" + padding + "\"}"))
            .andExpect(status().is(413));
    }

    /** RT-02 (Medium) API-X-09: amounts sent as JSON strings must be rejected, not coerced. */
    @Test
    void fixedCostAmountAsStringIsRejected() throws Exception {
        TestUser a = signIn();
        mvc.perform(post("/api/v1/me/fixed-costs").with(auth(a))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Rent\",\"amountPaise\":\"100000\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    /** RT-02 (Medium) API-X-09: same for profile money fields. */
    @Test
    void profileIncomeAsStringIsRejected() throws Exception {
        TestUser a = signIn();
        putProfile(a, EXAMPLE_PROFILE.replace("5000000", "\"5000000\""))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    /** RT-02 (Medium) API-X-09: same for PATCH. */
    @Test
    void fixedCostPatchAmountAsStringIsRejected() throws Exception {
        TestUser a = signIn();
        String id = addFixedCost(a, "Rent", 100_000);
        mvc.perform(patch("/api/v1/me/fixed-costs/" + id).with(auth(a))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"amountPaise\":\"200000\"}"))
            .andExpect(status().isBadRequest());
    }

    /** RT-03 (Medium) Input limits / ERR: a NUL character in a text field must be a 400, not a 500. */
    @Test
    void nulCharacterInFixedCostNameIsValidationNotInternal() throws Exception {
        TestUser a = signIn();
        mvc.perform(post("/api/v1/me/fixed-costs").with(auth(a))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Re\\u0000nt\",\"amountPaise\":100000}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    /** RT-03 (Medium): same on PATCH. */
    @Test
    void nulCharacterInFixedCostPatchIsValidationNotInternal() throws Exception {
        TestUser a = signIn();
        String id = addFixedCost(a, "Rent", 100_000);
        mvc.perform(patch("/api/v1/me/fixed-costs/" + id).with(auth(a))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Re\\u0000nt\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    /**
     * RT-03 (Medium): a NUL in the sign-in {@code device} field must not burn the code and return 500.
     * The OTP is consumed in one transaction and the token insert fails in the next.
     */
    @Test
    void nulCharacterInDeviceDoesNotBurnTheCodeWith500() throws Exception {
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip).andExpect(status().isNoContent());
        String code = mailer.lastCodeFor(email);
        int status = mvc.perform(post("/api/v1/auth/otp/verify").with(ip)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"code\":\"" + code + "\",\"device\":\"ph\\u0000one\"}"))
            .andReturn().getResponse().getStatus();
        assertThat(status).as("verify with NUL in device").isIn(200, 400);
    }

    /**
     * RT-04 (Medium) 4.7: "Rate limits per email and per IP on OTP request and verify."
     * Verify has only a per-IP limit; from rotating IPs one email can be hit without any 429.
     */
    @Test
    void verifyIsRateLimitedPerEmailAcrossIps() throws Exception {
        String email = uniqueEmail();
        List<Integer> statuses = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            statuses.add(verifyCode(email, "123456", freshIp()).andReturn().getResponse().getStatus());
        }
        assertThat(statuses).as("40 verifies for one email from 40 IPs").contains(429);
    }

    // ===================================================================================
    // DEFENDED: regression tests for attacks that held.
    // ===================================================================================

    // --- Authorisation ---

    @Test
    void anotherUsersFixedCostCannotBeEditedOrDeletedAndStaysIntact() throws Exception {
        TestUser a = signIn();
        TestUser b = signIn();
        String bCost = addFixedCost(b, "Rent", 100_000);
        mvc.perform(patch("/api/v1/me/fixed-costs/" + bCost).with(auth(a))
                .contentType(MediaType.APPLICATION_JSON).content("{\"amountPaise\":1}"))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(delete("/api/v1/me/fixed-costs/" + bCost).with(auth(a)))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(b)))
            .andExpect(jsonPath("$[0].amountPaise").value(100_000));
    }

    @Test
    void randomAndMalformedFixedCostIdsAreNotFoundOrValidation() throws Exception {
        TestUser a = signIn();
        mvc.perform(delete("/api/v1/me/fixed-costs/" + UUID.randomUUID()).with(auth(a)))
            .andExpect(status().isNotFound());
        mvc.perform(delete("/api/v1/me/fixed-costs/1 OR 1=1").with(auth(a)))
            .andExpect(status().isBadRequest());
    }

    @Test
    void massAssignmentOnFixedCostIsIgnored() throws Exception {
        TestUser a = signIn();
        TestUser b = signIn();
        UUID chosen = UUID.randomUUID();
        String body = mvc.perform(post("/api/v1/me/fixed-costs").with(auth(a))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"" + chosen + "\",\"userId\":\"" + b.id()
                    + "\",\"user_id\":\"" + b.id() + "\",\"active\":false,\"name\":\"Rent\",\"amountPaise\":100}"))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(body, "$.id");
        assertThat(id).isNotEqualTo(chosen.toString());
        UUID owner = jdbc.sql("select user_id from fixed_costs where id = ?").param(UUID.fromString(id))
            .query(UUID.class).single();
        assertThat(owner).isEqualTo(a.id());
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(b))).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void deletedFixedCostCannotBeEditedOrRevived() throws Exception {
        TestUser a = signIn();
        String id = addFixedCost(a, "Rent", 100_000);
        mvc.perform(delete("/api/v1/me/fixed-costs/" + id).with(auth(a))).andExpect(status().isNoContent());
        mvc.perform(patch("/api/v1/me/fixed-costs/" + id).with(auth(a))
                .contentType(MediaType.APPLICATION_JSON).content("{\"amountPaise\":5}"))
            .andExpect(status().isNotFound());
    }

    // --- Authentication ---

    @Test
    void tokenSignedWithAnotherKeyIsRejected() throws Exception {
        TestUser a = signIn();
        String header = b64("{\"alg\":\"HS256\",\"typ\":\"JWT\"}");
        String payload = b64("{\"iss\":\"gullak\",\"sub\":\"" + a.id() + "\",\"exp\":9999999999}");
        String sig = hs256("attacker-key-attacker-key-attacker-key-0123", header + "." + payload);
        mvc.perform(get("/api/v1/me/fixed-costs").with(bearer(header + "." + payload + "." + sig)))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void hs512AlgorithmSwitchIsRejected() throws Exception {
        TestUser a = signIn();
        String header = b64("{\"alg\":\"HS512\"}");
        String payload = a.accessToken().split("\\.")[1];
        mvc.perform(get("/api/v1/me/fixed-costs").with(bearer(header + "." + payload + "." + a.accessToken().split("\\.")[2])))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void refreshTokenIsNotAnAccessTokenAndViceVersa() throws Exception {
        TestUser a = signIn();
        mvc.perform(get("/api/v1/me/fixed-costs").with(bearer(a.refreshToken())))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + a.accessToken().substring(0, 100) + "\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void basicAuthAndCookieTokensAreIgnored() throws Exception {
        TestUser a = signIn();
        mvc.perform(get("/api/v1/me/fixed-costs").header("Cookie", "access_token=" + a.accessToken()))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/me/fixed-costs").header("Authorization", "Basic dXNlcjpwYXNz"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void parallelVerifyWithTheRightCodeSignsInOnce() throws Exception {
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip).andExpect(status().isNoContent());
        String code = mailer.lastCodeFor(email);
        Callable<Integer> call = () -> verifyCode(email, code, freshIp()).andReturn().getResponse().getStatus();
        List<Integer> statuses = runParallel(call, 6);
        assertThat(statuses.stream().filter(s -> s == 200).count()).isEqualTo(1);
        Integer tokens = jdbc.sql("select count(*) from refresh_tokens t join users u on u.id = t.user_id where u.email = ?")
            .param(email).query(Integer.class).single();
        assertThat(tokens).isEqualTo(1);
    }

    @Test
    void parallelWrongGuessesCannotExceedFiveAttempts() throws Exception {
        String email = uniqueEmail();
        requestCode(email, freshIp()).andExpect(status().isNoContent());
        String right = mailer.lastCodeFor(email);
        String wrong = right.equals("000000") ? "111111" : "000000";
        runParallel(() -> verifyCode(email, wrong, freshIp()).andReturn().getResponse().getStatus(), 20);
        Integer attempts = jdbc.sql("select attempts from otp_codes where email = ? and consumed_at is null")
            .param(email).query(Integer.class).single();
        assertThat(attempts).isEqualTo(5);
        verifyCode(email, right, freshIp()).andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("OTP_LOCKED"));
    }

    @Test
    void emailCaseVariantsShareOneRateLimitBucket() throws Exception {
        String email = uniqueEmail();
        String[] variants = {email, email.toUpperCase(), "U" + email.substring(1), email, email.toUpperCase()};
        for (String v : variants) {
            requestCode(v, freshIp()).andExpect(status().isNoContent());
        }
        requestCode("USER" + email.substring(4), freshIp()).andExpect(status().isTooManyRequests());
    }

    @Test
    void oldCodeDiesWhenANewOneIsRequested() throws Exception {
        String email = uniqueEmail();
        requestCode(email, freshIp()).andExpect(status().isNoContent());
        String first = mailer.lastCodeFor(email);
        requestCode(email, freshIp()).andExpect(status().isNoContent());
        String second = mailer.lastCodeFor(email);
        if (!first.equals(second)) {
            verifyCode(email, first, freshIp()).andExpect(status().isUnauthorized());
        }
        verifyCode(email, second, freshIp()).andExpect(status().isOk());
    }

    @Test
    void otpRequestAnswersTheSameForKnownAndUnknownEmails() throws Exception { // SEC-12
        TestUser known = signIn();
        var r1 = requestCode(known.email(), freshIp()).andReturn().getResponse();
        var r2 = requestCode(uniqueEmail(), freshIp()).andReturn().getResponse();
        assertThat(r1.getStatus()).isEqualTo(r2.getStatus()).isEqualTo(204);
        assertThat(r1.getContentAsString()).isEqualTo(r2.getContentAsString()).isEmpty();
    }

    @Test
    void verifyCodeFormatIsStrict() throws Exception {
        String email = uniqueEmail();
        requestCode(email, freshIp()).andExpect(status().isNoContent());
        for (String code : new String[] {"12345", "1234567", "１２３４５６", "12345a", "' OR 1=1 --"}) {
            verifyCode(email, code, freshIp()).andExpect(status().isBadRequest());
        }
    }

    // --- Routing and filter-chain bypass ---

    @Test
    void pathTraversalThroughThePublicAuthMatcherDoesNotReachProtectedRoutes() throws Exception {
        TestUser a = signIn();
        String json = "{\"name\":\"Pwned\",\"amountPaise\":100}";
        String[] paths = {
            "/api/v1/auth/../me/fixed-costs",
            "/api/v1/auth/otp/request/../../../me/fixed-costs",
            "/api/v1/auth/..;/me/fixed-costs",
            "/api/v1/auth/%2e%2e/me/fixed-costs",
            "/api/v1/auth/..%2Fme/fixed-costs",
            "/api/v1/auth//../me/fixed-costs"
        };
        for (String p : paths) {
            int s = mvc.perform(post(URI.create(p)).contentType(MediaType.APPLICATION_JSON).content(json))
                .andReturn().getResponse().getStatus();
            assertThat(s).as(p).isBetween(400, 499);
        }
        Integer pwned = jdbc.sql("select count(*) from fixed_costs where name = 'Pwned'").query(Integer.class).single();
        assertThat(pwned).isZero();
        assertThat(a).isNotNull();
    }

    @Test
    void actuatorPathsOtherThanHealthAreNotFoundForSignedInUsers() throws Exception {
        TestUser a = signIn();
        for (String p : new String[] {"/actuator/env", "/actuator/heapdump", "/actuator/beans", "/actuator/mappings"}) {
            mvc.perform(get(p).with(auth(a))).andExpect(status().isNotFound());
        }
    }

    // --- Input ---

    @Test
    void injectionAndUnicodeStringsAreStoredAsText() throws Exception { // API-X-07
        TestUser a = signIn();
        String[] names = {"' OR 1=1 --", "Robert'); DROP TABLE users;--", "<script>alert(1)</script>",
            "‮evil‬", "किराया 🏠", "${jndi:ldap://x}"};
        for (String n : names) {
            String id = addFixedCost(a, n.replace("\\", "\\\\").replace("\"", "\\\""), 100);
            String stored = jdbc.sql("select name from fixed_costs where id = ?").param(UUID.fromString(id))
                .query(String.class).single();
            assertThat(stored).isEqualTo(n);
        }
        Integer users = jdbc.sql("select count(*) from users where id = ?").param(a.id()).query(Integer.class).single();
        assertThat(users).isEqualTo(1);
    }

    @Test
    void moneyFieldsRejectDecimalsNegativesZeroOverflowAndBooleans() throws Exception { // API-X-09
        TestUser a = signIn();
        for (String amount : new String[] {"1.5", "-100", "0", "999999901", "99999999999999999999", "true", "1e3", "null"}) {
            mvc.perform(post("/api/v1/me/fixed-costs").with(auth(a))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"Rent\",\"amountPaise\":" + amount + "}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION"));
        }
        putProfile(a, EXAMPLE_PROFILE.replace("5000000", "10000000001")).andExpect(status().isBadRequest());
        putProfile(a, EXAMPLE_PROFILE.replace("2000000", "-1")).andExpect(status().isBadRequest());
    }

    @Test
    void longStringsAreRejected() throws Exception {
        TestUser a = signIn();
        mvc.perform(post("/api/v1/me/fixed-costs").with(auth(a))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"" + "x".repeat(10_000) + "\",\"amountPaise\":100}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/me/fixed-costs").with(auth(a))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"" + "x".repeat(61) + "\",\"amountPaise\":100}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/auth/otp/request").with(freshIp())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + "a".repeat(250) + "@example.test\"}"))
            .andExpect(status().isBadRequest());
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip).andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/otp/verify").with(ip)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"code\":\"" + mailer.lastCodeFor(email)
                    + "\",\"device\":\"" + "d".repeat(61) + "\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void profileEnumsTimezoneAndPaydayAreValidated() throws Exception {
        TestUser a = signIn();
        putProfile(a, EXAMPLE_PROFILE.replace("\"paydayDay\":1", "\"paydayDay\":29")).andExpect(status().isBadRequest());
        putProfile(a, EXAMPLE_PROFILE.replace("\"paydayDay\":1", "\"paydayDay\":0")).andExpect(status().isBadRequest());
        putProfile(a, EXAMPLE_PROFILE.replace("Asia/Kolkata", "America/New_York")).andExpect(status().isBadRequest());
        putProfile(a, EXAMPLE_PROFILE.replace("Asia/Kolkata", "Asia/Kolkata\\nX")).andExpect(status().isBadRequest());
        putProfile(a, EXAMPLE_PROFILE.replace("CHILL", "ADMIN")).andExpect(status().isBadRequest());
        putProfile(a, EXAMPLE_PROFILE.replace("08:00", "25:00")).andExpect(status().isBadRequest());
        putProfile(a, EXAMPLE_PROFILE.replace("2000000", "5000000")).andExpect(status().is(422))
            .andExpect(jsonPath("$.code").value("NOT_POSSIBLE"));
    }

    @Test
    void fixedCostsCannotPushSpendableToZeroAfterSetup() throws Exception {
        TestUser a = exampleUser();
        mvc.perform(post("/api/v1/me/fixed-costs").with(auth(a))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Huge\",\"amountPaise\":1500000}"))
            .andExpect(status().is(422));
        mvc.perform(get("/api/v1/budget/today").with(auth(a))).andExpect(status().isOk());
    }

    @Test
    void todayIgnoresAnotherUsersSpends() throws Exception {
        TestUser a = exampleUser();
        TestUser b = exampleUser();
        seedSpend(b, 90_000, Instant.now(clock));
        mvc.perform(get("/api/v1/budget/today").with(auth(a)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.spentPaise").value(0));
    }

    // --- Races ---

    @Test
    void parallelDeletesOfOneFixedCostHaveOneEffect() throws Exception {
        TestUser a = signIn();
        String id = addFixedCost(a, "Rent", 100_000);
        List<Integer> statuses = runParallel(
            () -> mvc.perform(delete("/api/v1/me/fixed-costs/" + id).with(auth(a))).andReturn().getResponse().getStatus(), 5);
        assertThat(statuses).allMatch(s -> s == 204 || s == 404).contains(204);
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(a))).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void parallelRefreshesLeaveNoLiveToken() throws Exception {
        TestUser a = signIn();
        List<Integer> statuses = runParallel(() -> mvc.perform(post("/api/v1/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + a.refreshToken() + "\"}")).andReturn().getResponse().getStatus(), 5);
        assertThat(statuses.stream().filter(s -> s == 200).count()).isLessThanOrEqualTo(1);
        Integer live = jdbc.sql("select count(*) from refresh_tokens where user_id = ? and revoked_at is null and used_at is null")
            .param(a.id()).query(Integer.class).single();
        assertThat(live).isZero();
    }

    // --- Hygiene on API responses ---

    @Test
    void apiResponsesCarryNoSniffNoFrameAndNoStore() throws Exception {
        TestUser a = signIn();
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(a)))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andExpect(header().string("X-Frame-Options", "DENY"))
            .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")));
    }

    @Test
    void foreignOriginGetsNoCorsHeaders() throws Exception { // SEC-05 (negative half)
        TestUser a = signIn();
        mvc.perform(options("/api/v1/me/fixed-costs")
                .header("Origin", "https://evil.example")
                .header("Access-Control-Request-Method", "GET"))
            .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        mvc.perform(get("/api/v1/me/fixed-costs").with(auth(a)).header("Origin", "https://evil.example"))
            .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void injectedRequestIdIsReplaced() throws Exception {
        ResultActions r = mvc.perform(get("/actuator/health").header("X-Request-Id", "<script>alert(1)</script>"));
        r.andExpect(header().string("X-Request-Id", org.hamcrest.Matchers.matchesPattern("[A-Za-z0-9-]{8,64}")));
    }

    // ===================================================================================

    private List<Integer> runParallel(Callable<Integer> call, int n) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(n);
        try {
            List<Callable<Integer>> calls = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                calls.add(call);
            }
            List<Integer> out = new ArrayList<>();
            for (Future<Integer> f : pool.invokeAll(calls)) {
                out.add(f.get());
            }
            return out;
        } finally {
            pool.shutdown();
        }
    }

    private static String b64(String json) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }

    private static String hs256(String key, String data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
    }
}
