package in.gullak.common.config;

import in.gullak.common.error.JsonAuthHandlers;
import in.gullak.common.log.UserMdcFilter;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

@Configuration
@EnableWebSecurity
public class SecurityConfig {
    /**
     * Public sign-in routes: no access token is read or required here, so an expired or junk
     * {@code Authorization} header cannot block a refresh or logout. Any future /auth endpoint
     * that needs a token must move outside this matcher.
     */
    static final RequestMatcher PUBLIC_AUTH =
        PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.POST, "/api/v1/auth/**");

    @Bean
    SecurityFilterChain api(HttpSecurity http, JsonAuthHandlers handlers,
                            ObjectProvider<DevCorsConfig.DevCors> devCors) throws Exception {
        // CORS only under the `local` profile (DevCorsConfig); otherwise browsers get no CORS headers.
        DevCorsConfig.DevCors cors = devCors.getIfAvailable();
        if (cors != null) {
            http.cors(c -> c.configurationSource(cors.source()));
        } else {
            http.cors(c -> c.disable());
        }
        http.csrf(c -> c.disable())
            .httpBasic(b -> b.disable())
            .formLogin(f -> f.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers(HttpMethod.GET, "/actuator/health").permitAll()
                // Anything else under /actuator is not exposed: let it fall through to a 404, not a 401.
                .requestMatchers("/actuator/**").permitAll()
                .requestMatchers(PUBLIC_AUTH).permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o
                .bearerTokenResolver(bearerTokens())
                .jwt(Customizer.withDefaults())
                .authenticationEntryPoint(handlers))
            .exceptionHandling(e -> e.authenticationEntryPoint(handlers).accessDeniedHandler(handlers))
            .addFilterAfter(new UserMdcFilter(), BearerTokenAuthenticationFilter.class);
        return http.build();
    }

    /** Header-only bearer tokens (query and form tokens stay off), ignored on {@link #PUBLIC_AUTH}. */
    static BearerTokenResolver bearerTokens() {
        DefaultBearerTokenResolver header = new DefaultBearerTokenResolver();
        return request -> PUBLIC_AUTH.matches(request) ? null : header.resolve(request);
    }
}
