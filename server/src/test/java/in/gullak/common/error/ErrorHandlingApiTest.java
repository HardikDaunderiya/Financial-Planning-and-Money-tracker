package in.gullak.common.error;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

@ExtendWith(OutputCaptureExtension.class)
class ErrorHandlingApiTest extends ApiTest {

    @Test
    void validationListsEveryBadField() throws Exception { // ERR-02, API-X-02
        mvc.perform(post("/test-probe/validate").with(user("u"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"\",\"amountPaise\":-5}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"))
            .andExpect(jsonPath("$.message").value("Check the highlighted fields"))
            .andExpect(jsonPath("$.fields[*].field", containsInAnyOrder("name", "amountPaise")));
    }

    @Test
    void malformedJsonIsValidation() throws Exception { // ERR-03, API-X-05
        mvc.perform(post("/test-probe/validate").with(user("u"))
                .contentType(MediaType.APPLICATION_JSON).content("{nope"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    @Test
    void unknownFieldsAreIgnored() throws Exception { // API-X-06
        mvc.perform(post("/test-probe/validate").with(user("u"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"a\",\"amountPaise\":5,\"userId\":\"x\"}"))
            .andExpect(status().isOk());
    }

    @Test
    void notFoundHasShape() throws Exception { // API-X-02
        mvc.perform(get("/test-probe/not-found").with(user("u")))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("NOT_FOUND"))
            .andExpect(jsonPath("$.message").value("Thing not found"))
            .andExpect(jsonPath("$.fields").doesNotExist())
            .andExpect(jsonPath("$.errorId").doesNotExist());
    }

    @Test
    void unprocessableHasShape() throws Exception { // API-X-02
        mvc.perform(get("/test-probe/not-possible").with(user("u")))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("NOT_POSSIBLE"));
    }

    @Test
    void unexpectedExceptionIsGeneric() throws Exception { // ERR-01, ERR-04
        mvc.perform(get("/test-probe/boom").with(user("u")))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.code").value("INTERNAL"))
            .andExpect(jsonPath("$.message").value("Something went wrong"))
            .andExpect(jsonPath("$.errorId").isNotEmpty())
            .andExpect(content().string(not(containsString("secret internal detail"))))
            .andExpect(content().string(not(containsString("IllegalStateException"))));
    }

    @Test
    void unknownRouteIsNotFound() throws Exception { // API-X-03
        mvc.perform(get("/api/v1/does-not-exist").with(user("u")))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void wrongMethodIs405() throws Exception { // API-X-04
        mvc.perform(delete("/test-probe/ok").with(user("u")))
            .andExpect(status().isMethodNotAllowed())
            .andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"));
    }

    @Test
    void unauthenticatedHasShape() throws Exception { // API-AUTH-18
        mvc.perform(get("/test-probe/ok"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
            .andExpect(jsonPath("$.message").value("Sign in to continue"));
    }

    @Test
    void wrongContentTypeIs415() throws Exception {
        mvc.perform(post("/test-probe/validate").with(user("u"))
                .contentType(MediaType.TEXT_PLAIN).content("hi"))
            .andExpect(status().isUnsupportedMediaType())
            .andExpect(jsonPath("$.code").value("UNSUPPORTED_MEDIA_TYPE"));
    }

    @Test
    void badQueryParameterIsValidation() throws Exception {
        mvc.perform(get("/test-probe/echo?n=abc").with(user("u")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    @Test
    void missingQueryParameterIsValidation() throws Exception {
        mvc.perform(get("/test-probe/echo").with(user("u")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    @Test
    void validationExceptionKeepsMessage() throws Exception {
        mvc.perform(get("/test-probe/validation").with(user("u")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"))
            .andExpect(jsonPath("$.message").value("Pick a day"));
    }

    @Test
    void rateLimitedIs429AndWarns(CapturedOutput output) throws Exception {
        mvc.perform(get("/test-probe/rate-limited").with(user("u")))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.code").value("RATE_LIMITED"));
        org.assertj.core.api.Assertions.assertThat(output.getAll()).contains("error.expected code=RATE_LIMITED");
    }

    @Test
    void accessDeniedIs403NotInternal(CapturedOutput output) throws Exception {
        mvc.perform(get("/test-probe/denied").with(user("u")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("FORBIDDEN"))
            .andExpect(jsonPath("$.message").value("Not allowed"));
        org.assertj.core.api.Assertions.assertThat(output.getAll()).doesNotContain("error.unexpected");
    }

    @Test
    void authenticationExceptionIs401NotInternal(CapturedOutput output) throws Exception {
        mvc.perform(get("/test-probe/bad-credentials").with(user("u")))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
            .andExpect(jsonPath("$.message").value("Sign in to continue"));
        org.assertj.core.api.Assertions.assertThat(output.getAll()).doesNotContain("error.unexpected");
    }

    @Test
    void notAcceptableIs406() throws Exception {
        mvc.perform(get("/test-probe/ok").with(user("u")).accept(MediaType.APPLICATION_XML))
            .andExpect(status().isNotAcceptable())
            .andExpect(jsonPath("$.code").value("NOT_ACCEPTABLE"))
            .andExpect(jsonPath("$.message").value("Ask for JSON"));
    }
}
