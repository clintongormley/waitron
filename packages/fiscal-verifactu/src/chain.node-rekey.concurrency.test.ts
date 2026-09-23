import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { captureError, locations, nodes, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
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
 * Node-keyed chain and series allocation, with the appends started together rather than awaited in
 * turn.
 *
 * TWO THINGS LOST when this file moved off PostgreSQL:
 *
 * - **Twenty independent connections.** There is one connection per venue file, so the twenty
 *   appends below are twenty transactions started together and serialised by the file's write
 *   queue (`packages/store/src/write-queue.ts`). What they still prove is the chain's own
 *   guarantee — twenty distinct, contiguous positions, each linked to its predecessor — which a
 *   queue that failed to serialise would break. The serialisation itself is observed, with its
 *   control, in `chain.concurrency.test.ts` ("holds a second appender on the same chain until the
 *   first commits"); it is not re-observed here.
 * - **The deployment ROLE.** SQLite has no roles, so `lets the app role append` is DELETED: it
 *   would have asserted only that an append returns `secuencia: 1` — which the first case here and
 *   `chain.concurrency.test.ts` both already assert. The ROLE half is covered by nothing.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

// `useVenueDb` empties every data table between tests (`packages/db/src/testing/venue-db.ts`), so
// the reseed-without-truncate reasoning this file used to carry no longer applies. `seedTill`
// still mints a FRESH node and nif per call, which keeps `registro_sif`'s identity unique across
// a file's many `beforeEach`es.
let node: SeededTill;

beforeEach(async () => {
  node = await seedTill(suite.db, "A");
});

describe("appendToChain from many callers started together, keyed by node", () => {
  // The unique index on (node_id, secuencia) rejects duplicate positions; this case checks the
  // allocation twenty simultaneously-started callers arrive at.
  it("assigns 20 simultaneously-started appends distinct positions with no gaps, each chained to its predecessor", async () => {
    const sales = await Promise.all(
      Array.from({ length: WRITERS }, (_, i) => seedSale(suite.db, node, i + 1)),
    );
    // Started together and NOT awaited in turn.
    const results = await Promise.all(
      sales.map((saleId, i) =>
        withTransaction(suite.db, (tx) =>
          appendToChain(tx, node.nodeId, altaFor(node.tillId, saleId, i + 1, i)),
        ),
      ),
    );
    // Naive read-then-write committed 3 of 20 on this hardware; anything below 20 is that failure.
    expect(results).toHaveLength(WRITERS);

    // `primer_registro` comes back as `0`/`1` from a raw select — it skips drizzle's read mapping —
    // so the first row is checked against `1`. What is asserted is unchanged.
    const { rows } = await suite.db.execute<{
      secuencia: number;
      huella: string;
      anterior_huella: string | null;
      primer_registro: number;
    }>(sql`
      select secuencia, huella, anterior_huella, primer_registro
      from registros_facturacion where node_id = ${node.nodeId} order by secuencia
    `);
    expect(rows.map((r) => r.secuencia)).toEqual(Array.from({ length: WRITERS }, (_, i) => i + 1));
    expect(rows[0]?.primer_registro).toBe(1);
    // Walk the WHOLE chain — a single crossed pair in the middle is exactly what a lost race makes.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]?.anterior_huella).toBe(rows[i - 1]?.huella);
    }
  });

  // Property 2 (design §9, the behaviour the rekey INTRODUCES): two tills of ONE node → ONE chain.
  // Before the rekey, each till had its own chain; now the chain is the node's, so sales rung at
  // EITHER till take the next secuencia on the same per-node chain. This did not exist before.
  it("continues one node chain across sales rung at two different tills of that node", async () => {
    const tillB = await addTillToNode(suite.db, node, "B");

    // Alternate the ringing till: A, B, A, B, ... All append to node.nodeId's one chain.
    const rung: SeededTill[] = Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? node : tillB));
    let sec = 0;
    for (const till of rung) {
      sec += 1;
      const saleId = await seedSale(suite.db, till, sec);
      await suite.db.transaction((tx) =>
        appendToChain(tx, node.nodeId, altaFor(till.tillId, saleId, sec, sec)),
      );
    }

    const { rows } = await suite.db.execute<{ secuencia: number; till_id: string }>(sql`
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
  // Property 4 (design §9.4): two nodes of one taxpayer resolve to distinct SIFs / distinct chains.
  it("gives two nodes of one taxpayer distinct SIF identities and distinct chains", async () => {
    const nodeA = node;
    // A second node under nodeA's OWN location and NIF, so the two genuinely share one obligado.
    const sibling = await addSiblingNode();

    const [sifA, sifB] = await suite.db.transaction(async (tx) => [
      await currentSif(tx, nodeA.nodeId),
      await currentSif(tx, sibling),
    ]);
    expect(sifA.nodeId).toBe(nodeA.nodeId);
    expect(sifB.nodeId).toBe(sibling);
    expect(sifA.id).not.toBe(sifB.id);
    // Distinct install numbers too — the (NIF, IdSIF) counter mints one apiece.
    expect(sifA.numeroInstalacion).not.toBe(sifB.numeroInstalacion);

    // And distinct chains: an append on nodeA leaves the sibling's chain untouched.
    const saleId = await seedSale(suite.db, nodeA, 1);
    await suite.db.transaction((tx) =>
      appendToChain(tx, nodeA.nodeId, altaFor(nodeA.tillId, saleId, 1, 1)),
    );
    const counts = await suite.db.execute<{ node_id: string; count: number }>(sql`
      select node_id, cast(count(*) as int) as count from registros_facturacion group by node_id
    `);
    const byNode = new Map(counts.rows.map((r) => [r.node_id, r.count]));
    expect(byNode.get(nodeA.nodeId)).toBe(1);
    expect(byNode.get(sibling)).toBeUndefined();
  });

  // Registers a second node beside an existing fixture's and gives it a live SIF, returning
  // its node id. Its own fresh location keeps it a distinct node under the same obligado.
  async function addSiblingNode(): Promise<NodeId> {
    return suite.db.transaction(async (tx) => {
      // Through the tables, not the raw inserts this replaces: `id` and `created_at` are
      // builder-side `$defaultFn` generators a raw insert never reaches (refused NOT NULL at run
      // time), and `invoice_locales` is a JSON column here, so the `array['es']` literal is a
      // syntax error on this engine.
      const [loc] = await tx
        .insert(locations)
        .values({
          name: "Sala sib",
          invoiceLocales: ["es"],
          operationDescription: "Venta en establecimiento",
        })
        .returning({ id: locations.id });
      const [nodeRow] = await tx
        .insert(nodes)
        .values({ locationId: loc!.id, name: "Node sib" })
        .returning({ id: nodes.id });
      const sibling = brandNodeId(nodeRow!.id);
      // Register a SIF for the sibling under the same NIF as the fixture (one obligado, two nodes)
      // via registerSif, so the installation number is minted from the real (NIF, IdSIF) counter
      // rather than hand-picked, and the sibling's cadenas head is seeded the way production does it.
      const nifRow = await tx.execute<{ tax_id: string }>(sql`
        select tax_id from tenants limit 1
      `);
      await registerSif(tx, {
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
      db: suite.db,
      resolveClient: staticResolver(fakeClient),
    });
  }

  it("rejects a sale whose node does not own the series", async () => {
    const other = await seedTill(suite.db, "OTH"); // a DIFFERENT node
    const backend = backendFor();
    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        // node.seriesId belongs to node.nodeId, but we claim to process on `other.nodeId`.
        return recordSale(
          tx,
          backend,
          saleInput({
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
    const result = await withTransaction(suite.db, async (tx) => {
      return recordSale(
        tx,
        backend,
        saleInput({
          tillId: node.tillId,
          nodeId: node.nodeId,
          seriesId: brandSeriesId(node.seriesId),
        }),
      );
    });
    expect(result.fiscal.state).toBe("pending");
    const { rows } = await suite.db.execute<{ count: number }>(sql`
      select cast(count(*) as int) as count from registros_facturacion where node_id = ${node.nodeId}
    `);
    expect(rows[0]?.count).toBe(1);
  });
});
