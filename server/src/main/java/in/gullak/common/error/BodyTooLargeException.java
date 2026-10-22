package in.gullak.common.error;

import java.io.IOException;

/** Thrown from the request stream when a chunked body passes the size limit; mapped to 413. */
public class BodyTooLargeException extends IOException {
    public BodyTooLargeException() {
        super("Request body too large");
    }
}
