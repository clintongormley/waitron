import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, openVenueDatabase, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
// Side-effect only: `payment.reconcile_unsettled`, thrown below, is declared by @waitron/payments's
// `declare module "@waitron/shared"` augmentation.
import "@waitron/payments";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";
import { scheduledRuns } from "./schema/scheduled-runs.js";
import { DEFAULTS, dayPeriod } from "./derive.js";
import { claimGap, readSnapshot, reclaimStale } from "./store.js";
import * as store from "./store.js";
import { runDue, type SchedulerDeps } from "./run.js";
import { FakeDuty, throwingDuty } from "./testing/fake-duty.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

const NOW = new Date("2026-07-25T04:00:00Z");
const HORIZON_START = new Date("2026-06-01T00:00:00Z");
// Read from DEFAULTS rather than re-typed: a test that hardcodes 300000 keeps passing when the
// default changes and silently stops testing the default at all.
const SKIP_RETRY_MS = DEFAULTS.skipRetryMs;
const AFTER_SKIP_RETRY = new Date(NOW.getTime() + SKIP_RETRY_MS);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

beforeEach(async () => {
  await seedTenant(db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Force ONE duty's snapshot read to throw, the earliest point at which a duty lands in `skipped`.
function failSnapshotFor(dutyName: string): void {
  const real = store.readSnapshot;
  vi.spyOn(store, "readSnapshot").mockImplementation((tx, params) =>
    params.duty === dutyName ? Promise.reject(new Error("snapshot read failed")) : real(tx, params),
  );
}

function deps(
  duties: SchedulerDeps["duties"],
  overrides: Partial<SchedulerDeps> = {},
): SchedulerDeps {
  return { db, duties, ...DEFAULTS, ...overrides };
}

describe("runDue", () => {
  it("runs the most recent complete period for a duty that has never run", async () => {
    const duty = new FakeDuty();
    const result = await runDue(deps([duty]), NOW);

    expect(duty.calls).toHaveLength(1);
    expect(duty.calls[0]!.period.from).toEqual(new Date("2026-07-24T00:00:00Z"));
    expect(result.ran).toHaveLength(1);
    expect(result.ran[0]).toMatchObject({ outcome: "succeeded", duty: "test.duty", generation: 0 });
  });

  it("persists the duty's summary verbatim", async () => {
    const duty = new FakeDuty("test.duty", () =>
      Promise.resolve({ summary: { remediationFailures: [{ paymentRef: "pi_1", reason: "x" }] } }),
    );
    await runDue(deps([duty]), NOW);

    // Read the column directly: readSnapshot deliberately omits `summary`. Through the table object,
    // because a raw select bypasses the column's JSON codec and returns the stored string.
    const stored = await withTransaction(db, (tx) =>
      tx
        .select({ summary: scheduledRuns.summary })
        .from(scheduledRuns)
        .where(eq(scheduledRuns.duty, "test.duty")),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.summary).toEqual({
      remediationFailures: [{ paymentRef: "pi_1", reason: "x" }],
    });
  });

  it("is idempotent within a tick — a second call finds no gap", async () => {
    const duty = new FakeDuty();
    await runDue(deps([duty]), NOW);
    const second = await runDue(deps([duty]), NOW);

    expect(duty.calls).toHaveLength(1);
    expect(second.ran).toEqual([]);
    expect(second.nextDueAt).toEqual(new Date("2026-07-26T00:00:00Z"));
  });

  it("records a failure with the AppError's code and a backoff", async () => {
    const duty = throwingDuty(
      "test.duty",
      new AppError("payment.reconcile_unsettled", { payments: [], count: 0 }),
    );
    const result = await runDue(deps([duty]), NOW);

    expect(result.ran[0]).toMatchObject({
      outcome: "failed",
      errorCode: "payment.reconcile_unsettled",
    });
    const snapshot = await withTransaction(db, (tx) =>
      readSnapshot(tx, { duty: "test.duty", horizonStart: HORIZON_START }),
    );
    // 15 minutes: backoffBaseMs * 2^(attempts-1), attempts = 1.
    expect(new Date(snapshot.rows[0]!.nextAttemptAt!).toISOString()).toBe(
      "2026-07-25T04:15:00.000Z",
    );
    // Derivation answers from a snapshot taken before the duty ran, so on its own it would report
    // the next day boundary, and a host sleeping on `nextDueAt` would miss the retry.
    expect(result.nextDueAt).toEqual(new Date("2026-07-25T04:15:00.000Z"));
  });

  it("records `unknown` for a non-AppError failure", async () => {
    const duty = throwingDuty("test.duty", new Error("boom"));
    const result = await runDue(deps([duty]), NOW);
    expect(result.ran[0]).toMatchObject({ outcome: "failed", errorCode: "unknown" });
  });

  it("parks a period after maxAttempts and stops retrying it", async () => {
    const duty = throwingDuty("test.duty", new Error("boom"));
    let at = NOW;
    for (let i = 0; i < 3; i += 1) {
      await runDue(deps([duty]), at);
      at = new Date(at.getTime() + 2 * 60 * 60 * 1000);
    }
    const after = await runDue(deps([duty]), at);

    const snapshot = await withTransaction(db, (tx) =>
      readSnapshot(tx, { duty: "test.duty", horizonStart: HORIZON_START }),
    );
    expect(snapshot.rows[0]).toMatchObject({ state: "parked", attempts: 3, nextAttemptAt: null });
    expect(after.ran).toEqual([]);
  });

  it("keeps periods independent — a parked day does not block the next one", async () => {
    const duty = throwingDuty("test.duty", new Error("boom"));
    let at = NOW;
    for (let i = 0; i < 3; i += 1) {
      await runDue(deps([duty]), at);
      at = new Date(at.getTime() + 2 * 60 * 60 * 1000);
    }
    // Next day: 2026-07-25 is now a complete period with no row of its own.
    const nextDay = new Date("2026-07-26T04:00:00Z");
    const result = await runDue(deps([duty]), nextDay);
    expect(result.ran.map((r) => r.period.from.toISOString())).toEqual([
      "2026-07-25T00:00:00.000Z",
    ]);
  });

  it("reports what the per-tick cap deferred", async () => {
    const duty = new FakeDuty();
    // Sweeping at 2026-07-20 records 2026-07-19, which becomes the floor. At NOW the gaps are
    // 07-20 … 07-24 — five of them.
    await runDue(deps([duty]), new Date("2026-07-20T04:00:00Z"));
    const result = await runDue(deps([duty], { maxPeriodsPerTick: 2 }), NOW);

    expect(result.ran).toHaveLength(2);
    expect(result.ran.map((r) => r.period.from.toISOString())).toEqual([
      "2026-07-20T00:00:00.000Z",
      "2026-07-21T00:00:00.000Z",
    ]);
    expect(result.deferred).toBe(3);
    // Work is available right now, so nextDueAt is now — not the next day boundary.
    expect(result.nextDueAt).toEqual(NOW);
  });

  // An infrastructure failure has no ledger row to carry it — the claim is what would have created
  // one.
  it("reports a duty whose claim failed, rather than swallowing it", async () => {
    const duty = new FakeDuty();
    // The snapshot read succeeds and derives a gap; only the claim that would record it throws.
    vi.spyOn(store, "claimGap").mockRejectedValue(new Error("claim failed"));
    const result = await runDue(deps([duty]), NOW);

    expect(store.claimGap).toHaveBeenCalledTimes(1);
    expect(result.ran).toEqual([]);
    expect(result.skipped).toEqual([{ duty: "test.duty", errorCode: "unknown" }]);
    expect(duty.calls).toEqual([]);
    // Not the next day boundary, which would leave the failure untouched for 20 hours, and not
    // `now`, which pins the host's loop at its floor for a failure only a human can fix.
    expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
  });

  // The snapshot read fails before derivation runs, so nothing else sets `nextDueAt`; `null` would
  // tell a host that no work will ever be due.
  it("reports the skip-retry interval, never `null`, when the snapshot read itself fails", async () => {
    // A closed venue file is what a database that has gone away looks like at this seam. Its own,
    // not the suite's, because `useVenueDb` owns that one's lifecycle.
    const directory = await mkdtemp(join(tmpdir(), "waitron-scheduler-dead-"));
    const dead = await openVenueDatabase(directory);
    await dead.close();

    try {
      const duty = new FakeDuty();
      const result = await runDue({ ...deps([duty]), db: dead.venue }, NOW);

      expect(result.ran).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(duty.calls).toEqual([]);
      expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  // The skip time is folded in as a minimum, so it cannot mask a successful pair's earlier answer.
  it("prefers a successful pair's earlier backoff over the skip-retry interval", async () => {
    // 1s, so the backoff this failing duty writes lands inside the 5-minute skip interval.
    const failing = throwingDuty("duty.fail", new Error("boom"));
    const skipper = new FakeDuty("duty.skip");
    failSnapshotFor("duty.skip");
    const result = await runDue(deps([failing, skipper], { backoffBaseMs: 1_000 }), NOW);

    expect(result.skipped).toHaveLength(1);
    expect(result.ran.some((r) => r.outcome === "failed")).toBe(true);
    expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + 1_000));
  });

  it("prefers the skip-retry interval over a successful pair's later answer", async () => {
    // The default 15-minute backoff is LATER than the 5-minute skip interval, so the skip wins.
    const failing = throwingDuty("duty.fail", new Error("boom"));
    const skipper = new FakeDuty("duty.skip");
    failSnapshotFor("duty.skip");
    const result = await runDue(deps([failing, skipper]), NOW);

    expect(result.skipped).toHaveLength(1);
    expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
  });

  // The branch that deliberately does NOT change. Capped work is genuinely runnable right now, so
  // draining the backlog fast is the intent — a skip present alongside it must not slow that down.
  it("still reports `now` when work was deferred, even with a skip present", async () => {
    const duty = new FakeDuty();
    const skipper = new FakeDuty("duty.skip");
    // A never-run duty has only one day due, so the cap alone defers nothing. Sweeping at 07-23
    // records 07-22 as the floor, leaving two gaps (07-23, 07-24) at NOW.
    await runDue(deps([duty]), new Date("2026-07-23T04:00:00Z"));
    failSnapshotFor("duty.skip");
    const result = await runDue(deps([duty, skipper], { maxPeriodsPerTick: 1 }), NOW);

    expect(result.deferred).toBeGreaterThan(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.nextDueAt).toEqual(NOW);
  });

  it("reports null only when there is no duty at all", async () => {
    const duty = new FakeDuty();
    expect((await runDue(deps([]), NOW)).nextDueAt).toBeNull();
    expect((await runDue(deps([duty]), NOW)).nextDueAt).not.toBeNull();
  });

  it("runs every duty for the tenant", async () => {
    const one = new FakeDuty("duty.one");
    const two = new FakeDuty("duty.two");
    const result = await runDue(deps([one, two]), NOW);

    expect(result.ran).toHaveLength(2);
    expect(one.calls).toHaveLength(1);
    expect(two.calls).toHaveLength(1);
  });

  // The fake duty's `run()`, which executes outside every transaction, plays a second runner:
  // it reclaims this row past `staleAfterMs`, so the first attempt then completes with a
  // superseded `startedAt` and the ownership fence rejects it.
  it("treats a completion lost to a mid-flight reclaim as 'this attempt owns nothing' — absent from ran", async () => {
    const duty = new FakeDuty("test.duty", async (call) => {
      const snapshot = await withTransaction(db, (tx) =>
        readSnapshot(tx, { duty: "test.duty", horizonStart: HORIZON_START }),
      );
      const row = snapshot.rows.find(
        (r) => new Date(r.periodFrom).getTime() === call.period.from.getTime(),
      );
      const reclaimAt = new Date(call.now.getTime() + DEFAULTS.staleAfterMs + 1);
      const reclaimed = await withTransaction(db, (tx) =>
        reclaimStale(tx, { id: row!.id, now: reclaimAt, staleAfterMs: DEFAULTS.staleAfterMs }),
      );
      // Confirms the reclaim actually won, or the rest of this test asserts nothing.
      expect(reclaimed).not.toBeNull();
      return { summary: { ok: true } };
    });

    const result = await runDue(deps([duty]), NOW);

    expect(duty.calls).toHaveLength(1);
    expect(result.ran).toEqual([]);

    const snapshot = await withTransaction(db, (tx) =>
      readSnapshot(tx, { duty: "test.duty", horizonStart: HORIZON_START }),
    );
    expect(snapshot.rows[0]).toMatchObject({ state: "running", attempts: 2 });
  });

  // Two duties, so an overwrite would leave only the second duty's count.
  it("accumulates beyondHorizon across duties onto TickResult, rather than overwriting it", async () => {
    const one = new FakeDuty("duty.one");
    const two = new FakeDuty("duty.two");
    // Each duty's own earliest-recorded period, far below the narrower horizon used next.
    await runDue(deps([one]), new Date("2026-07-11T04:00:00Z")); // records 2026-07-10
    await runDue(deps([two]), new Date("2026-07-15T04:00:00Z")); // records 2026-07-14

    // horizonDays: 5 → horizonStart = 2026-07-20. duty.one's floor (07-10) is 10 days short of it,
    // with only the one row recorded below the horizon: beyondHorizon = 10 - 1 = 9. duty.two's
    // floor (07-14) is 6 days short, same one recorded row: beyondHorizon = 6 - 1 = 5. The true
    // sum is 14; a `=` bug would leave 5 — duty.two's own value, since it is processed second.
    const result = await runDue(deps([one, two], { horizonDays: 5 }), NOW);

    expect(result.beyondHorizon).toBe(14);
  });

  it("reclaims a stale running row through a fresh tick, rather than leaving the period stuck", async () => {
    const period = dayPeriod(new Date("2026-07-24T00:00:00Z"));
    // Simulate a crashed process: claim the period directly (bypassing `runDue`, which always
    // completes what it claims) and never call `completeRun`.
    const stranded = await withTransaction(db, (tx) =>
      claimGap(tx, { duty: "test.duty", period, now: NOW }),
    );
    expect(stranded).not.toBeNull();

    const duty = new FakeDuty();
    const later = new Date(NOW.getTime() + DEFAULTS.staleAfterMs + 1);
    const result = await runDue(deps([duty]), later);

    // Claimed through `claimGap` instead of `reclaimStale`, the stranded row's key would absorb the
    // insert and the duty would never run.
    expect(duty.calls).toHaveLength(1);
    expect(duty.calls[0]!.period.from).toEqual(period.from);
    expect(result.ran).toHaveLength(1);
    expect(result.ran[0]).toMatchObject({ outcome: "succeeded", generation: 0 });

    const snapshot = await withTransaction(db, (tx) =>
      readSnapshot(tx, { duty: "test.duty", horizonStart: HORIZON_START }),
    );
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({
      id: stranded!.id,
      state: "succeeded",
      attempts: 2,
    });
  });
});
