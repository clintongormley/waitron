// Seed demo staff directly in the caller's transaction: a seed script has no management session.
// Dashboard users receive hashed passwords; all demo staff share the configured demo PIN.

import { sql } from "drizzle-orm";
import type { TenantId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { hashPassword, hashPin } from "@waitron/identity";
import { DEMO_ADMIN_EMAIL, DEMO_PIN, DEMO_STAFF } from "./staff.js";

/** Insert DEMO_STAFF for the requested tenant and give its provisioned admin a login email. */
export async function seedStaff(tx: Transaction, tenantId: TenantId): Promise<void> {
  const pinHash = hashPin(DEMO_PIN);
  for (const person of DEMO_STAFF) {
    // Nullable for till-only staff: no login email, no dashboard password.
    const email = person.email ?? null;
    const passwordHash = person.password !== undefined ? hashPassword(person.password) : null;
    await tx.execute(
      sql`insert into persons (tenant_id, display_name, pin_hash, password_hash, email, role)
          values (${tenantId}, ${person.displayName}, ${pinHash}, ${passwordHash}, ${email}, ${person.role})`,
    );
  }

  // Give the provisioned admin its dashboard login email. `role = 'admin'` is a fixed enum literal
  // (never user input); `email is null` scopes the UPDATE to the un-emailed provisioned admin and
  // makes it idempotent — a re-run, or a real admin email set elsewhere, is never overwritten.
  // Invariant: at most one emailless admin per tenant (provisioning mints exactly one; DEMO_STAFF adds
  // none). Two would both match and collide on persons_tenant_email_uq — fine for the demo as-is.
  await tx.execute(
    sql`update persons set email = ${DEMO_ADMIN_EMAIL}
        where role = 'admin' and email is null`,
  );
}
