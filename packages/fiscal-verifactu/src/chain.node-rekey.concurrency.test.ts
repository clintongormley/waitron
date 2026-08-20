import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { asAppUser, captureError, pgErrorCode, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { nodeId as brandNodeId, seriesId as brandSeriesId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { appendToChain } from "./chain.js";
import { currentSif, registerSif } from "./registro-sif.js";
import { VerifactuBackend } from "./backend.js";
import {
  addTillToNode,
  altaFor,
  seedSale,
  seedTill,
  TEST_SISTEMA,
  type SeededTill,
} from "./testing/seed.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

const WRITERS = 20;

/**
 * The node-id rekey's container-prototype gate (design §9). Every property below is re-proven on the
 * NODE key — the chain, series, SIF and concurrency backstop all moved from `till_id` to `node_id`
 * (#33: the SIF is the node). Real PostgreSQL via Testcontainers, deliberately never a PGlite
 * fallback: PGlite serialises every query onto one backend, so a concurrency suite there is a false
 * pass, and PGlite is superuser, so it cannot show the non-superuser app role under RLS (CLAUDE.md
 * §4). Docker-absence THROWS rather than skipping when Docker is unavailable — now at the package
 * globalSetup (`src/testing/global-setup.ts`'s `dockerRequired`), which precedes every worker — so a
 * vanished suite fails loudly instead of reporting a green that proves nothing.
 */
const suite = useTemplateDb({ template: "core_fiscal" });

// No truncate-and-reseed: registros_facturacion's append-only trigger blocks even a CASCADEd
// TRUNCATE from `tenants`. `seedTill` mints a FRESH tenant (and nif, and node) per call, so each
// test's rows are new and independent of whatever a previous test committed.
let node: SeededTill;

beforeEach(async () => {
  node = await seedTill(suite.admin, "A");
});

describe("appendToChain under real contention, keyed by node", () => {
  // Property 1 (design §9.1): the concurrency backstop under (tenant, node, secuencia). One node
  // serving sales; WRITERS concurrent appends on distinct backend connections; all commit, the
  // sequence is 1..WRITERS with no gap, and each record chains onto its predecessor's huella.
  //
  // What GUARANTEES the no-gaps property here is the per-node `cadenas` FOR UPDATE head lock
  // (chain.ts's lockChainHead): the writers serialise on that row, each computing head.secuencia+1
  // only after the previous one commits. MEASURED, not reasoned: dropping
  // registros_tenant_node_secuencia_uq and re-running this exact test leaves it PASSING (observed
  // 2026-08-03) — so the unique index is NOT what makes this test green. The index is the
  // defense-in-depth BACKSTOP against a writer that reaches an occupied (tenant, node, secuencia) by
  // any path that bypasses or races the lock; that is proven directly, and deterministically, by a
  // duplicate-position insert being rejected with 23505 while the same insert succeeds once the index
  // is dropped (task-4-report §2's delete-the-index receipt). This mirrors chain.concurrency.test.ts,
  // which likewise attributes the property to the lock and makes no deletion claim about the index.
  it("assigns 20 concurrent appends distinct positions with no gaps, each chained to its predecessor", async () => {
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => suite.pg.connect()));
    try {
      const sales = await Promise.all(dbs.map((_, i) => seedSale(suite.admin, node, i + 1)));
      const results = await Promise.all(
        dbs.map((db, i) =>
          db.transaction((tx) =>
            appendToChain(
              tx,
              node.tenantId,
              node.nodeId,
              altaFor(node.tillId, sales[i]!, i + 1, i),
            ),
          ),
        ),
      );
      // Naive read-then-write committed 3 of 20 on this hardware; anything below 20 is that failure.
      expect(results).toHaveLength(WRITERS);

      const { rows } = await suite.admin.execute<{
        secuencia: number;
        huella: string;
        anterior_huella: string | null;
        primer_registro: boolean;
      }>(sql`
        select secuencia, huella, anterior_huella, primer_registro
        from registros_facturacion where node_id = ${node.nodeId} order by secuencia
      `);
      expect(rows.map((r) => r.secuencia)).toEqual(
        Array.from({ length: WRITERS }, (_, i) => i + 1),
      );
      expect(rows[0]?.primer_registro).toBe(true);
      // Walk the WHOLE chain — a single crossed pair in the middle is exactly what a lost race makes.
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]?.anterior_huella).toBe(rows[i - 1]?.huella);
      }
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  // Property 2 (design §9, the behaviour the rekey INTRODUCES): two tills of ONE node → ONE chain.
  // Before the rekey, each till had its own chain; now the chain is the node's, so sales rung at
  // EITHER till take the next secuencia on the same per-node chain. This did not exist before.
  it("continues one node chain across sales rung at two different tills of that node", async () => {
    const tillB = await addTillToNode(suite.admin, node, "B");

    // Alternate the ringing till: A, B, A, B, ... All append to node.nodeId's one chain.
    const rung: SeededTill[] = Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? node : tillB));
    let sec = 0;
    for (const till of rung) {
      sec += 1;
      const saleId = await seedSale(suite.admin, till, sec);
      await suite.admin.transaction((tx) =>
        appendToChain(tx, node.tenantId, node.nodeId, altaFor(till.tillId, saleId, sec, sec)),
      );
    }

    const { rows } = await suite.admin.execute<{ secuencia: number; till_id: string }>(sql`
      select secuencia, till_id from registros_facturacion
      where node_id = ${node.nodeId} order by secuencia
    `);
    // One continuous per-node sequence spanning both tills...
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3, 4, 5, 6]);
    // ...and both tills' snapshots are present (the chain is the node's, not either till's).
    expect(new Set(rows.map((r) => r.till_id))).toEqual(new Set([node.tillId, tillB.tillId]));
  });
});

describe("currentSif resolves per node", () => {
  // Property 4 (design §9.4): two nodes under one tenant resolve to distinct SIFs / distinct chains.
  it("gives two nodes of one tenant distinct SIF identities and distinct chains", async () => {
    const nodeA = node;
    // A second, independently seeded node (fresh tenant is fine — the point is distinct SIFs; but to
    // stress "under one tenant" we add a sibling node to nodeA's tenant).
    const sibling = await addSiblingNode(nodeA);

    const [sifA, sifB] = await suite.admin.transaction(async (tx) => [
      await currentSif(tx, nodeA.tenantId, nodeA.nodeId),
      await currentSif(tx, nodeA.tenantId, sibling),
    ]);
    expect(sifA.nodeId).toBe(nodeA.nodeId);
    expect(sifB.nodeId).toBe(sibling);
    expect(sifA.id).not.toBe(sifB.id);
    // Distinct install numbers too — the (NIF, IdSIF) counter mints one apiece.
    expect(sifA.numeroInstalacion).not.toBe(sifB.numeroInstalacion);

    // And distinct chains: an append on nodeA leaves the sibling's chain untouched.
    const saleId = await seedSale(suite.admin, nodeA, 1);
    await suite.admin.transaction((tx) =>
      appendToChain(tx, nodeA.tenantId, nodeA.nodeId, altaFor(nodeA.tillId, saleId, 1, 1)),
    );
    const counts = await suite.admin.execute<{ node_id: string; count: number }>(sql`
      select node_id, count(*)::int as count from registros_facturacion
      where tenant_id = ${nodeA.tenantId} group by node_id
    `);
    const byNode = new Map(counts.rows.map((r) => [r.node_id, r.count]));
    expect(byNode.get(nodeA.nodeId)).toBe(1);
    expect(byNode.get(sibling)).toBeUndefined();
  });

  // Registers a second node under an existing fixture's tenant and gives it a live SIF, returning
  // its node id. Its own fresh location keeps it a distinct node under the same obligado.
  async function addSiblingNode(seed: SeededTill): Promise<NodeId> {
    return suite.admin.transaction(async (tx) => {
      const loc = await tx.execute<{ id: string }>(sql`
        insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (${seed.tenantId}, 'Sala sib', array['es'], 'Venta en establecimiento') returning id
      `);
      const nodeRow = await tx.execute<{ id: string }>(sql`
        insert into nodes (tenant_id, location_id, name)
        values (${seed.tenantId}, ${loc.rows[0]!.id}, 'Node sib') returning id
      `);
      const sibling = brandNodeId(nodeRow.rows[0]!.id);
      // Register a SIF for the sibling under the same NIF as the fixture (one obligado, two nodes)
      // via registerSif, so the installation number is minted from the real (NIF, IdSIF) counter
      // rather than hand-picked, and the sibling's cadenas head is seeded the way production does it.
      const nifRow = await tx.execute<{ tax_id: string }>(sql`
        select tax_id from tenants where id = ${seed.tenantId}
      `);
      await registerSif(tx, {
        tenantId: seed.tenantId,
        nodeId: sibling,
        nif: nifRow.rows[0]!.tax_id,
        idSistemaInformatico: TEST_SISTEMA.IdSistemaInformatico,
      });
      return sibling;
    });
  }
});

describe("the series↔node guard (record-sale)", () => {
  // Property 3 (design §9.2): a sale whose input.nodeId ≠ the series' node throws
  // sale.series_wrong_node; the matching case succeeds. Driven through @waitron/core's recordSale —
  // the guard's real home — under the non-superuser app role.
  function backendFor(): VerifactuBackend {
    return new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: suite.admin,
      resolveClient: staticResolver(fakeClient),
    });
  }

  it("rejects a sale whose node does not own the series", async () => {
    const other = await seedTill(suite.admin, "OTH"); // a DIFFERENT node (and tenant)
    const backend = backendFor();
    const error = await captureError(() =>
      withTenant(suite.admin, node.tenantId, async (tx) => {
        await asAppUser(tx);
        // node.seriesId belongs to node.nodeId, but we claim to process on `other.nodeId`.
        return recordSale(
          tx,
          backend,
          saleInput({
            tenantId: node.tenantId,
            tillId: node.tillId,
            nodeId: other.nodeId,
            seriesId: brandSeriesId(node.seriesId),
          }),
        );
      }),
    );
    expect((error as { code?: string }).code).toBe("sale.series_wrong_node");
  });

  it("accepts a sale whose node owns the series", async () => {
    const backend = backendFor();
    const result = await withTenant(suite.admin, node.tenantId, async (tx) => {
      await asAppUser(tx);
      return recordSale(
        tx,
        backend,
        saleInput({
          tenantId: node.tenantId,
          tillId: node.tillId,
          nodeId: node.nodeId,
          seriesId: brandSeriesId(node.seriesId),
        }),
      );
    });
    expect(result.fiscal.state).toBe("pending");
    const { rows } = await suite.admin.execute<{ count: number }>(sql`
      select count(*)::int as count from registros_facturacion where node_id = ${node.nodeId}
    `);
    expect(rows[0]?.count).toBe(1);
  });
});

describe("RLS under the non-superuser app role", () => {
  // Property 5 (design §9.3): the app role can append node-keyed rows under withTenant; the composite
  // (tenant_id, node_id) FK on `sales` blocks a cross-tenant node reference.
  it("lets the app role append under its own tenant context", async () => {
    const saleId = await seedSale(suite.admin, node, 1);
    const appended = await withTenant(suite.admin, node.tenantId, async (tx) => {
      await asAppUser(tx);
      return appendToChain(tx, node.tenantId, node.nodeId, altaFor(node.tillId, saleId, 1, 1));
    });
    expect(appended.secuencia).toBe(1);
  });

  it("rejects a sale that references a node belonging to another tenant", async () => {
    const other = await seedTill(suite.admin, "X"); // a node under a DIFFERENT tenant
    // Insert a `sales` row under `node`'s tenant but pointing at `other`'s node: the composite
    // sales_node_fk (tenant_id, node_id) → nodes(tenant_id, id) has no matching parent row.
    const error = await captureError(() =>
      suite.admin.execute(sql`
        insert into sales (tenant_id, till_id, node_id, series_id, invoice_number, issued_at,
                           issued_offset_minutes, total, vat_breakdown, locale, invoice_locales,
                           fiscal_backend, fiscal_state)
        values (${node.tenantId}, ${node.tillId}, ${other.nodeId}, ${node.seriesId}, 99,
                '2026-07-20T19:20:30+02:00', 120, '0.00', '[]'::jsonb, 'es', array['es'], 'verifactu', 'recorded')
      `),
    );
    expect(pgErrorCode(error)).toBe("23503"); // foreign_key_violation
  });
});
