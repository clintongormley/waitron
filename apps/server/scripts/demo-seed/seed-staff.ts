// `seedStaff` — the demo-seed's staff step (Phase 2, Task 8). Given a provisioned venue, it inserts
// the demo staff (staff.ts), every one on the shared `DEMO_PIN`, so the demo can hand out a single PIN
// and log in as anyone.
//
// It runs inside the CALLER's transaction, under the tenant GUC + app_user role the caller set with
// `withTenant`/`asAppUser` (the demo/POS shape, matching `seedCatalogues`/`seedFloor`). `createPerson`
// (`@waitron/identity`) is `person.manage`-session-gated — a seed script has no management session —
// so this inserts directly, the same raw-insert pattern `seedFloor` uses for
// `table_service_statuses`. The insert is parameterised via Drizzle's `sql` template (never
// string-concatenated, CLAUDE.md §3); `role` is always a fixed enum literal from `staff.ts`'s typed
// data, never user input.

import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { hashPin } from "@waitron/identity";
import { DEMO_PIN, DEMO_STAFF } from "./staff.js";

/**
 * Seed the demo staff under the caller's tenant context: one person per `DEMO_STAFF` row, all sharing
 * `DEMO_PIN`. `current_tenant_id()` satisfies `persons`' FORCE-RLS `WITH CHECK`.
 */
export async function seedStaff(tx: Transaction): Promise<void> {
  const pinHash = hashPin(DEMO_PIN);
  for (const person of DEMO_STAFF) {
    await tx.execute(
      sql`insert into persons (tenant_id, display_name, pin_hash, role)
          values (current_tenant_id(), ${person.displayName}, ${pinHash}, ${person.role})`,
    );
  }
}
