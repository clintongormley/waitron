import { sql } from "drizzle-orm";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { LocationId, NodeId } from "@waitron/shared";
import type { Database } from "../client.js";

// The taxpayer row is a singleton keyed on id = 1, so a suite has at most one NIF in play and a
// second seed is a no-op. The counter survives because other fixtures still mint their own NIFs for
// rows that are not the taxpayer (a restore's recorded identity, for one), and because a suite that
// truncates `tenants` between tests re-seeds a row whose NIF need not repeat.
let nifCounter = 0;

/** Returns a NIF unused so far in this test run. */
export function freshNif(): string {
  nifCounter += 1;
  return `${String(40_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * Makes sure the database's ONE taxpayer row exists. Run as the connection owner; app_user has no
 * INSERT grant. Idempotent: `tenants.id` is pinned to 1 by its primary key and
 * `tenants_singleton_ck`, so a second call adds nothing and returns nothing to scope a query by.
 */
export async function seedTenant(db: Database): Promise<void> {
  await db.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (1, 'ES', ${freshNif()}, 'Test SL')
    on conflict (id) do nothing`);
}

/** Seeds one node at `location` and returns its id. Run as the connection owner
 * for fixture setup, exactly like {@link seedTenant}. The name
 * is a fixed fixture value, mirroring seedTenant's hardcoded legal_name: callers that care about a
 * node's name insert it themselves. */
export async function seedNode(db: Database, location: LocationId): Promise<NodeId> {
  const result = await db.execute<{ id: string }>(sql`
    insert into nodes (location_id, name)
    values (${location}, 'Test node') returning id`);
  return brandNodeId(result.rows[0]!.id);
}

/** Seeds one kitchen station for `locationId` and returns its id. Run as the connection owner
 * for fixture setup, exactly like {@link seedTenant}/{@link seedNode}.
 * Defaults to the DEFAULT station named 'Cocina' — the fixture shape the till suites need so a fire's
 * default-station fallback ({@link fireLines}) resolves; callers wanting a non-default or differently
 * named station override `isDefault`/`name`. */
export async function seedKitchenStation(
  db: Database,
  opts: { locationId: LocationId; name?: string; isDefault?: boolean },
): Promise<string> {
  const { locationId, name = "Cocina", isDefault = true } = opts;
  const result = await db.execute<{ id: string }>(sql`
    insert into kitchen_stations (location_id, name, is_default)
    values (${locationId}, ${name}, ${isDefault}) returning id`);
  return result.rows[0]!.id;
}
