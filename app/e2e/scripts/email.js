// A fresh address per run so the server's one-live-code rule and rate limits never collide between runs.
output.email = "e2e-" + Date.now() + "@example.test";
