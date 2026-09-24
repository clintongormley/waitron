import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * Identity's tables. Every one means the same on every node of the venue: a person, their
 * authenticators, their logins and their sign-in ceremonies. A sign-in's cookie token is stored
 * only as its hash, so neither that session's row id nor its stored hash, read from a copy of the
 * database, signs anybody in (slice-2 spec §2).
 * Completeness against identity's migrations is guarded by `classification.test.ts`.
 */
export const IDENTITY_CLASSIFICATION: readonly ClassifiedTable[] = [
  // Durable account data; copied to a standby, never drained back.
  classify("persons", "state", STATE),
  classify(
    "management_account_actions",
    "state",
    "pending account activation and recovery proofs; copied to a standby, never drained back",
  ),
  classify(
    "webauthn_credentials",
    "state",
    "a person's registered authenticators; copied to a standby, never drained back",
  ),
  classify("recovery_codes", "state", "single-use account recovery proofs"),

  classify(
    "sessions",
    "state",
    "a person's shift login at a till; the cookie's token is stored only as its hash",
  ),
  classify(
    "management_sessions",
    "state",
    "a person's dashboard login; the cookie's token is stored only as its hash",
  ),
  classify(
    "webauthn_challenges",
    "state",
    "a short-lived passkey ceremony; a challenge signs nobody in without the authenticator",
  ),
  classify(
    "totp_enrollments",
    "state",
    "a short-lived authenticator setup; its secret is stored encrypted",
  ),
  classify(
    "google_oidc_states",
    "state",
    "a short-lived Google sign-in ceremony; its state is stored only as a hash",
  ),
];

// Authentication challenges and session activity do not invalidate displayed profile data.
export const IDENTITY_CHANGE_SOURCES: readonly ChangeSource[] = [
  { table: "persons", type: "persons" },
  {
    table: "webauthn_credentials",
    type: "webauthn_credentials",
    related: [{ type: "persons", column: "person_id" }],
  },
];
