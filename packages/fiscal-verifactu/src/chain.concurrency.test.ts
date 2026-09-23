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
 * ## What this file used to be, and the two things that went with PostgreSQL
 *
 * It opened twenty separate backends through a shared container and had them race the per-node
 * chain-head row lock. None of that survives the engine change, and the losses are named here
 * rather than left for a reader to infer:
 *
 * 1. **`runs its writers on distinct backend processes` is DELETED.** It was the suite's premise
 *    check — `select pg_backend_pid()` twenty times, expecting twenty distinct pids — and it
 *    exists to rule out the "every query serialises onto one backend" false pass PGlite gives.
 *    SQLite has no backend process and no `pg_backend_pid`. The premise it guarded has INVERTED:
 *    one writer at a time is now the product's design, not the thing that would make this suite
 *    theatre. What replaces it as the discriminating observation is
 *    `holds a second appender on the same chain until the first commits` below, which watches the
 *    second body fail to START.
 * 2. **`does not block an appender on a different node` is DELETED, and the property it asserted
 *    IS GONE.** Per-node parallelism — a busy node never stalling a quiet one — was a real
 *    guarantee of the row lock, and the venue file's write queue does not provide it: every
 *    writer serialises on the FILE, whichever node it is appending to. Nothing replaces this and
 *    nothing can while one file holds every node's chain. Recorded here because a future reader
 *    would otherwise assume the guarantee still holds.
 *
 * ## What still holds, and why these cases are worth keeping
 *
 * The chain's actual guarantee was never the lock — it is the unique index on
 * (`node_id`, `secuencia`), which refuses a forked position whatever wrote it (proven by deletion
 * in `chain.test.ts`, "rejects a second record claiming an occupied chain position"). Twenty
 * appends started together and NOT awaited in turn still have to land on twenty distinct,
 * contiguous positions, each linked to its predecessor's huella. A queue that failed to serialise
 * breaks exactly that, because twenty appends reading the same head all compute the same next
 * position — which is the measurement recorded on the serialisation case below.
 *
 * Keyed by NODE (node-id rekey, 2026-08-03): the chain is per-node.
 */
/**
 * ## The append-only refusal, measured on this engine (the receipt the deleted `privileges.test.ts`
 * used to share with the grants)
 *
 * `registros_facturacion`'s immutability rested on three things on PostgreSQL: the `REVOKE ALL`
 * and the `app_user` grant matrix, the append-only trigger, and the TRUNCATE-blocking trigger
 * (`CLAUDE.md` §5). The GRANTS are gone — SQLite has no roles — so the trigger is what is left,
 * and that was worth measuring rather than assuming.
 *
 * Measured 2026-09-22 on this file's own `useVenueDb` database (a temporary probe added here,
 * run, and removed), against a registro written through `appendToChain`:
 *
 * ```
 * update registros_facturacion set huella = 'X' where sale_id = ?
 *   -> REFUSED: "registros_facturacion is append-only"
 * delete from registros_facturacion where sale_id = ?
 *   -> REFUSED: "registros_facturacion is append-only"
 * select huella ... -> 1 row, huella still 3E5EBDA0...
 * ```
 *
 * Both refusals arrive as that message with no SQLSTATE and no `errcode` on the cause — it is the
 * trigger's own `RAISE(ABORT)`, not a constraint. The triggers reach the database because
 * `TEST_MIGRATIONS` carries each set's `appendOnlyTables` and `useVenueDb` installs them
 * (`packages/migrations/src/manifest.ts:163`, `packages/db/src/testing/venue-db.ts`). So a stored
 * fiscal record still cannot be rewritten or removed; what no longer refuses anything is the
 * ROLE-level half.
 *
 * `inmutabilidad.test.ts` is where this belongs as a standing guard, and it is the receipt: run on
 * 2026-09-22 on its own, 1 file and 2 cases passing. An earlier version of this comment said that
 * suite was red on a `tenants.created_at` fixture omission; that was fixed before this branch's
 * test conversion finished, and the sentence outlived it.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

// `useVenueDb` empties every data table between tests, dropping and recreating the append-only
// triggers around the delete (`packages/db/src/testing/venue-db.ts`, `buildResetPlan`/
// `applyReset`) — so the reseed-without-truncate reasoning this file used to carry, about
// `registros_facturacion_block_truncate` refusing a CASCADEd TRUNCATE, no longer applies. Each
// call still mints a FRESH node and nif, which is what keeps `registro_sif`'s
// (nif, id_sistema_informatico, numero_instalacion) unique across a file's many `beforeEach`es.
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

    // Naive read-then-write committed 3 of 20 here on the old engine (measured, see chain.ts's own
    // doc comment). Anything below 20 is that failure, not a flake.
    expect(results).toHaveLength(WRITERS);
    // `cast(count(*) as int)`, not `count(*)::int`: the PostgreSQL cast spelling is
    // `unrecognized token: ":"` on this engine. Same row, same column name.
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
    // skips drizzle's read mapping — so the first row is checked against `1`. The other three
    // columns are text either way. What is asserted is unchanged.
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
    // THE DISCRIMINATING CASE, replacing `blocks a second appender on the same chain`. That one
    // held the `cadenas` row lock open on one backend and proved a second backend waited until
    // `lock_timeout` fired (`55P03`). There is no row lock, no second backend and no
    // `lock_timeout` here, so the thing to observe moved: not "the second one is BLOCKED", but
    // "the second one has not STARTED". `withTransaction` (`packages/db/src/tenancy.ts`) runs its
    // body inside `db.withWriteLock`, and `packages/store/src/write-queue.ts` issues
    // `begin immediate` … `commit`, so the next caller's `begin` does not run until that `commit`
    // has returned. Same observation, and the same reasoning, as `racePair` in
    // `packages/catalogue/test/fixtures.ts`; written out here rather than imported because that
    // helper lives in another package's test directory.
    //
    // NOT a translation of the old assertion: `pgErrorCode` answers the same string for every
    // failure on this engine (`packages/db/src/testing/errors.ts`), so a `.toBe("55P03")` kept as
    // `.toBe(<something>)` would have been a check that passes for the wrong reason.
    //
    // CONTROL RUN, 2026-09-22: with both bodies calling `appendToChain(suite.db, …)` directly
    // instead of through `withTransaction` — no queue — this case reported
    // `secondStarted === true` and failed at the `toBe(false)` below. So the `false` it reports is
    // not a reading that could never have printed anything else.
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
  // Deferred here from Task 13, which proved mintNumeroInstalacion correct BY CONSTRUCTION (one
  // statement — INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING — with no read-then-write
  // window for a second registration to slip into) but had no harness to exercise it under
  // simultaneous callers.
  //
  // 20 DISTINCT nodes of ONE obligado (one shared NIF), each registered exactly once, started
  // together — not fewer nodes hit multiple times each (node-id rekey, 2026-08-03: the SIF is the
  // node, so the counter's clients are nodes). registerSif's revoke-then-insert is two statements,
  // and firing it twice against the SAME node races a DIFFERENT, out-of-scope hazard
  // (registro_sif_activo_uq, concurrent re-registration of one node). This fixture isolates the
  // property Task 13 deferred: the (NIF, IdSistemaInformatico) counter's own allocation.
  //
  // LOST with PostgreSQL: the twenty callers were on twenty distinct backends and genuinely
  // overlapped inside the counter's one statement. Here they are twenty transactions started
  // together on one file and serialised by its write queue, so what is proven is that the
  // allocator hands out twenty distinct, strictly increasing numbers to twenty callers — not that
  // it survives a true overlap, which this engine cannot stage.
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
