import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { appendToChain } from "./chain.js";
import { altaFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

const WRITERS = 20;

// One instance for both tests, reseeded per test — chain.test.ts's convention. Sharing it does not
// weaken the pid assertion below: one PGlite instance is exactly the single backend this file
// exists to demonstrate.
const pg = usePgliteDb({ migrations: TEST_MIGRATIONS });

let till: SeededTill;

beforeEach(async () => {
  till = await seedTill(pg.db);
});

/**
 * This file is a permanent, executable demonstration that the concurrency suite
 * (./chain.concurrency.test.ts) CANNOT live on PGlite. It is not a duplicate of that suite; it is
 * the counter-example that keeps someone from "simplifying" the Testcontainers dependency away six
 * months from now.
 *
 * THE MECHANISM, PRECISELY — this is the one thing this file must get right, because it exists
 * only to be read as evidence: PGlite 0.5.4 serialises every `.query()`/`.transaction()` call
 * through one per-instance, weight-1 mutex (`_runExclusiveTransaction`, verified against PGlite's
 * own source). That is a SINGLE-BACKEND MUTEX, not "concurrent transactions merging into one" —
 * the wording an earlier draft of the spec used and which this file deliberately does not repeat.
 * The distinction matters: with the mutex, there is never a SECOND backend process for `FOR
 * UPDATE` to block against, full stop — nothing runs at the same time as anything else, ever, no
 * matter what the writers touch. "Transactions merge" describes a real but DIFFERENT and narrower
 * hazard — losing transaction GROUPING, such that one caller's statements could interleave with
 * another's in dispatch order — which is not what makes the test below pass, because every writer
 * here only ever touches its own sale and its own registro row.
 */
describe("PGlite cannot test lock contention", () => {
  it("reports a green 20-writer contention run — while proving nothing", async () => {
    const sales = await Promise.all(
      Array.from({ length: WRITERS }, (_, i) => seedSale(pg.db, till, i + 1)),
    );
    await Promise.all(
      sales.map((saleId, i) =>
        pg.db.transaction((tx) =>
          appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, saleId, i + 1, i)),
        ),
      ),
    );
    const { rows } = await pg.db.execute<{ secuencia: number }>(sql`
      select secuencia from registros_facturacion where node_id = ${till.nodeId} order by secuencia
    `);
    // Green. Identical assertions to the real-Postgres suite's "commits all 20 concurrent appends
    // to one chain" / "assigns every concurrent append a distinct position with no gaps". Worthless
    // — see the next test for why.
    expect(rows.map((r) => r.secuencia)).toEqual(Array.from({ length: WRITERS }, (_, i) => i + 1));
  });

  it("serialises every 'concurrent' query onto one backend process (a single-backend mutex, not merged transactions)", async () => {
    // Here is WHY the run above is worthless. Twenty writers, ONE pid. There was never any
    // contention to survive, so FOR UPDATE never blocked and the unique constraint was never
    // approached. If this test ever FAILS because the pids differ, PGlite has gained real
    // concurrency and the decision to require Testcontainers may be revisited — deliberately, on
    // evidence, not by assumption.
    const pids = await Promise.all(
      Array.from({ length: WRITERS }, async () => {
        const { rows } = await pg.db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        return rows[0]?.pid;
      }),
    );
    expect(new Set(pids).size).toBe(1);
  });
});
