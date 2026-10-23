package in.gullak.common.error;

import org.springframework.http.HttpStatus;

public class UnprocessableException extends GullakException {
    public UnprocessableException(ErrorCode code, String message) {
        super(code, HttpStatus.UNPROCESSABLE_ENTITY, message);
    }
}
