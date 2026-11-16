import type { ChangeSource } from "@waitron/shared";

/** The tables this module's code owns. They live in core's set, which classifies them. */
export const IDENTITY_TABLES = [
  "persons",
  "roles",
  "person_roles",
  "staff_roles",
  "person_staff_roles",
  "account_actions",
  "webauthn_credentials",
  "recovery_codes",
  "till_sessions",
  "dashboard_sessions",
  "sign_in_challenges",
  "device_profile_admission_roles",
] as const;

export const IDENTITY_CHANGE_SOURCES: readonly ChangeSource[] = [
  { table: "persons", type: "persons" },
  { table: "roles", type: "roles" },
  {
    table: "person_roles",
    type: "person_roles",
    related: [{ type: "persons", column: "person_id" }],
  },
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
];
