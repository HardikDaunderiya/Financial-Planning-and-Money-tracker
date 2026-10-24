package in.gullak.common.config;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Local development only: lets the Expo web dev server (a different port on localhost) call the API.
 * Every other profile has no CORS source, so browsers get no CORS headers. Plan 9 adds the real web
 * origin, cookies and the CSRF header for production.
 */
@Configuration
@Profile("local")
class DevCorsConfig {

    /** Its own type so it never clashes with Spring MVC's built-in CorsConfigurationSource bean. */
    record DevCors(CorsConfigurationSource source) {}

    @Bean
    DevCors devCors(
            @Value("${gullak.dev.web-origins:http://localhost:8081,http://localhost:8082,http://localhost:19006}")
            List<String> origins) {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(origins);
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "X-Request-Id"));
        cors.setExposedHeaders(List.of("X-Request-Id"));
        cors.setAllowCredentials(false);
        cors.setMaxAge(600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", cors);
        return new DevCors(source);
    }
}
