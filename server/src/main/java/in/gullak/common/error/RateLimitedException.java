package in.gullak.common.error;

import org.springframework.http.HttpStatus;

public class RateLimitedException extends GullakException {
    public RateLimitedException() {
        super(ErrorCode.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS, "Too many tries. Wait a few minutes and try again.");
    }
}
