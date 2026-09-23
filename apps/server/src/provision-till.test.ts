import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invoiceSeries, locations, nodes, tenants, tills } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, TillId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { provisionNode } from "./provision-till.js";

// `provisionNode` looks a node up by id and runs each module's seed. The fiscal seed one layer down
// is covered in packages/fiscal-verifactu/src/provisioning.test.ts, as are stripe-account.test.ts
// and aeat-transport.test.ts.

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
  // Every row goes in through its TABLE DEFINITION rather than as raw SQL, the same change
  // `packages/db/src/testing/seed.ts` and `testing/fiscal-fixtures.ts` took. Two separate reasons,
  // both measured against this fixture: the raw insert reached no `$defaultFn` generator, so it
  // stopped at `NOT NULL constraint failed: tenants.created_at` and every id came back null; and
  // `array['es-ES']` is PostgreSQL array syntax this engine refuses at prepare. `invoice_series`
  // keeps naming only `node_id` and `code` — `next_number` is a SQL DEFAULT of 1 on both engines,
  // so the series still opens at invoice number 1 (CLAUDE.md §5).
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: nif, legalName: "Deli SL" })
    .onConflictDoNothing({ target: tenants.id });

  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Mostrador",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });

  const [till] = await suite.db
    .insert(tills)
    .values({ locationId: brandLocationId(location!.id), name: "Caja 1" })
    .returning({ id: tills.id });
  const tillId = brandTillId(till!.id);

  const [node] = await suite.db
    .insert(nodes)
    .values({ locationId: brandLocationId(location!.id), name: "Node 1" })
    .returning({ id: nodes.id });
  const nodeId = brandNodeId(node!.id);

  await suite.db.insert(invoiceSeries).values({ nodeId, code: "A" });

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
