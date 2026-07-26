import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  createPgliteDb,
  runMigrations,
  withTenant,
  type Database,
} from "@waitron/db";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
// Side-effect only: this test constructs a real `AppError<"payment.reconcile_unsettled">`, and
// that code exists only via @waitron/payments's own `declare module "@waitron/shared"`
// augmentation (its src/errors.ts). This package's runtime code never imports @waitron/payments —
// this import is test-only, exactly the reason it is a devDependency here.
import "@waitron/payments";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";
import { DEFAULTS, dayPeriod } from "./derive.js";
import { claimGap, readSnapshot, reclaimStale } from "./store.js";
import { runDue, type SchedulerDeps } from "./run.js";
import { FakeDuty, throwingDuty } from "./testing/fake-duty.js";
import { seedTenant } from "../test/seed.js";

const NOW = new Date("2026-07-25T04:00:00Z");
const HORIZON_START = new Date("2026-06-01T00:00:00Z");

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

function deps(
  duties: SchedulerDeps["duties"],
  overrides: Partial<SchedulerDeps> = {},
): SchedulerDeps {
  return { db, duties, ...DEFAULTS, ...overrides };
}

describe("runDue", () => {
  it("runs the most recent complete period for a duty that has never run", async () => {
    const duty = new FakeDuty();
    const result = await runDue(deps([duty]), [tenantId], NOW);

    expect(duty.calls).toHaveLength(1);
    expect(duty.calls[0]!.period.from).toEqual(new Date("2026-07-24T00:00:00Z"));
    expect(result.ran).toHaveLength(1);
    expect(result.ran[0]).toMatchObject({ outcome: "succeeded", duty: "test.duty", generation: 0 });
  });

  it("persists the duty's summary verbatim", async () => {
    const duty = new FakeDuty("test.duty", () =>
      Promise.resolve({ summary: { remediationFailures: [{ paymentRef: "pi_1", reason: "x" }] } }),
    );
    await runDue(deps([duty]), [tenantId], NOW);

    // Read the column directly: readSnapshot deliberately omits `summary`, since derivation never
    // needs it and a large one would be read on every tick for nothing.
    //
    // Explicitly scoped to `tenantId`, unlike the brief's original text: `withTenant`'s own doc
    // comment warns PGlite connects as superuser and bypasses RLS entirely, "which is precisely
    // why the tests must not rely on it" — and this describe block's earlier tests already leave
    // their own `duty = 'test.duty'` rows behind under other tenants in the same shared `db`.
    // Without this filter the query over-matches the moment it runs after any prior test.
    const stored = await withTenant(db, tenantId, (tx) =>
      tx.execute<{ summary: Record<string, unknown> }>(
        sql`select summary from scheduled_runs where duty = 'test.duty' and tenant_id = ${tenantId}`,
      ),
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.summary).toEqual({
      remediationFailures: [{ paymentRef: "pi_1", reason: "x" }],
    });
  });

  it("is idempotent within a tick — a second call finds no gap", async () => {
    const duty = new FakeDuty();
    await runDue(deps([duty]), [tenantId], NOW);
    const second = await runDue(deps([duty]), [tenantId], NOW);

    expect(duty.calls).toHaveLength(1);
    expect(second.ran).toEqual([]);
    expect(second.nextDueAt).toEqual(new Date("2026-07-26T00:00:00Z"));
  });

  it("records a failure with the AppError's code and a backoff", async () => {
    const duty = throwingDuty(
      "test.duty",
      new AppError("payment.reconcile_unsettled", { payments: [], count: 0 }),
    );
    const result = await runDue(deps([duty]), [tenantId], NOW);

    expect(result.ran[0]).toMatchObject({
      outcome: "failed",
      errorCode: "payment.reconcile_unsettled",
    });
    const snapshot = await withTenant(db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: "test.duty", horizonStart: HORIZON_START }),
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
    const result = await runDue(deps([duty]), [tenantId], NOW);
    expect(result.ran[0]).toMatchObject({ outcome: "failed", errorCode: "unknown" });
  });

  it("parks a period after maxAttempts and stops retrying it", async () => {
    const duty = throwingDuty("test.duty", new Error("boom"));
    let at = NOW;
    for (let i = 0; i < 3; i += 1) {
      await runDue(deps([duty]), [tenantId], at);
      at = new Date(at.getTime() + 2 * 60 * 60 * 1000);
    }
    const after = await runDue(deps([duty]), [tenantId], at);

    const snapshot = await withTenant(db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: "test.duty", horizonStart: HORIZON_START }),
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
      await runDue(deps([duty]), [tenantId], at);
      at = new Date(at.getTime() + 2 * 60 * 60 * 1000);
    }
    // Next day: 2026-07-25 is now a complete period with no row of its own.
    const nextDay = new Date("2026-07-26T04:00:00Z");
    const result = await runDue(deps([duty]), [tenantId], nextDay);
    expect(result.ran.map((r) => r.period.from.toISOString())).toEqual([
      "2026-07-25T00:00:00.000Z",
    ]);
  });

  it("reports what the per-tick cap deferred", async () => {
    const duty = new FakeDuty();
    // Sweeping at 2026-07-20 records 2026-07-19, which becomes the floor. At NOW the gaps are
    // 07-20 … 07-24 — five of them.
    await runDue(deps([duty]), [tenantId], new Date("2026-07-20T04:00:00Z"));
    const result = await runDue(deps([duty], { maxPeriodsPerTick: 2 }), [tenantId], NOW);

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
    const missing = brandTenantId(randomUUID());
    const result = await runDue(deps([duty]), [missing], NOW);

    expect(result.ran).toEqual([]);
    expect(result.skipped).toEqual([
      { tenantId: missing, duty: "test.duty", errorCode: "unknown" },
    ]);
    expect(duty.calls).toEqual([]);
    // Skipped work is due NOW — nothing was claimed and no backoff was written for it. Without
    // this, the tick reports the next day boundary (the derivation ran before the claim threw)
    // and a host sleeping on `nextDueAt` leaves the failure untouched for 20 hours.
    expect(result.nextDueAt).toEqual(NOW);
  });

  // The sharper half of the same defect. Here the SNAPSHOT READ fails, before derivation runs at
  // all, so nothing ever moves `earliestFuture` — the state in which `nextDueAt` used to be
  // `null`, i.e. "no work will ever be due", from one transient database blip. A long-running host
  // reading that stops polling permanently.
  it("reports `now`, never `null`, when the snapshot read itself fails", async () => {
    // A real driver failure rather than a stub: a closed PGlite connection is exactly what a
    // database that has gone away looks like at this seam, and it costs no cast.
    const dead = await createPgliteDb();
    await dead.close();

    const duty = new FakeDuty();
    const result = await runDue({ ...deps([duty]), db: dead }, [tenantId], NOW);

    expect(result.ran).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(duty.calls).toEqual([]);
    expect(result.nextDueAt).toEqual(NOW);
  });

  // The ONLY state in which `nextDueAt` may be null, and now the only test that reaches it: a
  // tenant list with a duty list to cross against produces at least a next period boundary, and a
  // pair that throws reports `now`. "No pair at all" is what null means, and nothing else.
  it("reports null only when there is no (tenant, duty) pair at all", async () => {
    const duty = new FakeDuty();
    expect((await runDue(deps([duty]), [], NOW)).nextDueAt).toBeNull();
    expect((await runDue(deps([]), [tenantId], NOW)).nextDueAt).toBeNull();
    expect(duty.calls).toEqual([]);
  });

  it("isolates one tenant's failure from another's", async () => {
    const other = await seedTenant(db);
    const duty = new FakeDuty("test.duty", (call) =>
      call.tenantId === tenantId
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ summary: { ok: true } }),
    );
    const result = await runDue(deps([duty]), [tenantId, other], NOW);

    expect(result.ran).toHaveLength(2);
    expect(result.ran.map((r) => r.outcome).sort()).toEqual(["failed", "succeeded"]);
  });

  it("runs every duty for every tenant", async () => {
    const one = new FakeDuty("duty.one");
    const two = new FakeDuty("duty.two");
    const other = await seedTenant(db);
    const result = await runDue(deps([one, two]), [tenantId, other], NOW);

    expect(result.ran).toHaveLength(4);
    expect(one.calls).toHaveLength(2);
    expect(two.calls).toHaveLength(2);
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
      const snapshot = await withTenant(db, tenantId, (tx) =>
        readSnapshot(tx, { tenantId, duty: "test.duty", horizonStart: HORIZON_START }),
      );
      const row = snapshot.rows.find(
        (r) => new Date(r.periodFrom).getTime() === call.period.from.getTime(),
      );
      const reclaimAt = new Date(call.now.getTime() + DEFAULTS.staleAfterMs + 1);
      const reclaimed = await withTenant(db, tenantId, (tx) =>
        reclaimStale(tx, { id: row!.id, now: reclaimAt, staleAfterMs: DEFAULTS.staleAfterMs }),
      );
      // Confirms the reclaim actually won — otherwise the rest of this test would be asserting
      // nothing.
      expect(reclaimed).not.toBeNull();
      return { summary: { ok: true } };
    });

    const result = await runDue(deps([duty]), [tenantId], NOW);

    expect(duty.calls).toHaveLength(1);
    expect(result.ran).toEqual([]);

    // The row itself must still read exactly as the reclaim left it — running, at the reclaim's
    // attempt count — never overwritten by the lost attempt's (rejected) completion.
    const snapshot = await withTenant(db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: "test.duty", horizonStart: HORIZON_START }),
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
    await runDue(deps([one]), [tenantId], new Date("2026-07-11T04:00:00Z")); // records 2026-07-10
    await runDue(deps([two]), [tenantId], new Date("2026-07-15T04:00:00Z")); // records 2026-07-14

    // horizonDays: 5 → horizonStart = 2026-07-20. duty.one's floor (07-10) is 10 days short of it,
    // with only the one row recorded below the horizon: beyondHorizon = 10 - 1 = 9. duty.two's
    // floor (07-14) is 6 days short, same one recorded row: beyondHorizon = 6 - 1 = 5. The true
    // sum is 14; a `=` bug would leave 5 — duty.two's own value, since it is processed second.
    const result = await runDue(deps([one, two], { horizonDays: 5 }), [tenantId], NOW);

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
    const stranded = await withTenant(db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: "test.duty", period, now: NOW }),
    );
    expect(stranded).not.toBeNull();

    const duty = new FakeDuty();
    const later = new Date(NOW.getTime() + DEFAULTS.staleAfterMs + 1);
    const result = await runDue(deps([duty]), [tenantId], later);

    // The duty ran again for the SAME period. If `runOne` mistakenly claimed via `claimGap`
    // instead of `reclaimStale`, this insert would collide with the stranded row's own
    // generation-0 key, `onConflictDoNothing` would return null, and the duty would never run.
    expect(duty.calls).toHaveLength(1);
    expect(duty.calls[0]!.period.from).toEqual(period.from);
    expect(result.ran).toHaveLength(1);
    expect(result.ran[0]).toMatchObject({ outcome: "succeeded", generation: 0 });

    const snapshot = await withTenant(db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: "test.duty", horizonStart: HORIZON_START }),
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
