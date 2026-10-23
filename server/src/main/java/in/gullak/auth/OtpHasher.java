package in.gullak.auth;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/** HMAC with a server-side pepper, so a leaked table does not reveal codes. */
@Component
class OtpHasher {
    private final SecretKeySpec key;

    OtpHasher(AuthProperties props) {
        this.key = new SecretKeySpec(props.otpPepper().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    String hash(String email, String code) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return HexFormat.of().formatHex(mac.doFinal((email + ":" + code).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 is not available", e);
        }
    }

    boolean matches(String email, String code, String expectedHash) {
        return MessageDigest.isEqual(
            hash(email, code).getBytes(StandardCharsets.UTF_8),
            expectedHash.getBytes(StandardCharsets.UTF_8));
    }
}
