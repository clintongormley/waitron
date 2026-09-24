import { nodeId as brandNodeId } from "@waitron/shared";
import type { LocationId, NodeId } from "@waitron/shared";
import type { Database } from "../client.js";
import { kitchenStations } from "../schema/kitchen-stations.js";
import { nodes } from "../schema/nodes.js";
import { tenants } from "../schema/tenants.js";

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
 * Makes sure the database's ONE taxpayer row exists. Idempotent: `tenants.id` is pinned to 1 by its
 * primary key and `tenants_singleton_ck`, so a second call adds nothing and returns nothing to
 * scope a query by.
 */
export async function seedTenant(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: freshNif(), legalName: "Test SL" })
    .onConflictDoNothing({ target: tenants.id });
}

/** Seeds one node at `location` and returns its id. */
export async function seedNode(db: Database, location: LocationId): Promise<NodeId> {
  const [row] = await db
    .insert(nodes)
    .values({ locationId: location, name: "Test node" })
    .returning({ id: nodes.id });
  return brandNodeId(row!.id);
}

/** Seeds one kitchen station for `locationId` and returns its id. Defaults to the DEFAULT station
 * named 'Cocina' — the fixture shape the till suites need so a fire's default-station fallback
 * ({@link fireLines}) resolves. */
export async function seedKitchenStation(
  db: Database,
  opts: { locationId: LocationId; name?: string; isDefault?: boolean },
): Promise<string> {
  const { locationId, name = "Cocina", isDefault = true } = opts;
  const [row] = await db
    .insert(kitchenStations)
    .values({ locationId, name, isDefault })
    .returning({ id: kitchenStations.id });
  return row!.id;
}
