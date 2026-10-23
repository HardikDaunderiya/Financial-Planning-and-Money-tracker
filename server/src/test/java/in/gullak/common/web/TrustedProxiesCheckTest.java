package in.gullak.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * Behind a load balancer an empty trusted-proxy list makes every user share the balancer's IP, so the
 * per-IP OTP limit becomes one app-wide cap. The prod profile refuses to start that way.
 */
class TrustedProxiesCheckTest {
    private static final String PROPERTY = "server.tomcat.remoteip.internal-proxies";

    private static ApplicationContextRunner runner(String... profiles) {
        return new ApplicationContextRunner()
            .withInitializer(context -> context.getEnvironment().setActiveProfiles(profiles))
            .withUserConfiguration(TrustedProxiesCheck.class);
    }

    @Test
    void prodWithNoTrustedProxiesFailsToStart() {
        runner("prod").withPropertyValues(PROPERTY + "=").run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).rootCause().hasMessageContaining("GULLAK_TRUSTED_PROXIES");
        });
    }

    @Test
    void prodWithBlankTrustedProxiesFailsToStart() {
        runner("prod").withPropertyValues(PROPERTY + "=   ").run(context -> assertThat(context).hasFailed());
    }

    @Test
    void prodWithTheSettingMissingAltogetherFailsToStart() {
        runner("prod").run(context -> assertThat(context).hasFailed());
    }

    @Test
    void prodWithTrustedProxiesStarts() {
        runner("prod").withPropertyValues(PROPERTY + "=10\\.0\\.0\\.\\d{1,3}")
            .run(context -> assertThat(context).hasNotFailed().hasSingleBean(TrustedProxiesCheck.class));
    }

    @Test
    void otherProfilesMayLeaveItEmpty() {
        runner("local").withPropertyValues(PROPERTY + "=")
            .run(context -> assertThat(context).hasNotFailed().doesNotHaveBean(TrustedProxiesCheck.class));
    }
}
