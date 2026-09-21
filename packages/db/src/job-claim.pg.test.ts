// Real PostgreSQL, not PGlite: both cases run a SECOND claimer while a first one still holds its
// rows, and PGlite serialises every query onto its one backend, so the second claimer cannot exist
// there at all and the suite would pass without proving anything (CLAUDE.md §4).
//
// What each case establishes, rather than what PostgreSQL does in general: that the claim skips a
// row another claimer holds instead of waiting for it, and that the two claimers between them take
// each row once. The negative control was run rather than reasoned about — with `skip locked`
// deleted from `job-claim.ts`, both cases stop returning and fail on the suite's timeout, because
// the second claimer waits for the first one's transaction.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { claimLock, claimRows } from "./job-claim.js";
import { count, label, table } from "./schema/columns.js";
import { withTransaction } from "./tenancy.js";
import { useTemplateDb } from "./testing/lifecycle.js";

const probeJobs = table("probe_jobs", {
  position: count("position").primaryKey(),
  status: label("status").notNull(),
});

type ClaimedProbe = { position: number };

describe("two claimers over one queue", () => {
  const suite = useTemplateDb({
    template: "core",
    setup: async ({ admin }) => {
      await admin.execute(
        sql`create table probe_jobs (position integer primary key, status text not null)`,
      );
    },
  });

  /** Four claimable rows, and a fresh pool for each claimer so the two are separate backends. */
  const seed = async () => {
    await suite.admin.execute(sql`delete from probe_jobs`);
    await suite.admin.execute(
      sql`insert into probe_jobs (position, status) select n, 'pending' from generate_series(1, 4) as n`,
    );
  };

  it("hands the second claimer the rows the first did not take, and never the same row twice", async () => {
    await seed();
    const holder = await suite.pg.connect();
    const waiter = await suite.pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));
      let first: number[] = [];

      // The first claimer takes two rows and keeps its transaction open across the second claim.
      holding = withTransaction(holder, async (tx) => {
        const claimed = await claimRows<ClaimedProbe>(tx, {
          table: "probe_jobs",
          claimable: sql`j.status = 'pending'`,
          order: sql`j.position`,
          limit: 2,
          set: sql`status = 'running'`,
          returning: sql`probe_jobs.position`,
        });
        first = claimed.map((row) => row.position);
        acquire();
        await held;
      });
      await acquired;

      // Asking for all four while the first claimer holds two: it returns the other two straight
      // away. Blocking instead would fail this case on the suite's timeout, never on an assertion.
      const second = await withTransaction(waiter, (tx) =>
        claimRows<ClaimedProbe>(tx, {
          table: "probe_jobs",
          claimable: sql`j.status = 'pending'`,
          order: sql`j.position`,
          limit: 4,
          set: sql`status = 'running'`,
          returning: sql`probe_jobs.position`,
        }),
      );
      const secondPositions = second.map((row) => row.position);

      // Sorted, because RETURNING's row order is not the `order by` the claim was taken in —
      // measured 2026-09-21, a four-row claim returning 3, 2, 4. What the order DOES decide is
      // which rows are claimed, and that is what these two assertions read.
      expect([...first].sort()).toEqual([1, 2]);
      expect([...secondPositions].sort()).toEqual([3, 4]);

      release();
      await holding;
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });

  it("does the same when the claim is the lock alone", async () => {
    await seed();
    const holder = await suite.pg.connect();
    const waiter = await suite.pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));

      // The first claimer locks ONE row — the raw statement, so the case reads the helper's
      // behaviour against a held lock rather than against itself.
      let lockedPosition = 0;
      holding = withTransaction(holder, async (tx) => {
        const locked = await tx.execute<{ position: number }>(
          sql`select position from probe_jobs where status = 'pending'
              order by position limit 1 for update skip locked`,
        );
        lockedPosition = locked.rows[0].position;
        acquire();
        await held;
      });
      await acquired;

      const second = await withTransaction(waiter, (tx) =>
        claimLock(
          tx
            .select({ position: probeJobs.position })
            .from(probeJobs)
            .where(sql`${probeJobs.status} = 'pending'`)
            .orderBy(probeJobs.position),
        ),
      );
      const secondPositions = second.map((row) => row.position);

      expect(lockedPosition).toBe(1);
      expect(secondPositions).not.toContain(lockedPosition);
      // Exact order, not sorted: this claim is a SELECT with an ORDER BY, and a forward pass in
      // `packages/payments` reads its queue oldest-first. The sibling case above sorts because an
      // UPDATE's RETURNING carries no such promise.
      expect(secondPositions).toEqual([2, 3, 4]);

      release();
      await holding;
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });
});
