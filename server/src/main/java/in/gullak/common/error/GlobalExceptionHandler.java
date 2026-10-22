package in.gullak.common.error;

import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private static final String CHECK_FIELDS = "Check the highlighted fields";

    @ExceptionHandler(GullakException.class)
    ResponseEntity<ErrorBody> gullak(GullakException e) {
        if (e.code().warn()) {
            log.warn("error.expected code={}", e.code());
        }
        return ResponseEntity.status(e.status()).body(ErrorBody.of(e.code(), e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ErrorBody> invalidBody(MethodArgumentNotValidException e) {
        List<ErrorBody.FieldProblem> fields = e.getBindingResult().getFieldErrors().stream()
            .map(f -> new ErrorBody.FieldProblem(f.getField(), f.getDefaultMessage()))
            .toList();
        return badRequest(fields);
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    ResponseEntity<ErrorBody> invalidParameters(HandlerMethodValidationException e) {
        List<ErrorBody.FieldProblem> fields = e.getParameterValidationResults().stream()
            .flatMap(r -> r.getResolvableErrors().stream()
                .map(err -> new ErrorBody.FieldProblem(r.getMethodParameter().getParameterName(), err.getDefaultMessage())))
            .toList();
        return badRequest(fields);
    }

    @ExceptionHandler({
        HttpMessageNotReadableException.class,
        MethodArgumentTypeMismatchException.class,
        MissingServletRequestParameterException.class,
        MissingServletRequestPartException.class
    })
    ResponseEntity<ErrorBody> unreadable() {
        return badRequest(null);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ErrorBody> tooLarge() {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
            .body(ErrorBody.of(ErrorCode.TOO_LARGE, "That file is over 10 MB"));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ErrorBody> noRoute() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ErrorBody.of(ErrorCode.NOT_FOUND, "Not found"));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ErrorBody> wrongMethod() {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
            .body(ErrorBody.of(ErrorCode.METHOD_NOT_ALLOWED, "That action isn't supported here"));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ErrorBody> wrongMediaType() {
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
            .body(ErrorBody.of(ErrorCode.UNSUPPORTED_MEDIA_TYPE, "Send JSON"));
    }

    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    ResponseEntity<ErrorBody> notAcceptable() {
        return ResponseEntity.status(HttpStatus.NOT_ACCEPTABLE)
            .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
            .body(ErrorBody.of(ErrorCode.NOT_ACCEPTABLE, "Ask for JSON"));
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ErrorBody> accessDenied() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ErrorBody.of(ErrorCode.FORBIDDEN, "Not allowed"));
    }

    @ExceptionHandler(AuthenticationException.class)
    ResponseEntity<ErrorBody> unauthenticated() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(ErrorBody.of(ErrorCode.UNAUTHENTICATED, "Sign in to continue"));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorBody> unexpected(Exception e) {
        String errorId = UUID.randomUUID().toString();
        log.error("error.unexpected errorId={}", errorId, e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(new ErrorBody(ErrorCode.INTERNAL.name(), "Something went wrong", null, errorId));
    }

    private static ResponseEntity<ErrorBody> badRequest(List<ErrorBody.FieldProblem> fields) {
        return ResponseEntity.badRequest()
            .body(new ErrorBody(ErrorCode.VALIDATION.name(), CHECK_FIELDS, fields, null));
    }
}
