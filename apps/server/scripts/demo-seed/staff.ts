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
 * and by `seed-staff.test.ts`. PIN-only till staff carry no password at all. */
export const DEMO_DASHBOARD_PASSWORD = "dashPass123";

/** The provisioned admin's ("Administradora") dashboard login email. `applyVenue` (provisioning)
 * creates the sole `role='admin'` row WITHOUT an email; `seedStaff` sets this one afterwards, so the
 * demo admin — already seeded WITH a password — can sign in with email + password. Distinct from
 * every `DEMO_STAFF` email (the per-tenant `persons_tenant_email_uq` index). */
export const DEMO_ADMIN_EMAIL = "owner@demo.waitron.local";

/** A demo person: a display name, the `person_role` they are seeded with, and — for dashboard-login
 * persons only — a login `email` + dashboard `password`. Till-only (PIN-only) staff omit both: the
 * `persons_tenant_email_uq` index is NULL-permissive, so any number of persons may carry a null
 * email, and `password_hash` is nullable for PIN-only staff. */
export interface SeedPerson {
  displayName: string;
  role: PersonRoleValue;
  /** Login email — set ONLY for dashboard-login persons (the manager). Omitted for till-only staff. */
  email?: string;
  /** Dashboard password (plaintext here; `seedStaff` hashes it) — set ONLY alongside `email`. */
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
  // The floor supervisor — void/refund/discount/rectify + gated cash-drawer authority, no staff admin.
  // Till-only (PIN): no dashboard login, so no email/password.
  { displayName: "Javier Torres", role: "supervisor" },
  // Waitstaff and kitchen crew — ring sales, no privileged actions. Till-only (PIN): no email/password.
  { displayName: "Lucía Fernández", role: "staff" },
  { displayName: "Diego Molina", role: "staff" },
  { displayName: "Sofía Navarro", role: "staff" },
];
