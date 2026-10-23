package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

class TokenApiTest extends ApiTest {
    @Autowired JwtEncoder encoder;

    @Test
    void accessTokenIdentifiesTheUser() throws Exception { // API-AUTH-06
        TestUser u = signIn();
        mvc.perform(get("/test-probe/whoami").with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.userId").value(u.id().toString()));
    }

    @Test
    void refreshRotatesTheToken() throws Exception { // API-AUTH-12
        TestUser u = signIn();
        String body = refresh(u.refreshToken()).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String newRefresh = JsonPath.read(body, "$.refreshToken");
        String newAccess = JsonPath.read(body, "$.accessToken");
        assertThat(newRefresh).isNotEqualTo(u.refreshToken());
        mvc.perform(get("/test-probe/whoami").with(bearer(newAccess))).andExpect(status().isOk());
    }

    @Test
    void reusingASpentRefreshTokenRevokesEverySession() throws Exception { // API-AUTH-13
        TestUser u = signIn();
        String body = refresh(u.refreshToken()).andReturn().getResponse().getContentAsString();
        String newRefresh = JsonPath.read(body, "$.refreshToken");
        refresh(u.refreshToken())
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("TOKEN_REUSED"));
        refresh(newRefresh).andExpect(status().isUnauthorized());
    }

    @Test
    void reuseAlsoRevokesOtherDevices() throws Exception { // API-AUTH-13
        TestUser phone = signIn();
        TestUser laptop = signIn(phone.email());
        refresh(phone.refreshToken());
        refresh(phone.refreshToken()).andExpect(jsonPath("$.code").value("TOKEN_REUSED"));
        refresh(laptop.refreshToken()).andExpect(status().isUnauthorized());
    }

    @Test
    void expiredRefreshTokenIsRejected() throws Exception { // API-AUTH-14
        TestUser u = signIn();
        clock.advance(Duration.ofDays(31));
        refresh(u.refreshToken())
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("TOKEN_EXPIRED"));
    }

    @Test
    void logoutEndsTheSession() throws Exception { // API-AUTH-15, API-AUTH-17
        TestUser u = signIn();
        mvc.perform(post("/api/v1/auth/logout").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + u.refreshToken() + "\"}"))
            .andExpect(status().isNoContent());
        refresh(u.refreshToken()).andExpect(status().isUnauthorized());
    }

    @Test
    void unknownRefreshTokenIsUnauthenticated() throws Exception {
        refresh("not-a-real-token")
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void expiredAccessTokenIsRejected() throws Exception { // API-AUTH-19
        TestUser u = signIn();
        clock.advance(Duration.ofMinutes(16));
        mvc.perform(get("/test-probe/whoami").with(auth(u)))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("TOKEN_EXPIRED"));
    }

    @Test
    void tamperedTokenIsRejected() throws Exception { // API-AUTH-20
        TestUser u = signIn();
        String[] parts = u.accessToken().split("\\.");
        String otherSubject = Base64.getUrlEncoder().withoutPadding().encodeToString(
            "{\"iss\":\"gullak\",\"sub\":\"00000000-0000-0000-0000-000000000000\",\"exp\":9999999999}"
                .getBytes(StandardCharsets.UTF_8));
        mvc.perform(get("/test-probe/whoami").with(bearer(parts[0] + "." + otherSubject + "." + parts[2])))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void algNoneIsRejected() throws Exception { // API-AUTH-21
        TestUser u = signIn();
        String header = Base64.getUrlEncoder().withoutPadding()
            .encodeToString("{\"alg\":\"none\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String payload = u.accessToken().split("\\.")[1];
        mvc.perform(get("/test-probe/whoami").with(bearer(header + "." + payload + ".")))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void tokenInQueryStringIsIgnored() throws Exception { // SEC-13
        TestUser u = signIn();
        mvc.perform(get("/test-probe/whoami").param("access_token", u.accessToken()))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void parallelRefreshWithSameTokenRevokesFamily() throws Exception { // Review focus
        TestUser u = signIn();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        Callable<Integer> call = () -> refresh(u.refreshToken()).andReturn().getResponse().getStatus();
        List<Future<Integer>> results = pool.invokeAll(List.of(call, call));
        pool.shutdown();
        List<Integer> statuses = List.of(results.get(0).get(), results.get(1).get());
        assertThat(statuses).containsExactlyInAnyOrder(200, 401);
        Integer live = jdbc.sql("select count(*) from refresh_tokens where user_id = ? and revoked_at is null and used_at is null")
            .param(u.id()).query(Integer.class).single();
        assertThat(live).isZero();
    }

    // --- Bearer headers on the public auth routes are ignored ---

    @Test
    void refreshWorksWithAnExpiredBearerHeader() throws Exception {
        TestUser u = signIn();
        clock.advance(Duration.ofMinutes(16));
        refresh(u.refreshToken(), auth(u)).andExpect(status().isOk());
    }

    @Test
    void refreshWorksWithAGarbageBearerHeader() throws Exception {
        TestUser u = signIn();
        refresh(u.refreshToken(), bearer("garbage")).andExpect(status().isOk());
    }

    @Test
    void logoutWorksWithAnExpiredBearerHeader() throws Exception {
        TestUser u = signIn();
        clock.advance(Duration.ofMinutes(16));
        logout(u.refreshToken(), auth(u)).andExpect(status().isNoContent());
        refresh(u.refreshToken()).andExpect(status().isUnauthorized());
        Integer live = jdbc.sql("select count(*) from refresh_tokens where user_id = ? and revoked_at is null")
            .param(u.id()).query(Integer.class).single();
        assertThat(live).isZero();
    }

    @Test
    void accessTokenInAFormBodyIsIgnored() throws Exception { // SEC-13
        TestUser u = signIn();
        mvc.perform(post("/test-probe/whoami").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .content("access_token=" + u.accessToken()))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void tokenFromAnotherIssuerIsRejected() throws Exception {
        TestUser u = signIn();
        Instant now = clock.instant();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer("evil").subject(u.id().toString()).issuedAt(now).expiresAt(now.plus(Duration.ofMinutes(15)))
            .build();
        String forged = encoder.encode(
            JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        mvc.perform(get("/test-probe/whoami").with(bearer(forged)))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    // --- A spent token is not a sign-out-everywhere switch unless it was rotated away ---

    @Test
    void refreshAfterLogoutLeavesOtherDevicesSignedIn() throws Exception {
        TestUser phone = signIn();
        TestUser laptop = signIn(phone.email());
        logout(phone.refreshToken()).andExpect(status().isNoContent());
        refresh(phone.refreshToken())
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        refresh(laptop.refreshToken()).andExpect(status().isOk());
    }

    @Test
    void usedTokenPresentedAfterExpiryIsExpiredAndRevokesNothing() throws Exception {
        TestUser u = signIn();
        String second = JsonPath.read(refresh(u.refreshToken()).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString(), "$.refreshToken");
        clock.advance(Duration.ofDays(29));
        String third = JsonPath.read(refresh(second).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString(), "$.refreshToken");
        clock.advance(Duration.ofDays(2));
        refresh(u.refreshToken())
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("TOKEN_EXPIRED"));
        refresh(third).andExpect(status().isOk());
    }

    @Test
    void logoutWithARotatedAwayTokenRevokesEverySession() throws Exception {
        TestUser phone = signIn();
        TestUser laptop = signIn(phone.email());
        String newPhone = JsonPath.read(refresh(phone.refreshToken()).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString(), "$.refreshToken");
        logout(phone.refreshToken()).andExpect(status().isNoContent());
        refresh(laptop.refreshToken()).andExpect(status().isUnauthorized());
        refresh(newPhone).andExpect(status().isUnauthorized());
    }

    @Test
    void logoutWithAUsedTokenPastItsExpiryRevokesNothing() throws Exception { // M-1, API-AUTH-13b
        TestUser phone = signIn();
        refresh(phone.refreshToken()).andExpect(status().isOk()); // phone's first token is now used
        TestUser laptop = signIn(phone.email());
        clock.advance(Duration.ofDays(29));
        String laptopNow = JsonPath.read(refresh(laptop.refreshToken()).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString(), "$.refreshToken");
        clock.advance(Duration.ofDays(2)); // phone's first token is now past its 30 days
        logout(phone.refreshToken()).andExpect(status().isNoContent());
        refresh(laptopNow).andExpect(status().isOk());
    }

    private ResultActions refresh(String token, RequestPostProcessor extra)
            throws Exception {
        return mvc.perform(post("/api/v1/auth/refresh").with(extra).contentType(MediaType.APPLICATION_JSON)
            .content("{\"refreshToken\":\"" + token + "\"}"));
    }

    private ResultActions logout(String token) throws Exception {
        return mvc.perform(post("/api/v1/auth/logout").contentType(MediaType.APPLICATION_JSON)
            .content("{\"refreshToken\":\"" + token + "\"}"));
    }

    private ResultActions logout(String token, RequestPostProcessor extra)
            throws Exception {
        return mvc.perform(post("/api/v1/auth/logout").with(extra).contentType(MediaType.APPLICATION_JSON)
            .content("{\"refreshToken\":\"" + token + "\"}"));
    }

    private ResultActions refresh(String token) throws Exception {
        return mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
            .content("{\"refreshToken\":\"" + token + "\"}"));
    }
}
