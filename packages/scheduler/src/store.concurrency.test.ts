import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";
import { scheduledRuns } from "./schema/scheduled-runs.js";
import { dayPeriod } from "./derive.js";
import { claimGap, claimRow, completeRun, enqueueSuccessor, readSnapshot } from "./store.js";

const DUTY = "test.duty";
const NOW = new Date("2026-07-25T04:00:00Z");

/**
 * Three runners arriving at once on ONE venue file.
 *
 * ## What this file used to be
 *
 * It opened three PostgreSQL backends — two writers and a read-only probe — and forced each race
 * by holding one transaction open and polling `pg_locks` until the other backend was demonstrably
 * blocked. None of that exists here: a venue file has one write connection, and `pg_locks` has no
 * counterpart, so `waitForABlockedBackend` is gone with it. What replaces the forcing is the
 * write queue itself: two `withTransaction` calls started together are serialised, so the second
 * runner sees the first's COMMITTED state rather than racing it.
 *
 * ## The loss, and what was done about it
 *
 * **`enqueueSuccessor`'s unique-violation catch is no longer reachable through the public verb.**
 * The old third case worked only because the loser could see a state the winner had written but
 * not committed: its `unfinished > 0` guard passed on a stale read and its INSERT then collided.
 * Serialised, the loser's SELECT sees the winner's `pending` row, the guard returns `false` first,
 * and the catch never runs. That catch — and the SAVEPOINT around the insert it depends on — is
 * the regression guard `CLAUDE.md` §3 names on this file, so it is not left uncovered: it is
 * reached two ways below instead of one.
 *
 * - `reads a genuine SQLite unique violation as already-enqueued, not as an error` drives the
 *   catch with a stub whose refusal carries `errcode: 2067` and SQLite's own message. `errcode`,
 *   not `code`: `node:sqlite` puts `"ERR_SQLITE_ERROR"` on `code` for every failure alike
 *   (`packages/db/src/sql-state.ts`), so a stub forging a SQLSTATE-shaped `code` would stage no
 *   collision at all and `isUniqueViolation` would return false — the branch under test would
 *   never run and the case would pass for the wrong reason.
 * - `leaves the transaction usable after a refusal inside it` drives a REAL refusal on a real
 *   database, inside one `withTransaction`, and shows the work written before and after it both
 *   commit. That is the half the old case's `loserKeptGoing` asserted.
 *
 * **What is genuinely gone and is replaced by nothing:** the observation that a second runner had
 * actually reached the contended row while the first still held it. With one writer there is no
 * such moment to observe.
 *
 * Migration sets: CORE then SCHEDULER, the pair the deleted `core_scheduler` template this file
 * cloned was built from (`git show aabdde6a8^:packages/scheduler/src/testing/global-setup.ts`).
 *
 * `resetPerTest: false` is kept for the reason it was always kept: each case claims a DISTINCT
 * period, so accumulating rows never collide on `scheduled_runs_key`, and every read is scoped to
 * the row id or period it just wrote.
 */
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS],
  resetPerTest: false,
  setup: (db) => seedTenant(db),
});

describe("two runners starting together on one gap", () => {
  it("produces exactly one claim", async () => {
    const period = dayPeriod(new Date("2026-07-24T00:00:00Z"));
    // Started together and NOT awaited in turn; the write queue is what flattens them.
    const [first, second] = await Promise.all([
      withTransaction(suite.db, (tx) => claimGap(tx, { duty: DUTY, period, now: NOW })),
      withTransaction(suite.db, (tx) => claimGap(tx, { duty: DUTY, period, now: NOW })),
    ]);
    expect([first, second].filter((r) => r !== null)).toHaveLength(1);
  });
});

describe("two runners starting together on one failed row", () => {
  it("produces exactly one claim", async () => {
    const period = dayPeriod(new Date("2026-07-23T00:00:00Z"));
    const claimed = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    await withTransaction(suite.db, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "failed",
        summary: null,
        errorCode: "unknown",
        nextAttemptAt: NOW,
        now: NOW,
      }),
    );
    const later = new Date(NOW.getTime() + 60_000);
    const [first, second] = await Promise.all([
      withTransaction(suite.db, (tx) => claimRow(tx, { id: claimed!.id, now: later })),
      withTransaction(suite.db, (tx) => claimRow(tx, { id: claimed!.id, now: later })),
    ]);
    expect([first, second].filter((r) => r !== null)).toHaveLength(1);

    // The loser must not have inflated the attempt count — a conditional UPDATE that matched
    // nothing changes nothing, which is what bounds retries.
    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    expect(snapshot.rows.find((r) => r.id === claimed!.id)?.attempts).toBe(2);
  });
});

describe("enqueueSuccessor's duplicate-key catch", () => {
  it("reads a genuine SQLite unique violation as already-enqueued, not as an error", async () => {
    // A stub, because the branch is unreachable from a real database with one writer (this file's
    // header says why). The stub's job is to make the SELECT pass the `unfinished > 0` guard and
    // the nested insert refuse, so `enqueueSuccessor`'s own catch decides what happens.
    const refusal = Object.assign(
      // SQLite's own words for this table's key, and the only identity a unique refusal has here.
      new Error(
        "UNIQUE constraint failed: scheduled_runs.duty, scheduled_runs.period_from, " +
          "scheduled_runs.generation",
      ),
      // 2067, the extended result code for a unique INDEX (a primary key would be 1555) —
      // `packages/db/src/sql-state.ts`'s `UNIQUE_VIOLATION`. On `errcode`, never on `code`.
      { errcode: 2067 },
    );
    const fakeTx = {
      select: () => ({
        from: () => ({
          // `unfinished: 0` so the guard lets the insert run; `highest: 0` so it computes
          // generation 1. Numbers as the engine hands aggregates back.
          where: () => Promise.resolve([{ unfinished: 0, highest: 0 }]),
        }),
      }),
      transaction: (body: (attempt: Transaction) => Promise<unknown>) =>
        body({
          insert: () => ({ values: () => Promise.reject(refusal) }),
        } as unknown as Transaction),
    } as unknown as Transaction;

    const period = dayPeriod(new Date("2026-07-18T00:00:00Z"));
    // `false`, not a throw: the successor exists, which is the same fact the caller wanted.
    await expect(
      enqueueSuccessor(fakeTx, { duty: DUTY, period, dueAt: new Date("2026-07-26T00:00:00Z") }),
    ).resolves.toBe(false);
  });

  it("rethrows a refusal that is not a unique violation", async () => {
    // The control for the case above, and the half that stops the catch swallowing everything. A
    // NOT NULL refusal (1299) is a real refusal of a DIFFERENT class, so `isUniqueViolation` must
    // decline it and the error must reach the caller unchanged.
    const other = Object.assign(new Error("NOT NULL constraint failed: scheduled_runs.duty"), {
      errcode: 1299,
    });
    const fakeTx = {
      select: () => ({
        from: () => ({ where: () => Promise.resolve([{ unfinished: 0, highest: 0 }]) }),
      }),
      transaction: (body: (attempt: Transaction) => Promise<unknown>) =>
        body({ insert: () => ({ values: () => Promise.reject(other) }) } as unknown as Transaction),
    } as unknown as Transaction;

    const period = dayPeriod(new Date("2026-07-17T00:00:00Z"));
    await expect(
      enqueueSuccessor(fakeTx, { duty: DUTY, period, dueAt: new Date("2026-07-26T00:00:00Z") }),
    ).rejects.toBe(other);
  });

  it("leaves the transaction usable after a refusal inside it", async () => {
    // The half the deleted race case asserted with `loserKeptGoing`: a refusal absorbed inside one
    // transaction must not cost that transaction the work written beside it. On PostgreSQL a
    // refused statement aborted the WHOLE transaction, so without the savepoint the enqueue that
    // came after would have failed with `25P02` and `completeRun`'s own already-written row would
    // have been rolled back — the incident `CLAUDE.md` §3 records against this file.
    //
    // Driven with a REAL refusal, not a stub, and inside ONE `withTransaction`: an insert that
    // duplicates the row written moments earlier in the same transaction, caught at a nested
    // `tx.transaction` savepoint, with real work either side of it.
    //
    // MEASURED 2026-09-22, and the finding is worth stating rather than implying: with the nested
    // `tx.transaction` replaced by a bare `tx.insert`, this case STILL PASSES. SQLite backs out
    // the refused statement alone and leaves the transaction open, so on this engine the savepoint
    // is not what rescues the transaction — `packages/scheduler/src/store.ts:293-307` says the
    // same and cites `bench/sqlite-failover/README.md`. So this case pins the OUTCOME (the work
    // either side of a refusal commits) and NOT the savepoint's necessity, which no longer holds
    // on this engine and which nothing here should be read as proving.
    const first = dayPeriod(new Date("2026-07-16T00:00:00Z"));
    const second = dayPeriod(new Date("2026-07-15T00:00:00Z"));
    const dueAt = new Date("2026-07-26T00:00:00Z");

    const kept = await withTransaction(suite.db, async (tx) => {
      const enqueued = await enqueueSuccessor(tx, { duty: DUTY, period: first, dueAt });
      let refused = false;
      try {
        await tx.transaction(async (attempt) => {
          await attempt.insert(scheduledRuns).values({
            duty: DUTY,
            periodFrom: first.from.toISOString(),
            periodTo: first.to.toISOString(),
            // The generation `enqueueSuccessor` just used, so this collides on
            // `scheduled_runs_key` rather than inserting a second row.
            generation: 0,
            state: "pending",
            attempts: 0,
            nextAttemptAt: dueAt.toISOString(),
          });
        });
      } catch {
        refused = true;
      }
      // The refusal has to have HAPPENED, or everything below is vacuous.
      expect(refused).toBe(true);
      // And the transaction still takes writes.
      const after = await enqueueSuccessor(tx, { duty: DUTY, period: second, dueAt });
      return { enqueued, after };
    });

    expect(kept).toEqual({ enqueued: true, after: true });

    // Both committed, and the refused duplicate left no second row behind.
    const rows = await suite.db
      .select()
      .from(scheduledRuns)
      .where(
        and(eq(scheduledRuns.duty, DUTY), eq(scheduledRuns.periodFrom, first.from.toISOString())),
      );
    expect(rows).toHaveLength(1);
    const later = await suite.db
      .select()
      .from(scheduledRuns)
      .where(
        and(eq(scheduledRuns.duty, DUTY), eq(scheduledRuns.periodFrom, second.from.toISOString())),
      );
    expect(later).toHaveLength(1);
  });
});
