import { setImmediate as turn } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  activityLog,
  recordActivity,
  CORE_MIGRATIONS,
  printJobs,
  signInChallenges,
  dashboardSessions,
  mediaBlobs,
  mediaImages,
  serviceCommands,
  parties,
  insertInChunks,
  withTransaction,
} from "@waitron/db";
import { seedPerson, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createPrinter } from "@waitron/printing";
import {
  clearOldActivityLog,
  clearOldPrintPayloads,
  housekeepingJob,
  HOUSEKEEPING_STEPS,
} from "./housekeeping.js";
import { startClockState } from "./start-clock-check.js";
import { startClockGateHolds } from "./start-clock-gate.js";
import { createJobRunner } from "./job-runner.js";
import { fakeTimerDelay } from "./testing/fake-timer-delay.js";
import { printJobInTrouble } from "./print-job-trouble.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const now = new Date("2026-11-14T04:00:00.000Z");
const old = "2026-11-01T04:00:00.000Z";
async function printer() {
  return withTransaction(suite.db, (tx) =>
    createPrinter(tx, {
      name: "Kitchen",
      transport: "network_tcp",
      host: "printer.test",
    }),
  );
}
async function job(printerId: string, patch: Partial<typeof printJobs.$inferInsert> = {}) {
  return (
    await suite.db
      .insert(printJobs)
      .values({
        printerId,
        payload: new Uint8Array([27, 64, 1]),
        status: "done",
        createdAt: old,
        ...patch,
      })
      .returning()
  )[0]!;
}
const lengths = () =>
  suite.db.all<{ size: number; storage: string }>(
    sql`select length(payload) size, typeof(payload) storage from print_jobs order by rowid`,
  );

function tidy(overrides: Partial<Parameters<typeof housekeepingJob>[0]> = {}) {
  return housekeepingJob({
    db: suite.db,
    isPrimary: () => true,
    clockUnconfirmed: () => false,
    readClock: async () => ({ timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] }),
    jitterSeed: "node",
    now: () => now,
    log: () => {},
    maxWaitMs: 3600000,
    ...overrides,
  });
}
const pass = (duty = tidy(), signal = new AbortController().signal) => duty.pass({ now, signal });

describe("daily housekeeping steps", () => {
  it("keeps photo garbage on a secondary through the runner's startup and stop", async () => {
    await suite.db
      .insert(mediaBlobs)
      .values({ hash: "a".repeat(64), format: "jpg", bytes: new Uint8Array([1]) });
    vi.useFakeTimers();
    const runner = createJobRunner({ now: () => now, delay: fakeTimerDelay, log: () => {} });
    try {
      runner.add(tidy({ isPrimary: () => false }));
      await vi.advanceTimersByTimeAsync(61000);
    } finally {
      await runner.stopJobs();
      vi.useRealTimers();
    }
    expect(await suite.db.select().from(mediaBlobs)).toHaveLength(1);
  });

  it("honours a stop while a new step is waiting for the write turn", async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    await suite.db.insert(signInChallenges).values({
      id: "keep",
      kind: "passkey_login",
      challenge: "expired",
      createdAt: old,
      expiresAt: now.toISOString(),
    });
    const holding = withTransaction(suite.db, async () => {
      entered();
      await gate;
    });
    await started;
    const controller = new AbortController();
    let requested!: () => void;
    const queued = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const original = suite.db.withWriteLock.bind(suite.db);
    const lock = vi
      .spyOn(suite.db, "withWriteLock")
      .mockImplementation(<T>(body: () => Promise<T>) => {
        requested();
        return original(body);
      });
    let cleaning: Promise<unknown> | undefined;
    try {
      cleaning = pass(tidy({ clockUnconfirmed: () => true }), controller.signal);
      await queued;
      controller.abort();
    } finally {
      release();
      await holding;
      await cleaning;
      lock.mockRestore();
    }
    expect((await suite.db.select().from(signInChallenges)).map((row) => row.id)).toEqual(["keep"]);
  });
  it("commits short batches separately, yielding to a stop before another batch", async () => {
    const step = HOUSEKEEPING_STEPS.find((step) => step.name === "sign_in_challenges")!;
    await insertInChunks(
      suite.db,
      signInChallenges,
      Array.from({ length: 1001 }, (_, index) => ({
        id: String(index),
        kind: "passkey_login" as const,
        challenge: "test",
        createdAt: old,
        expiresAt: now.toISOString(),
      })),
    );
    const controller = new AbortController();
    const stop = turn().then(() => controller.abort());
    await pass(tidy({ steps: [step] }), controller.signal);
    await stop;
    expect(await suite.db.select().from(signInChallenges)).toHaveLength(501);
    const locks = vi.spyOn(suite.db, "withWriteLock");
    try {
      await pass(tidy({ steps: [step], clockUnconfirmed: () => true }));
      expect(await suite.db.select().from(signInChallenges)).toEqual([]);
      expect(locks).toHaveBeenCalledTimes(2);
    } finally {
      locks.mockRestore();
    }
  });

  it("logs a failed step, runs the next step, then throws for the runner's failure alert", async () => {
    const failure = new Error("prune refused");
    await suite.db
      .insert(mediaBlobs)
      .values({ hash: "a".repeat(64), format: "jpg", bytes: new Uint8Array([1]) });
    const log = vi.fn();
    const duty = tidy({
      log,
      steps: [
        {
          name: "sign_in_challenges",
          enabled: true,
          async deleteBatch() {
            throw failure;
          },
        },
        {
          name: "media_blobs",
          enabled: true,
          async deleteBatch(tx) {
            return (await tx.delete(mediaBlobs).returning()).length;
          },
        },
      ],
    });
    await expect(pass(duty)).rejects.toBe(failure);
    expect(await suite.db.select().from(mediaBlobs)).toEqual([]);
    expect(log).toHaveBeenCalledWith("error", "housekeeping.step_failed", {
      step: "sign_in_challenges",
      errorCode: "unknown",
    });
  });
  it("deletes expired and far-future challenges while keeping live boundaries", async () => {
    await suite.db.insert(signInChallenges).values(
      [
        ["expired", "2026-11-14T03:59:59.999Z"],
        ["now", "2026-11-14T04:00:00.000Z"],
        ["live", "2026-11-14T04:00:00.001Z"],
        ["ten-minutes", "2026-11-14T04:10:00.000Z"],
        ["clock-stepped", "2026-11-14T04:10:00.001Z"],
      ].map(([id, expiresAt]) => ({
        id: id!,
        expiresAt: expiresAt!,
        kind: "passkey_login" as const,
        challenge: "challenge",
        createdAt: old,
      })),
    );
    await pass();
    expect((await suite.db.select().from(signInChallenges)).map((row) => row.id).sort()).toEqual([
      "live",
      "ten-minutes",
    ]);
  });

  it("deletes ended and idle sessions in either clock direction, keeping the thirty-minute boundaries", async () => {
    const personId = await seedPerson(suite.db);
    await suite.db.insert(dashboardSessions).values(
      [
        ["past", "2026-11-14T03:29:59.999Z", null],
        ["past-boundary", "2026-11-14T03:30:00.000Z", null],
        ["future-boundary", "2026-11-14T04:30:00.000Z", null],
        ["future", "2026-11-14T04:30:00.001Z", null],
        ["ten-ahead", "2026-11-14T04:10:00.000Z", null],
        ["ended", "2026-11-14T04:00:00.000Z", "2026-11-14T04:00:00.000Z"],
      ].map(([id, lastSeenAt, endedAt], index) => ({
        id: id!,
        personId,
        tokenHash: index.toString(16).padStart(64, "0"),
        lastSeenAt: lastSeenAt!,
        endedAt,
      })),
    );
    await pass();
    expect((await suite.db.select().from(dashboardSessions)).map((row) => row.id).sort()).toEqual([
      "future-boundary",
      "past-boundary",
      "ten-ahead",
    ]);
  });

  it("deletes unnamed photo bytes and preserves both original and replacement bytes", async () => {
    const [originalHash, sourceHash, garbage] = ["a", "b", "c"].map((char) => char.repeat(64));
    await suite.db.insert(mediaBlobs).values(
      [originalHash!, sourceHash!, garbage!].map((hash) => ({
        hash,
        format: "jpg" as const,
        bytes: new Uint8Array([1, 2, 3]),
      })),
    );
    await suite.db.insert(mediaImages).values({
      filename: `${originalHash}.jpg`,
      names: {},
      originalHash: originalHash!,
      sourceHash,
    });
    await pass();
    expect((await suite.db.select().from(mediaBlobs)).map((row) => row.hash).sort()).toEqual([
      originalHash,
      sourceHash,
    ]);
  });

  it("keeps command retry answers while the service-command step is disabled", async () => {
    const personId = await seedPerson(suite.db);
    const [party] = await suite.db
      .insert(parties)
      .values({ openedBy: personId, state: "closed", closedAt: old })
      .returning();
    await suite.db.insert(serviceCommands).values({
      scopeKind: "party",
      scopeId: party!.id,
      submissionId: "retry",
      kind: "finish",
      fingerprint: "same",
      result: { value: "answer" },
    });
    const before = await suite.db.select().from(serviceCommands);
    await pass();
    expect(await suite.db.select().from(serviceCommands)).toEqual(before);
  });

  it("deletes only command answers whose own party or bill finished over twenty-four hours ago", async () => {
    const personId = await seedPerson(suite.db);
    const scopes = [
      ["old", "2026-11-13T03:59:59.999Z"],
      ["boundary", "2026-11-13T04:00:00.000Z"],
      ["recent", "2026-11-13T04:00:00.001Z"],
      ["open", null],
    ] as const;
    for (const [id, closedAt] of scopes) {
      await suite.db.insert(parties).values({
        id: `party-${id}`,
        openedBy: personId,
        state: closedAt === null ? "open" : "closed",
        closedAt,
      });
      await seedWorkingOrder(suite.db, {
        id: `bill-${id}`,
        status: closedAt === null ? "open" : "settled",
        settledAt: closedAt,
      });
    }
    await seedWorkingOrder(suite.db, { id: "bill-abandoned", status: "abandoned" });
    for (const scopeKind of ["party", "bill"] as const) {
      for (const id of [
        "old",
        "boundary",
        "recent",
        "open",
        "missing",
        ...(scopeKind === "bill" ? ["abandoned"] : []),
      ]) {
        await suite.db.insert(serviceCommands).values({
          id: `${scopeKind}-${id}`,
          scopeKind,
          scopeId: `${scopeKind}-${id}`,
          submissionId: "same",
          kind: "finish",
          fingerprint: "same",
          result: {},
        });
      }
    }
    const step = HOUSEKEEPING_STEPS.find((step) => step.name === "service_commands");
    expect(step).toBeDefined();
    expect(await withTransaction(suite.db, (tx) => step!.deleteBatch(tx, now, 1))).toBe(1);
    expect(await withTransaction(suite.db, (tx) => step!.deleteBatch(tx, now, 5))).toBe(1);
    expect((await suite.db.select().from(serviceCommands)).map((row) => row.id).sort()).toEqual([
      "bill-abandoned",
      "bill-boundary",
      "bill-missing",
      "bill-open",
      "bill-recent",
      "party-boundary",
      "party-missing",
      "party-open",
      "party-recent",
    ]);
  });
});

describe("activity log housekeeping", () => {
  async function activity(at: string) {
    return withTransaction(suite.db, (tx) =>
      recordActivity(tx, {
        kind: "settings.saved",
        subjectId: "venue",
        personId: null,
        data: { revision: 1 },
        at: new Date(at),
      }),
    );
  }
  it("checks the activity clock gate after print cleanup finishes", async () => {
    const p = await printer();
    await job(p.id);
    const entry = await activity("2026-10-01T00:00:00.000Z");
    await pass(tidy({ clockUnconfirmed: () => lengths()[0]!.size === 0 }));
    expect(lengths()[0]!.size).toBe(0);
    expect((await suite.db.select().from(activityLog)).map((row) => row.id)).toEqual([entry.id]);
  });
  it("prunes the log at 30 days while print payloads keep their seven-day rule", async () => {
    const expired = await activity("2026-10-15T03:59:59.999Z");
    const boundary = await activity("2026-10-15T04:00:00.000Z");
    const recent = await activity("2026-11-01T04:00:00.000Z");
    const p = await printer();
    await job(p.id);
    const duty = housekeepingJob({
      db: suite.db,
      isPrimary: () => true,
      clockUnconfirmed: () => false,
      readClock: async () => ({
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        cutoverChanges: [],
      }),
      jitterSeed: "node",
      now: () => now,
      log: () => {},
      maxWaitMs: 3600000,
    });
    await duty.pass({ now, signal: new AbortController().signal });
    expect((await suite.db.select().from(activityLog)).map((row) => row.id).sort()).toEqual(
      [boundary.id, recent.id].sort(),
    );
    expect(await suite.db.select().from(activityLog).where(eq(activityLog.id, expired.id))).toEqual(
      [],
    );
    expect(lengths()[0]!.size).toBe(0);
  });
  it("honours a stop received while a batch waits for the write lock", async () => {
    const entry = await activity("2026-10-01T00:00:00.000Z");
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holding = withTransaction(suite.db, async () => {
      entered();
      await gate;
    });
    await started;
    const controller = new AbortController();
    const pruning = clearOldActivityLog(suite.db, now, controller.signal, 2);
    controller.abort();
    release();
    await holding;
    expect(await pruning).toBe(0);
    expect((await suite.db.select().from(activityLog)).map((row) => row.id)).toEqual([entry.id]);
  });
  it("yields between batches and honours an abort before the next write", async () => {
    for (let i = 0; i < 3; i++) await activity("2026-10-01T00:00:00.000Z");
    const controller = new AbortController();
    const stop = turn().then(() => controller.abort());
    expect(await clearOldActivityLog(suite.db, now, controller.signal, 2)).toBe(2);
    await stop;
    expect(await suite.db.select().from(activityLog)).toHaveLength(1);
    expect(await clearOldActivityLog(suite.db, now, controller.signal, 2)).toBe(0);
    expect(await clearOldActivityLog(suite.db, now, new AbortController().signal, 2)).toBe(1);
    expect(await suite.db.select().from(activityLog)).toEqual([]);
  });
});

describe("print payload housekeeping", () => {
  it("empties only old terminal jobs and stores an empty blob without changing their history", async () => {
    const p = await printer();
    const cases = [
      [{ status: "done" }, 0],
      [{ status: "done", createdAt: "2026-11-07T04:00:00.000Z" }, 3],
      [{ status: "done", createdAt: "2026-11-07T03:59:59.999Z" }, 0],
      [{ status: "done", createdAt: "2026-11-13T04:00:00.000Z" }, 3],
      [{ status: "queued" }, 3],
      [{ status: "printing" }, 3],
      [{ status: "failed", attempts: 4 }, 3],
      [{ status: "failed", attempts: 5 }, 3],
      [{ status: "failed", attempts: 5, lastError: "print_job.moved" }, 3],
      [{ status: "failed", attempts: 5, lastError: "printer.unpaired" }, 3],
      [{ status: "failed", attempts: 5, lastError: "printer.deleted" }, 0],
      [{ status: "failed", kind: "drawer", attempts: 1 }, 0],
    ] as const;
    for (const [patch] of cases) await job(p.id, patch);
    const before = await suite.db.select().from(printJobs);
    expect(await clearOldPrintPayloads(suite.db, now, new AbortController().signal)).toBe(4);
    expect(lengths()).toEqual(cases.map(([, want]) => ({ size: want, storage: "blob" })));
    const after = await suite.db.select().from(printJobs);
    expect(after.map((row) => ({ ...row, payload: null }))).toEqual(
      before.map((row) => ({ ...row, payload: null })),
    );
    expect(await clearOldPrintPayloads(suite.db, now, new AbortController().signal)).toBe(0);
  });

  it("keeps a retryable original even when its replacement has printed, and retains resend links", async () => {
    const p = await printer();
    const ended = await job(p.id, { status: "failed", attempts: 5 });
    const retryable = await job(p.id, { status: "failed", attempts: 1 });
    await job(p.id, { resendOf: ended.id });
    await job(p.id, { resendOf: retryable.id });
    const trouble = () =>
      suite.db.all(sql`select id from print_jobs where ${printJobInTrouble(now)}`);
    const before = trouble();
    expect(await clearOldPrintPayloads(suite.db, now, new AbortController().signal)).toBe(3);
    expect(lengths().map((row) => row.size)).toEqual([0, 3, 0, 0]);
    expect(trouble()).toEqual(before);
    expect((await suite.db.select().from(printJobs)).map((row) => row.resendOf)).toEqual([
      null,
      null,
      ended.id,
      retryable.id,
    ]);
  });

  it("advances beyond ineligible windows and lets a stop run before the next batch", async () => {
    const p = await printer();
    for (const status of ["queued", "queued", "done", "queued", "done"] as const)
      await job(p.id, { status });
    expect(await clearOldPrintPayloads(suite.db, now, new AbortController().signal, 2)).toBe(2);
    expect(lengths().map((row) => row.size)).toEqual([3, 3, 0, 3, 0]);
    await suite.db.delete(printJobs);
    for (let i = 0; i < 4; i++) await job(p.id);
    const controller = new AbortController();
    const stop = turn().then(() => controller.abort());
    expect(await clearOldPrintPayloads(suite.db, now, controller.signal, 2)).toBe(2);
    await stop;
    expect(lengths().map((row) => row.size)).toEqual([0, 0, 3, 3]);
  });

  it("clears old payloads when the box restarts after 04:00 on seven successive days", async () => {
    const p = await printer();
    const sizes: number[] = [];
    for (let day = 0; day < 7; day++) {
      const at = new Date(now.getTime() + day * 86400000 + 3 * 3600000);
      const row = await job(p.id, {
        createdAt: new Date(at.getTime() - 8 * 86400000).toISOString(),
      });
      const duty = housekeepingJob({
        db: suite.db,
        isPrimary: () => true,
        clockUnconfirmed: () => false,
        readClock: async () => ({
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
          cutoverChanges: [],
        }),
        jitterSeed: "node",
        now: () => at,
        log: () => {},
        maxWaitMs: 3600000,
      });
      vi.useFakeTimers();
      const runner = createJobRunner({ now: () => at, delay: fakeTimerDelay, log: () => {} });
      try {
        runner.add(duty);
        await vi.advanceTimersByTimeAsync(999);
        expect(
          (await suite.db.select().from(printJobs).where(eq(printJobs.id, row.id)))[0]!.payload
            .byteLength,
        ).toBe(3);
        await vi.advanceTimersByTimeAsync(1);
        sizes.push(
          (await suite.db.select().from(printJobs).where(eq(printJobs.id, row.id)))[0]!.payload
            .byteLength,
        );
      } finally {
        await runner.stopJobs();
        vi.useRealTimers();
      }
    }
    expect(sizes).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("runs catch-up once, then follows 04:00 venue time and the next local day", async () => {
    const p = await printer();
    const row = await job(p.id);
    let at = new Date("2026-11-14T02:00:00.000Z");
    let primary = true;
    const startClock = startClockState();
    const activity = await withTransaction(suite.db, (tx) =>
      recordActivity(tx, {
        kind: "settings.saved",
        subjectId: "venue",
        personId: null,
        data: { revision: 1 },
        at: new Date("2026-10-01T00:00:00.000Z"),
      }),
    );
    const duty = housekeepingJob({
      db: suite.db,
      isPrimary: () => primary,
      clockUnconfirmed: startClockGateHolds(
        startClock,
        () => true,
        () => false,
      ),
      readClock: async () => ({
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        cutoverChanges: [],
      }),
      jitterSeed: "node",
      now: () => at,
      log: () => {},
      maxWaitMs: 3600000,
    });
    expect(duty.name).toBe("housekeeping");
    expect(duty.applies()).toBe(true);
    expect((await duty.pass({ now: at, signal: new AbortController().signal })).nextDueAt).toEqual(
      new Date("2026-11-14T03:00:00.000Z"),
    );
    expect(lengths()[0]!.size).toBe(0);
    expect((await suite.db.select().from(activityLog)).map((entry) => entry.id)).toEqual([
      activity.id,
    ]);
    await suite.db
      .update(printJobs)
      .set({ payload: new Uint8Array([1, 2, 3]) })
      .where(eq(printJobs.id, row.id));
    await duty.pass({ now: at, signal: new AbortController().signal });
    expect(lengths()[0]!.size).toBe(3);
    at = new Date("2026-11-14T03:00:00.000Z");
    startClock.confirm("by_person", {});
    expect((await duty.pass({ now: at, signal: new AbortController().signal })).nextDueAt).toEqual(
      new Date("2026-11-15T03:00:00.000Z"),
    );
    expect(lengths()[0]!.size).toBe(0);
    expect(await suite.db.select().from(activityLog)).toEqual([]);
    await suite.db
      .update(printJobs)
      .set({ payload: new Uint8Array([1]) })
      .where(eq(printJobs.id, row.id));
    await duty.pass({ now: at, signal: new AbortController().signal });
    expect(lengths()[0]!.size).toBe(1);
    primary = false;
    expect(duty.applies()).toBe(false);
  });
});
