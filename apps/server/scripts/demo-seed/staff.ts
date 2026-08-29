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

/** A demo person: a display name and the `person_role` they are seeded with. */
export interface SeedPerson {
  displayName: string;
  role: PersonRoleValue;
}

export const DEMO_STAFF: SeedPerson[] = [
  // The floor manager — day-to-day running of the room, second only to the admin/owner.
  { displayName: "Marta Ruiz", role: "manager" },
  // The floor supervisor — void/refund/discount/rectify + gated cash-drawer authority, no staff admin.
  { displayName: "Javier Torres", role: "supervisor" },
  // Waitstaff and kitchen crew — ring sales, no privileged actions.
  { displayName: "Lucía Fernández", role: "staff" },
  { displayName: "Diego Molina", role: "staff" },
  { displayName: "Sofía Navarro", role: "staff" },
];
