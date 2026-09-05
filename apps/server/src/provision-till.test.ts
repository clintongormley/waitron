import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  nodeId as brandNodeId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, TenantId, TillId } from "@waitron/shared";
import { provisionNode } from "./provision-till.js";

// PGlite, not `startRealPostgres` — deliberately, and against the grain of this package's other
// database suites. That harness's own refusal message says a container is required because "PGlite
// runs every connection as a superuser, so it cannot show whether this host works as the
// non-superuser deployment role"; nothing here ever leaves the superuser connection, so the
// justification does not apply. `registerSif` itself — the function under test, one layer down — is
// covered exactly this way (`registro-sif.test.ts`, same two migration sets), as are this
// directory's `stripe-account.test.ts` and `aeat-transport.test.ts`. `vitest.config.ts` pins
// `singleFork`, so a container here would be pure additive wall-clock on every run.
//
// What PGlite does NOT buy: it is not a stronger harness for the ownership guard. Both it and a
// superuser container kill a mutant that drops the guard, because neither applies RLS. Only a
// container connected as the non-superuser deployment role would let `eq(nodes.tenantId, …)` be
// deleted unnoticed — RLS would hide the foreign node anyway — and no harness here does that.

// Two characters: `packages/verifactu`'s `validate` caps `IdSistemaInformatico` at that
// (`ID_SISTEMA_LENGTH`), and every other fixture in the repo uses this exact value.
const ID_SIF = "WT";

// Well-formed but absent — the shape a mistyped argument actually takes, since a malformed one
// never survives `tenantId()`'s brand.
const ABSENT = "00000000-0000-0000-0000-000000000000";

// The full manifest, not just [core, fiscal]: fiscal's SP-3a capture migration (0014) needs sync's
// `sync_capture()`, so the whole manifest is applied (sync before fiscal) — the production order.
const suite = usePgliteDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface Bootstrapped {
  tenantId: TenantId;
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
  const tenant = await suite.db.execute<{ id: string }>(sql`
    insert into tenants (country, tax_id, legal_name) values ('ES', ${nif}, 'Deli SL') returning id`);
  const tenantId = brandTenantId(tenant.rows[0]!.id);

  const location = await suite.db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Mostrador', array['es-ES'], 'Venta en establecimiento') returning id`);

  const till = await suite.db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${location.rows[0]!.id}, 'Caja 1') returning id`);
  const tillId = brandTillId(till.rows[0]!.id);

  const node = await suite.db.execute<{ id: string }>(sql`
    insert into nodes (tenant_id, location_id, name)
    values (${tenantId}, ${location.rows[0]!.id}, 'Node 1') returning id`);
  const nodeId = brandNodeId(node.rows[0]!.id);

  await suite.db.execute(sql`
    insert into invoice_series (tenant_id, node_id, code) values (${tenantId}, ${nodeId}, 'A')`);

  return { tenantId, tillId, nodeId, nif };
}

describe("provisioning a node that has no SIF registration yet", () => {
  it("registers it under the tenant's own NIF, which is never an argument", async () => {
    const { tenantId, nodeId, nif } = await bootstrapTenant();

    const registration = await provisionNode(suite.db, {
      tenantId,
      nodeId,
      idSistemaInformatico: ID_SIF,
    });

    expect(registration.nif).toBe(nif);
    expect(registration.numeroInstalacion).toBe(1);

    // The row `currentSif` would read back — the thing `recordSale` was missing.
    const live = await suite.db.execute<{
      nif: string;
      id_sistema_informatico: string;
      numero_instalacion: number;
    }>(sql`select nif, id_sistema_informatico, numero_instalacion from registro_sif
           where tenant_id = ${tenantId} and node_id = ${nodeId} and revocado_en is null`);
    expect(live.rows).toEqual([{ nif, id_sistema_informatico: ID_SIF, numero_instalacion: 1 }]);
  });

  it("refuses a node belonging to a different tenant, and writes nothing", async () => {
    const mine = await bootstrapTenant();
    const theirs = await bootstrapTenant();

    await expect(
      provisionNode(suite.db, {
        tenantId: mine.tenantId,
        nodeId: theirs.nodeId,
        idSistemaInformatico: ID_SIF,
      }),
    ).rejects.toMatchObject({
      code: "node.not_found",
      params: { id: theirs.nodeId, tenantId: mine.tenantId },
    });

    const written = await suite.db.execute(
      sql`select 1 from registro_sif where node_id = ${theirs.nodeId}`,
    );
    expect(written.rows).toEqual([]);
  });

  it("refuses a tenant that does not exist", async () => {
    const { nodeId } = await bootstrapTenant();

    await expect(
      provisionNode(suite.db, {
        tenantId: brandTenantId(ABSENT),
        nodeId,
        idSistemaInformatico: ID_SIF,
      }),
    ).rejects.toMatchObject({ code: "tenant.not_found", params: { id: ABSENT } });
  });

  // The value AEAT caps at two characters, which nothing else in the repo checks: `validate` has no
  // production caller, the column has no CHECK, and `registerSif` takes a bare string. An operator
  // types it once and it lands on every registro the node files.
  it.each([
    ["longer than two characters", "WTRN01"],
    ["empty", ""],
  ])("refuses an IdSistemaInformatico that is %s, before writing anything", async (_label, bad) => {
    const { tenantId, nodeId } = await bootstrapTenant();

    await expect(
      provisionNode(suite.db, { tenantId, nodeId, idSistemaInformatico: bad }),
    ).rejects.toMatchObject({
      code: "sif.id_sistema_invalid",
      params: { value: bad, maxLength: 2 },
    });

    const written = await suite.db.execute(
      sql`select 1 from registro_sif where node_id = ${nodeId}`,
    );
    expect(written.rows).toEqual([]);
  });
});
