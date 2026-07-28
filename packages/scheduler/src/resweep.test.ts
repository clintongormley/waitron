import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  createPgliteDb,
  runMigrations,
  withTenant,
  type Database,
} from "@waitron/db";
import type { TenantId } from "@waitron/shared";
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

let db: Database;
let tenantId: TenantId;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, SCHEDULER_MIGRATIONS);
});

afterAll(async () => {
  if (db !== undefined) await db.close();
});

beforeEach(async () => {
  tenantId = await seedTenant(db);
});

function deps(duties: SchedulerDeps["duties"]): SchedulerDeps {
  return { db, duties, ...DEFAULTS };
}

function snapshotOf(): Promise<LedgerSnapshot> {
  return withTenant(db, tenantId, (tx) =>
    readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: HORIZON_START }),
  );
}

describe("resweepAfter", () => {
  it("enqueues the next generation of the SAME period, due when asked", async () => {
    const duty = new FakeDuty(DUTY, () =>
      Promise.resolve({ summary: { gated: 1 }, resweepAfter: TOMORROW }),
    );
    await runDue(deps([duty]), [tenantId], NOW);

    const snapshot = await snapshotOf();
    const pending = snapshot.rows.filter((r) => r.state === "pending");
    expect(pending).toHaveLength(1);
    // Store timestamps are normalised ISO-8601 via `to_json(col) #>> '{}'`, which renders the
    // offset form (`"2026-07-24T00:00:00+00:00"`), not the `.000Z` literal — parse-then-compare,
    // as packages/payments/src/store.test.ts's convention already does.
    expect(new Date(pending[0]!.periodFrom).toISOString()).toBe("2026-07-24T00:00:00.000Z");
    expect(pending[0]).toMatchObject({ generation: 1 });
  });

  // The re-sweep row this tick just enqueued is the earliest work the ledger now carries — but
  // derivation answered from a snapshot taken BEFORE the duty ran, where that row did not exist,
  // so on its own it reports the next day boundary (2026-07-26T00:00:00Z). SOON is deliberately
  // earlier than that boundary: without folding the enqueue in, a host sleeping on `nextDueAt`
  // would miss the re-sweep by 19 hours, and the self-healing loop §7 promises would run a day
  // late every time.
  it("reports the re-sweep it just enqueued as the next due time", async () => {
    const soon = new Date("2026-07-25T05:00:00Z");
    const duty = new FakeDuty(DUTY, () => Promise.resolve({ summary: {}, resweepAfter: soon }));
    const result = await runDue(deps([duty]), [tenantId], NOW);
    expect(result.nextDueAt).toEqual(soon);
  });

  // The other half of that fold: a re-sweep time is reported only when a successor row was
  // actually INSERTED. Here a concurrent runner (simulated inside the duty's own run(), which
  // executes outside every transaction) has already enqueued a successor for this period, so the
  // enqueue guard refuses ours — and that row's due time is not this run's to report. Reporting
  // `soon` regardless would be a guess about a row this tick never wrote.
  it("does not report a re-sweep time for a successor the guard refused", async () => {
    const soon = new Date("2026-07-25T05:00:00Z");
    const duty = new FakeDuty(DUTY, async (call) => {
      await withTenant(db, tenantId, (tx) =>
        tx.insert(scheduledRuns).values({
          tenantId,
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

    const result = await runDue(deps([duty]), [tenantId], NOW);
    expect(result.ran).toHaveLength(1);
    // The competing row was inserted after the snapshot was read, so derivation never saw it
    // either: the answer is the plain next day boundary.
    expect(result.nextDueAt).toEqual(new Date("2026-07-26T00:00:00Z"));

    const snapshot = await snapshotOf();
    // Exactly two rows for the period — the completed generation 0 and the competing generation 7.
    // No generation 8 alongside them.
    expect(snapshot.rows.map((r) => r.generation).sort()).toEqual([0, 7]);
  });

  // Without this the period would never be re-derived: it has no gap. This is the whole mechanism
  // that makes a gated drift orphan self-healing rather than merely re-reported once.
  it("runs the same period again once its due time arrives", async () => {
    const duty = new FakeDuty(DUTY, (_call, index) =>
      Promise.resolve(index === 0 ? { summary: {}, resweepAfter: TOMORROW } : { summary: {} }),
    );
    await runDue(deps([duty]), [tenantId], NOW);
    const second = await runDue(deps([duty]), [tenantId], TOMORROW);

    const reswept = second.ran.filter(
      (r) => r.period.from.toISOString() === "2026-07-24T00:00:00.000Z",
    );
    expect(reswept).toHaveLength(1);
    expect(reswept[0]).toMatchObject({ generation: 1, outcome: "succeeded" });
  });

  it("does not re-run the period before its due time", async () => {
    const duty = new FakeDuty(DUTY, () => Promise.resolve({ summary: {}, resweepAfter: TOMORROW }));
    await runDue(deps([duty]), [tenantId], NOW);
    const soon = await runDue(deps([duty]), [tenantId], new Date("2026-07-25T05:00:00Z"));
    expect(soon.ran).toEqual([]);
  });

  it("keeps the chain linear — one unresolved finding cannot fan out", async () => {
    // Every run asks for a re-sweep. After three ticks there must be exactly one pending row and
    // three completed ones — a chain that stays ONE deep, never a fan-out. What this does NOT
    // observe is the enqueue guard refusing anything: each tick completes its own chain row before
    // enqueueing the next, so the guard sees zero non-terminal rows every time and inserts. The
    // guard's refusal is covered directly by store.test.ts's "refuses when the period already has
    // a non-terminal row"; what is covered here is that the runner's own call pattern never asks
    // it to.
    const duty = new FakeDuty(DUTY, (call) =>
      Promise.resolve({ summary: {}, resweepAfter: new Date(call.now.getTime() + 60_000) }),
    );
    let at = NOW;
    for (let i = 0; i < 3; i += 1) {
      await runDue(deps([duty]), [tenantId], at);
      at = new Date(at.getTime() + 120_000);
    }
    const snapshot = await snapshotOf();
    expect(snapshot.rows.filter((r) => r.state === "pending")).toHaveLength(1);
    expect(snapshot.rows.filter((r) => r.state === "succeeded")).toHaveLength(3);
  });

  it("survives a period older than the horizon", async () => {
    // A re-sweep is EXPLICIT work, so the gap horizon must not bury it. Seeded by hand at a period
    // 90 days back, which no gap derivation would ever reach.
    const old = new Date("2026-04-20T00:00:00Z");
    const duty = new FakeDuty(DUTY, () => Promise.resolve({ summary: {} }));
    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(scheduledRuns).values({
        tenantId,
        duty: DUTY,
        periodFrom: old.toISOString(),
        periodTo: new Date(old.getTime() + 86_400_000).toISOString(),
        generation: 1,
        state: "pending",
        attempts: 0,
        nextAttemptAt: NOW.toISOString(),
      });
    });
    const result = await runDue(deps([duty]), [tenantId], NOW);
    expect(result.ran.map((r) => r.period.from.toISOString())).toContain(
      "2026-04-20T00:00:00.000Z",
    );
  });

  // The interface-change guard from Task 5: `runOne` must enqueue a successor only when its OWN
  // `completeRun` call actually won the ownership fence. This scenario is deliberately built so the
  // store's OWN "no non-terminal row" guard could NOT have caught a missing gate on its own: the
  // reclaiming runner finishes and completes the row to `succeeded` (terminal) BEFORE the original,
  // stale attempt's own (losing) `completeRun` call runs — so if `enqueueSuccessor` ran regardless
  // of `completed`, it would see zero unfinished rows and insert a spurious successor anyway. Only
  // gating on the fence's own boolean return stops it.
  it("does not enqueue a successor off a completion the ownership fence rejected", async () => {
    const duty = new FakeDuty(DUTY, async (call) => {
      const snapshot = await snapshotOf();
      const row = snapshot.rows.find(
        (r) => new Date(r.periodFrom).getTime() === call.period.from.getTime(),
      )!;
      const reclaimAt = new Date(call.now.getTime() + DEFAULTS.staleAfterMs + 1);
      const reclaimed = await withTenant(db, tenantId, (tx) =>
        reclaimStale(tx, { id: row.id, now: reclaimAt, staleAfterMs: DEFAULTS.staleAfterMs }),
      );
      expect(reclaimed).not.toBeNull();
      // The reclaiming runner finishes its own attempt first, leaving the row terminal.
      const won = await withTenant(db, tenantId, (tx) =>
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

    const result = await runDue(deps([duty]), [tenantId], NOW);
    expect(result.ran).toEqual([]);

    const snapshot = await snapshotOf();
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({ state: "succeeded" });
  });
});
