package in.gullak.common.error;

import org.springframework.http.HttpStatus;

public class GullakException extends RuntimeException {
    private final ErrorCode code;
    private final HttpStatus status;

    public GullakException(ErrorCode code, HttpStatus status, String message) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public ErrorCode code() { return code; }
    public HttpStatus status() { return status; }
}
