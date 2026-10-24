// Reads the code the local server "mailed" (dev endpoint, local profile only).
const base = typeof GULLAK_API !== "undefined" ? GULLAK_API : "http://10.0.2.2:8080/api/v1";
const res = http.post(base + "/auth/dev/otp", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: output.email }),
});
if (!res.ok) throw new Error("dev otp failed: " + res.status);
output.code = json(res.body).code;
