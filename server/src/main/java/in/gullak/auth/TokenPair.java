package in.gullak.auth;

public record TokenPair(String accessToken, String refreshToken, long expiresIn) {}
