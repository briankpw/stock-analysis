/**
 * Shared authentication configuration.
 *
 * Deliberately zero Node-specific imports so this module can be pulled
 * into the edge-runtime `middleware.ts` and the Node-runtime API routes
 * from the same source. Everything is derived from `process.env`, which
 * both runtimes expose.
 *
 * Three auth modes, in precedence order:
 *
 *   * `"credentials"` — `APP_USERNAME` AND `APP_PASSWORD` are set. The
 *     login UI shows a username + password form. The expected shared
 *     secret is the literal string `<user>:<pass>`; that's what the
 *     login route bakes into the `app_token` cookie and what the
 *     middleware compares against on every request. CLI callers can
 *     still authenticate via `Authorization: Bearer <user>:<pass>`.
 *
 *   * `"token"` — only `APP_TOKEN` is set. Single-field login form.
 *     The cookie carries that token verbatim.
 *
 *   * `"none"` — neither is set. Middleware short-circuits every check;
 *     the login page auto-redirects home; the auth-status widget in
 *     the sidebar hides itself.
 *
 * Credentials take precedence over a bare token when both are set —
 * "more specific" wins, and this way an operator wanting to migrate
 * from token-only to user/pass just needs to add the two new vars.
 */

export type AuthMode = "none" | "token" | "credentials";

function trim(s: string | undefined): string {
  return s?.trim() || "";
}

const APP_TOKEN = trim(process.env.APP_TOKEN);
const APP_USERNAME = trim(process.env.APP_USERNAME);
const APP_PASSWORD = trim(process.env.APP_PASSWORD);

const HAS_CREDENTIALS = Boolean(APP_USERNAME && APP_PASSWORD);
const HAS_TOKEN = Boolean(APP_TOKEN);

/** Which authentication mode the server is running in. */
export function authMode(): AuthMode {
  if (HAS_CREDENTIALS) return "credentials";
  if (HAS_TOKEN) return "token";
  return "none";
}

/** True when SOME auth is configured (either mode). */
export function authRequired(): boolean {
  return HAS_CREDENTIALS || HAS_TOKEN;
}

/**
 * The single string value that the middleware and cookie compare
 * against. Empty string when no auth is configured.
 *
 * IMPORTANT: In credentials mode this is literally `user:pass`. That
 * means the `app_token` cookie contains the password in plaintext.
 * The cookie is HttpOnly + SameSite=Lax + Secure-on-HTTPS, so browser
 * JavaScript can't read it and it's never sent cross-site. This is
 * the same threat model as a shared bearer token — an attacker with
 * cookie-jar access already has full access. Hashing here would only
 * cost us reversibility (useful for CLI Authorization headers) with
 * no material security gain.
 */
export function expectedSecret(): string {
  if (HAS_CREDENTIALS) return `${APP_USERNAME}:${APP_PASSWORD}`;
  if (HAS_TOKEN) return APP_TOKEN;
  return "";
}

/**
 * Constant-time-ish string comparison. Guards against timing oracles
 * that could leak the length or first-differing byte of the expected
 * secret. Not a substitute for `crypto.timingSafeEqual` in threat
 * models that assume a local co-tenant, but appropriate for the
 * network-attacker model this app targets.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Validate a raw `Authorization: Bearer` value / cookie. */
export function validatePresentedSecret(presented: string): boolean {
  const expected = expectedSecret();
  if (!expected) return false;
  return safeEqual(presented, expected);
}

/** Validate a username + password pair against APP_USERNAME/APP_PASSWORD. */
export function validateCredentials(username: string, password: string): boolean {
  if (!HAS_CREDENTIALS) return false;
  // Run both compares even when the first fails so total time is
  // independent of which field mismatched.
  const okUser = safeEqual(username, APP_USERNAME);
  const okPass = safeEqual(password, APP_PASSWORD);
  return okUser && okPass;
}

/** Validate a legacy bearer token against APP_TOKEN. */
export function validateToken(token: string): boolean {
  if (!HAS_TOKEN) return false;
  return safeEqual(token, APP_TOKEN);
}
