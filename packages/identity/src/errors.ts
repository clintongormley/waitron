// A bare side-effect import so TypeScript augments the real "@waitron/shared" module rather than
// declaring a fresh ambient one.
import "@waitron/shared";

/**
 * NO PARAM HERE EVER CARRIES A PIN OR A HASH: a credential must not reach a log line, a stack
 * trace, or a test name.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    "profile.invalid": { field: string };
    /** No open session for this id — unknown or already ended. */
    "session.not_open": { sessionId: string };
    /** No live management session for this token — unknown or already ended. */
    "management_session.required": Record<string, never>;
    /** The management session idled past the timeout. */
    "management_session.expired": Record<string, never>;
    "pin.invalid": Record<string, never>;
    /** `min` is the policy, never the PIN. */
    "pin.too_short": { min: number };
    /** Too many wrong PINs for this (device, person). `retryAfterSeconds` is the whole seconds to wait
     * before another attempt. */
    "pin.throttled": { retryAfterSeconds: number };
    /** `min` is the policy, never the password. */
    "password.too_short": { min: number };
    "password.invalid": Record<string, never>;
    /** Also thrown for a malformed token. */
    "totp.invalid": Record<string, never>;
    /** The password verified, but this account requires its enrolled authenticator or a recovery code. */
    "totp.required": Record<string, never>;
    /** A stored authenticator secret cannot be opened by the configured current/previous key ring. */
    "totp.key_unavailable": { personId: string };
    "google.invalid": Record<string, never>;
    "google.already_linked": Record<string, never>;
    "google.second_factor_required": Record<string, never>;
    "person.not_found": { personId: string };
    /** The person exists but is suspended — cannot log in or authorize. */
    "person.suspended": { personId: string };
    "person.self_deactivation": Record<string, never>;
    /** Failed `isValidEmail` at a write boundary. */
    "person.email_invalid": Record<string, never>;
    /** Failed `isValidTelephone` at a write boundary. */
    "person.telephone_invalid": Record<string, never>;
    "person.email_taken": { email: string };
    /** Another active or pending person already uses this display name. */
    "person.display_name_taken": { displayName: string };
    /** An account change would leave the venue without an active administrator. */
    "person.last_admin": Record<string, never>;
    /** The requested direct status change is not part of the account lifecycle. */
    "person.transition_invalid": Record<string, never>;
    /** The invitation or password-reset token is unknown, expired, or already used. */
    "account_action.invalid": Record<string, never>;
    /** Neither the session's operator nor any supplied override holds the required permission. */
    "authorization.not_permitted": { permission: string };
    /** No passkey is registered for this person. */
    "passkey.not_registered": Record<string, never>;
    /** The authenticator's response failed the library's checks, or the challenge handle matched no
     * live row — never issued, or already consumed by an earlier finish. */
    "passkey.verification_failed": Record<string, never>;
    /** The challenge was not returned within `CHALLENGE_TTL_MS`. */
    "passkey.challenge_expired": Record<string, never>;
    /** `beginPasskeyRegistration` sends `excludeCredentials`, so a compliant authenticator refuses a
     * duplicate; a non-compliant client can still send one, which the `credential_id` unique
     * constraint refuses. */
    "passkey.already_registered": Record<string, never>;
  }
}
