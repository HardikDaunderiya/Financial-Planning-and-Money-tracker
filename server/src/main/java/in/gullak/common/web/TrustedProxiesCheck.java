package in.gullak.common.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Production runs behind a load balancer. With no trusted proxy, every request appears to come from the
 * balancer's IP, so the per-IP OTP limit turns into one cap for the whole app. Refuse to start instead.
 */
@Component
@Profile("prod")
class TrustedProxiesCheck {

    TrustedProxiesCheck(@Value("${server.tomcat.remoteip.internal-proxies:}") String trustedProxies) {
        if (trustedProxies == null || trustedProxies.isBlank()) {
            throw new IllegalStateException("GULLAK_TRUSTED_PROXIES must be set in prod: a regex matching the load "
                + "balancer's address. Without it every user shares the balancer's IP and per-IP rate limits "
                + "become app-wide.");
        }
    }
}
