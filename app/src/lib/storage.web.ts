import type { TokenStore, Tokens } from "./storage";
export type { TokenStore, Tokens } from "./storage";

let current: Tokens | null = null;

/**
 * Web: tokens stay in memory only (SEC-07). A reload signs out until Plan 9 moves the refresh token
 * into an httpOnly cookie. Nothing is ever written to localStorage, sessionStorage or document.cookie.
 */
export const tokenStore: TokenStore = {
  load: () => Promise.resolve(current),
  save: (tokens) => {
    current = tokens;
    return Promise.resolve();
  },
  clear: () => {
    current = null;
    return Promise.resolve();
  },
};
