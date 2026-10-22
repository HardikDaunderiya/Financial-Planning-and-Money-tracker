package in.gullak.common.error;

import org.springframework.http.HttpStatus;

public class NotFoundException extends GullakException {
    public NotFoundException(String thing) {
        super(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, thing + " not found");
    }
}
