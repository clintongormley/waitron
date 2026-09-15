import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, withTransaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { AppError } from "@waitron/shared";
// Side-effect only: this test constructs a real `AppError<"payment.reconcile_unsettled">`, and
// that code exists only via @waitron/payments's own `declare module "@waitron/shared"`
// augmentation (its src/errors.ts). This package's runtime code never imports @waitron/payments —
// this import is test-only, exactly the reason it is a devDependency here.
import "@waitron/payments";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";
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

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS] });

beforeEach(async () => {
  await seedTenant(suite.db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Force ONE duty's snapshot read to throw, leaving every other duty's read untouched. A skip is any
// (tenant, duty) pair whose processing throws in runDue's outer try, and the snapshot read is the
// earliest such point — precisely the infrastructure read failure that `skipped` documents.
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
  return { db: suite.db, duties, ...DEFAULTS, ...overrides };
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

    // Read the column directly: readSnapshot deliberately omits `summary`, since derivation never
    // needs it and a large one would be read on every tick for nothing.
    const stored = await withTransaction(suite.db, (tx) =>
      tx.execute<{ summary: Record<string, unknown> }>(
        sql`select summary from scheduled_runs where duty = 'test.duty'`,
      ),
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.summary).toEqual({
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
    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: "test.duty", horizonStart: HORIZON_START }),
    );
    // 15 minutes: backoffBaseMs * 2^(attempts-1), attempts = 1. Store timestamps are normalised
    // ISO-8601 via `to_json(col) #>> '{}'`, which renders the offset form
    // (`"2026-07-25T04:15:00+00:00"`), not the `.000Z` literal — parse-then-compare, as
    // packages/payments/src/store.test.ts's convention already does.
    expect(new Date(snapshot.rows[0]!.nextAttemptAt!).toISOString()).toBe(
      "2026-07-25T04:15:00.000Z",
    );
    // …and the tick REPORTS that backoff. Derivation answers from a snapshot taken before any duty
    // ran, so on its own it would say "the next day boundary" — 2026-07-26T00:00:00Z, 19h45m after
    // the row this very call made claimable. A host that sleeps on `nextDueAt` would never reach
    // the documented "15m then 30m" retry, and `drain`'s hourly retry is a LEGAL obligation.
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

    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: "test.duty", horizonStart: HORIZON_START }),
    );
    // A parked row is non-terminal in neither sense: it stays visible in the snapshot, but it is
    // never claimed again, so the fourth tick finds nothing.
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
  // one. Reporting it is the difference between "nothing was due" and "we never found out".
  it("reports a (tenant, duty) whose claim failed, rather than swallowing it", async () => {
    const duty = new FakeDuty();
    // The snapshot read succeeds and derives a gap; only the claim that would record it throws.
    vi.spyOn(store, "claimGap").mockRejectedValue(new Error("claim failed"));
    const result = await runDue(deps([duty]), NOW);

    expect(store.claimGap).toHaveBeenCalledTimes(1);
    expect(result.ran).toEqual([]);
    expect(result.skipped).toEqual([{ duty: "test.duty", errorCode: "unknown" }]);
    expect(duty.calls).toEqual([]);
    // Skipped work is due on the skip-retry interval, NOT at the next day boundary the derivation
    // computed before the claim threw — a host sleeping on that would leave the failure untouched
    // for 20 hours. It is also not `now`: a duty that fails for a reason only a human can fix
    // answers the same way every pass, and reporting `now` pins the host's loop at its MIN_TICK
    // floor forever.
    expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
  });

  // The sharper half of the same defect. Here the SNAPSHOT READ fails, before derivation runs at
  // all, so nothing ever moves `earliestFuture` — the state in which `nextDueAt` used to be
  // `null`, i.e. "no work will ever be due", from one transient database blip. A long-running host
  // reading that stops polling permanently. `Math.min(Infinity, retryAt)` is `retryAt`, which is
  // why this case needs no branch of its own in `runDue`.
  it("reports the skip-retry interval, never `null`, when the snapshot read itself fails", async () => {
    // A real driver failure rather than a stub: a closed PGlite connection is exactly what a
    // database that has gone away looks like at this seam, and it costs no cast.
    const dead = await createPgliteDb();
    await dead.close();

    const duty = new FakeDuty();
    const result = await runDue({ ...deps([duty]), db: dead }, NOW);

    expect(result.ran).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(duty.calls).toEqual([]);
    expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
  });

  // THE FOLD, and the reason it is a fold rather than an assignment. Before this, a skip
  // overwrote `nextDueAt` unconditionally, which was safe only because the value written was
  // `now` — always earlier than any real future answer. A value in the FUTURE can mask a
  // successful pair's genuinely earlier one, so the skip time is folded as a MINIMUM.
  //
  // One tenant, two duties: one runs and fails (writing a backoff), the other's snapshot read is
  // forced to throw so its pair lands in `skipped`.
  it("prefers a successful pair's earlier backoff over the skip-retry interval", async () => {
    // 1s, so the backoff this failing duty writes lands well inside the 5-minute skip interval.
    // The DEFAULT backoff (15 minutes) is longer than the skip interval, so this test cannot be
    // written without the override — and without it the assertion would pass for the wrong reason.
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
    // Same shape as the test above with one knob changed — that is the point: the fold is a min,
    // not a preference for either side.
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
    // A duty that has never run has only ONE day due — the most recent complete period, per
    // "runs the most recent complete period for a duty that has never run" — so `maxPeriodsPerTick:
    // 1` alone could not defer anything. Sweeping once at 2026-07-23 records 2026-07-22 as the
    // floor, so at NOW there are two gaps (07-23, 07-24) for the cap to actually bite on.
    await runDue(deps([duty]), new Date("2026-07-23T04:00:00Z"));
    failSnapshotFor("duty.skip");
    const result = await runDue(deps([duty, skipper], { maxPeriodsPerTick: 1 }), NOW);

    expect(result.deferred).toBeGreaterThan(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.nextDueAt).toEqual(NOW);
  });

  // The ONLY state in which `nextDueAt` may be null, and now the only test that reaches it: any
  // duty at all produces at least a next period boundary, and a duty that throws reports the
  // skip-retry interval. "No duty at all" is what null means, and nothing else.
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

  // Pins the interface-change resolution for Task 5: `completeRun` now reports (via its boolean
  // return) when a reclaim has superseded the attempt calling it, and `runOne` treats that exactly
  // like a lost claim — return null, absent from `ran`. Staged without two real connections: the
  // fake duty's `run()` — which executes OUTSIDE every transaction, exactly where a real duty's
  // network call would hang — reaches back into the store with `reclaimStale` and a `now` pushed
  // past `staleAfterMs`, simulating a second runner reclaiming this same row while the first
  // attempt is still "in flight". When the first attempt's `duty.run()` resolves and `runOne` calls
  // `completeRun` with ITS OWN (now-superseded) `startedAt`, the ownership fence rejects it.
  it("treats a completion lost to a mid-flight reclaim as 'this attempt owns nothing' — absent from ran", async () => {
    const duty = new FakeDuty("test.duty", async (call) => {
      const snapshot = await withTransaction(suite.db, (tx) =>
        readSnapshot(tx, { duty: "test.duty", horizonStart: HORIZON_START }),
      );
      const row = snapshot.rows.find(
        (r) => new Date(r.periodFrom).getTime() === call.period.from.getTime(),
      );
      const reclaimAt = new Date(call.now.getTime() + DEFAULTS.staleAfterMs + 1);
      const reclaimed = await withTransaction(suite.db, (tx) =>
        reclaimStale(tx, { id: row!.id, now: reclaimAt, staleAfterMs: DEFAULTS.staleAfterMs }),
      );
      // Confirms the reclaim actually won — otherwise the rest of this test would be asserting
      // nothing.
      expect(reclaimed).not.toBeNull();
      return { summary: { ok: true } };
    });

    const result = await runDue(deps([duty]), NOW);

    expect(duty.calls).toHaveLength(1);
    expect(result.ran).toEqual([]);

    // The row itself must still read exactly as the reclaim left it — running, at the reclaim's
    // attempt count — never overwritten by the lost attempt's (rejected) completion.
    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: "test.duty", horizonStart: HORIZON_START }),
    );
    expect(snapshot.rows[0]).toMatchObject({ state: "running", attempts: 2 });
  });

  // Review finding 1: `beyondHorizon` appeared only in `run.ts`, never asserted at the `runDue`
  // level — `result.beyondHorizon += derivation.beyondHorizon` could be silently weakened to `=`
  // and every existing test would stay green. Two duties, not one, so the mutation is actually
  // distinguishable: with `=`, the second duty processed would silently overwrite the first's
  // contribution instead of adding to it.
  it("accumulates beyondHorizon across (tenant, duty) pairs onto TickResult, rather than overwriting it", async () => {
    const one = new FakeDuty("duty.one");
    const two = new FakeDuty("duty.two");
    // Each duty's OWN earliest-recorded period, far enough in the past that a later, narrower
    // horizon drops most of the days between it and the horizon permanently.
    await runDue(deps([one]), new Date("2026-07-11T04:00:00Z")); // records 2026-07-10
    await runDue(deps([two]), new Date("2026-07-15T04:00:00Z")); // records 2026-07-14

    // horizonDays: 5 → horizonStart = 2026-07-20. duty.one's floor (07-10) is 10 days short of it,
    // with only the one row recorded below the horizon: beyondHorizon = 10 - 1 = 9. duty.two's
    // floor (07-14) is 6 days short, same one recorded row: beyondHorizon = 6 - 1 = 5. The true
    // sum is 14; a `=` bug would leave 5 — duty.two's own value, since it is processed second.
    const result = await runDue(deps([one, two], { horizonDays: 5 }), NOW);

    expect(result.beyondHorizon).toBe(14);
  });

  // Review finding 2: no test ever let a claimed row go stale and then ran a FRESH tick over it,
  // so `derive()` never actually classified anything as `{ kind: "stale" }` and `runOne`'s
  // `reclaimStale` dispatch branch (run.ts's third arm) never executed. A wrong function there —
  // e.g. `claimGap`, which would collide with the stranded row's own unique key and silently
  // return null — locks the period forever, which is the exact failure this mechanism exists to
  // prevent, and nothing above catches it.
  it("reclaims a stale running row through a fresh tick, rather than leaving the period stuck", async () => {
    const period = dayPeriod(new Date("2026-07-24T00:00:00Z"));
    // Simulate a crashed process: claim the period directly (bypassing `runDue`, which always
    // completes what it claims) and never call `completeRun`.
    const stranded = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: "test.duty", period, now: NOW }),
    );
    expect(stranded).not.toBeNull();

    const duty = new FakeDuty();
    const later = new Date(NOW.getTime() + DEFAULTS.staleAfterMs + 1);
    const result = await runDue(deps([duty]), later);

    // The duty ran again for the SAME period. If `runOne` mistakenly claimed via `claimGap`
    // instead of `reclaimStale`, this insert would collide with the stranded row's own
    // generation-0 key, `onConflictDoNothing` would return null, and the duty would never run.
    expect(duty.calls).toHaveLength(1);
    expect(duty.calls[0]!.period.from).toEqual(period.from);
    expect(result.ran).toHaveLength(1);
    expect(result.ran[0]).toMatchObject({ outcome: "succeeded", generation: 0 });

    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: "test.duty", horizonStart: HORIZON_START }),
    );
    // Exactly one row for the period — a RECLAIM of the stranded row, not a second row inserted
    // alongside it.
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({
      id: stranded!.id,
      state: "succeeded",
      attempts: 2,
    });
  });
});
