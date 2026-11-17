import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, installChangeFeed, withTransaction } from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";

import { jobOrigin } from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  WORKFORCE_CHANGE_SOURCES,
  WorkforceBackend,
  attendanceDays,
  attendanceQuestions,
  readChain,
  rosterVersions,
  shifts,
  timeEntries,
  verifyChain,
} from "@waitron/workforce";
import { markAttendanceSourceChanged } from "./attendance-source-changes.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { realSleep } from "./loop.js";
import { createJobRunner } from "./job-runner.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const backend = new WorkforceBackend();
let nodeId: string, personId: string, primary: boolean;
const now = new Date("2026-01-07T09:00:00Z");
const deps = () => ({ db: suite.db, nodeId, now: () => now, isPrimary: () => primary });
beforeEach(async () => {
  primary = true;
  await suite.db.execute(sql`drop trigger if exists reject_question`);
  await seedVenue(suite.db, {
    name: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    invoiceLocales: ["es"],
  });
  nodeId = await seedNode(suite.db);
  const [person] = await seedPersons(suite.db, { displayName: "Worker", pinHash: "scrypt$00$00" });
  personId = person!.id;
});
async function seed() {
  await withTransaction(suite.db, async (tx) => {
    await backend.clockIn(tx, {
      nodeId,
      personId,
      at: "2026-01-05T09:00:00Z",
      offsetMinutes: 60,
      origin: jobOrigin("dashboard"),
    });
    await recordAttendanceFact(tx, {
      source: "order",
      key: "last-order",
      personId,
      kind: "order",
      at: "2026-01-05T16:40:00Z",
      offsetMinutes: 60,
      outcome: "qualified",
    });
  });
}
async function snapshot() {
  return {
    entries: await suite.db.select().from(timeEntries),
    work: await suite.db.select().from(attendanceDays),
    questions: await suite.db
      .select({ ...getTableColumns(attendanceQuestions), businessDay: attendanceDays.businessDay })
      .from(attendanceQuestions)
      .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceQuestions.attendanceDayId)),
  };
}
async function pass() {
  return (await import("./attendance-loop.js")).runAttendancePass(deps());
}
async function settle() {
  for (let i = 0; i < 20; i++) if (!(await pass()).more) return;
  throw new Error("duty exceeded bounded fixture batches");
}
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe("attendance duty pass", () => {
  it("continues immediately when another evaluated day is due from deferred work", async () => {
    await suite.db.insert(attendanceDays).values([
      {
        businessDay: "2026-01-05",
        startAt: "2026-01-05T04:00:00.000Z",
        endAt: "2026-01-06T04:00:00.000Z",
        nextDueAt: "2026-01-06T04:00:00.000Z",
      },
      {
        businessDay: "2026-01-06",
        startAt: "2026-01-06T04:00:00.000Z",
        endAt: "2026-01-07T04:00:00.000Z",
        dirtyRevision: 1,
        evaluatedRevision: 1,
        nextDueAt: "2026-01-07T05:00:00.000Z",
      },
    ]);
    expect(await pass()).toEqual({ processed: true, more: true });
    expect(await pass()).toEqual({ processed: true, more: false });
  });
  it("keeps a day due until evaluated past its deferred end without a stored shift list", async () => {
    await suite.db.insert(attendanceDays).values({
      businessDay: "2026-01-05",
      startAt: "2026-01-05T04:00:00.000Z",
      endAt: "2026-01-06T04:00:00.000Z",
      dirtyRevision: 1,
      evaluatedRevision: 1,
      nextDueAt: "2026-01-06T05:00:00.000Z",
    });
    const { runAttendancePass } = await import("./attendance-loop.js");
    expect(
      await runAttendancePass({ ...deps(), now: () => new Date("2026-01-06T04:59:59Z") }),
    ).toEqual({ processed: false, more: false });
    expect(
      await runAttendancePass({ ...deps(), now: () => new Date("2026-01-06T05:00:00Z") }),
    ).toEqual({ processed: true, more: false });
    expect((await suite.db.select().from(attendanceDays))[0]!.nextDueAt).toBe(
      "2026-01-06T04:00:00.000Z",
    );
    expect(
      await runAttendancePass({ ...deps(), now: () => new Date("2026-01-06T05:00:00Z") }),
    ).toEqual({ processed: false, more: false });
  });
  it("retains overnight deferred work until its end without another source change", async () => {
    const [version] = await suite.db
      .insert(rosterVersions)
      .values({
        periodStart: "2026-01-05",
        periodEnd: "2026-01-11",
        status: "published",
        publishedAt: "2026-01-01T09:00:00.000Z",
      })
      .returning();
    const [shift] = await suite.db
      .insert(shifts)
      .values({
        personId,
        startsAt: "2026-01-06T01:00:00.000Z",
        endsAt: "2026-01-06T05:00:00.000Z",
        startsOffsetMinutes: 60,
        endsOffsetMinutes: 60,
        rosterVersionId: version!.id,
      })
      .returning();
    await withTransaction(suite.db, (tx) => markAttendanceSourceChanged(tx, "shift", shift!.id));
    const { runAttendancePass } = await import("./attendance-loop.js");
    const early = new Date("2026-01-06T04:00:00Z");
    expect(await runAttendancePass({ ...deps(), now: () => early })).toEqual({
      processed: true,
      more: false,
    });
    expect((await snapshot()).questions).toEqual([]);
    expect((await snapshot()).work.filter((row) => row.businessDay === "2026-01-05")).toMatchObject(
      [{ nextDueAt: "2026-01-06T05:00:00.000Z" }],
    );
    const late = new Date("2026-01-06T05:00:00Z");
    expect(await runAttendancePass({ ...deps(), now: () => late })).toEqual({
      processed: true,
      more: false,
    });
    expect((await snapshot()).questions).toMatchObject([
      { shiftKey: `rota:${shift!.id}`, missingKinds: ["in", "out"] },
    ]);
    expect((await snapshot()).work.filter((row) => row.businessDay === "2026-01-05")).toMatchObject(
      [{ nextDueAt: "2026-01-06T04:00:00.000Z" }],
    );
  });
  it("appends on this node while preserving an older node's open entry and chain", async () => {
    const oldNode = await seedNode(suite.db);
    await withTransaction(suite.db, (tx) =>
      backend.clockIn(tx, {
        nodeId: oldNode,
        personId,
        at: "2026-01-05T09:00:00Z",
        offsetMinutes: 60,
        origin: jobOrigin("dashboard"),
      }),
    );
    const before = await readChain(suite.db, { nodeId: oldNode });
    await withTransaction(suite.db, (tx) =>
      recordAttendanceFact(tx, {
        source: "order",
        key: "last",
        personId,
        kind: "order",
        at: "2026-01-05T16:40:00Z",
        offsetMinutes: 60,
        outcome: "qualified",
      }),
    );
    await settle();
    expect(await readChain(suite.db, { nodeId: oldNode })).toEqual(before);
    expect((await snapshot()).entries.filter((e) => e.entryKind === "out")).toMatchObject([
      { nodeId, eventAt: "2026-01-05T16:40:00.000Z" },
    ]);
    expect(verifyChain(await readChain(suite.db, { nodeId }))).toEqual({ ok: true });
  });
  it("closes and replays a committed day without another end", async () => {
    await seed();
    await settle();
    const first = await snapshot();
    expect(first.entries).toMatchObject([
      { entryKind: "in" },
      { entryKind: "out", eventAt: "2026-01-05T16:40:00.000Z", authorKind: "automatic" },
    ]);
    expect(first.questions).toHaveLength(1);
    expect(first.work.every((w) => w.dirtyRevision === w.evaluatedRevision)).toBe(true);
    expect(await pass()).toEqual({ processed: false, more: false });
    expect(await snapshot()).toEqual(first);
    expect(verifyChain(await readChain(suite.db, { nodeId }))).toEqual({ ok: true });
  });
  it("processes at most one completed day per pass and catches up later", async () => {
    await seed();
    await withTransaction(suite.db, (tx) =>
      recordAttendanceFact(tx, {
        source: "draft",
        key: "next-day",
        personId,
        kind: "order",
        at: "2026-01-06T16:00:00Z",
        offsetMinutes: 60,
        outcome: "qualified",
      }),
    );
    expect(await pass()).toEqual({ processed: true, more: true });
    const first = await snapshot();
    expect(first.work.find((w) => w.businessDay === "2026-01-06")!.evaluatedRevision).toBe(0);
    expect(first.entries.map((e) => e.entryKind)).toEqual(["in", "out"]);
    await settle();
    const final = await snapshot();
    expect(final.work.every((w) => w.evaluatedRevision === w.dirtyRevision)).toBe(true);
    expect(final.questions.map((q) => q.businessDay).sort()).toEqual(["2026-01-05", "2026-01-06"]);
  });
  it("does not touch database state when not primary", async () => {
    await seed();
    const before = await snapshot();
    primary = false;
    expect(await pass()).toEqual({ processed: false, more: false });
    expect(await snapshot()).toEqual(before);
  });
  it("rechecks primary ownership after waiting for another write", async () => {
    await import("./attendance-loop.js");
    await seed();
    const before = await snapshot();
    const entered = gate(),
      held = gate(),
      queued = gate();
    const holder = withTransaction(suite.db, async () => {
      entered.release();
      await held.promise;
    });
    await entered.promise;
    const real = suite.db.withWriteLock.bind(suite.db);
    const spy = vi
      .spyOn(suite.db, "withWriteLock")
      .mockImplementation(<T>(body: () => Promise<T>) => {
        queued.release();
        return real(body);
      });
    let result!: ReturnType<typeof pass>;
    try {
      result = pass();
      await queued.promise;
      primary = false;
    } finally {
      spy.mockRestore();
      held.release();
    }
    await holder;
    expect(await result).toEqual({ processed: false, more: false });
    expect(await snapshot()).toEqual(before);
  });
  it("rolls failed processing back and retries its durable day after the cause is removed", async () => {
    await seed();
    const before = await snapshot();
    await suite.db.execute(
      sql`create trigger reject_question before insert on attendance_questions begin select raise(abort, 'question refused'); end`,
    );
    await expect(pass()).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await suite.db.execute(sql`drop trigger reject_question`);
    expect((await pass()).processed).toBe(true);
    expect((await snapshot()).entries.map((e) => e.entryKind)).toEqual(["in", "out"]);
  });
});

describe("a running shift across a clock days off", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const working = async () => {
    await withTransaction(suite.db, async (tx) => {
      await backend.clockIn(tx, {
        nodeId,
        personId,
        at: "2026-01-07T08:00:00Z",
        offsetMinutes: 60,
        origin: jobOrigin("dashboard"),
      });
      await recordAttendanceFact(tx, {
        source: "order",
        key: "morning-order",
        personId,
        kind: "order",
        at: "2026-01-07T08:30:00Z",
        offsetMinutes: 60,
        outcome: "qualified",
      });
    });
  };
  const settleAt = async (at: Date) => {
    const { runAttendancePass } = await import("./attendance-loop.js");
    for (let i = 0; i < 40; i++)
      if (!(await runAttendancePass({ ...deps(), now: () => at })).more) return;
    throw new Error("duty exceeded bounded fixture batches");
  };
  const clock = (kind: "clockIn" | "clockOut", at: string) =>
    withTransaction(suite.db, (tx) =>
      backend[kind](tx, {
        nodeId,
        personId,
        at,
        offsetMinutes: 60,
        origin: jobOrigin("dashboard"),
      }),
    );
  const entries = async () =>
    (await suite.db.select().from(timeEntries)).map((e) => [e.entryKind, e.eventAt, e.authorKind]);

  it("a clock 400 days ahead closes the shift at its last order; after the step back nothing is deleted and the worker clocks in again", async () => {
    await working();
    await settleAt(new Date(now.getTime() + 400 * DAY_MS));
    expect(await entries()).toEqual([
      ["in", "2026-01-07T08:00:00.000Z", "worker"],
      ["out", "2026-01-07T08:30:00.000Z", "automatic"],
    ]);
    // The step: the right time again. The automatic clock-out stands, so a clock-out is refused as
    // for anyone already out, and a clock-in is written.
    await expect(clock("clockOut", "2026-01-07T09:30:00Z")).rejects.toMatchObject({
      code: "attendance.no_open_entry",
    });
    await clock("clockIn", "2026-01-07T10:00:00Z");
    await settleAt(new Date("2026-01-08T06:00:00Z"));
    expect(await entries()).toEqual([
      ["in", "2026-01-07T08:00:00.000Z", "worker"],
      ["out", "2026-01-07T08:30:00.000Z", "automatic"],
      ["in", "2026-01-07T10:00:00.000Z", "worker"],
    ]);
    expect(verifyChain(await readChain(suite.db, { nodeId }))).toEqual({ ok: true });
  });

  it("a clock 400 days behind closes nothing; after the step forward the worker clocks out and in", async () => {
    await working();
    await settleAt(new Date(now.getTime() - 400 * DAY_MS));
    expect(await entries()).toEqual([["in", "2026-01-07T08:00:00.000Z", "worker"]]);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual([]);
    await clock("clockOut", "2026-01-07T09:30:00Z");
    await clock("clockIn", "2026-01-07T10:00:00Z");
    await settleAt(new Date("2026-01-08T06:00:00Z"));
    expect(await entries()).toEqual([
      ["in", "2026-01-07T08:00:00.000Z", "worker"],
      ["out", "2026-01-07T09:30:00.000Z", "worker"],
      ["in", "2026-01-07T10:00:00.000Z", "worker"],
    ]);
    expect(verifyChain(await readChain(suite.db, { nodeId }))).toEqual({ ok: true });
  });
});

describe("attendance job lifecycle", () => {
  const runAttendanceJob = async (
    options: ReturnType<typeof deps> & {
      signal: AbortSignal;
      onError(error: unknown): void;
      sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    },
  ) => {
    const { attendanceJob } = await import("./attendance-loop.js");
    const { runTestJob } = await import("./testing/run-job.js");
    return runTestJob(attendanceJob({ ...options, maxSleepMs: 60_000 }), options.signal, {
      sleep: options.sleep,
      log: (_level, event) => {
        if (event === "job.failed") options.onError(new Error(event));
      },
    }).done;
  };
  it("uses short continuation ticks and an idle tick after durable work settles", async () => {
    await seed();
    const abort = new AbortController();
    const ticks: number[] = [];
    await runAttendanceJob({
      ...deps(),
      signal: abort.signal,
      onError: (e) => {
        throw e;
      },
      sleep: async (ms) => {
        ticks.push(ms);
        if (ms === 60_000 || ticks.length > 20) abort.abort();
      },
    });
    expect(ticks).toContain(500);
    expect(ticks.at(-1)).toBe(60_000);
    expect((await snapshot()).entries.map((e) => e.entryKind)).toEqual(["in", "out"]);
  });
  it("reports a failed pass and retries with backoff without losing the day", async () => {
    await seed();
    await suite.db.execute(
      sql`create trigger reject_question before insert on attendance_questions begin select raise(abort, 'question refused'); end`,
    );
    const abort = new AbortController();
    const errors: unknown[] = [];
    const ticks: number[] = [];
    await runAttendanceJob({
      ...deps(),
      signal: abort.signal,
      onError: (e) => {
        errors.push(e);
      },
      sleep: async (ms) => {
        ticks.push(ms);
        if (ticks.length === 1) await suite.db.execute(sql`drop trigger reject_question`);
        if ((await snapshot()).entries.length === 2) abort.abort();
      },
    });
    expect(errors).toHaveLength(1);
    expect(ticks[0]).toBe(5_000);
    expect((await snapshot()).entries.map((e) => e.entryKind)).toEqual(["in", "out"]);
  });
  it("an already aborted loop makes no pass or writes", async () => {
    await seed();
    const before = await snapshot();
    const abort = new AbortController();
    abort.abort();
    await runAttendanceJob({
      ...deps(),
      signal: abort.signal,
      onError: (e) => {
        throw e;
      },
    });
    expect(await snapshot()).toEqual(before);
  });
  it("aborts the real idle sleep promptly", async () => {
    const abort = new AbortController();
    const idle = gate();
    let finished = false;
    const done = runAttendanceJob({
      ...deps(),
      signal: abort.signal,
      onError: (e) => {
        throw e;
      },
      sleep: async (ms, signal) => {
        idle.release();
        await realSleep(ms, signal);
      },
    }).then(() => {
      finished = true;
    });
    await idle.promise;
    expect(finished).toBe(false);
    abort.abort();
    await done;
    expect((await snapshot()).entries).toEqual([]);
  });
  it("awaits its active queued pass before resolving an abort", async () => {
    await seed();
    const entered = gate(),
      held = gate(),
      queued = gate();
    const holder = withTransaction(suite.db, async () => {
      entered.release();
      await held.promise;
    });
    await entered.promise;
    const real = suite.db.withWriteLock.bind(suite.db);
    const spy = vi
      .spyOn(suite.db, "withWriteLock")
      .mockImplementation(<T>(body: () => Promise<T>) => {
        queued.release();
        return real(body);
      });
    const abort = new AbortController();
    let done!: Promise<void>,
      finished = false;
    let sleeps = 0;
    try {
      done = runAttendanceJob({
        ...deps(),
        signal: abort.signal,
        onError: (e) => {
          throw e;
        },
        sleep: async () => {
          sleeps++;
        },
      }).then(() => {
        finished = true;
      });
      await queued.promise;
      abort.abort();
      expect(finished).toBe(false);
    } finally {
      spy.mockRestore();
      held.release();
    }
    await holder;
    await done;
    expect(finished).toBe(true);
    expect(sleeps).toBe(0);
    expect((await snapshot()).entries.map((e) => e.entryKind)).toEqual(["in", "out"]);
  });
});

describe("attendance runner job", () => {
  it("an idle pass opens no write transaction and waits for the next day end", async () => {
    await seed();
    let at = new Date("2026-01-05T18:00:00Z");
    const { attendanceJob } = await import("./attendance-loop.js");
    const job = attendanceJob({ ...deps(), now: () => at, maxSleepMs: 86_400_000 });
    const lock = vi.spyOn(suite.db, "withWriteLock");
    try {
      expect(await job.pass({ now: at, signal: new AbortController().signal })).toEqual({
        nextDueAt: new Date("2026-01-06T04:00:00Z"),
      });
      expect(lock).not.toHaveBeenCalled();
      at = new Date("2026-01-06T04:00:00Z");
      await job.pass({ now: at, signal: new AbortController().signal });
      expect(lock).toHaveBeenCalled();
      expect((await snapshot()).entries.map((entry) => entry.entryKind)).toEqual(["in", "out"]);
    } finally {
      lock.mockRestore();
    }
  });

  it("processes a day at its end with no change written", async () => {
    await seed();
    let at = new Date("2026-01-05T18:00:00Z");
    const { attendanceJob } = await import("./attendance-loop.js");
    const { runTestJob } = await import("./testing/run-job.js");
    const controller = new AbortController();
    const sleeps: number[] = [];
    await runTestJob(
      attendanceJob({ ...deps(), now: () => at, maxSleepMs: 86_400_000 }),
      controller.signal,
      {
        now: () => at,
        sleep: async (ms) => {
          sleeps.push(ms);
          if (sleeps.length === 1) at = new Date(at.getTime() + ms);
          else controller.abort();
        },
      },
    ).done;
    expect(sleeps).toEqual([36_000_000, 500]);
    expect((await snapshot()).entries.map((entry) => entry.entryKind)).toEqual(["in", "out"]);
  });

  it("settled rows do not cause a write turn and deferred work keeps its later due time", async () => {
    await suite.db.insert(attendanceDays).values([
      {
        businessDay: "2026-01-04",
        startAt: "2026-01-04T04:00:00.000Z",
        endAt: "2026-01-05T04:00:00.000Z",
        nextDueAt: "2026-01-05T04:00:00.000Z",
        dirtyRevision: 1,
        evaluatedRevision: 1,
      },
      {
        businessDay: "2026-01-05",
        startAt: "2026-01-05T04:00:00.000Z",
        endAt: "2026-01-06T04:00:00.000Z",
        nextDueAt: "2026-01-06T05:00:00.000Z",
        dirtyRevision: 1,
        evaluatedRevision: 1,
      },
    ]);
    const at = new Date("2026-01-06T04:30:00Z");
    const { attendanceJob } = await import("./attendance-loop.js");
    const lock = vi.spyOn(suite.db, "withWriteLock");
    try {
      const job = attendanceJob({ ...deps(), now: () => at, maxSleepMs: 86_400_000 });
      expect(await job.pass({ now: at, signal: new AbortController().signal })).toEqual({
        nextDueAt: new Date("2026-01-06T05:00:00Z"),
      });
      expect(lock).not.toHaveBeenCalled();
    } finally {
      lock.mockRestore();
    }
  });

  it("reads the role each turn and processes a due day after promotion", async () => {
    await seed();
    primary = false;
    const { attendanceJob } = await import("./attendance-loop.js");
    const { runTestJob } = await import("./testing/run-job.js");
    const controller = new AbortController();
    let turns = 0;
    const before = await snapshot();
    const work = runTestJob(attendanceJob({ ...deps(), maxSleepMs: 60_000 }), controller.signal, {
      sleep: async () => {
        if (++turns === 1) {
          expect(await snapshot()).toEqual(before);
          primary = true;
        } else controller.abort();
      },
    });
    await work.done;
    expect((await snapshot()).entries.map((entry) => entry.entryKind)).toEqual(["in", "out"]);
  });

  it("a failing pass backs off 5 s, then 10 s without losing its day", async () => {
    await seed();
    await suite.db.execute(
      sql`create trigger reject_question before insert on attendance_questions begin select raise(abort, 'question refused'); end`,
    );
    const { attendanceJob } = await import("./attendance-loop.js");
    const { runTestJob } = await import("./testing/run-job.js");
    const controller = new AbortController();
    const ticks: number[] = [];
    const work = runTestJob(attendanceJob({ ...deps(), maxSleepMs: 60_000 }), controller.signal, {
      sleep: async (ms) => {
        ticks.push(ms);
        if (ticks.length === 2) await suite.db.execute(sql`drop trigger reject_question`);
        if ((await snapshot()).entries.length === 2) controller.abort();
      },
    });
    await work.done;
    expect(ticks.slice(0, 2)).toEqual([5_000, 10_000]);
    expect((await snapshot()).entries.map((entry) => entry.entryKind)).toEqual(["in", "out"]);
  });
});

describe("attendance job change feed", () => {
  it("a clock-out through the workforce chain wakes and evaluates its marked day", async () => {
    await suite.db.insert(attendanceDays).values({
      businessDay: "2026-01-05",
      startAt: "2026-01-05T04:00:00.000Z",
      endAt: "2026-01-06T04:00:00.000Z",
      nextDueAt: "2026-01-06T04:00:00.000Z",
      dirtyRevision: 1,
      evaluatedRevision: 1,
    });
    await installChangeFeed(
      suite.db,
      WORKFORCE_CHANGE_SOURCES.filter((source) => source.table === "time_entries"),
    );
    const { attendanceJob } = await import("./attendance-loop.js");
    const asleep = gate();
    const runner = createJobRunner({
      now: () => now,
      log: () => {},
      delay: async (ms, signal) => {
        asleep.release();
        await realSleep(ms, signal);
      },
    });
    runner.add(attendanceJob({ ...deps(), maxSleepMs: 60_000 }));
    try {
      await asleep.promise;
      await withTransaction(suite.db, async (tx) => {
        await backend.clockIn(tx, {
          nodeId,
          personId,
          at: "2026-01-05T09:00:00Z",
          offsetMinutes: 60,
          origin: jobOrigin("dashboard"),
        });
        await backend.clockOut(tx, {
          nodeId,
          personId,
          at: "2026-01-05T17:00:00Z",
          offsetMinutes: 60,
          origin: jobOrigin("dashboard"),
        });
      });
      await vi.waitFor(
        async () => {
          const [day] = await suite.db.select().from(attendanceDays);
          expect(day!.dirtyRevision).toBe(3);
          expect(day!.evaluatedRevision).toBe(3);
        },
        { timeout: 2_000 },
      );
    } finally {
      await runner.stopJobs();
    }
    expect((await snapshot()).entries.map((entry) => entry.entryKind)).toEqual(["in", "out"]);
  });
});
