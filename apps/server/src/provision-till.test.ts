import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { nodeId as brandNodeId, tillId as brandTillId } from "@waitron/shared";
import type { NodeId, TillId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { provisionNode } from "./provision-till.js";

// PGlite is enough: `provisionNode` looks a node up by id and runs each module's seed, no role or
// concurrency behaviour under test, so a container adds no needed coverage (§4). The fiscal seed one
// layer down uses the same target in packages/fiscal-verifactu/src/provisioning.test.ts, as do
// stripe-account.test.ts and aeat-transport.test.ts.

// Well-formed but absent — the shape a mistyped argument actually takes, since a malformed one
// never survives the `nodeId()` brand.
const ABSENT = "00000000-0000-0000-0000-000000000000";

// The full manifest (`manifestSets()`), not just [core, fiscal]: each module lands on top of its
// dependencies in one ordered set — the production migration order.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface Bootstrapped {
  tillId: TillId;
  nodeId: NodeId;
  nif: string;
}

// Tenants accumulate for the life of this suite and `tenants_country_tax_id_key` is unique, so each seeded
// tenant needs its own NIF. A local counter rather than `@waitron/db`'s `freshNif`: this fixture
// writes the deli's *shape* of row, and mixing two generators against one database is the exact
// collision that helper's own comment warns about.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(50_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * The pre-SIF state `provisionNode` has to register against: tenant → location → till → node →
 * node-keyed series, and NO SIF registration (node-id rekey, 2026-08-03: the SIF is the node, #33,
 * so a node is what `provisionNode` registers; the series is now keyed by node). `waitron-provision
 * venue` registers the SIF as it stands a venue up, so this bare-node shape is now what a REIMAGED
 * node (or one registered standalone) looks like before `provisionNode` runs.
 *
 * Written out rather than reusing `@waitron/fiscal-verifactu`'s fixtures, both of which were
 * considered: `seedTill` registers a SIF, which is the state this suite must start *without*, and
 * `seedNodesForSifContention` — the repo's only bare-node fixture — is named and documented for one
 * unrelated test ("Exists for exactly one test") and seeds a different locale and series code.
 * Borrowing it would mean either a misleading call site here or a rename reaching into
 * `chain.concurrency.test.ts`. The pre-SIF node state is what this module has to provision, so it is
 * what the fixture reproduces.
 */
async function bootstrapTenant(): Promise<Bootstrapped> {
  const nif = nextNif();
  await suite.db.execute<{ id: string }>(sql`
    insert into tenants (id, country, tax_id, legal_name) values (1, 'ES', ${nif}, 'Deli SL')
    on conflict (id) do nothing`);

  const location = await suite.db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description)
    values ('Mostrador', array['es-ES'], 'Venta en establecimiento') returning id`);

  const till = await suite.db.execute<{ id: string }>(sql`
    insert into tills (location_id, name)
    values (${location.rows[0]!.id}, 'Caja 1') returning id`);
  const tillId = brandTillId(till.rows[0]!.id);

  const node = await suite.db.execute<{ id: string }>(sql`
    insert into nodes (location_id, name)
    values (${location.rows[0]!.id}, 'Node 1') returning id`);
  const nodeId = brandNodeId(node.rows[0]!.id);

  await suite.db.execute(sql`
    insert into invoice_series (node_id, code) values (${nodeId}, 'A')`);

  return { tillId, nodeId, nif };
}

describe("provisioning a node that has no SIF registration yet", () => {
  it("runs every module's seed for the node — fiscal registers it under the tenant's own NIF", async () => {
    const { nodeId, nif } = await bootstrapTenant();

    const seeded = await provisionNode(suite.db, { nodeId }, ALL_MODULES);
    expect(seeded.map((s) => s.module)).toEqual(["catalogue", "venue-service", "fiscal-verifactu"]);
    expect(seeded[2]!.report).toMatch(/^SIF .* \(installation 1\)$/);

    // The row `currentSif` would read back — the thing `recordSale` was missing.
    const live = await suite.db.execute<{
      nif: string;
      id_sistema_informatico: string;
      numero_instalacion: number;
    }>(sql`select nif, id_sistema_informatico, numero_instalacion from registro_sif
           where node_id = ${nodeId} and revocado_en is null`);
    expect(live.rows).toEqual([{ nif, id_sistema_informatico: "W1", numero_instalacion: 1 }]);
  });

  it("refuses a node id that names no node", async () => {
    await bootstrapTenant();

    await expect(
      provisionNode(suite.db, { nodeId: brandNodeId(ABSENT) }, ALL_MODULES),
    ).rejects.toMatchObject({ code: "node.not_found", params: { id: ABSENT } });
  });
});
