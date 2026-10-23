package in.gullak.common.error;

import org.springframework.http.HttpStatus;

public class AuthException extends GullakException {
    public AuthException(ErrorCode code, String message) {
        super(code, HttpStatus.UNAUTHORIZED, message);
    }
}
