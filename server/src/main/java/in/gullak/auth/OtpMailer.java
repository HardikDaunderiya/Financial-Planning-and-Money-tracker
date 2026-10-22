package in.gullak.auth;

public interface OtpMailer {
    void sendOtp(String email, String code);
}
