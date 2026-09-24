import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
  },
});

describe("claimGap", () => {
  it("inserts a running row and returns it", async () => {
    const claimed = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period: PERIOD, now: NOW }),
    );
    expect(claimed).toMatchObject({ generation: 0, attempts: 1 });
    expect(new Date(claimed!.periodFrom).toISOString()).toBe("2026-07-24T00:00:00.000Z");
  });

  // The insert IS the lock — a second claim of the same period conflicts on scheduled_runs_key.
  it("returns null when the row already exists", async () => {
    const again = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period: PERIOD, now: NOW }),
    );
    expect(again).toBeNull();
  });
});

describe("readSnapshot", () => {
  it("returns an empty snapshot for a duty with no rows", async () => {
    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, {
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
    const claimed = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    await withTransaction(suite.db, (tx) =>
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
    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const row = snapshot.rows.find(
      (r) => new Date(r.periodFrom).toISOString() === "2026-07-23T00:00:00.000Z",
    );
    expect(row).toMatchObject({ state: "succeeded", nextAttemptAt: null });
    expect(new Date(snapshot.earliestPeriodFrom!).toISOString()).toBe("2026-07-23T00:00:00.000Z");
  });

  it("records a failure with a structured code and a backoff", async () => {
    const period = dayPeriod(new Date("2026-07-22T00:00:00Z"));
    const claimed = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    await withTransaction(suite.db, (tx) =>
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
    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
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
    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const failed = snapshot.rows.find((r) => r.state === "failed")!;
    const later = new Date("2026-07-25T05:00:00Z");
    const claimed = await withTransaction(suite.db, (tx) =>
      claimRow(tx, { id: failed.id, now: later }),
    );
    expect(claimed).toMatchObject({ attempts: 2 });
  });

  // Matches `derive()`'s own `due <= nowMs`, or a row derivation reports as due is not claimable.
  it("claims a failed row whose backoff elapses at exactly `now`", async () => {
    const period = dayPeriod(new Date("2026-07-18T00:00:00Z"));
    const claimed = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    const boundary = new Date("2026-07-25T05:30:00Z");
    await withTransaction(suite.db, (tx) =>
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
    const reclaimed = await withTransaction(suite.db, (tx) =>
      claimRow(tx, { id: claimed!.id, now: boundary }),
    );
    expect(reclaimed).toMatchObject({ attempts: 2 });
  });

  it("clears next_attempt_at when it claims, so a running row never carries a stale one", async () => {
    const period = dayPeriod(new Date("2026-07-21T00:00:00Z"));
    const gap = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    await withTransaction(suite.db, (tx) =>
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
    await withTransaction(suite.db, (tx) =>
      claimRow(tx, { id: gap!.id, now: new Date("2026-07-25T04:20:00Z") }),
    );

    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const claimed = snapshot.rows.find((r) => r.id === gap!.id)!;
    expect(claimed).toMatchObject({ state: "running", nextAttemptAt: null });
  });

  it("returns null for a row that is no longer claimable", async () => {
    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const running = snapshot.rows.find((r) => r.state === "running")!;
    const claimed = await withTransaction(suite.db, (tx) =>
      claimRow(tx, { id: running.id, now: new Date("2026-07-25T06:00:00Z") }),
    );
    expect(claimed).toBeNull();
  });

  it("returns null for a failed row whose backoff has not yet elapsed", async () => {
    const period = dayPeriod(new Date("2026-07-17T00:00:00Z"));
    const claimed = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    const future = new Date("2026-07-26T00:00:00Z");
    await withTransaction(suite.db, (tx) =>
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
    const tooSoon = await withTransaction(suite.db, (tx) =>
      claimRow(tx, { id: claimed!.id, now: new Date(future.getTime() - 1) }),
    );
    expect(tooSoon).toBeNull();
  });

  // Inserted by hand: `enqueueSuccessor` always sets `next_attempt_at`.
  it("returns null for a pending row with no next_attempt_at set", async () => {
    const [inserted] = await withTransaction(suite.db, (tx) =>
      tx
        .insert(scheduledRuns)
        .values({
          duty: DUTY,
          periodFrom: dayPeriod(new Date("2026-07-16T00:00:00Z")).from.toISOString(),
          periodTo: dayPeriod(new Date("2026-07-16T00:00:00Z")).to.toISOString(),
          generation: 1,
          state: "pending",
          attempts: 0,
        })
        .returning({ id: scheduledRuns.id }),
    );
    const claimed = await withTransaction(suite.db, (tx) =>
      claimRow(tx, { id: inserted!.id, now: NOW }),
    );
    expect(claimed).toBeNull();
  });
});

describe("reclaimStale", () => {
  it("reclaims a running row stranded past staleAfterMs", async () => {
    const period = dayPeriod(new Date("2026-07-20T00:00:00Z"));
    const claimed = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    const reclaimed = await withTransaction(suite.db, (tx) =>
      reclaimStale(tx, { id: claimed!.id, now: later, staleAfterMs: 60 * 60 * 1000 }),
    );
    expect(reclaimed).toMatchObject({ attempts: 2 });
  });

  it("refuses a running row inside staleAfterMs", async () => {
    const period = dayPeriod(new Date("2026-07-19T00:00:00Z"));
    const claimed = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    const reclaimed = await withTransaction(suite.db, (tx) =>
      reclaimStale(tx, { id: claimed!.id, now: NOW, staleAfterMs: 60 * 60 * 1000 }),
    );
    expect(reclaimed).toBeNull();
  });

  it("refuses a row that is no longer running, however stale its started_at", async () => {
    const period = dayPeriod(new Date("2026-06-01T00:00:00Z"));
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
        nextAttemptAt: new Date("2026-07-25T04:15:00Z"),
        now: NOW,
      }),
    );
    const reclaimed = await withTransaction(suite.db, (tx) =>
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
  // A claims and hangs past staleAfterMs, B reclaims (stamping a new started_at), then A completes
  // with its own stale startedAt — which, unfenced, would overwrite the row B is still running.
  it("rejects a completion from an attempt a reclaim has since superseded", async () => {
    const period = dayPeriod(new Date("2026-05-01T00:00:00Z"));
    const original = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    const reclaimAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    const reclaimed = await withTransaction(suite.db, (tx) =>
      reclaimStale(tx, { id: original!.id, now: reclaimAt, staleAfterMs: 60 * 60 * 1000 }),
    );
    expect(reclaimed).toMatchObject({ attempts: 2 });

    const won = await withTransaction(suite.db, (tx) =>
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

    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-01-01T00:00:00Z") }),
    );
    const row = snapshot.rows.find((r) => r.id === original!.id);
    expect(row).toMatchObject({ state: "running", attempts: 2 });
  });

  // The fence's `state` conjunct: same id and same startedAt, so `startedAt` alone would still match.
  it("rejects a duplicate completion once the row has already reached a terminal state", async () => {
    const period = dayPeriod(new Date("2026-04-01T00:00:00Z"));
    const claimed = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    const first = await withTransaction(suite.db, (tx) =>
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

    const second = await withTransaction(suite.db, (tx) =>
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

    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-01-01T00:00:00Z") }),
    );
    const row = snapshot.rows.find((r) => r.id === claimed!.id);
    expect(row).toMatchObject({ state: "succeeded", nextAttemptAt: null });
  });
});

describe("enqueueSuccessor", () => {
  it("refuses when the period already has a non-terminal row, even one merely awaiting retry", async () => {
    const period = dayPeriod(new Date("2026-03-01T00:00:00Z"));
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
        nextAttemptAt: new Date(NOW.getTime() + 60_000),
        now: NOW,
      }),
    );

    const inserted = await withTransaction(suite.db, (tx) =>
      enqueueSuccessor(tx, {
        duty: DUTY,
        period,
        dueAt: new Date(NOW.getTime() + 120_000),
      }),
    );
    expect(inserted).toBe(false);

    const snapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-01-01T00:00:00Z") }),
    );
    expect(
      snapshot.rows.filter((r) => new Date(r.periodFrom).getTime() === period.from.getTime()),
    ).toHaveLength(1);
  });

  it("treats a parked row as terminal, exactly as derivation does", async () => {
    const period = dayPeriod(new Date("2026-03-03T00:00:00Z"));
    const claimed = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    await withTransaction(suite.db, (tx) =>
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

    const inserted = await withTransaction(suite.db, (tx) =>
      enqueueSuccessor(tx, {
        duty: DUTY,
        period,
        dueAt: new Date(NOW.getTime() + 60_000),
      }),
    );
    expect(inserted).toBe(true);
  });

  // Two generations deep, so a generation fixed at 1 cannot pass.
  it("computes the next generation as max(generation) + 1, not a fixed value", async () => {
    const period = dayPeriod(new Date("2026-03-02T00:00:00Z"));
    const gen0 = await withTransaction(suite.db, (tx) =>
      claimGap(tx, { duty: DUTY, period, now: NOW }),
    );
    await withTransaction(suite.db, (tx) =>
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
    await withTransaction(suite.db, (tx) =>
      enqueueSuccessor(tx, { duty: DUTY, period, dueAt: dueAt1 }),
    );

    const afterFirst = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-01-01T00:00:00Z") }),
    );
    const gen1Row = afterFirst.rows.find(
      (r) => new Date(r.periodFrom).getTime() === period.from.getTime() && r.generation === 1,
    )!;
    const gen1 = await withTransaction(suite.db, (tx) =>
      claimRow(tx, { id: gen1Row.id, now: dueAt1 }),
    );
    await withTransaction(suite.db, (tx) =>
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
    const insertedSecond = await withTransaction(suite.db, (tx) =>
      enqueueSuccessor(tx, { duty: DUTY, period, dueAt: dueAt2 }),
    );
    expect(insertedSecond).toBe(true);

    const finalSnapshot = await withTransaction(suite.db, (tx) =>
      readSnapshot(tx, { duty: DUTY, horizonStart: new Date("2026-01-01T00:00:00Z") }),
    );
    const gen2Row = finalSnapshot.rows.find(
      (r) => new Date(r.periodFrom).getTime() === period.from.getTime() && r.state === "pending",
    );
    expect(gen2Row).toMatchObject({ generation: 2 });
  });
});
