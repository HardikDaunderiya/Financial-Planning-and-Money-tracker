package in.gullak.common.error;

import org.springframework.http.HttpStatus;

public class ValidationException extends GullakException {
    public ValidationException(String message) {
        super(ErrorCode.VALIDATION, HttpStatus.BAD_REQUEST, message);
    }
}
