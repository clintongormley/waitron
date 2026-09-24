import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";
import { DEFAULTS, type LedgerSnapshot } from "./derive.js";
import { completeRun, readSnapshot, reclaimStale } from "./store.js";
import { runDue, type SchedulerDeps } from "./run.js";
import { scheduledRuns } from "./schema/scheduled-runs.js";
import { FakeDuty } from "./testing/fake-duty.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

const NOW = new Date("2026-07-25T04:00:00Z");
const TOMORROW = new Date("2026-07-26T04:00:00Z");
const HORIZON_START = new Date("2026-06-01T00:00:00Z");
const DUTY = "test.duty";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS] });

beforeEach(async () => {
  await seedTenant(suite.db);
});

function deps(duties: SchedulerDeps["duties"]): SchedulerDeps {
  return { db: suite.db, duties, ...DEFAULTS };
}

function snapshotOf(): Promise<LedgerSnapshot> {
  return withTransaction(suite.db, (tx) =>
    readSnapshot(tx, { duty: DUTY, horizonStart: HORIZON_START }),
  );
}

describe("resweepAfter", () => {
  it("enqueues the next generation of the SAME period, due when asked", async () => {
    const duty = new FakeDuty(DUTY, () =>
      Promise.resolve({ summary: { gated: 1 }, resweepAfter: TOMORROW }),
    );
    await runDue(deps([duty]), NOW);

    const snapshot = await snapshotOf();
    const pending = snapshot.rows.filter((r) => r.state === "pending");
    expect(pending).toHaveLength(1);
    expect(new Date(pending[0]!.periodFrom).toISOString()).toBe("2026-07-24T00:00:00.000Z");
    expect(pending[0]).toMatchObject({ generation: 1 });
  });

  // Derivation answered from a snapshot taken before the duty ran, where the re-sweep row did not
  // exist, so on its own it reports the next day boundary; `soon` is earlier than that boundary.
  it("reports the re-sweep it just enqueued as the next due time", async () => {
    const soon = new Date("2026-07-25T05:00:00Z");
    const duty = new FakeDuty(DUTY, () => Promise.resolve({ summary: {}, resweepAfter: soon }));
    const result = await runDue(deps([duty]), NOW);
    expect(result.nextDueAt).toEqual(soon);
  });

  // A concurrent runner, played inside the duty's own run(), which executes outside every
  // transaction, has already enqueued a successor, so the guard refuses ours.
  it("does not report a re-sweep time for a successor the guard refused", async () => {
    const soon = new Date("2026-07-25T05:00:00Z");
    const duty = new FakeDuty(DUTY, async (call) => {
      await withTransaction(suite.db, (tx) =>
        tx.insert(scheduledRuns).values({
          duty: DUTY,
          periodFrom: call.period.from.toISOString(),
          periodTo: call.period.to.toISOString(),
          generation: 7,
          state: "pending",
          attempts: 0,
          nextAttemptAt: new Date("2026-07-27T00:00:00Z").toISOString(),
        }),
      );
      return { summary: {}, resweepAfter: soon };
    });

    const result = await runDue(deps([duty]), NOW);
    expect(result.ran).toHaveLength(1);
    // The competing row was inserted after the snapshot was read, so derivation never saw it
    // either: the answer is the plain next day boundary.
    expect(result.nextDueAt).toEqual(new Date("2026-07-26T00:00:00Z"));

    const snapshot = await snapshotOf();
    expect(snapshot.rows.map((r) => r.generation).sort()).toEqual([0, 7]);
  });

  // Without this the period would never be re-derived: it has no gap.
  it("runs the same period again once its due time arrives", async () => {
    const duty = new FakeDuty(DUTY, (_call, index) =>
      Promise.resolve(index === 0 ? { summary: {}, resweepAfter: TOMORROW } : { summary: {} }),
    );
    await runDue(deps([duty]), NOW);
    const second = await runDue(deps([duty]), TOMORROW);

    const reswept = second.ran.filter(
      (r) => r.period.from.toISOString() === "2026-07-24T00:00:00.000Z",
    );
    expect(reswept).toHaveLength(1);
    expect(reswept[0]).toMatchObject({ generation: 1, outcome: "succeeded" });
  });

  it("does not re-run the period before its due time", async () => {
    const duty = new FakeDuty(DUTY, () => Promise.resolve({ summary: {}, resweepAfter: TOMORROW }));
    await runDue(deps([duty]), NOW);
    const soon = await runDue(deps([duty]), new Date("2026-07-25T05:00:00Z"));
    expect(soon.ran).toEqual([]);
  });

  it("keeps the chain linear — one unresolved finding cannot fan out", async () => {
    // Each tick completes its own row before enqueueing the next, so the guard never refuses here;
    // store.test.ts covers the refusal.
    const duty = new FakeDuty(DUTY, (call) =>
      Promise.resolve({ summary: {}, resweepAfter: new Date(call.now.getTime() + 60_000) }),
    );
    let at = NOW;
    for (let i = 0; i < 3; i += 1) {
      await runDue(deps([duty]), at);
      at = new Date(at.getTime() + 120_000);
    }
    const snapshot = await snapshotOf();
    expect(snapshot.rows.filter((r) => r.state === "pending")).toHaveLength(1);
    expect(snapshot.rows.filter((r) => r.state === "succeeded")).toHaveLength(3);
  });

  it("survives a period older than the horizon", async () => {
    // A re-sweep is EXPLICIT work, so the gap horizon must not bury it. Seeded by hand below the
    // horizon, which no gap derivation would reach.
    const old = new Date("2026-04-20T00:00:00Z");
    const duty = new FakeDuty(DUTY, () => Promise.resolve({ summary: {} }));
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(scheduledRuns).values({
        duty: DUTY,
        periodFrom: old.toISOString(),
        periodTo: new Date(old.getTime() + 86_400_000).toISOString(),
        generation: 1,
        state: "pending",
        attempts: 0,
        nextAttemptAt: NOW.toISOString(),
      });
    });
    const result = await runDue(deps([duty]), NOW);
    expect(result.ran.map((r) => r.period.from.toISOString())).toContain(
      "2026-04-20T00:00:00.000Z",
    );
  });

  // The reclaiming runner leaves the row `succeeded` before the stale attempt completes, so the
  // store's own non-terminal guard would let a successor through; only the fence's result stops it.
  it("does not enqueue a successor off a completion the ownership fence rejected", async () => {
    const duty = new FakeDuty(DUTY, async (call) => {
      const snapshot = await snapshotOf();
      const row = snapshot.rows.find(
        (r) => new Date(r.periodFrom).getTime() === call.period.from.getTime(),
      )!;
      const reclaimAt = new Date(call.now.getTime() + DEFAULTS.staleAfterMs + 1);
      const reclaimed = await withTransaction(suite.db, (tx) =>
        reclaimStale(tx, { id: row.id, now: reclaimAt, staleAfterMs: DEFAULTS.staleAfterMs }),
      );
      expect(reclaimed).not.toBeNull();
      // The reclaiming runner finishes its own attempt first, leaving the row terminal.
      const won = await withTransaction(suite.db, (tx) =>
        completeRun(tx, {
          id: reclaimed!.id,
          startedAt: reclaimed!.startedAt,
          state: "succeeded",
          summary: { ok: true },
          errorCode: null,
          nextAttemptAt: null,
          now: reclaimAt,
        }),
      );
      expect(won).toBe(true);
      return { summary: {}, resweepAfter: TOMORROW };
    });

    const result = await runDue(deps([duty]), NOW);
    expect(result.ran).toEqual([]);

    const snapshot = await snapshotOf();
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({ state: "succeeded" });
  });
});
