import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, refusalError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { reconciliationRuns } from "../schema/reconciliation-runs.js";
import { dayPeriod } from "./derive.js";
import { claimGap, claimRow, completeRun, enqueueSuccessor, readSnapshot } from "./store.js";

const DUTY = "test.duty";
const NOW = new Date("2026-07-25T04:00:00Z");

/**
 * Runners arriving at once on one venue file. `withTransaction` serialises them, so the second sees
 * the first's committed state rather than racing it, and nothing here observes two runners holding
 * one row at the same moment. Serialised, `enqueueSuccessor`'s guard refuses before its insert can
 * collide, so its unique-violation catch is reached below only by faking the guard's read: twice with
 * a stub transaction whose insert also refuses, once on the real transaction.
 *
 * Each case claims a distinct period, so rows accumulating under `resetPerTest: false` never collide.
 */
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  resetPerTest: false,
  setup: (db) => seedTaxpayer(db),
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
      withTransaction(suite.db, (tx) =>
        claimRow(tx, { id: claimed!.id, now: later, longestWaitMs: 24 * 60 * 60 * 1000 }),
      ),
      withTransaction(suite.db, (tx) =>
        claimRow(tx, { id: claimed!.id, now: later, longestWaitMs: 24 * 60 * 60 * 1000 }),
      ),
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
    // Passes the `unfinished > 0` guard and makes the insert refuse, so `enqueueSuccessor`'s own
    // catch decides what happens.
    const refusal = refusalError({
      unique: { table: "reconciliation_runs", columns: ["duty", "period_from", "generation"] },
    });
    const fakeTx = {
      select: () => ({
        from: () => ({
          // `unfinished: 0` so the guard lets the insert run; `highest: 0` so it computes
          // generation 1. Numbers as the engine hands aggregates back.
          where: () => Promise.resolve([{ unfinished: 0, highest: 0 }]),
        }),
      }),
      insert: () => ({ values: () => Promise.reject(refusal) }),
    } as unknown as Transaction;

    const period = dayPeriod(new Date("2026-07-18T00:00:00Z"));
    // `false`, not a throw: the successor exists, which is the same fact the caller wanted.
    await expect(
      enqueueSuccessor(fakeTx, { duty: DUTY, period, dueAt: new Date("2026-07-26T00:00:00Z") }),
    ).resolves.toBe(false);
  });

  it("rethrows a refusal that is not a unique violation", async () => {
    const other = refusalError({ notNull: { table: "reconciliation_runs", column: "duty" } });
    const fakeTx = {
      select: () => ({
        from: () => ({ where: () => Promise.resolve([{ unfinished: 0, highest: 0 }]) }),
      }),
      insert: () => ({ values: () => Promise.reject(other) }),
    } as unknown as Transaction;

    const period = dayPeriod(new Date("2026-07-17T00:00:00Z"));
    await expect(
      enqueueSuccessor(fakeTx, { duty: DUTY, period, dueAt: new Date("2026-07-26T00:00:00Z") }),
    ).rejects.toBe(other);
  });

  it("returns false for its own insert's real collision and leaves the transaction usable", async () => {
    const collided = dayPeriod(new Date("2026-07-14T00:00:00Z"));
    const second = dayPeriod(new Date("2026-07-13T00:00:00Z"));
    const dueAt = new Date("2026-07-26T00:00:00Z");
    const periodRows = (period: typeof collided) =>
      suite.db
        .select()
        .from(reconciliationRuns)
        .where(
          and(
            eq(reconciliationRuns.duty, DUTY),
            eq(reconciliationRuns.periodFrom, period.from.toISOString()),
          ),
        );

    const results = await withTransaction(suite.db, async (tx) => {
      const first = await enqueueSuccessor(tx, { duty: DUTY, period: collided, dueAt });
      // The real transaction, but its guard read reports no rows, so the insert reuses generation
      // 0 and SQLite refuses it on `reconciliation_runs_key`.
      let guardFaked = false;
      const blindGuard = new Proxy(tx, {
        get: (target, property) => {
          if (property === "select") {
            guardFaked = true;
            return () => ({
              from: () => ({ where: () => Promise.resolve([{ unfinished: 0, highest: -1 }]) }),
            });
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? (value as () => unknown).bind(target) : value;
        },
      });
      const duplicate = await enqueueSuccessor(blindGuard, { duty: DUTY, period: collided, dueAt });
      const after = await enqueueSuccessor(tx, { duty: DUTY, period: second, dueAt });
      return { first, duplicate, after, guardFaked };
    });

    expect(results).toEqual({ first: true, duplicate: false, after: true, guardFaked: true });
    expect(await periodRows(collided)).toHaveLength(1);
    expect(await periodRows(second)).toHaveLength(1);
  });
});
