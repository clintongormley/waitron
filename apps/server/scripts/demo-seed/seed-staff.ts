// Seed demo staff directly in the caller's transaction: a seed script has no management session.
// Dashboard users receive hashed passwords; all demo staff share the configured demo PIN.

import { sql } from "drizzle-orm";
import type { TenantId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { hashPassword, hashPin } from "@waitron/identity";
import { DEMO_PIN, DEMO_STAFF } from "./staff.js";

/** Insert DEMO_STAFF for the requested tenant. */
export async function seedStaff(tx: Transaction, tenantId: TenantId): Promise<void> {
  const pinHash = hashPin(DEMO_PIN);
  for (const person of DEMO_STAFF) {
    const passwordHash = person.password !== undefined ? hashPassword(person.password) : null;
    await tx.execute(
      sql`insert into persons (tenant_id, display_name, pin_hash, password_hash, email, role)
          values (${tenantId}, ${person.displayName}, ${pinHash}, ${passwordHash}, ${person.email}, ${person.role})`,
    );
  }
}
