package in.gullak.common.log;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.ApiTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
class RequestLoggingApiTest extends ApiTest {

    @Test
    void oneRequestLinePerRequest(CapturedOutput out) throws Exception { // LOG-01
        mvc.perform(get("/test-probe/ok").with(user("u"))).andExpect(status().isOk());
        assertThat(out.getOut()).containsOnlyOnce("http method=GET route=/test-probe/ok status=200");
    }

    @Test
    void requestIdIsEchoedAndLogged(CapturedOutput out) throws Exception { // LOG-02
        mvc.perform(get("/test-probe/ok").with(user("u")).header("X-Request-Id", "req-12345678"))
            .andExpect(header().string("X-Request-Id", "req-12345678"));
        assertThat(out.getOut()).contains("[req-12345678]");
    }

    @Test
    void requestIdIsGeneratedWhenMissing() throws Exception { // LOG-02
        String id = mvc.perform(get("/test-probe/ok").with(user("u")))
            .andReturn().getResponse().getHeader("X-Request-Id");
        assertThat(id).matches("[0-9a-f-]{36}");
    }

    @Test
    void unsafeRequestIdIsReplaced(CapturedOutput out) throws Exception { // Review focus
        String evil = "abc\nFAKE LOG LINE";
        String id = mvc.perform(get("/test-probe/ok").with(user("u")).header("X-Request-Id", evil))
            .andReturn().getResponse().getHeader("X-Request-Id");
        assertThat(id).matches("[0-9a-f-]{36}");
        assertThat(out.getOut()).doesNotContain("FAKE LOG LINE");

        String tooLong = "a".repeat(500);
        String id2 = mvc.perform(get("/test-probe/ok").with(user("u")).header("X-Request-Id", tooLong))
            .andReturn().getResponse().getHeader("X-Request-Id");
        assertThat(id2).matches("[0-9a-f-]{36}");
    }

    @Test
    void unexpectedErrorLoggedOnceWithErrorId(CapturedOutput out) throws Exception { // LOG-04
        String body = mvc.perform(get("/test-probe/boom").with(user("u")))
            .andReturn().getResponse().getContentAsString();
        String errorId = JsonPath.read(body, "$.errorId");
        assertThat(out.getOut()).containsOnlyOnce("error.unexpected errorId=" + errorId);
        assertThat(out.getOut()).contains("ERROR");
    }
}
