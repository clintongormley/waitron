// A bare side-effect import so TypeScript augments the real "@waitron/shared" module rather than
// declaring a fresh ambient one — the idiom packages/core, packages/credentials use.
import "@waitron/shared";

/**
 * packages/identity's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention, never the package name. NO PARAM HERE EVER
 * CARRIES A PIN OR A HASH: a credential must not reach a log line, a stack trace, or a test name.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** No open session for this id — unknown, already ended, or another tenant's (RLS-hidden). */
    "session.not_open": { sessionId: string };
    /** No live management session for this id — unknown, already ended, or another tenant's
     * (RLS-hidden). The browser must sign in again. */
    "management_session.required": Record<string, never>;
    /** The management session idled past the timeout and is no longer live. Sign in again. */
    "management_session.expired": Record<string, never>;
    /** The PIN did not verify against the stored hash (login or override). */
    "pin.invalid": Record<string, never>;
    /** A PIN below the minimum length was supplied to create/reset. `min` is the policy, never the
     * PIN. */
    "pin.too_short": { min: number };
    /** A password below the minimum length was supplied. `min` is the policy, never the password. */
    "password.too_short": { min: number };
    /** The password did not verify against the stored hash. */
    "password.invalid": Record<string, never>;
    /** The TOTP token did not verify against the stored secret (or was malformed — fail-closed). */
    "totp.invalid": Record<string, never>;
    /** No such person in this tenant (RLS-scoped): unknown id, or another tenant's. */
    "person.not_found": { personId: string };
    /** The person exists but is suspended — cannot log in or authorize. */
    "person.suspended": { personId: string };
    /** Neither the session's operator nor any supplied override holds the required permission. */
    "authorization.not_permitted": { permission: string };
    /** No passkey is registered for this person (or no credential matched the returned id) — they
     * must enroll one, or sign in another way. */
    "passkey.not_registered": Record<string, never>;
    /** The WebAuthn ceremony did not verify: the authenticator's response failed the library's
     * checks, or the challenge handle matched no live row — never issued, or already consumed by an
     * earlier finish (the single-use consume-DELETE, including a concurrent finish that won the race).
     * Nothing is registered or signed in. */
    "passkey.verification_failed": Record<string, never>;
    /** The challenge issued at the start of the ceremony was not returned within `CHALLENGE_TTL_MS`, so
     * it is no longer honoured — the browser must begin the ceremony again. (The stored row is NOT kept
     * deleted on this path: finish consumes it with a DELETE, then the TTL check throws and the
     * transaction rolls back, restoring the row to lapse by its TTL rather than being swept.) */
    "passkey.challenge_expired": Record<string, never>;
  }
}
