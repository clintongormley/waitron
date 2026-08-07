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
  }
}
