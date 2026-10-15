import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  attendanceDayWork,
  attendanceQuestions,
  attendanceSourceState,
  readChain,
  rosterVersions,
  shifts,
  timeEntries,
  verifyChain,
} from "@waitron/workforce";
import { beginAttendanceDiscovery, discoverAttendanceDays } from "./attendance-discovery.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { realSleep } from "./loop.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const backend = new WorkforceBackend();
let locationId: string, nodeId: string, personId: string, primary: boolean;
const now = new Date("2026-01-07T09:00:00Z");
const deps = () => ({ db: suite.db, locationId, nodeId, now: () => now, isPrimary: () => primary });
beforeEach(async () => {
  primary = true;
  await suite.db.execute(sql`drop trigger if exists reject_question`);
  await seedTenant(suite.db);
  const [place] = await suite.db
    .insert(locations)
    .values({
      name: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    })
    .returning();
  locationId = place!.id;
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Worker", pinHash: "scrypt$00$00" })
    .returning();
  personId = person!.id;
});
async function seed() {
  await withTransaction(suite.db, async (tx) => {
    await backend.clockIn(tx, {
      nodeId,
      locationId,
      personId,
      at: "2026-01-05T09:00:00Z",
      offsetMinutes: 60,
      origin: jobOrigin("dashboard"),
    });
    await recordAttendanceFact(tx, {
      source: "order",
      key: "last-order",
      locationId,
      personId,
      kind: "order",
      at: "2026-01-05T16:40:00Z",
      offsetMinutes: 60,
      outcome: "qualified",
    });
    await beginAttendanceDiscovery(tx, { locationId, generation: "opened" });
  });
}
async function prime() {
  for (let i = 0; i < 20; i++)
    if (
      !(
        await withTransaction(suite.db, (tx) =>
          discoverAttendanceDays(tx, { locationId, now, batchSize: 100 }),
        )
      ).more
    )
      return;
  throw new Error("bootstrap exceeded bounded fixture batches");
}
async function snapshot() {
  return {
    entries: await suite.db.select().from(timeEntries),
    work: await suite.db.select().from(attendanceDayWork),
    questions: await suite.db.select().from(attendanceQuestions),
    sources: await suite.db.select().from(attendanceSourceState),
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
  it("retains overnight deferred work until its end without another source change", async () => {
    const [version] = await suite.db
      .insert(rosterVersions)
      .values({
        locationId,
        periodStart: "2026-01-05",
        periodEnd: "2026-01-11",
        status: "published",
        publishedAt: "2026-01-01T09:00:00.000Z",
      })
      .returning();
    const [shift] = await suite.db
      .insert(shifts)
      .values({
        locationId,
        personId,
        startsAt: "2026-01-06T01:00:00.000Z",
        endsAt: "2026-01-06T05:00:00.000Z",
        startsOffsetMinutes: 60,
        endsOffsetMinutes: 60,
        rosterVersionId: version!.id,
      })
      .returning();
    await prime();
    const { runAttendancePass } = await import("./attendance-loop.js");
    const early = new Date("2026-01-06T04:00:00Z");
    expect(await runAttendancePass({ ...deps(), now: () => early })).toEqual({
      processed: true,
      more: false,
    });
    expect((await snapshot()).questions).toEqual([]);
    expect((await snapshot()).work).toMatchObject([
      { deferredShiftIds: [shift!.id], nextDueAt: "2026-01-06T05:00:00.000Z" },
    ]);
    const late = new Date("2026-01-06T05:00:00Z");
    expect(await runAttendancePass({ ...deps(), now: () => late })).toEqual({
      processed: true,
      more: false,
    });
    expect((await snapshot()).questions).toMatchObject([
      { shiftKey: `rota:${shift!.id}`, missingKinds: ["in", "out"] },
    ]);
    expect((await snapshot()).work).toMatchObject([{ deferredShiftIds: [] }]);
  });
  it("appends on this node while preserving an older node's open entry and chain", async () => {
    const oldNode = await seedNode(suite.db, brandLocationId(locationId));
    await withTransaction(suite.db, (tx) =>
      backend.clockIn(tx, {
        nodeId: oldNode,
        locationId,
        personId,
        at: "2026-01-05T09:00:00Z",
        offsetMinutes: 60,
        origin: jobOrigin("dashboard"),
      }),
    );
    const before = await readChain(suite.db, { nodeId: oldNode, locationId });
    await withTransaction(suite.db, (tx) =>
      recordAttendanceFact(tx, {
        source: "order",
        key: "last",
        locationId,
        personId,
        kind: "order",
        at: "2026-01-05T16:40:00Z",
        offsetMinutes: 60,
        outcome: "qualified",
      }),
    );
    await settle();
    expect(await readChain(suite.db, { nodeId: oldNode, locationId })).toEqual(before);
    expect((await snapshot()).entries.filter((e) => e.entryKind === "out")).toMatchObject([
      { nodeId, eventAt: "2026-01-05T16:40:00.000Z" },
    ]);
    expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
  });
  it("bootstraps before closing and replays a committed day without another end", async () => {
    await seed();
    expect(await pass()).toEqual({ processed: false, more: true });
    expect((await snapshot()).entries.map((e) => e.entryKind)).toEqual(["in"]);
    expect((await snapshot()).sources.some((s) => s.cursor !== null && s.cursor > 0)).toBe(true);
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
    expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
  });
  it("processes at most one completed day per pass and catches up later", async () => {
    await seed();
    await withTransaction(suite.db, (tx) =>
      recordAttendanceFact(tx, {
        source: "draft",
        key: "next-day",
        locationId,
        personId,
        kind: "order",
        at: "2026-01-06T16:00:00Z",
        offsetMinutes: 60,
        outcome: "qualified",
      }),
    );
    await prime();
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
    await prime();
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
    await prime();
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

describe("attendance loop lifecycle", () => {
  it("reports a failed sleep and keeps the duty alive for the next tick", async () => {
    const abort = new AbortController();
    const failure = new Error("timer refused");
    const errors: unknown[] = [];
    let sleeps = 0;
    const { runAttendanceLoop } = await import("./attendance-loop.js");
    await runAttendanceLoop({
      ...deps(),
      signal: abort.signal,
      onError: (e) => {
        errors.push(e);
      },
      sleep: async () => {
        if (++sleeps === 1) throw failure;
        abort.abort();
      },
    });
    expect(errors).toEqual([failure]);
    expect(sleeps).toBe(2);
  });
  it("uses short continuation ticks and an idle tick after durable work settles", async () => {
    await seed();
    const abort = new AbortController();
    const ticks: number[] = [];
    const { runAttendanceLoop } = await import("./attendance-loop.js");
    await runAttendanceLoop({
      ...deps(),
      signal: abort.signal,
      onError: (e) => {
        throw e;
      },
      sleep: async (ms) => {
        ticks.push(ms);
        if (ms === 30_000 || ticks.length > 20) abort.abort();
      },
    });
    expect(ticks).toContain(500);
    expect(ticks.at(-1)).toBe(30_000);
    expect((await snapshot()).entries.map((e) => e.entryKind)).toEqual(["in", "out"]);
  });
  it("reports a failed pass and retries on the short tick without losing the day", async () => {
    await seed();
    await prime();
    await suite.db.execute(
      sql`create trigger reject_question before insert on attendance_questions begin select raise(abort, 'question refused'); end`,
    );
    const abort = new AbortController();
    const errors: unknown[] = [];
    const ticks: number[] = [];
    const { runAttendanceLoop } = await import("./attendance-loop.js");
    await runAttendanceLoop({
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
    expect(ticks[0]).toBe(500);
    expect((await snapshot()).entries.map((e) => e.entryKind)).toEqual(["in", "out"]);
  });
  it("an already aborted loop makes no pass or writes", async () => {
    await seed();
    const before = await snapshot();
    const abort = new AbortController();
    abort.abort();
    const { runAttendanceLoop } = await import("./attendance-loop.js");
    await runAttendanceLoop({
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
    const { runAttendanceLoop } = await import("./attendance-loop.js");
    let finished = false;
    const done = runAttendanceLoop({
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
    await prime();
    const entered = gate(),
      held = gate(),
      queued = gate();
    const { runAttendanceLoop } = await import("./attendance-loop.js");
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
      done = runAttendanceLoop({
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
