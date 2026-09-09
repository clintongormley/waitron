// Demo staff for the Casa Delgado seed (Phase 2, Task 8) — spec §4.4. This is DEV/DEMO data, the same
// plausibility-not-accuracy bar `menu.ts` and `floor.ts` state for their own content.
//
// Every seeded person shares one PIN (`DEMO_PIN`, "5555") so the demo can hand out a single number
// and log in as anyone. `applyVenue` (packages/provisioning) already seeds ONE `role='admin'` person
// (the venue owner) — see `venue-apply.ts`'s `role='admin'` insert — so this module covers the
// remaining three `person_role` values (`staff`/`supervisor`/`manager`); counting the provisioning
// admin, all four roles exist in a freshly seeded venue. Names are plain, plausible Spanish given
// names — identifiers stay English (CLAUDE.md §3), but `apps/*` is out of the english-only guard's
// scope for i18n-shaped VALUES like these, the same choice `floor.ts`'s zone names make.

import type { PersonRoleValue } from "@waitron/identity";

/** The PIN every seeded demo person (this module's five, plus the provisioning-seeded admin's own
 * separate PIN — see `dev-setup.ts`) logs in with, so the demo can hand out one number. */
export const DEMO_PIN = "5555";

/** The dashboard (management) password shared by the demo's dashboard-login persons, so the demo can
 * hand out one password alongside the seeded login emails. The seeded manager (Marta Ruiz) is given
 * this password + a login email by `seedStaff` so email sign-in works in the demo; the provisioned
 * admin ("Administradora") is seeded with this SAME password by `dev-setup.ts` (its `ADMIN_PASSWORD`)
 * and by `seed-staff.test.ts`. Staff without a seeded password can set one through email. */
export const DEMO_DASHBOARD_PASSWORD = "dashPass123";

/** The provisioned admin's ("Administradora") dashboard login email. `dev-setup` supplies it to
 * `applyVenue` alongside the initial password. It is distinct from every `DEMO_STAFF` email (the
 * per-tenant `persons_tenant_email_uq` index). */
export const DEMO_ADMIN_EMAIL = "owner@demo.waitron.local";

/** A demo person: a display name, role, required account email, and optional pre-seeded password. */
export interface SeedPerson {
  displayName: string;
  role: PersonRoleValue;
  email: string;
  /** Dashboard password (plaintext here; `seedStaff` hashes it). */
  password?: string;
}

export const DEMO_STAFF: SeedPerson[] = [
  // The floor manager — day-to-day running of the room, second only to the admin/owner. A
  // dashboard-login person: given a login email + the shared demo dashboard password so an operator
  // can sign in to the dashboard as the manager, not only as the owner/admin.
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
