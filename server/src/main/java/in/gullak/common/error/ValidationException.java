package in.gullak.common.error;

import org.springframework.http.HttpStatus;

public class ValidationException extends GullakException {
    private final String field;

    public ValidationException(String message) {
        this(null, message);
    }

    /** A business-rule failure on one request field, reported in {@code fields} so the app can highlight it. */
    public ValidationException(String field, String message) {
        super(ErrorCode.VALIDATION, HttpStatus.BAD_REQUEST, message);
        this.field = field;
    }

    /** The request field at fault, or null when the problem is not about one field. */
    public String field() { return field; }
}
