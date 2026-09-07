import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * Identity's tables, classified for native replication (swap spec §2.1). A person and their
 * registered authenticators are durable service state a standby must hold; a login session or a
 * pending WebAuthn challenge is this node's own live record and is not copied. Completeness against
 * identity's migrations is guarded by `classification.test.ts`.
 */
export const IDENTITY_CLASSIFICATION: readonly ClassifiedTable[] = [
  // state (2) — durable account data; copied to a standby, never drained back.
  classify("persons", "state", STATE),
  classify(
    "webauthn_credentials",
    "state",
    "a person's registered authenticators; copied to a standby, never drained back",
  ),

  // local (3) — this node's own live login records; not copied, not drained.
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
];
