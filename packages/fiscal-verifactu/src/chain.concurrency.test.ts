import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain } from "./chain.js";
import { registerSif } from "./registro-sif.js";
import {
  altaFor,
  seedNodesForSifContention,
  seedSale,
  seedTill,
  TEST_SISTEMA,
  type SeededTill,
} from "./testing/seed.js";

const WRITERS = 20;

let node: SeededTill;

/**
 * Twenty appends started together against ONE venue file.
 *
 * Two properties the PostgreSQL version of this suite held are GONE, with no counterpart here:
 *
 * 1. **Per-node parallelism.** Every writer serialises on the FILE, whichever node it appends to,
 *    so a busy node can stall a quiet one. Nothing can restore that while one file holds every
 *    node's chain.
 * 2. **The premise check that writers ran on distinct backends.** One writer at a time is now the
 *    design, not the thing that would make this suite theatre; `holds a second appender on the same
 *    chain until the first commits` is the discriminating case instead.
 *
 * What still holds: twenty appends started together and NOT awaited in turn must land on twenty
 * distinct, contiguous positions, each linked to its predecessor's huella. A queue that failed to
 * serialise breaks exactly that, because appends reading the same head compute the same position.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

beforeEach(async () => {
  node = await seedTill(suite.db, "A");
});

/** A promise plus the function that settles it. */
function latch(): { waited: Promise<void>; open: () => void } {
  let open!: () => void;
  const waited = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { waited, open };
}

/** Seeds one sale per writer and starts `appendToChain` for all of them together, without awaiting
 * any of them in turn. Nothing but the venue file's write queue keeps the second out of the
 * first's transaction. */
async function appendTogether(count: number): Promise<unknown[]> {
  const sales = await Promise.all(
    Array.from({ length: count }, (_, i) => seedSale(suite.db, node, i + 1)),
  );
  return Promise.all(
    sales.map((saleId, i) =>
      withTransaction(suite.db, (tx) =>
        appendToChain(tx, node.nodeId, altaFor(node.tillId, saleId, i + 1, i)),
      ),
    ),
  );
}

describe("appendToChain from many callers started together", () => {
  it("commits all 20 simultaneously-started appends to one chain", async () => {
    const results = await appendTogether(WRITERS);

    // Anything below 20 is a lost append, not a flake.
    expect(results).toHaveLength(WRITERS);
    const { rows } = await suite.db.execute<{ count: number }>(sql`
      select cast(count(*) as int) as count from registros_facturacion where node_id = ${node.nodeId}
    `);
    expect(rows[0]?.count).toBe(WRITERS);
  });

  it("assigns every simultaneously-started append a distinct position with no gaps", async () => {
    await appendTogether(WRITERS);
    const { rows } = await suite.db.execute<{ secuencia: number }>(sql`
      select secuencia from registros_facturacion where node_id = ${node.nodeId} order by secuencia
    `);
    expect(rows.map((r) => r.secuencia)).toEqual(Array.from({ length: WRITERS }, (_, i) => i + 1));
  });

  it("leaves every record correctly chained to its predecessor", async () => {
    await appendTogether(WRITERS);
    // `primer_registro` is read through this raw select as `0`/`1`, not a boolean — a raw select
    // skips drizzle's read mapping — so the first row is checked against `1`.
    const { rows } = await suite.db.execute<{
      secuencia: number;
      huella: string;
      anterior_huella: string | null;
      primer_registro: number;
    }>(sql`
      select secuencia, huella, anterior_huella, primer_registro
      from registros_facturacion where node_id = ${node.nodeId} order by secuencia
    `);
    expect(rows[0]?.primer_registro).toBe(1);
    // Walking the WHOLE chain, not spot-checking the ends: a single crossed pair in the middle
    // is precisely what a lost race produces.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]?.anterior_huella).toBe(rows[i - 1]?.huella);
    }
  });

  it("holds a second appender on the same chain until the first commits", async () => {
    // THE DISCRIMINATING CASE. What it observes is that the second append has not STARTED while
    // the first is open. `withTransaction` (`packages/db/src/tenancy.ts`) runs its
    // body inside `db.withWriteLock`, and `packages/store/src/write-queue.ts` issues
    // `begin immediate` … `commit`, so the next caller's `begin` does not run until that `commit`
    // has returned. Same observation as `racePair` in `packages/catalogue/test/fixtures.ts`,
    // written out here because that helper lives in another package's test directory.
    // Control: with both bodies calling `appendToChain` directly instead of through
    // `withTransaction`, `secondStarted` was true and this case failed.
    const first = await seedSale(suite.db, node, 1);
    const second = await seedSale(suite.db, node, 2);

    const hold = latch();
    const reached = latch();
    let secondStarted = false;

    const one = withTransaction(suite.db, async (tx) => {
      const appended = await appendToChain(tx, node.nodeId, altaFor(node.tillId, first, 1, 1));
      reached.open();
      await hold.waited;
      return appended;
    });
    // Started without awaiting `one`.
    const two = withTransaction(suite.db, async (tx) => {
      secondStarted = true;
      return appendToChain(tx, node.nodeId, altaFor(node.tillId, second, 2, 2));
    });
    const settled = Promise.allSettled([one, two]);
    try {
      await reached.waited;
      // A real pause, not a microtask turn: this has to give the second transaction every chance
      // to run the statement it must not run.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(secondStarted, "the second append started while the first was still open").toBe(false);
    } finally {
      hold.open();
    }

    // And once the first commits, the second does not merely start — it lands at the NEXT
    // position, chained to what the first wrote. A queue that let it start early would have
    // computed position 1 twice.
    const [a, b] = await settled;
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    const { rows } = await suite.db.execute<{ secuencia: number; anterior_huella: string | null }>(
      sql`select secuencia, huella, anterior_huella from registros_facturacion
          where node_id = ${node.nodeId} order by secuencia`,
    );
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2]);
    expect(rows[1]?.anterior_huella).toBe(
      (rows[0] as unknown as { huella: string } | undefined)?.huella,
    );
  });
});

describe("registerSif's installation-number counter, from many callers started together", () => {
  // 20 DISTINCT nodes of ONE obligado (one shared NIF), each registered exactly once: registering
  // the SAME node twice races a different hazard (registro_sif_activo_uq). This isolates the
  // (NIF, IdSistemaInformatico) counter's own allocation.
  //
  // Weaker than its name: the twenty transactions are serialised by the venue file's write queue,
  // so this proves twenty distinct, strictly increasing numbers for twenty callers — not that the
  // allocator survives a true overlap, which this engine cannot stage.
  it("mints 20 distinct, strictly increasing installation numbers across many nodes of one obligado", async () => {
    const fixture = await seedNodesForSifContention(suite.db, WRITERS);
    const results = await Promise.all(
      fixture.nodeIds.map((nodeId) =>
        withTransaction(suite.db, (tx) =>
          registerSif(tx, {
            nodeId,
            nif: fixture.nif,
            idSistemaInformatico: TEST_SISTEMA.IdSistemaInformatico,
          }),
        ),
      ),
    );

    const numbers = results.map((r) => r.numeroInstalacion).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: WRITERS }, (_, i) => i + 1));
    expect(new Set(numbers).size).toBe(WRITERS);
  });
});
