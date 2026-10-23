package in.gullak.common.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorBody(String code, String message, List<FieldProblem> fields, String errorId) {
    public record FieldProblem(String field, String message) {}

    public static ErrorBody of(ErrorCode code, String message) {
        return new ErrorBody(code.name(), message, null, null);
    }
}
