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
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

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
            .andExpect(jsonPath("$.message").value("Thing not found"));
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
}
