import { api } from "@/lib/client";
import type { Tokens } from "@/lib/storage";

export type TokenPair = Tokens & { expiresIn: number };

const device = (process.env.EXPO_OS ?? "unknown").slice(0, 60);

export const authApi = {
  requestCode: (email: string) => api.post<void>("/auth/otp/request", { email }, { auth: false }),
  verifyCode: (email: string, code: string) =>
    api.post<TokenPair>("/auth/otp/verify", { email, code, device }, { auth: false }),
  logout: (refreshToken: string) => api.post<void>("/auth/logout", { refreshToken }, { auth: false }),
};
