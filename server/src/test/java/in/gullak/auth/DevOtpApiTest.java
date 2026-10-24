package in.gullak.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Profile;
import org.springframework.http.MediaType;

class DevOtpApiTest extends ApiTest {

    @Test
    void theDevRouteDoesNotExistOutsideTheLocalProfile() throws Exception { // API-X-03 shape, no leak
        String email = uniqueEmail();
        requestCode(email, freshIp()).andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/dev/otp").with(freshIp()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("NOT_FOUND"))
            .andExpect(jsonPath("$.code").isString());
    }

    @Test
    void theControllerIsBoundToTheLocalProfileOnly() {
        Profile profile = DevOtpController.class.getAnnotation(Profile.class);
        assertThat(profile).isNotNull();
        assertThat(profile.value()).containsExactly("local");
    }
}
