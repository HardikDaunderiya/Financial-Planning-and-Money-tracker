package in.gullak.common.web;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Rejects NUL and other control characters (including line breaks); null passes, use @NotNull for that. */
@Documented
@Constraint(validatedBy = SingleLineText.Validator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
public @interface SingleLineText {
    String message() default "must be plain text on one line";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<SingleLineText, CharSequence> {
        @Override
        public boolean isValid(CharSequence value, ConstraintValidatorContext context) {
            return value == null || value.chars().noneMatch(Character::isISOControl);
        }
    }
}
