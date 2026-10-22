package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@ExtendWith(OutputCaptureExtension.class)
class OtpApiTest extends ApiTest {

    @Test
    void requestStoresOnlyAHashAndSendsTheCode() throws Exception { // API-AUTH-01
        String email = uniqueEmail();
        requestCode(email, freshIp()).andExpect(status().isNoContent());
        String code = mailer.lastCodeFor(email);
        assertThat(code).matches("\\d{6}");
        String stored = jdbc.sql("select code_hash from otp_codes where email = ?").param(email)
            .query(String.class).single();
        assertThat(stored).isNotEqualTo(code).hasSize(64);
    }

    @Test
    void existingAndNewEmailsGetTheSameAnswer() throws Exception { // API-AUTH-02
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip);
        verifyCode(email, mailer.lastCodeFor(email), ip).andExpect(status().isOk());
        String existing = requestCode(email, freshIp()).andExpect(status().isNoContent())
            .andReturn().getResponse().getContentAsString();
        String fresh = requestCode(uniqueEmail(), freshIp()).andExpect(status().isNoContent())
            .andReturn().getResponse().getContentAsString();
        assertThat(existing).isEqualTo(fresh).isEmpty();
    }

    @Test
    void badEmailIsValidation() throws Exception { // API-AUTH-03
        requestCode("not-an-email", freshIp())
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    @Test
    void sixthRequestForOneEmailIsRateLimited(CapturedOutput out) throws Exception { // API-AUTH-04, LOG-04
        String email = uniqueEmail();
        for (int i = 0; i < 5; i++) {
            requestCode(email, freshIp()).andExpect(status().isNoContent());
        }
        requestCode(email, freshIp())
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.code").value("RATE_LIMITED"));
        assertThat(out.getOut()).contains("WARN").contains("error.expected code=RATE_LIMITED");
    }

    @Test
    void thirtyFirstRequestFromOneIpIsRateLimited() throws Exception { // API-AUTH-05
        RequestPostProcessor ip = freshIp();
        for (int i = 0; i < 30; i++) {
            requestCode(uniqueEmail(), ip).andExpect(status().isNoContent());
        }
        requestCode(uniqueEmail(), ip).andExpect(status().isTooManyRequests());
    }

    @Test
    void rateLimitResetsAfterTheWindow() throws Exception { // API-AUTH-04
        String email = uniqueEmail();
        for (int i = 0; i < 5; i++) {
            requestCode(email, freshIp());
        }
        clock.advance(Duration.ofMinutes(11));
        requestCode(email, freshIp()).andExpect(status().isNoContent());
    }

    @Test
    void correctCodeSignsInAndConsumesTheCode() throws Exception { // API-AUTH-06, API-AUTH-10
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip);
        String code = mailer.lastCodeFor(email);
        verifyCode(email, code, ip)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.accessToken").isNotEmpty())
            .andExpect(jsonPath("$.refreshToken").isNotEmpty())
            .andExpect(jsonPath("$.expiresIn").value(900));
        verifyCode(email, code, ip)
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("OTP_INVALID"));
    }

    @Test
    void wrongCodeCountsAnAttempt() throws Exception { // API-AUTH-07
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip);
        verifyCode(email, wrongCode(mailer.lastCodeFor(email)), ip)
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("OTP_INVALID"));
        Integer attempts = jdbc.sql("select attempts from otp_codes where email = ?").param(email)
            .query(Integer.class).single();
        assertThat(attempts).isEqualTo(1);
    }

    @Test
    void sixthAttemptIsLockedEvenWithTheRightCode(CapturedOutput out) throws Exception { // API-AUTH-08, LOG-04
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip);
        String code = mailer.lastCodeFor(email);
        for (int i = 0; i < 5; i++) {
            verifyCode(email, wrongCode(code), ip).andExpect(jsonPath("$.code").value("OTP_INVALID"));
        }
        verifyCode(email, code, ip)
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("OTP_LOCKED"));
        assertThat(out.getOut()).contains("error.expected code=OTP_LOCKED");
    }

    @Test
    void expiredCodeIsRejected() throws Exception { // API-AUTH-09
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip);
        String code = mailer.lastCodeFor(email);
        clock.advance(Duration.ofMinutes(11));
        verifyCode(email, code, ip)
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("OTP_EXPIRED"));
    }

    @Test
    void codeForOneEmailDoesNotWorkForAnother() throws Exception { // API-AUTH-11
        String a = uniqueEmail();
        String b = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(a, ip);
        verifyCode(b, mailer.lastCodeFor(a), ip)
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("OTP_INVALID"));
    }

    @Test
    void emailIsNormalised() throws Exception { // Review focus
        String id = UUID.randomUUID().toString().substring(0, 8);
        String messy = "  Priya." + id + "@Example.TEST ";
        String clean = "priya." + id + "@example.test";
        RequestPostProcessor ip = freshIp();
        requestCode(messy.trim(), ip).andExpect(status().isNoContent());
        verifyCode(clean, mailer.lastCodeFor(clean), ip).andExpect(status().isOk());
        requestCode(clean, freshIp());
        verifyCode(messy.trim(), mailer.lastCodeFor(clean), freshIp()).andExpect(status().isOk());
        Integer users = jdbc.sql("select count(*) from users where email = ?").param(clean)
            .query(Integer.class).single();
        assertThat(users).isEqualTo(1);
    }

    @Test
    void codesAndEmailsNeverReachTheLog(CapturedOutput out) throws Exception { // LOG-05 (auth part)
        String email = uniqueEmail();
        RequestPostProcessor ip = freshIp();
        requestCode(email, ip);
        String code = mailer.lastCodeFor(email);
        verifyCode(email, code, ip);
        assertThat(out.getOut()).doesNotContain(email).doesNotContain(code);
    }

    private static String wrongCode(String code) {
        return code.equals("000000") ? "111111" : "000000";
    }
}
