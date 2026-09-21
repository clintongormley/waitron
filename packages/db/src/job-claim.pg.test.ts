// Real PostgreSQL, not PGlite: every case here runs a SECOND session against rows a first session
// is holding, and PGlite serialises every query onto its one backend, so a second session cannot
// exist there and the suite would pass without proving anything (CLAUDE.md §4). The claims run as
// `app_user`, the deployment role, because the proof they hold came from a suite that ran that way
// (`packages/printing/src/runtime.race.test.ts`). What that buys HERE is narrow, and worth saying
// so nobody assumes more: the probe table's grants are the ones this file hands out, so the role
// can only catch SQL a non-owner may not run at all — not a privilege missing on a real table.
//
// This is where the properties of a claim statement that need a second session are held, rather
// than at any one caller: that a claimer does not WAIT for another claimer, that a claim takes a
// row another transaction rewrote underneath it, and that a lock-only claimer partitions the queue
// with the rest. What one claim statement selects and stamps on its own, grants included, lives in
// the hermetic sibling `job-claim.test.ts`. `packages/payments/src/forward.concurrency.test.ts` holds the
// first property at its own call site and is deliberately untouched by the change that added this
// file; the case below is the `packages/db` guard for it, so that this module's behaviour does not
// depend on a suite in a package that depends on it.
//
// Running the negative control takes minutes, not seconds. Measured 2026-09-21 with `skip locked`
// deleted from `job-claim.ts`: three cases failed, which on the day was every case in this file —
// it has gained one since, so read that as a dated run rather than as a description of the file.
// The first fails on the 30s test timeout, which IS the waiting the clause exists to avoid; its
// holder is then still parked, so the per-test reset blocks on that holder's row locks (a 120s
// hook timeout) and whatever follows goes with it. Only the first failure is the control; the rest
// is collateral. Task P4b's `claimLockedRows` case was measured the same way on the same day, and
// fails the same way — see the note on that case.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Transaction } from "./client.js";
import { claimLock, claimLockedRows, claimRows } from "./job-claim.js";
import { count, label, table } from "./schema/columns.js";
import { withTransaction } from "./tenancy.js";
import { useTemplateDb } from "./testing/lifecycle.js";
import type { RealPostgres } from "./testing/postgres.js";
import { asAppUser } from "./testing/roles.js";

const probeJobs = table("probe_jobs", {
  position: count("position").primaryKey(),
  status: label("status").notNull(),
});

/** The advisory lock the gate function below parks on. Any number nothing else uses. */
const GATE = 7654321;

interface Held<T> {
  /** What the holding transaction produced before it parked. */
  readonly value: T;
  /** Lets the holding transaction finish, and waits for it. */
  readonly release: () => Promise<void>;
}

/**
 * Runs `body` as `app_user` in a backend of its own and keeps that transaction OPEN afterwards, so
 * a second claimer can be watched while the first still holds whatever `body` took.
 *
 * The same holder/waiter shape is hand-written in every real-PostgreSQL contention suite in this
 * repository; this copy is local because making it shared is a change to `testing/lifecycle.ts`
 * that reaches all of them, which is not this file's to make.
 */
async function holdOpen<T>(
  pg: RealPostgres,
  body: (tx: Transaction) => Promise<T>,
): Promise<Held<T>> {
  const db = await pg.connect();
  let release!: () => void;
  const parked = new Promise<void>((resolve) => (release = resolve));
  let acquired!: (value: T) => void;
  let failed!: (reason: unknown) => void;
  const ready = new Promise<T>((resolve, reject) => {
    acquired = resolve;
    failed = reject;
  });
  const holding = withTransaction(db, async (tx) => {
    await asAppUser(tx);
    let value: T;
    try {
      value = await body(tx);
    } catch (error) {
      failed(error);
      throw error;
    }
    acquired(value);
    await parked;
  }).finally(() => db.close());
  holding.catch(() => undefined);
  return {
    value: await ready,
    release: async () => {
      release();
      await holding;
    },
  };
}

/** Runs `body` while `held` is still holding, and releases it afterwards however `body` ends. */
async function whileHolding<T>(held: Held<unknown>, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } finally {
    await held.release();
  }
}

/** Runs one claim as `app_user` on a backend of its own, and closes it again. */
async function asClaimer<T>(pg: RealPostgres, body: (tx: Transaction) => Promise<T>): Promise<T> {
  const db = await pg.connect();
  try {
    return await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      return body(tx);
    });
  } finally {
    await db.close();
  }
}

describe("claiming job rows against another session", () => {
  const suite = useTemplateDb({
    template: "core",
    setup: async ({ admin }) => {
      await admin.execute(sql`create table probe_jobs (
        position integer primary key, status text not null, payload text not null)`);
      // Parks whatever statement evaluates it until the advisory lock is free, which is how a claim
      // is held open in the middle of its own execution. `CREATE FUNCTION` takes no bind
      // parameters, so the lock number goes in as text (`08P01` otherwise).
      await admin.execute(sql`create function probe_gate() returns boolean language plpgsql as
        $$ begin perform pg_advisory_xact_lock(${sql.raw(String(GATE))}); return true; end $$`);
      await admin.execute(sql`grant select, insert, update, delete on probe_jobs to app_user`);
    },
  });

  /** Four claimable rows. The per-test reset empties the table between cases. */
  const seed = async (rows = 4) => {
    await suite.admin.execute(sql`insert into probe_jobs (position, status, payload)
      select n, 'pending', 'original' from generate_series(1, ${rows}) as n`);
  };

  const claimSpec = (limit: number) => ({
    table: "probe_jobs",
    key: "position",
    claimable: sql`j.status = 'pending'`,
    order: sql`j.position`,
    limit,
    set: sql`status = 'running'`,
    returning: sql`probe_jobs.position`,
  });

  it("hands the second claimer the rows the first did not take, and never the same row twice", async () => {
    await seed();

    // The first claimer takes two rows and keeps its transaction open across the second claim.
    const first = await holdOpen(suite.pg, (tx) =>
      claimRows<{ position: number }>(tx, claimSpec(2)).then((rows) => rows.map((r) => r.position)),
    );
    // Asking for all four while the first claimer holds two: it returns the other two straight
    // away. Waiting instead would fail this case on the suite's timeout, never on an assertion.
    const second = await whileHolding(first, () =>
      asClaimer(suite.pg, (tx) =>
        claimRows<{ position: number }>(tx, claimSpec(4)).then((rows) =>
          rows.map((r) => r.position),
        ),
      ),
    );

    // Sorted, because RETURNING's row order is not the `order by` the claim was taken in —
    // measured 2026-09-21, a four-row claim returning 3, 2, 4. What the order DOES decide is which
    // rows are claimed, and that is what these two assertions read.
    expect([...first.value].sort()).toEqual([1, 2]);
    expect([...second].sort()).toEqual([3, 4]);
  });

  it("takes a row another transaction rewrote while the claim was running", async () => {
    await seed(1);
    // Hold the gate, so the claim below parks inside its own statement.
    const gate = await holdOpen(suite.pg, (tx) =>
      tx.execute(sql`select pg_advisory_xact_lock(${GATE})`),
    );

    const claimed = await whileHolding(gate, async () => {
      const claiming = asClaimer(suite.pg, (tx) =>
        claimRows<{ position: number; payload: string }>(tx, {
          ...claimSpec(1),
          claimable: sql`j.status = 'pending' and (select probe_gate())`,
          returning: sql`probe_jobs.position, probe_jobs.payload`,
        }),
      );
      claiming.catch(() => undefined);
      await expect
        .poll(
          async () =>
            (
              await suite.admin.execute<{ n: number }>(sql`select count(*)::int as n
                from pg_stat_activity
                where datname = current_database() and wait_event = 'advisory'`)
            ).rows[0]?.n,
          { timeout: 5_000 },
        )
        .toBe(1);

      // The claim's statement has begun and is parked. Change the row it is about to take.
      await suite.admin.execute(
        sql`update probe_jobs set payload = 'rewritten' where position = 1`,
      );
      await gate.release();
      return claiming;
    });

    // Keyed on the row's `ctid` this returns nothing at all: the outer scan still sees the row
    // where it used to be, while the selection has followed it to where it now is. Keyed on its
    // primary key the claim takes it, carrying the other transaction's change.
    expect(claimed).toEqual([{ position: 1, payload: "rewritten" }]);
  });

  it("does the same when the claim is the lock alone", async () => {
    await seed();

    // The first session locks ONE row with a raw statement, so the case reads the helper's
    // behaviour against a held lock rather than against itself.
    const first = await holdOpen(suite.pg, async (tx) => {
      const locked = await tx.execute<{ position: number }>(
        sql`select position from probe_jobs where status = 'pending'
            order by position limit 1 for update skip locked`,
      );
      return locked.rows[0]?.position;
    });
    const second = await whileHolding(first, () =>
      asClaimer(suite.pg, (tx) =>
        claimLock(
          tx
            .select({ position: probeJobs.position })
            .from(probeJobs)
            .where(sql`${probeJobs.status} = 'pending'`)
            .orderBy(probeJobs.position),
        ).then((rows) => rows.map((r) => r.position)),
      ),
    );

    expect(first.value).toBe(1);
    expect(second).not.toContain(first.value);
    // Exact order, not sorted: this claim is a SELECT with an ORDER BY, and a forward pass in
    // `packages/payments` reads its queue oldest-first. The sibling cases sort because an UPDATE's
    // RETURNING carries no such promise.
    expect(second).toEqual([2, 3, 4]);
  });
  it("hands the lock-only claimer the rows the first did not take, and stamps nothing", async () => {
    await seed();

    // The negative control for this case, measured 2026-09-21: with `skip locked` deleted from
    // `claimLockedRows` alone, it fails on the 30s test timeout — which IS the waiting the clause
    // exists to avoid, and it then parks the per-test reset on its own 120s hook timeout. On the
    // day it was measured another case followed it and went down with it; it is the file's last
    // case now, so there is nothing left for it to take — that part is a deduction from the shape
    // of the file, not something that was run again.
    const pending = (limit: number) => ({
      selection: sql`select j.position from probe_jobs j
        where j.status = 'pending' order by j.position limit ${limit}`,
      of: "j",
    });
    const first = await holdOpen(suite.pg, (tx) =>
      claimLockedRows<{ position: number }>(tx, pending(2)).then((rows) =>
        rows.map((r) => r.position),
      ),
    );
    // Asking for all four while the first claimer holds two: it returns the other two straight
    // away. Waiting instead would fail this case on the suite's timeout, never on an assertion.
    const second = await whileHolding(first, () =>
      asClaimer(suite.pg, (tx) =>
        claimLockedRows<{ position: number }>(tx, pending(4)).then((rows) =>
          rows.map((r) => r.position),
        ),
      ),
    );

    expect(first.value).toEqual([1, 2]);
    // Exact order, not sorted: a lock-only claim is a SELECT with an ORDER BY, as in the sibling
    // `claimLock` case above.
    expect(second).toEqual([3, 4]);
    // The claim is the lock alone. Nothing either claimer took carries a mark of having been
    // taken — which is the whole difference from `claimRows`, and what lets the drain decide row
    // by row which of the rows it locked it will actually stamp.
    const after = await suite.admin.execute<{ status: string }>(
      sql`select status from probe_jobs order by position`,
    );
    expect(after.rows.map((r) => r.status)).toEqual(["pending", "pending", "pending", "pending"]);
  });
});
