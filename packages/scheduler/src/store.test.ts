import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";
import { dayPeriod } from "./derive.js";
import {
  claimGap,
  claimRow,
  completeRun,
  enqueueSuccessor,
  readSnapshot,
  reclaimStale,
} from "./store.js";
import { scheduledRuns } from "./schema/scheduled-runs.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

const DUTY = "test.duty";
const NOW = new Date("2026-07-25T04:00:00Z");
const PERIOD = dayPeriod(new Date("2026-07-24T00:00:00Z"));

let tenantId: TenantId;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

describe("claimGap", () => {
  it("inserts a running row and returns it", async () => {
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period: PERIOD, now: NOW }),
    );
    expect(claimed).toMatchObject({ generation: 0, attempts: 1 });
    // Store timestamps are normalised ISO-8601 via `to_json(col) #>> '{}'`, which renders the
    // offset form (`"2026-07-24T00:00:00+00:00"`), not the `.000Z` literal — parse-then-compare,
    // as packages/payments/src/store.test.ts's convention already does.
    expect(new Date(claimed!.periodFrom).toISOString()).toBe("2026-07-24T00:00:00.000Z");
  });

  // The insert IS the lock — a second claim of the same period conflicts on scheduled_runs_key.
  it("returns null when the row already exists", async () => {
    const again = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period: PERIOD, now: NOW }),
    );
    expect(again).toBeNull();
  });
});

describe("readSnapshot", () => {
  // Closes a branch the other readSnapshot tests never reach: every one of them shares `DUTY`,
  // which already has rows by the time it is read. A duty with none exercises `bounds?.earliest`
  // actually being SQL NULL (no `min()` match), not merely absent — the same "never run" case
  // `derive.test.ts`'s "starts from the most recent complete period, not the horizon" depends on.
  it("returns an empty snapshot for a duty with no rows", async () => {
    const snapshot = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, {
        tenantId,
        duty: "test.duty.never-run",
        horizonStart: new Date("2026-07-01T00:00:00Z"),
      }),
    );
    expect(snapshot).toEqual({ rows: [], earliestPeriodFrom: null, recordedBelowHorizon: 0 });
  });
});

describe("completeRun and readSnapshot", () => {
  it("records a success with its summary and leaves nothing claimable", async () => {
    const period = dayPeriod(new Date("2026-07-23T00:00:00Z"));
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "succeeded",
        summary: { checked: 3 },
        errorCode: null,
        nextAttemptAt: null,
        now: NOW,
      }),
    );
    const snapshot = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const row = snapshot.rows.find(
      (r) => new Date(r.periodFrom).toISOString() === "2026-07-23T00:00:00.000Z",
    );
    expect(row).toMatchObject({ state: "succeeded", nextAttemptAt: null });
    expect(new Date(snapshot.earliestPeriodFrom!).toISOString()).toBe("2026-07-23T00:00:00.000Z");
  });

  it("records a failure with a structured code and a backoff", async () => {
    const period = dayPeriod(new Date("2026-07-22T00:00:00Z"));
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "failed",
        summary: null,
        errorCode: "payment.reconcile_report_unavailable",
        nextAttemptAt: new Date("2026-07-25T04:15:00Z"),
        now: NOW,
      }),
    );
    const snapshot = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const row = snapshot.rows.find(
      (r) => new Date(r.periodFrom).toISOString() === "2026-07-22T00:00:00.000Z",
    );
    expect(row).toMatchObject({ state: "failed", attempts: 1 });
    expect(new Date(row!.nextAttemptAt!).toISOString()).toBe("2026-07-25T04:15:00.000Z");
  });
});

describe("claimRow", () => {
  it("claims a failed row whose backoff has elapsed and increments attempts", async () => {
    const snapshot = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const failed = snapshot.rows.find((r) => r.state === "failed")!;
    const later = new Date("2026-07-25T05:00:00Z");
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimRow(tx, { id: failed.id, now: later }),
    );
    expect(claimed).toMatchObject({ attempts: 2 });
  });

  // Pins the exact-equality boundary: `next_attempt_at` equal to `now` must be claimable, matching
  // `derive()`'s own `due <= nowMs`. A stray `lt()` here would silently defer this row a whole
  // tick while `derive` had already reported it as due — the mismatch Resolution 1 warns about.
  it("claims a failed row whose backoff elapses at exactly `now`", async () => {
    const period = dayPeriod(new Date("2026-07-18T00:00:00Z"));
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    const boundary = new Date("2026-07-25T05:30:00Z");
    await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "failed",
        summary: null,
        errorCode: "unknown",
        nextAttemptAt: boundary,
        now: NOW,
      }),
    );
    const reclaimed = await withTenant(suite.db, tenantId, (tx) =>
      claimRow(tx, { id: claimed!.id, now: boundary }),
    );
    expect(reclaimed).toMatchObject({ attempts: 2 });
  });

  // The schema declares `next_attempt_at` "Null unless `pending` or `failed`". Claiming is the one
  // write that could leave it set on a `running` row, so it is the one write that has to clear it.
  // Nothing in `derive` depends on this — it dispatches on `running` first — which is exactly why
  // an unenforced invariant would rot unnoticed until something else read the column.
  it("clears next_attempt_at when it claims, so a running row never carries a stale one", async () => {
    // 07-21: every other period in this file is already claimed by a sibling test, and this suite
    // shares one duty, so reusing one makes `claimGap` return null on the unique key.
    const period = dayPeriod(new Date("2026-07-21T00:00:00Z"));
    const gap = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: gap!.id,
        startedAt: gap!.startedAt,
        state: "failed",
        summary: null,
        errorCode: "unknown",
        nextAttemptAt: new Date("2026-07-25T04:15:00Z"),
        now: NOW,
      }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      claimRow(tx, { id: gap!.id, now: new Date("2026-07-25T04:20:00Z") }),
    );

    const snapshot = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const claimed = snapshot.rows.find((r) => r.id === gap!.id)!;
    expect(claimed).toMatchObject({ state: "running", nextAttemptAt: null });
  });

  it("returns null for a row that is no longer claimable", async () => {
    const snapshot = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const running = snapshot.rows.find((r) => r.state === "running")!;
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimRow(tx, { id: running.id, now: new Date("2026-07-25T06:00:00Z") }),
    );
    expect(claimed).toBeNull();
  });

  // Deleting the `next_attempt_at <= now` predicate outright left every other test in this suite
  // green: the row each of them happens to find already satisfies the time guard on its own. This
  // is the one that cannot pass without it — a retry storm is exactly what `backoffBaseMs` exists
  // to prevent.
  it("returns null for a failed row whose backoff has not yet elapsed", async () => {
    const period = dayPeriod(new Date("2026-07-17T00:00:00Z"));
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    const future = new Date("2026-07-26T00:00:00Z");
    await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "failed",
        summary: null,
        errorCode: "unknown",
        nextAttemptAt: future,
        now: NOW,
      }),
    );
    const tooSoon = await withTenant(suite.db, tenantId, (tx) =>
      claimRow(tx, { id: claimed!.id, now: new Date(future.getTime() - 1) }),
    );
    expect(tooSoon).toBeNull();
  });

  // The only coverage `state = 'pending'` gets at all: every other test reaches `claimRow` via a
  // `failed` row, so without this, half of "retry and re-sweep share ONE statement" is unverified.
  // Inserted directly because `enqueueSuccessor` (Task 6) does not exist yet — this is the shape a
  // re-sweep row will have once it does: `pending`, no `next_attempt_at` set yet.
  it("returns null for a pending row with no next_attempt_at set", async () => {
    const [inserted] = await withTenant(suite.db, tenantId, (tx) =>
      tx
        .insert(scheduledRuns)
        .values({
          tenantId,
          duty: DUTY,
          periodFrom: dayPeriod(new Date("2026-07-16T00:00:00Z")).from.toISOString(),
          periodTo: dayPeriod(new Date("2026-07-16T00:00:00Z")).to.toISOString(),
          generation: 1,
          state: "pending",
          attempts: 0,
        })
        .returning({ id: scheduledRuns.id }),
    );
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimRow(tx, { id: inserted!.id, now: NOW }),
    );
    expect(claimed).toBeNull();
  });
});

describe("reclaimStale", () => {
  it("reclaims a running row stranded past staleAfterMs", async () => {
    const period = dayPeriod(new Date("2026-07-20T00:00:00Z"));
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    const reclaimed = await withTenant(suite.db, tenantId, (tx) =>
      reclaimStale(tx, { id: claimed!.id, now: later, staleAfterMs: 60 * 60 * 1000 }),
    );
    expect(reclaimed).toMatchObject({ attempts: 2 });
  });

  it("refuses a running row inside staleAfterMs", async () => {
    const period = dayPeriod(new Date("2026-07-19T00:00:00Z"));
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    const reclaimed = await withTenant(suite.db, tenantId, (tx) =>
      reclaimStale(tx, { id: claimed!.id, now: NOW, staleAfterMs: 60 * 60 * 1000 }),
    );
    expect(reclaimed).toBeNull();
  });

  // The state guard, isolated from the time guard: this row's `started_at` is well past any
  // `staleAfterMs`, so only `state = 'running'` stands between it and a reclaim it must not get —
  // a completed run is not "stranded", and reclaiming it would resurrect a finished attempt.
  it("refuses a row that is no longer running, however stale its started_at", async () => {
    const period = dayPeriod(new Date("2026-06-01T00:00:00Z"));
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "failed",
        summary: null,
        errorCode: "unknown",
        nextAttemptAt: new Date("2026-07-25T04:15:00Z"),
        now: NOW,
      }),
    );
    const reclaimed = await withTenant(suite.db, tenantId, (tx) =>
      reclaimStale(tx, {
        id: claimed!.id,
        now: new Date(NOW.getTime() + 10 * 60 * 60 * 1000),
        staleAfterMs: 60 * 60 * 1000,
      }),
    );
    expect(reclaimed).toBeNull();
  });
});

describe("completeRun's ownership fence", () => {
  // The exact scenario the fence exists for: A claims, hangs past staleAfterMs, B reclaims (which
  // bumps attempts and stamps a NEW started_at), and A — still holding its OWN, now-stale
  // startedAt — finally calls completeRun. Without the fence this overwrites the row B is still
  // executing; with it, A's call is rejected and the row is left exactly as B's reclaim set it.
  it("rejects a completion from an attempt a reclaim has since superseded", async () => {
    const period = dayPeriod(new Date("2026-05-01T00:00:00Z"));
    const original = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    const reclaimAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    const reclaimed = await withTenant(suite.db, tenantId, (tx) =>
      reclaimStale(tx, { id: original!.id, now: reclaimAt, staleAfterMs: 60 * 60 * 1000 }),
    );
    expect(reclaimed).toMatchObject({ attempts: 2 });

    // A wakes up late and completes using ITS OWN claim's startedAt — stale by now.
    const won = await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: original!.id,
        startedAt: original!.startedAt,
        state: "succeeded",
        summary: { checked: 1 },
        errorCode: null,
        nextAttemptAt: null,
        now: NOW,
      }),
    );
    expect(won).toBe(false);

    // The row must still read exactly as B's reclaim left it: running, at B's attempt count — not
    // overwritten by A's (rejected) outcome.
    const snapshot = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-01-01T00:00:00Z") }),
    );
    const row = snapshot.rows.find((r) => r.id === original!.id);
    expect(row).toMatchObject({ state: "running", attempts: 2 });
  });

  // Isolates the fence's OTHER conjunct: `reclaimStale` never touches `state`, so the test above
  // is decided entirely by the `startedAt` mismatch and leaves `eq(state, "running")` untested. A
  // duplicate or retried completeRun — same id, same startedAt, nothing about ownership changed —
  // is the one scenario only the `state` conjunct guards: by the second call the row is no longer
  // `running`, so `startedAt` alone would still match here.
  it("rejects a duplicate completion once the row has already reached a terminal state", async () => {
    const period = dayPeriod(new Date("2026-04-01T00:00:00Z"));
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    const first = await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "succeeded",
        summary: { checked: 1 },
        errorCode: null,
        nextAttemptAt: null,
        now: NOW,
      }),
    );
    expect(first).toBe(true);

    const second = await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "failed",
        summary: null,
        errorCode: "unknown",
        nextAttemptAt: new Date("2026-07-26T00:00:00Z"),
        now: NOW,
      }),
    );
    expect(second).toBe(false);

    // The row's recorded outcome must still be the FIRST completion's — untouched by the second.
    const snapshot = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-01-01T00:00:00Z") }),
    );
    const row = snapshot.rows.find((r) => r.id === claimed!.id);
    expect(row).toMatchObject({ state: "succeeded", nextAttemptAt: null });
  });
});

describe("enqueueSuccessor", () => {
  // Neither resweep.test.ts's tests nor store.concurrency.test.ts's race exercise this branch
  // directly: in the runner's own call pattern, enqueueSuccessor only runs right after a WINNING
  // completeRun in the same transaction, so the row it just saw is already terminal. Called
  // directly, as any other caller of this exported function could, a `failed` row awaiting its own
  // retry must block a successor exactly as the doc comment promises — deleting the `unfinished > 0`
  // half of the guard would let this insert through with no unique-key collision to catch it.
  it("refuses when the period already has a non-terminal row, even one merely awaiting retry", async () => {
    const period = dayPeriod(new Date("2026-03-01T00:00:00Z"));
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "failed",
        summary: null,
        errorCode: "unknown",
        nextAttemptAt: new Date(NOW.getTime() + 60_000),
        now: NOW,
      }),
    );

    const inserted = await withTenant(suite.db, tenantId, (tx) =>
      enqueueSuccessor(tx, {
        tenantId,
        duty: DUTY,
        period,
        dueAt: new Date(NOW.getTime() + 120_000),
      }),
    );
    expect(inserted).toBe(false);

    const snapshot = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-01-01T00:00:00Z") }),
    );
    expect(
      snapshot.rows.filter((r) => new Date(r.periodFrom).getTime() === period.from.getTime()),
    ).toHaveLength(1);
  });

  // The other side of that guard, and the reason it is expressed with derivation's own `TERMINAL`
  // list rather than a second hardcoded `not in (...)`: `parked` is terminal EXACTLY as
  // `succeeded` is, so a parked row must not block a successor. The `failed` case above passes
  // just as happily against a guard that had drifted to `not in ('succeeded')` — this one does
  // not, so between them the two pin the whole list.
  it("treats a parked row as terminal, exactly as derivation does", async () => {
    const period = dayPeriod(new Date("2026-03-03T00:00:00Z"));
    const claimed = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "parked",
        summary: null,
        errorCode: "unknown",
        nextAttemptAt: null,
        now: NOW,
      }),
    );

    const inserted = await withTenant(suite.db, tenantId, (tx) =>
      enqueueSuccessor(tx, {
        tenantId,
        duty: DUTY,
        period,
        dueAt: new Date(NOW.getTime() + 60_000),
      }),
    );
    expect(inserted).toBe(true);
  });

  // Isolates the generation computation from the linear-chain behaviour: resweep.test.ts's "keeps
  // the chain linear" test would also fail if `generation` were hardcoded (e.g. always 1) instead
  // of `max(generation) + 1`, but only because a hardcoded value eventually collides with a
  // generation already used and gets silently absorbed by the unique-violation catch — the chain
  // just stalls, which is a weaker signal than asserting the actual number. Driven through TWO
  // completed generations so a mutant fixed at "1" is distinguishable from the real max+1.
  it("computes the next generation as max(generation) + 1, not a fixed value", async () => {
    const period = dayPeriod(new Date("2026-03-02T00:00:00Z"));
    const gen0 = await withTenant(suite.db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: gen0!.id,
        startedAt: gen0!.startedAt,
        state: "succeeded",
        summary: {},
        errorCode: null,
        nextAttemptAt: null,
        now: NOW,
      }),
    );
    const dueAt1 = new Date(NOW.getTime() + 60_000);
    await withTenant(suite.db, tenantId, (tx) =>
      enqueueSuccessor(tx, { tenantId, duty: DUTY, period, dueAt: dueAt1 }),
    );

    const afterFirst = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-01-01T00:00:00Z") }),
    );
    const gen1Row = afterFirst.rows.find(
      (r) => new Date(r.periodFrom).getTime() === period.from.getTime() && r.generation === 1,
    )!;
    const gen1 = await withTenant(suite.db, tenantId, (tx) =>
      claimRow(tx, { id: gen1Row.id, now: dueAt1 }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      completeRun(tx, {
        id: gen1!.id,
        startedAt: gen1!.startedAt,
        state: "succeeded",
        summary: {},
        errorCode: null,
        nextAttemptAt: null,
        now: dueAt1,
      }),
    );

    const dueAt2 = new Date(dueAt1.getTime() + 60_000);
    const insertedSecond = await withTenant(suite.db, tenantId, (tx) =>
      enqueueSuccessor(tx, { tenantId, duty: DUTY, period, dueAt: dueAt2 }),
    );
    expect(insertedSecond).toBe(true);

    const finalSnapshot = await withTenant(suite.db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-01-01T00:00:00Z") }),
    );
    const gen2Row = finalSnapshot.rows.find(
      (r) => new Date(r.periodFrom).getTime() === period.from.getTime() && r.state === "pending",
    );
    expect(gen2Row).toMatchObject({ generation: 2 });
  });
});
