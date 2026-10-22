package in.gullak.auth;

import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class TokenService {
    private final AuthProperties props;

    TokenService(AuthProperties props) {
        this.props = props;
    }

    public TokenPair issue(UUID userId, String device) {
        return new TokenPair("pending-task-6-" + UUID.randomUUID(), "pending-task-6-" + UUID.randomUUID(),
            props.accessTtl().toSeconds());
    }
}
