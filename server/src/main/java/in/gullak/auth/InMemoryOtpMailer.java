package in.gullak.auth;

import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Local and test only. Keeps the last code per email in memory and never logs it. */
@Component
@Profile({"local", "test"})
public class InMemoryOtpMailer implements OtpMailer {
    private final ConcurrentHashMap<String, String> last = new ConcurrentHashMap<>();

    @Override
    public void sendOtp(String email, String code) {
        last.put(email, code);
    }

    public String lastCodeFor(String email) {
        return last.get(Emails.normalize(email));
    }
}
