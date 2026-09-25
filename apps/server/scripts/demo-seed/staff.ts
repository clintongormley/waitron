// Demo staff for the Casa Delgado seed. `applyVenue` already seeds the one `admin`, so this covers
// the other three roles.

import type { PersonRoleValue } from "@waitron/identity";

export const DEMO_PIN = "5555";

/** Shared by the demo's dashboard-login persons: the seeded manager, and the provisioned admin
 * (`dev-setup.ts`'s `ADMIN_PASSWORD`). */
export const DEMO_DASHBOARD_PASSWORD = "dashPass123";

/** Must differ from every `DEMO_STAFF` email: `persons_tenant_email_uq` makes emails unique across
 * the database, case-insensitively. */
export const DEMO_ADMIN_EMAIL = "owner@demo.waitron.local";

export interface SeedPerson {
  displayName: string;
  role: PersonRoleValue;
  email: string;
  /** Plaintext here; `seedStaff` hashes it. */
  password?: string;
}

export const DEMO_STAFF: SeedPerson[] = [
  {
    displayName: "Marta Ruiz",
    role: "manager",
    email: "manager@demo.waitron.local",
    password: DEMO_DASHBOARD_PASSWORD,
  },
  {
    displayName: "Javier Torres",
    role: "supervisor",
    email: "javier@demo.waitron.local",
  },
  { displayName: "Lucía Fernández", role: "staff", email: "lucia@demo.waitron.local" },
  { displayName: "Diego Molina", role: "staff", email: "diego@demo.waitron.local" },
  { displayName: "Sofía Navarro", role: "staff", email: "sofia@demo.waitron.local" },
];
