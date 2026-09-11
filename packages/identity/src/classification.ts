import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * Identity's tables, classified for native replication (swap spec §2.1). A person and their
 * registered authenticators are durable service state a standby must hold; a login session or a
 * pending WebAuthn challenge is this node's own live record and is not copied. Completeness against
 * identity's migrations is guarded by `classification.test.ts`.
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

  // This node's own live login records; not copied, not drained.
  classify("sessions", "local", "this node's own live login sessions; not copied"),
  classify(
    "management_sessions",
    "local",
    "this node's own live management-console sessions; not copied",
  ),
  classify(
    "webauthn_challenges",
    "local",
    "this node's own pending WebAuthn challenges; not copied",
  ),
  classify("totp_enrollments", "local", "short-lived authenticator setup challenges"),
  classify("google_oidc_states", "local", "short-lived Google sign-in and linking ceremonies"),
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
