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
    /** No live management session for this token: it is unknown or ended, or its person is
     * `pending` or no longer exists. `@waitron/server-kit` also raises it for a missing or non-UUID
     * cookie. */
    "management_session.required": Record<string, never>;
    /** The management session idled past the timeout. */
    "management_session.expired": Record<string, never>;
    /** Every PIN login refusal, whatever the cause. This package's refusals carry the cause in the
     * log-only `reason`. */
    "pin.invalid": Record<string, never>;
    /** `min` is the policy, never the PIN. */
    "pin.too_short": { min: number };
    /** Too many wrong PINs for this (device, person), or a new person on a device whose back-off
     * table is full. `retryAfterSeconds` is the whole seconds to wait before another attempt. */
    "pin.throttled": { retryAfterSeconds: number };
    /** `min` is the policy, never the password. */
    "password.too_short": { min: number };
    /** Every password login refusal, whatever the cause, and a wrong current password on a profile
     * change. This package's login refusals carry the cause in the log-only `reason`. */
    "password.invalid": Record<string, never>;
    /** Also thrown for a malformed token. */
    "totp.invalid": Record<string, never>;
    /** The password verified, but this account requires its enrolled authenticator or a recovery code. */
    "totp.required": Record<string, never>;
    "google.invalid": Record<string, never>;
    "google.already_linked": Record<string, never>;
    "google.second_factor_required": Record<string, never>;
    "person.not_found": { personId: string };
    /** A live management session's person has been suspended, or an account action was asked for a
     * suspended person. */
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
    /** The invitation or password-reset token is unknown, expired, used or for the other purpose,
     * or its person has since left the status that purpose needs, lost their login email, or no
     * longer exists. `apps/server` also raises it for a malformed account-action request and for an
     * email-change code it did not accept. */
    "account_action.invalid": Record<string, never>;
    /** Neither the session's operator nor any supplied override holds the required permission. */
    "authorization.not_permitted": { permission: string };
    "passkey.not_registered": Record<string, never>;
    "passkey.verification_failed": Record<string, never>;
    /** The challenge was not returned within `CHALLENGE_TTL_MS`. */
    "passkey.challenge_expired": Record<string, never>;
    /** `beginPasskeyRegistration` sends `excludeCredentials`, so a compliant authenticator refuses a
     * duplicate; a non-compliant client can still send one, which the `credential_id` unique
     * constraint refuses. */
    "passkey.already_registered": Record<string, never>;
  }
}
