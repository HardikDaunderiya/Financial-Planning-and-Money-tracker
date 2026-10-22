package in.gullak.common.error;

/** Every error code the API can return. The app mirrors this list. Later plans append codes. */
public enum ErrorCode {
    VALIDATION(false),
    UNAUTHENTICATED(false),
    TOKEN_EXPIRED(false),
    TOKEN_REUSED(true),
    OTP_INVALID(false),
    OTP_EXPIRED(false),
    OTP_LOCKED(true),
    RATE_LIMITED(true),
    FORBIDDEN(false),
    NOT_FOUND(false),
    METHOD_NOT_ALLOWED(false),
    UNSUPPORTED_MEDIA_TYPE(false),
    NOT_ACCEPTABLE(false),
    TOO_LARGE(false),
    NOT_POSSIBLE(false),
    SETUP_INCOMPLETE(false),
    INTERNAL(false);

    private final boolean warn;

    ErrorCode(boolean warn) {
        this.warn = warn;
    }

    /** True when this expected failure is worth a WARN log line. */
    public boolean warn() {
        return warn;
    }
}
