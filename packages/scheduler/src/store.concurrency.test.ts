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
 * Runners arriving at once on one venue file. `withTransaction` serialises them, so the second sees
 * the first's committed state rather than racing it, and nothing here observes two runners holding
 * one row at the same moment. Serialised, `enqueueSuccessor`'s guard refuses before its insert can
 * collide, so its unique-violation catch is reached below only through a stub.
 *
 * Each case claims a distinct period, so rows accumulating under `resetPerTest: false` never collide.
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

    // The loser must not have inflated the attempt count, which is what bounds retries.
    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    expect(snapshot.rows.find((r) => r.id === claimed!.id)?.attempts).toBe(2);
  });
});

describe("enqueueSuccessor's duplicate-key catch", () => {
  it("reads a genuine SQLite unique violation as already-enqueued, not as an error", async () => {
    // Passes the `unfinished > 0` guard and makes the nested insert refuse, so `enqueueSuccessor`'s
    // own catch decides what happens.
    const refusal = Object.assign(
      // SQLite's own message for this table's key.
      new Error(
        "UNIQUE constraint failed: scheduled_runs.duty, scheduled_runs.period_from, " +
          "scheduled_runs.generation",
      ),
      // 2067, a unique index. On `errcode`, never `code`: `node:sqlite` puts `"ERR_SQLITE_ERROR"` on
      // `code` for every failure, so a stub forging `code` would stage no collision at all.
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
    // Pins the outcome — work either side of a refusal commits — not the savepoint's necessity:
    // SQLite backs out only the refused statement, so this passes with a bare `tx.insert` too.
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
      const after = await enqueueSuccessor(tx, { duty: DUTY, period: second, dueAt });
      return { enqueued, after };
    });

    expect(kept).toEqual({ enqueued: true, after: true });

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
