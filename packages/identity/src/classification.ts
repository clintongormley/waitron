import type { ChangeSource } from "@waitron/shared";

/** The tables this module's code owns. They live in core's set, which classifies them. */
export const IDENTITY_TABLES = [
  "persons",
  "staff_roles",
  "person_staff_roles",
  "management_account_actions",
  "webauthn_credentials",
  "recovery_codes",
  "sessions",
  "management_sessions",
  "webauthn_challenges",
  "totp_enrollments",
  "device_profile_admission_roles",
  "device_profile_admission_persons",
  "google_oidc_states",
] as const;

export const IDENTITY_CHANGE_SOURCES: readonly ChangeSource[] = [
  { table: "persons", type: "persons" },
  { table: "staff_roles", type: "staff_roles" },
  {
    table: "person_staff_roles",
    type: "person_staff_roles",
    related: [{ type: "persons", column: "person_id" }],
  },
  {
    table: "webauthn_credentials",
    type: "webauthn_credentials",
    related: [{ type: "persons", column: "person_id" }],
  },
  { table: "device_profile_admission_roles", type: "device_profile_admission_roles" },
  { table: "device_profile_admission_persons", type: "device_profile_admission_persons" },
];
