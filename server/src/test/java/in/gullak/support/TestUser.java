package in.gullak.support;

import java.util.UUID;

public record TestUser(UUID id, String email, String accessToken, String refreshToken) {}
