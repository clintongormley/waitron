// `seedStaff` — the demo-seed's staff step (Phase 2, Task 8). Given a provisioned venue, it inserts
// the demo staff (staff.ts), every one on the shared `DEMO_PIN`, so the demo can hand out a single PIN
// and log in as anyone. The dashboard-login persons additionally get a login email + a dashboard
// password so email sign-in works in the demo (Task 10): the seeded manager (email + password on its
// `DEMO_STAFF` row) and the provisioned admin (this seed sets its email — see below).
//
// It runs inside the CALLER's transaction, under the tenant GUC + app_user role the caller set with
// `withTenant`/`asAppUser` (the demo/POS shape, matching `seedCatalogues`/`seedFloor`). `createPerson`
// (`@waitron/identity`) is `person.manage`-session-gated — a seed script has no management session —
// so this inserts directly, the same raw-insert pattern `seedFloor` uses for
// `table_service_statuses`. The insert is parameterised via Drizzle's `sql` template (never
// string-concatenated, CLAUDE.md §3); `role` is always a fixed enum literal from `staff.ts`'s typed
// data, never user input. `app_user` holds SELECT/INSERT/UPDATE on `persons`
// (drizzle/0001_identity_rls.sql), so both the inserts and the admin-email UPDATE below run under the
// same app_user tx.

import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { hashPassword, hashPin } from "@waitron/identity";
import { DEMO_ADMIN_EMAIL, DEMO_PIN, DEMO_STAFF } from "./staff.js";

/**
 * Seed the demo staff under the caller's tenant context: one person per `DEMO_STAFF` row, all sharing
 * `DEMO_PIN`. `current_tenant_id()` satisfies `persons`' FORCE-RLS `WITH CHECK`. Dashboard-login rows
 * (the manager) also carry a login `email` + hashed `password`; till-only rows carry neither (null
 * email/password_hash — the `persons_tenant_email_uq` index is NULL-permissive).
 *
 * It then gives the provisioned admin ("Administradora") its login email: `applyVenue` creates the
 * sole `role='admin'` row (already carrying its provisioned dashboard password) WITHOUT an email, and
 * that admin is the demo's owner dashboard login, so email sign-in needs one set here.
 */
export async function seedStaff(tx: Transaction): Promise<void> {
  const pinHash = hashPin(DEMO_PIN);
  for (const person of DEMO_STAFF) {
    // Nullable for till-only staff: no login email, no dashboard password.
    const email = person.email ?? null;
    const passwordHash = person.password !== undefined ? hashPassword(person.password) : null;
    await tx.execute(
      sql`insert into persons (tenant_id, display_name, pin_hash, password_hash, email, role)
          values (current_tenant_id(), ${person.displayName}, ${pinHash}, ${passwordHash}, ${email}, ${person.role})`,
    );
  }

  // Give the provisioned admin its dashboard login email. `role = 'admin'` is a fixed enum literal
  // (never user input); `email is null` scopes the UPDATE to the un-emailed provisioned admin and
  // makes it idempotent — a re-run, or a real admin email set elsewhere, is never overwritten.
  await tx.execute(
    sql`update persons set email = ${DEMO_ADMIN_EMAIL}
        where role = 'admin' and email is null`,
  );
}
