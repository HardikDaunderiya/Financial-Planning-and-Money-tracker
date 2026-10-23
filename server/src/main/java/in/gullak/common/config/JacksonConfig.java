package in.gullak.common.config;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.type.LogicalType;

@Configuration
class JacksonConfig {
    /** Money fields are numbers: "100000" as a string is refused, not coerced (API-X-09). */
    @Bean
    JsonMapperBuilderCustomizer noStringToIntegerCoercion() {
        return builder -> builder.withCoercionConfig(LogicalType.Integer,
            c -> c.setCoercion(CoercionInputShape.String, CoercionAction.Fail));
    }
}
