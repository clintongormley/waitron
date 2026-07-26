import { sql } from "drizzle-orm";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { TenantId } from "@waitron/shared";

// Tenants accumulate for the life of a suite (nothing truncates `tenants`), so every seeded tenant
// needs its own NIF or collides on `tenants_nif_key`.
let nifCounter = 0;

/** Returns a NIF unused so far in this test run. */
export function freshNif(): string {
  nifCounter += 1;
  return `${String(30_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Seeds one tenant and returns its id. Run as the connection owner (superuser) — RLS is bypassed,
 * so this is pure setup. */
export async function seedTenant(db: Database): Promise<TenantId> {
  const result = await db.execute<{ id: string }>(sql`
    insert into tenants (nif, legal_name) values (${freshNif()}, 'Test SL') returning id`);
  return brandTenantId(result.rows[0]!.id);
}
