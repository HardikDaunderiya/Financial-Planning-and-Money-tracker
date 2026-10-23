import { createApi } from "./api";
import { tokenStore } from "./storage";

const baseUrl = process.env.EXPO_PUBLIC_API_URL;
if (!baseUrl) {
  throw new Error("EXPO_PUBLIC_API_URL is not set; copy app/.env.example to app/.env");
}

type Listener = () => void;
const signedOutListeners = new Set<Listener>();

/** Fired when the server rejected a refresh: the session is gone and the UI must return to login. */
export const authEvents = {
  onSignedOut(listener: Listener): () => void {
    signedOutListeners.add(listener);
    return () => signedOutListeners.delete(listener);
  },
};

export const api = createApi({
  baseUrl,
  tokens: tokenStore,
  onSignedOut: () => signedOutListeners.forEach((l) => l()),
});
