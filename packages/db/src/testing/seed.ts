import { sql } from "drizzle-orm";
import { nodeId as brandNodeId, tenantId as brandTenantId } from "@waitron/shared";
import type { LocationId, NodeId, TenantId } from "@waitron/shared";
import type { Database } from "../client.js";

// Tenants accumulate for the life of a suite (nothing truncates `tenants`), so every seeded tenant
// needs its own NIF or collides on `tenants_country_tax_id_key`. One module-scope counter is enough: each
// package's suite runs in its own process against its own database.
//
// The 40-million base is load-bearing, not arbitrary. Four other NIF generators survive elsewhere
// in this repo, each with its own independent counter — `packages/core/test/fixtures.ts`,
// `packages/payments/test/seed.ts` and `packages/fiscal-verifactu/src/testing/seed.ts` on 10M,
// `packages/fiscal-verifactu/test/fixtures.ts` on 20M. A file that seeds through two generators
// against ONE database collides on `tenants_country_tax_id_key` with nothing in the failure to explain why,
// and `apps/server/src/boot.test.ts` is already one line away from that: it imports
// `seedPendingEnvios` from `@waitron/fiscal-verifactu/test/drain-fixtures.js`, whose own tenants
// come off the 20M counter, into the same database this seed writes to. Staying off every base in
// use keeps that unreachable rather than merely unlikely.
let nifCounter = 0;

/** Returns a NIF unused so far in this test run. */
export function freshNif(): string {
  nifCounter += 1;
  return `${String(40_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Seeds one tenant and returns its id. Run as the connection owner; app_user has no INSERT grant. */
export async function seedTenant(db: Database): Promise<TenantId> {
  const result = await db.execute<{ id: string }>(sql`
    insert into tenants (country, tax_id, legal_name) values ('ES', ${freshNif()}, 'Test SL') returning id`);
  return brandTenantId(result.rows[0]!.id);
}

/** Seeds one node for `tenant` at `location` and returns its id. Run as the connection owner
 * for fixture setup, exactly like {@link seedTenant}. The name
 * is a fixed fixture value, mirroring seedTenant's hardcoded legal_name: callers that care about a
 * node's name insert it themselves. */
export async function seedNode(
  db: Database,
  tenant: TenantId,
  location: LocationId,
): Promise<NodeId> {
  const result = await db.execute<{ id: string }>(sql`
    insert into nodes (tenant_id, location_id, name)
    values (${tenant}, ${location}, 'Test node') returning id`);
  return brandNodeId(result.rows[0]!.id);
}

/** Seeds one kitchen station for `tenantId`/`locationId` and returns its id. Run as the connection owner
 * for fixture setup, exactly like {@link seedTenant}/{@link seedNode}.
 * Defaults to the DEFAULT station named 'Cocina' — the fixture shape the till suites need so a fire's
 * default-station fallback ({@link fireLines}) resolves; callers wanting a non-default or differently
 * named station override `isDefault`/`name`. */
export async function seedKitchenStation(
  db: Database,
  opts: { tenantId: TenantId; locationId: LocationId; name?: string; isDefault?: boolean },
): Promise<string> {
  const { tenantId, locationId, name = "Cocina", isDefault = true } = opts;
  const result = await db.execute<{ id: string }>(sql`
    insert into kitchen_stations (tenant_id, location_id, name, is_default)
    values (${tenantId}, ${locationId}, ${name}, ${isDefault}) returning id`);
  return result.rows[0]!.id;
}
