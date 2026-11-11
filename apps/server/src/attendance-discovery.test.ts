import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedBusinessDay } from "@waitron/db/testing/seed.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatementSync } from "node:sqlite";
import { asc, eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  installChangeFeed,
  removeChangeFeed,
  appendOrderAmendment,
  dayCutoverChanges,
  newId,
  parties,
  orderDrafts,
  orderDraftEvents,
  orderGroupEvents,
  billPayments,
  workingOrders,
  withTransaction,
  type Transaction,
  venueLocationId,
} from "@waitron/db";
import { seedDevice, seedNode, seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons, sessions, hashSessionToken } from "@waitron/identity";
import { jobOrigin } from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  attendanceDayWork,
  attendanceSourceState,
  rosterVersions,
  shifts,
  timeEntries,
} from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const backend = new WorkforceBackend();
let locationId: string, personId: string, nodeId: string, deviceId: string;
const now = new Date("2026-01-09T12:00:00Z");
const scope = () => ({ locationId, now, batchSize: 2 });
const event = (at: string) => ({
  personId,
  nodeId,
  at,
  offsetMinutes: 60,
  origin: jobOrigin("dashboard"),
});
async function begin(generation = "open-one") {
  const { beginAttendanceDiscovery } = await import("./attendance-discovery.js");
  return run((tx) => beginAttendanceDiscovery(tx, { generation }));
}
async function pass(batchSize = 2) {
  const { discoverAttendanceDays } = await import("./attendance-discovery.js");
  return run((tx) => discoverAttendanceDays(tx, { ...scope(), batchSize }));
}
async function next(at = now) {
  const { nextAttendanceDay } = await import("./attendance-discovery.js");
  return run((tx) => nextAttendanceDay(tx, { now: at }));
}
async function drain(batchSize = 2) {
  for (let i = 0; i < 100; i++) if (!(await pass(batchSize)).more) return;
  throw new Error("discovery did not finish bounded batches");
}
async function signIn(at: string, placeDevice = deviceId) {
  const id = newId();
  await suite.db
    .insert(sessions)
    .values({ id, personId, deviceId: placeDevice, tokenHash: hashSessionToken(id), openedAt: at });
  return id;
}
async function rows() {
  return suite.db.select().from(attendanceDayWork).orderBy(asc(attendanceDayWork.businessDay));
}
async function evaluate() {
  for (const work of await rows())
    await suite.db
      .update(attendanceDayWork)
      .set({ evaluatedRevision: work.dirtyRevision })
      .where(eq(attendanceDayWork.id, work.id));
}
beforeEach(async () => {
  await seedVenue(suite.db, {
    name: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "04:00",
    invoiceLocales: ["es"],
    operationDescription: "Restaurant",
  });
  locationId = await venueLocationId(suite.db);
  nodeId = await seedNode(suite.db);
  deviceId = (await seedDevice(suite.db)).deviceId;
  const [person] = await seedPersons(suite.db, {
    displayName: "Anna",
    pinHash: "scrypt$00$00",
    role: "admin",
  });
  personId = person!.id;
});

describe("durable attendance discovery", () => {
  it("discovers the venue's day without being told a location", async () => {
    await signIn("2026-01-05T12:00:00Z");
    const { beginAttendanceDiscovery, discoverAttendanceDays, nextAttendanceDay } =
      await import("./attendance-discovery.js");
    await run((tx) => beginAttendanceDiscovery(tx, { generation: "venue-only" }));
    for (let i = 0; i < 100; i++)
      if (!(await run((tx) => discoverAttendanceDays(tx, { now, batchSize: 2 }))).more) break;
    expect(await run((tx) => nextAttendanceDay(tx, { now }))).toEqual({
      businessDay: "2026-01-05",
      startAt: "2026-01-05T03:00:00.000Z",
      endAt: "2026-01-06T03:00:00.000Z",
    });
  });
  it("keeps the day unavailable until the captured last source page is committed", async () => {
    await signIn("2026-01-05T08:00:00Z");
    await signIn("2026-01-05T12:00:00Z");
    await signIn("2026-01-05T17:00:00Z");
    await begin();
    expect(await next()).toBeNull();
    expect(await pass()).toEqual({ more: true });
    expect(await next()).toBeNull();
    const [scan] = await suite.db
      .select()
      .from(attendanceSourceState)
      .where(eq(attendanceSourceState.recordKind, "scan"));
    expect(scan).toMatchObject({ generation: "open-one" });
    await drain();
    expect(await next()).toEqual({
      businessDay: "2026-01-05",
      startAt: "2026-01-05T03:00:00.000Z",
      endAt: "2026-01-06T03:00:00.000Z",
    });
    expect(await suite.db.select().from(timeEntries)).toEqual([]);
  });
  it.each([
    ["2026-03-29T01:30:00Z", "2026-03-28", "2026-03-28T03:00:00.000Z", "2026-03-29T02:00:00.000Z"],
    ["2026-10-25T01:30:00Z", "2026-10-24", "2026-10-24T02:00:00.000Z", "2026-10-25T03:00:00.000Z"],
  ])("saves historical Madrid DST bounds for %s", async (at, businessDay, startAt, endAt) => {
    await signIn(at);
    await begin();
    await drain();
    expect(await next(new Date(endAt))).toEqual({ businessDay, startAt, endAt });
    expect(await next(new Date(Date.parse(endAt) - 1))).toBeNull();
  });
  it("uses cutover history, exact boundaries and oldest-first catchup without creating empty days", async () => {
    await suite.db
      .insert(dayCutoverChanges)
      .values({ effectiveBusinessDay: "2026-01-07", dayCutover: "06:00:00" });
    for (const at of ["2026-01-05T03:00:00Z", "2026-01-06T03:00:00Z", "2026-01-07T05:00:00Z"])
      await signIn(at);
    await begin();
    await drain();
    expect((await rows()).map((r) => [r.businessDay, r.startAt, r.endAt])).toEqual([
      ["2026-01-05", "2026-01-05T03:00:00.000Z", "2026-01-06T03:00:00.000Z"],
      ["2026-01-06", "2026-01-06T03:00:00.000Z", "2026-01-07T05:00:00.000Z"],
      ["2026-01-07", "2026-01-07T05:00:00.000Z", "2026-01-08T05:00:00.000Z"],
    ]);
    expect((await next())?.businessDay).toBe("2026-01-05");
    expect(await next(new Date("2026-01-05T02:59:59Z"))).toBeNull();
  });
  it("finds an old instant inserted after a newer row and a row inserted between bootstrap pages", async () => {
    await signIn("2026-01-06T12:00:00Z");
    await signIn("2026-01-07T12:00:00Z");
    await begin();
    await pass(1);
    await signIn("2026-01-05T17:00:00Z");
    await drain();
    expect((await rows()).map((r) => r.businessDay)).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ]);
    await evaluate();
    await signIn("2026-01-05T19:00:00Z");
    await drain();
    expect(
      (await rows())
        .filter((r) => r.dirtyRevision !== r.evaluatedRevision)
        .map((r) => r.businessDay),
    ).toEqual(["2026-01-05"]);
  });
  it("restarts at new rowid endpoints after VACUUM without dirtying unchanged evaluated days", async () => {
    await signIn("2026-01-05T12:00:00Z");
    await begin();
    await drain();
    await evaluate();
    const before = await rows();
    await suite.db.execute(sql`vacuum`);
    await begin("open-two");
    expect(await next()).toBeNull();
    await drain();
    expect(await rows()).toEqual(before);
    expect(await next()).toBeNull();
    const scans = await suite.db
      .select()
      .from(attendanceSourceState)
      .where(eq(attendanceSourceState.recordKind, "scan"));
    expect(
      scans.every((s) => s.generation === "open-two" && s.completed && s.cursor === s.endpoint),
    ).toBe(true);
  });
  it("keeps completed discovery across an ordinary restart and reads only new source rows", async () => {
    await signIn("2026-01-05T12:00:00Z");
    await begin();
    await drain();
    const scans = await suite.db.select().from(attendanceSourceState);
    await signIn("2026-01-06T17:00:00Z");
    const original = StatementSync.prototype.all;
    const returned: string[] = [];
    const spy = vi.spyOn(StatementSync.prototype, "all").mockImplementation(function (
      this: StatementSync,
      ...args
    ) {
      const result = Reflect.apply(original, this, args) as ReturnType<typeof original>;
      if (/from sessions e /i.test(this.sourceSQL))
        returned.push(...(result as { at: string }[]).map((row) => row.at));
      return result;
    });
    try {
      await begin("ordinary-restart");
      expect(await suite.db.select().from(attendanceSourceState)).toEqual(scans);
      await drain();
    } finally {
      spy.mockRestore();
    }
    expect(returned).toEqual(["2026-01-06T17:00:00Z"]);
    expect((await rows()).map((row) => row.businessDay)).toEqual(["2026-01-05", "2026-01-06"]);
  });

  it("resumes a partially committed bootstrap on restart and still waits for its last page", async () => {
    await signIn("2026-01-05T08:00:00Z");
    await signIn("2026-01-05T12:00:00Z");
    await signIn("2026-01-05T17:00:00Z");
    await begin();
    await pass(1);
    const scans = await suite.db.select().from(attendanceSourceState);
    await begin("interrupted-restart");
    expect(await suite.db.select().from(attendanceSourceState)).toEqual(scans);
    expect(await next()).toBeNull();
    await drain(1);
    expect((await next())?.businessDay).toBe("2026-01-05");
    const sessionScan = (await suite.db.select().from(attendanceSourceState)).find(
      (row) => row.recordKind === "scan" && row.source === "session",
    );
    expect(sessionScan).toMatchObject({
      generation: "open-one",
      cursor: 3,
      endpoint: 3,
      completed: true,
    });
  });

  it("rescans a changed layout after VACUUM before reading inserts below the old cursor", async () => {
    await signIn("2026-01-05T12:00:00Z");
    await suite.db.execute(sql`update sessions set rowid = 100`);
    await begin();
    await drain();
    await evaluate();
    const before = await rows();
    await suite.db.execute(sql`vacuum`);
    await suite.db.execute(sql`update sessions set rowid = 1`);
    await signIn("2026-01-06T17:00:00Z");
    await begin("after-vacuum");
    expect(await next()).toBeNull();
    await drain();
    expect((await rows())[0]).toEqual(before[0]);
    expect((await rows()).map((row) => row.businessDay)).toEqual(["2026-01-05", "2026-01-06"]);
    const scan = (await suite.db.select().from(attendanceSourceState)).find(
      (row) => row.recordKind === "scan" && row.source === "session",
    );
    expect(scan).toMatchObject({
      generation: "after-vacuum",
      cursor: 2,
      endpoint: 2,
      completed: true,
    });
  });

  it("rescans when the saved physical identity is missing and then retains the completed scan", async () => {
    await signIn("2026-01-05T12:00:00Z");
    await begin();
    await drain();
    const saved = (await suite.db.select().from(attendanceSourceState)).find(
      (row) => row.recordKind === "scan" && row.source === "rota" && row.key === "shifts",
    )!;
    const { clock } = JSON.parse(saved.fingerprint!) as { clock: unknown };
    await suite.db
      .update(attendanceSourceState)
      .set({ fingerprint: JSON.stringify({ clock }) })
      .where(eq(attendanceSourceState.id, saved.id));
    await begin("without-identity");
    expect(await next()).toBeNull();
    await drain();
    const scans = await suite.db.select().from(attendanceSourceState);
    expect(
      scans
        .filter((row) => row.recordKind === "scan")
        .every((row) => row.generation === "without-identity"),
    ).toBe(true);
    await begin("ordinary-restart");
    expect(await suite.db.select().from(attendanceSourceState)).toEqual(scans);
    expect((await next())?.businessDay).toBe("2026-01-05");
  });

  it("retains the database identity while a changed business-day clock rescans future shifts", async () => {
    const version = newId();
    await suite.db.insert(rosterVersions).values({
      id: version,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
      status: "published",
      publishedAt: "2026-01-04T12:00:00Z",
    });
    for (const day of ["10", "11", "12"])
      await suite.db.insert(shifts).values({
        personId,
        rosterVersionId: version,
        startsAt: `2026-01-${day}T08:00:00.000Z`,
        endsAt: `2026-01-${day}T17:00:00.000Z`,
        startsOffsetMinutes: 60,
        endsOffsetMinutes: 60,
      });
    await begin();
    await drain();
    await suite.db.insert(dayCutoverChanges).values({
      effectiveBusinessDay: "2026-01-11",
      dayCutover: "06:00:00",
    });
    await pass(1);
    const partial = await suite.db.select().from(attendanceSourceState);
    expect(partial.find((row) => row.source === "rota" && row.key === "shifts")).toMatchObject({
      cursor: 1,
      completed: false,
    });
    await begin("during-clock-rescan");
    expect(await suite.db.select().from(attendanceSourceState)).toEqual(partial);
    await drain();
    const completed = await suite.db.select().from(attendanceSourceState);
    await begin("after-clock-rescan");
    expect(await suite.db.select().from(attendanceSourceState)).toEqual(completed);
    expect((await rows()).map((row) => row.businessDay)).toEqual([
      "2026-01-10",
      "2026-01-11",
      "2026-01-12",
    ]);
  });

  it.each(["db", "workforce"])(
    "rescans after the %s migration version changes during boot",
    async (changed) => {
      const { beginAttendanceDiscovery } = await import("./attendance-discovery.js");
      await signIn("2026-01-05T12:00:00Z");
      const migrationVersions = { db: 1, workforce: 1 };
      await run((tx) =>
        beginAttendanceDiscovery(tx, { generation: "before-migration", migrationVersions }),
      );
      await drain();
      await run((tx) =>
        beginAttendanceDiscovery(tx, {
          generation: "unchanged-versions",
          migrationVersions: { workforce: 1, db: 1 },
        }),
      );
      expect((await next())?.businessDay).toBe("2026-01-05");
      const schemaVersionBeforeMigrations = suite.db.execute<{ schema_version: number }>(
        sql`pragma schema_version`,
      ).rows[0]!.schema_version;
      await run((tx) =>
        beginAttendanceDiscovery(tx, {
          generation: "after-migration",
          schemaVersionBeforeMigrations,
          migrationVersions: { ...migrationVersions, [changed]: 2 },
        }),
      );
      expect(await next()).toBeNull();
      await drain();
      expect(
        (await suite.db.select().from(attendanceSourceState))
          .filter((row) => row.recordKind === "scan")
          .every((row) => row.generation === "after-migration" && row.completed),
      ).toBe(true);
      expect((await next())?.businessDay).toBe("2026-01-05");
    },
  );

  it("records boot's rebuilt trigger cookie for the following restart", async () => {
    const { beginAttendanceDiscovery } = await import("./attendance-discovery.js");
    const sources = [{ table: "sessions", type: "session" }];
    await installChangeFeed(suite.db, sources);
    await signIn("2026-01-05T12:00:00Z");
    await begin();
    await drain();
    const before = await suite.db.select().from(attendanceSourceState);
    const schemaVersionBeforeMigrations = suite.db.execute<{ schema_version: number }>(
      sql`pragma schema_version`,
    ).rows[0]!.schema_version;
    removeChangeFeed(suite.db);
    await installChangeFeed(suite.db, sources);
    const current = suite.db.execute<{ schema_version: number }>(sql`pragma schema_version`)
      .rows[0]!.schema_version;
    expect(current).toBeGreaterThan(schemaVersionBeforeMigrations);
    await run((tx) =>
      beginAttendanceDiscovery(tx, {
        generation: "after-trigger-rebuild",
        schemaVersionBeforeMigrations,
      }),
    );
    const updated = await suite.db.select().from(attendanceSourceState);
    expect(updated.map((row) => [row.id, row.generation, row.cursor, row.completed])).toEqual(
      before.map((row) => [row.id, row.generation, row.cursor, row.completed]),
    );
    await begin("following-restart");
    expect(await suite.db.select().from(attendanceSourceState)).toEqual(updated);
    expect((await next())?.businessDay).toBe("2026-01-05");
  });

  it("rolls back a source page and its cursor together before resuming the same generation", async () => {
    await signIn("2026-01-05T12:00:00Z");
    await begin();
    const before = await suite.db.select().from(attendanceSourceState);
    const { discoverAttendanceDays } = await import("./attendance-discovery.js");
    await expect(
      run(async (tx) => {
        await discoverAttendanceDays(tx, scope());
        throw new Error("page interrupted");
      }),
    ).rejects.toThrow("page interrupted");
    expect(await rows()).toEqual([]);
    expect(await suite.db.select().from(attendanceSourceState)).toEqual(before);
    await drain();
    expect((await next())?.businessDay).toBe("2026-01-05");
  });
  it("discovers retained unpaid amendments, discarded drafts, group events and bill requests", async () => {
    const partyId = newId(),
      orderId = newId(),
      draftId = newId();
    await suite.db.insert(parties).values({ id: partyId, openedBy: personId });
    await seedWorkingOrder(suite.db, {
      id: orderId,
      source: "dashboard",
      nodeId,
      orderNumber: 1,
      partyId,
    });
    await run((tx) =>
      appendOrderAmendment(tx, {
        workingOrderId: orderId,
        kind: "order_placed",
        actorId: personId,
        reason: null,
        origin: jobOrigin("dashboard"),
        capturedByNodeId: nodeId,
        eventAt: new Date("2026-01-05T12:00:00Z"),
        eventOffsetMinutes: 60,
      }),
    );
    await suite.db
      .insert(orderDrafts)
      .values({ id: draftId, partyId, ownerId: personId, state: "discarded" });
    await suite.db.insert(orderDraftEvents).values({
      draftId,
      kind: "discarded",
      actorId: personId,
      fromPerson: personId,
      toPerson: personId,
      detail: {},
      createdAt: "2026-01-06T12:00:00Z",
    });
    await suite.db.insert(orderGroupEvents).values([
      {
        partyId,
        kind: "reordered",
        actorId: personId,
        detail: {},
        createdAt: "2026-01-07T12:00:00Z",
      },
      {
        partyId,
        kind: "reordered",
        actorDeviceId: deviceId,
        detail: {},
        createdAt: "2026-01-08T12:00:00Z",
      },
    ]);
    await suite.db.insert(billPayments).values({
      workingOrderId: orderId,
      submissionId: "one",
      fingerprint: "one",
      kind: "contribution",
      method: "card",
      applied: 100,
      state: "received",
      requestedBy: personId,
      source: "device",
      deviceId,
      createdAt: "2026-01-08T12:00:00Z",
      receivedAt: "2026-01-09T12:00:00Z",
    });
    await begin();
    await drain();
    expect((await rows()).map((r) => r.businessDay)).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
    ]);
  });
  it("discovers published shifts only and retained clock starts with sequence cursors", async () => {
    const version = newId();
    await suite.db.insert(rosterVersions).values({
      id: version,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
      status: "published",
      publishedAt: "2026-01-04T12:00:00Z",
    });
    await suite.db.insert(shifts).values([
      {
        personId,
        rosterVersionId: version,
        startsAt: "2026-01-05T08:00:00.000Z",
        endsAt: "2026-01-05T17:00:00.000Z",
        startsOffsetMinutes: 60,
        endsOffsetMinutes: 60,
      },
      {
        personId,
        startsAt: "2026-01-06T08:00:00.000Z",
        endsAt: "2026-01-06T17:00:00.000Z",
        startsOffsetMinutes: 60,
        endsOffsetMinutes: 60,
      },
    ]);
    await run((tx) => backend.clockIn(tx, event("2026-01-07T08:00:00Z")));
    await begin();
    await drain();
    expect((await rows()).map((r) => r.businessDay)).toEqual(["2026-01-05", "2026-01-07"]);
    const clocks = await suite.db
      .select()
      .from(attendanceSourceState)
      .where(eq(attendanceSourceState.source, "clock"));
    expect(clocks.find((s) => s.recordKind === "scan")).toMatchObject({
      key: nodeId,
      cursor: 1,
      endpoint: 1,
      completed: true,
    });
  });
  // Discovery reads every node's clock entries on each pass, and the table only grows.
  it("reads each node's clock entries by position", async () => {
    const { beginAttendanceDiscovery, discoverAttendanceDays } =
      await import("./attendance-discovery.js");
    await run((tx) => backend.clockIn(tx, event("2026-01-07T08:00:00Z")));
    const plans: string[][] = [];
    const planning = (tx: Transaction) =>
      new Proxy(tx, {
        get: (target, key, receiver) =>
          key === "execute"
            ? (query: ReturnType<typeof sql>) => {
                plans.push(
                  target
                    .execute<{ detail: string }>(sql`explain query plan ${query}`)
                    .rows.map((row) => row.detail),
                );
                return target.execute(query);
              }
            : Reflect.get(target, key, receiver),
      });
    await run((tx) => beginAttendanceDiscovery(planning(tx), { generation: "open-one" }));
    await run((tx) => discoverAttendanceDays(planning(tx), scope()));
    const clockPlans = plans.filter((plan) => plan.some((line) => /\btime_entries\b/.test(line)));
    expect(clockPlans).not.toEqual([]);
    for (const plan of clockPlans) {
      expect(plan.filter((line) => /^SCAN time_entries\b/.test(line))).toEqual([]);
      expect(plan.some((line) => line.includes("time_entries_chain_position_uq"))).toBe(true);
    }
  });

  it("reconciles the ended day of a shift begun on another node before clocking", async () => {
    const { reconcileAttendanceBeforeClock } = await import("./attendance-discovery.js");
    const otherNode = await seedNode(suite.db);
    await run((tx) => backend.clockIn(tx, { ...event("2026-01-05T08:00:00Z"), nodeId: otherNode }));
    expect(
      await run((tx) =>
        reconcileAttendanceBeforeClock(tx, { nodeId, personId }, new Date("2026-01-06T12:00:00Z")),
      ),
    ).toBeNull();
    expect((await rows()).map((r) => r.businessDay)).toEqual(["2026-01-05"]);
  });

  it("dirties original and retimed days for a late approved correction without changing time rows", async () => {
    await run((tx) => backend.clockIn(tx, event("2026-01-05T08:00:00Z")));
    await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z")));
    await begin();
    await drain();
    await evaluate();
    const [target] = await suite.db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.entryKind, "in"));
    const request = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: target!.id,
        at: "2026-01-04T23:00:00Z",
        offsetMinutes: 60,
        reason: "Earlier start",
        actorPersonId: personId,
        origin: jobOrigin("dashboard"),
      }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: personId }),
    );
    const entries = await suite.db.select().from(timeEntries);
    await drain();
    expect(
      (await rows())
        .filter((r) => r.dirtyRevision !== r.evaluatedRevision)
        .map((r) => r.businessDay),
    ).toEqual(["2026-01-04", "2026-01-05"]);
    expect(await suite.db.select().from(timeEntries)).toEqual(entries);
  });
  it("allows deferred evaluated work only at its saved due instant", async () => {
    await signIn("2026-01-05T12:00:00Z");
    await begin();
    await drain();
    const [work] = await rows();
    await suite.db
      .update(attendanceDayWork)
      .set({
        evaluatedRevision: work!.dirtyRevision,
        deferredShiftIds: ["overnight"],
        nextDueAt: "2026-01-06T05:00:00.000Z",
      })
      .where(eq(attendanceDayWork.id, work!.id));
    expect(await next(new Date("2026-01-06T04:59:59Z"))).toBeNull();
    expect((await next(new Date("2026-01-06T05:00:00Z")))?.businessDay).toBe("2026-01-05");
  });
  it("an unchanged idle pass materializes no clock history rows", async () => {
    await run(async (tx) => {
      for (let day = 0; day < 365 * 4; day++) {
        const date = new Date(Date.UTC(2022, 0, 1 + day)).toISOString().slice(0, 10);
        await backend.clockIn(tx, event(`${date}T08:00:00Z`));
        await backend.clockOut(tx, event(`${date}T17:00:00Z`));
      }
    });
    await begin();
    await drain(100);
    await evaluate();
    const all = StatementSync.prototype.all;
    const returned: number[] = [];
    const spy = vi.spyOn(StatementSync.prototype, "all").mockImplementation(function (
      this: StatementSync,
      ...args
    ) {
      const result = Reflect.apply(all, this, args) as ReturnType<typeof all>;
      if (/\btime_entries\b/i.test(this.sourceSQL) && !/\bmax\s*\(/i.test(this.sourceSQL))
        returned.push(result.length);
      return result;
    });
    try {
      expect(await pass()).toEqual({ more: false });
      expect(await next()).toBeNull();
    } finally {
      spy.mockRestore();
    }
    expect(returned.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("mutable attendance source watches", () => {
  async function bill(state: "pending" | "received") {
    const orderId = newId();
    await seedWorkingOrder(suite.db, { id: orderId, source: "dashboard", nodeId, orderNumber: 1 });
    const [payment] = await suite.db
      .insert(billPayments)
      .values({
        workingOrderId: orderId,
        submissionId: "watch",
        fingerprint: "watch",
        kind: "contribution",
        method: "card",
        applied: 100,
        state,
        requestedBy: personId,
        source: "device",
        deviceId,
        createdAt: "2026-01-05T12:00:00Z",
        receivedAt: state === "received" ? "2026-01-05T13:00:00Z" : null,
      })
      .returning();
    return payment!.id;
  }
  it("finds a pending bill's later received outcome at the original request day", async () => {
    const id = await bill("pending");
    await begin();
    await drain();
    expect(await rows()).toEqual([]);
    await suite.db
      .update(billPayments)
      .set({ state: "received", receivedAt: "2026-01-09T12:00:00Z" })
      .where(eq(billPayments.id, id));
    await pass();
    expect((await rows()).map((r) => r.businessDay)).toEqual(["2026-01-05"]);
    await evaluate();
    const before = await rows();
    await pass();
    expect(await rows()).toEqual(before);
  });
  it("discovers publication of a previously empty draft and its newly attached shift", async () => {
    const id = newId();
    await suite.db
      .insert(rosterVersions)
      .values({ id, periodStart: "2026-01-05", periodEnd: "2026-01-11" });
    await begin();
    await drain();
    expect(await rows()).toEqual([]);
    await suite.db.insert(shifts).values({
      personId,
      rosterVersionId: id,
      startsAt: "2026-01-05T08:00:00.000Z",
      endsAt: "2026-01-05T17:00:00.000Z",
      startsOffsetMinutes: 60,
      endsOffsetMinutes: 60,
    });
    await suite.db
      .update(rosterVersions)
      .set({ status: "published", publishedAt: "2026-01-09T12:00:00Z" })
      .where(eq(rosterVersions.id, id));
    await drain();
    expect((await rows()).map((r) => r.businessDay)).toEqual(["2026-01-05"]);
  });
  it("consumes accepted shift invalidation, preserving the old day after move or deletion", async () => {
    const version = newId(),
      shiftId = newId();
    await suite.db.insert(rosterVersions).values({
      id: version,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
      status: "published",
      publishedAt: "2026-01-04T12:00:00Z",
    });
    await suite.db.insert(shifts).values({
      id: shiftId,
      personId,
      rosterVersionId: version,
      startsAt: "2026-01-05T08:00:00.000Z",
      endsAt: "2026-01-05T17:00:00.000Z",
      startsOffsetMinutes: 60,
      endsOffsetMinutes: 60,
    });
    await begin();
    await drain();
    await evaluate();
    const { markAttendanceSourceChanged } = await import("./attendance-source-changes.js");
    await run(async (tx) => {
      await markAttendanceSourceChanged(tx, "shift", shiftId);
      await tx
        .update(shifts)
        .set({ startsAt: "2026-01-06T08:00:00.000Z", endsAt: "2026-01-06T17:00:00.000Z" })
        .where(eq(shifts.id, shiftId));
      await markAttendanceSourceChanged(tx, "shift", shiftId);
    });
    await drain();
    const [watch] = await suite.db
      .select()
      .from(attendanceSourceState)
      .where(eq(attendanceSourceState.key, `shift:${shiftId}`));
    expect(watch!.fingerprint).not.toBeNull();
    expect(
      (await rows())
        .filter((r) => r.dirtyRevision !== r.evaluatedRevision)
        .map((r) => r.businessDay),
    ).toEqual(["2026-01-05", "2026-01-06"]);
    await evaluate();
    await run(async (tx) => {
      await markAttendanceSourceChanged(tx, "shift", shiftId);
      await tx.delete(shifts).where(eq(shifts.id, shiftId));
      await markAttendanceSourceChanged(tx, "shift", shiftId);
    });
    await drain();
    const [deleted] = await suite.db
      .select()
      .from(attendanceSourceState)
      .where(eq(attendanceSourceState.key, `shift:${shiftId}`));
    expect(deleted).toMatchObject({ fingerprint: "deleted", nextDueAt: null, previousDays: [] });
  });
  it("rotates pending watches so the first unresolved bill does not starve a later outcome", async () => {
    const orderId = newId();
    await seedWorkingOrder(suite.db, { id: orderId, source: "dashboard", nodeId, orderNumber: 1 });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = newId();
      ids.push(id);
      await suite.db.insert(billPayments).values({
        id,
        workingOrderId: orderId,
        submissionId: `watch-${i}`,
        fingerprint: `watch-${i}`,
        kind: "contribution",
        method: "card",
        applied: 100,
        state: "pending",
        requestedBy: personId,
        source: "device",
        deviceId,
        createdAt: "2026-01-05T12:00:00Z",
      });
    }
    await begin();
    await drain();
    for (let i = 0; i < ids.length; i++) {
      const [watch] = await suite.db
        .select()
        .from(attendanceSourceState)
        .where(eq(attendanceSourceState.key, ids[i]!));
      await suite.db
        .update(attendanceSourceState)
        .set({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` })
        .where(eq(attendanceSourceState.id, watch!.id));
    }
    await suite.db
      .update(billPayments)
      .set({ state: "received", receivedAt: "2026-01-09T12:00:00Z" })
      .where(eq(billPayments.id, ids[4]!));
    for (let i = 0; i < 5 && (await rows()).length === 0; i++) await pass(1);
    expect((await rows()).map((r) => r.businessDay)).toEqual(["2026-01-05"]);
  });
});

it("refreshes unprocessed future bounds after a scheduled cutover change", async () => {
  await signIn("2026-01-10T12:00:00Z");
  await begin();
  await drain();
  await suite.db
    .insert(dayCutoverChanges)
    .values({ effectiveBusinessDay: "2026-01-11", dayCutover: "06:00:00" });
  expect(await next(new Date("2026-01-10T20:00:00Z"))).toBeNull();
  const [work] = await rows();
  expect(work).toMatchObject({
    businessDay: "2026-01-10",
    endAt: "2026-01-11T05:00:00.000Z",
    nextDueAt: "2026-01-11T05:00:00.000Z",
  });
  expect(await next(new Date("2026-01-11T03:00:00Z"))).toBeNull();
  expect((await next(new Date("2026-01-11T05:00:00Z")))?.businessDay).toBe("2026-01-10");
});
it.each([
  {
    cutover: "06:00:00",
    now: "2026-01-11T03:00:00Z",
    endAt: "2026-01-11T05:00:00.000Z",
    due: false,
  },
  {
    cutover: "06:00:00",
    now: "2026-01-11T06:00:00Z",
    endAt: "2026-01-11T05:00:00.000Z",
    due: true,
  },
  {
    cutover: "02:00:00",
    now: "2026-01-11T01:00:00Z",
    endAt: "2026-01-11T01:00:00.000Z",
    due: true,
  },
])(
  "refreshes an unevaluated day when resuming at $now after moving cutover to $cutover",
  async ({ cutover, now: instant, endAt, due }) => {
    await signIn("2026-01-10T12:00:00Z");
    await begin();
    await drain();
    const [before] = await rows();
    await suite.db
      .insert(dayCutoverChanges)
      .values({ effectiveBusinessDay: "2026-01-11", dayCutover: cutover });
    const answer = next(new Date(instant));
    await expect(answer).resolves.toEqual(
      due ? { businessDay: "2026-01-10", startAt: "2026-01-10T03:00:00.000Z", endAt } : null,
    );
    expect(await rows()).toEqual([{ ...before, endAt, nextDueAt: endAt }]);
  },
);
it("refuses a changed historical bound rather than relabeling an evaluated day", async () => {
  await signIn("2026-01-05T12:00:00Z");
  await begin();
  await drain();
  await evaluate();
  const [work] = await rows();
  await suite.db
    .update(attendanceDayWork)
    .set({ dirtyRevision: work!.dirtyRevision + 1 })
    .where(eq(attendanceDayWork.id, work!.id));
  const before = await rows();
  await seedBusinessDay(suite.db, { dayCutover: "06:00" });
  await expect(next()).rejects.toMatchObject({ code: "attendance.invalid" });
  expect(await rows()).toEqual(before);
});
it("new same-day sources stay unavailable while the new endpoint page is outstanding", async () => {
  await signIn("2026-01-05T12:00:00Z");
  await begin();
  await drain();
  await signIn("2026-01-05T16:00:00Z");
  await signIn("2026-01-05T18:00:00Z");
  expect(await pass(1)).toEqual({ more: true });
  expect(await next()).toBeNull();
  await drain();
  expect((await next())?.businessDay).toBe("2026-01-05");
});
it("does not dirty any day for a device-only party event without a bill payment", async () => {
  const partyId = newId(),
    orderId = newId();
  await suite.db.insert(parties).values({ id: partyId, openedBy: personId });
  await seedWorkingOrder(suite.db, {
    id: orderId,
    partyId,
    source: "dashboard",
    nodeId,
    orderNumber: 1,
  });
  await suite.db.insert(orderGroupEvents).values({
    partyId,
    kind: "reordered",
    actorDeviceId: deviceId,
    detail: {},
    createdAt: "2026-01-05T12:00:00Z",
  });
  await begin();
  await drain();
  expect(await rows()).toEqual([]);
});

it("qualifies a captured pending bill at its saved instant when the retained outcome arrives", async () => {
  const orderId = newId(),
    paymentId = newId();
  await seedWorkingOrder(suite.db, { id: orderId, source: "dashboard", orderNumber: 1 });
  await suite.db.insert(billPayments).values({
    id: paymentId,
    workingOrderId: orderId,
    submissionId: "captured",
    fingerprint: "captured",
    kind: "contribution",
    method: "card",
    applied: 100,
    state: "pending",
    requestedBy: personId,
    source: "device",
    deviceId,
    createdAt: "2026-01-06T12:00:00Z",
  });
  await run((tx) =>
    recordAttendanceFact(tx, {
      source: "bill-payment",
      key: paymentId,
      personId,
      kind: "payment",
      at: "2026-01-05T11:00:00Z",
      offsetMinutes: 60,
      outcome: "pending",
    }),
  );
  await begin();
  await drain();
  await evaluate();
  await suite.db
    .update(billPayments)
    .set({ state: "received", receivedAt: "2026-01-09T12:00:00Z" })
    .where(eq(billPayments.id, paymentId));
  await pass();
  const { attendanceOperationFacts } = await import("@waitron/workforce");
  const [fact] = await suite.db.select().from(attendanceOperationFacts);
  expect(fact).toMatchObject({ outcome: "qualifying", at: "2026-01-05T11:00:00.000Z" });
  expect(
    (await rows()).filter((r) => r.dirtyRevision !== r.evaluatedRevision).map((r) => r.businessDay),
  ).toEqual(["2026-01-05"]);
});

it("does not mark a day for draft or group events whose party has no order", async () => {
  const partyId = newId(),
    draftId = newId();
  await suite.db.insert(parties).values({ id: partyId, openedBy: personId });
  await suite.db
    .insert(orderDrafts)
    .values({ id: draftId, partyId, ownerId: personId, state: "discarded" });
  await suite.db.insert(orderDraftEvents).values({
    draftId,
    kind: "discarded",
    actorId: personId,
    fromPerson: personId,
    toPerson: personId,
    detail: {},
    createdAt: "2026-01-06T12:00:00Z",
  });
  await suite.db.insert(orderGroupEvents).values({
    partyId,
    kind: "reordered",
    actorId: personId,
    detail: {},
    createdAt: "2026-01-07T12:00:00Z",
  });
  await begin();
  await drain();
  expect(await rows()).toEqual([]);
});

it("a captured event still marks its day after its party loses every order", async () => {
  const partyId = newId(),
    otherParty = newId(),
    orderId = newId(),
    draftId = newId(),
    eventId = newId();
  await suite.db.insert(parties).values([
    { id: partyId, openedBy: personId },
    { id: otherParty, openedBy: personId },
  ]);
  await seedWorkingOrder(suite.db, {
    id: orderId,
    source: "dashboard",
    nodeId,
    orderNumber: 1,
    partyId,
  });
  await suite.db
    .insert(orderDrafts)
    .values({ id: draftId, partyId, ownerId: personId, state: "discarded" });
  await suite.db.insert(orderDraftEvents).values({
    id: eventId,
    draftId,
    kind: "discarded",
    actorId: personId,
    fromPerson: personId,
    toPerson: personId,
    detail: {},
    createdAt: "2026-01-06T12:00:00Z",
  });
  await run((tx) =>
    recordAttendanceFact(tx, {
      source: "draft",
      key: `event:${eventId}`,
      personId,
      kind: "order",
      at: "2026-01-06T12:00:00Z",
      offsetMinutes: 60,
      outcome: "qualified",
    }),
  );
  await suite.db
    .update(workingOrders)
    .set({ partyId: otherParty })
    .where(eq(workingOrders.id, orderId));
  await evaluate();
  await begin();
  await drain();
  expect(
    (await rows()).filter((r) => r.dirtyRevision !== r.evaluatedRevision).map((r) => r.businessDay),
  ).toEqual(["2026-01-06"]);
  const [watch] = await suite.db
    .select()
    .from(attendanceSourceState)
    .where(eq(attendanceSourceState.key, `event:${eventId}`));
  expect(watch).toMatchObject({
    source: "draft",
    recordKind: "watch",
    previousDays: ["2026-01-06"],
  });
});

it("reassigns a future published shift to its new start-day after a scheduled cutover changes", async () => {
  const version = newId();
  await suite.db.insert(rosterVersions).values({
    id: version,
    periodStart: "2026-01-05",
    periodEnd: "2026-01-11",
    status: "published",
    publishedAt: "2026-01-04T12:00:00Z",
  });
  await suite.db.insert(shifts).values({
    personId,
    rosterVersionId: version,
    startsAt: "2026-01-11T04:00:00.000Z",
    endsAt: "2026-01-11T10:00:00.000Z",
    startsOffsetMinutes: 60,
    endsOffsetMinutes: 60,
  });
  await begin();
  await drain();
  expect((await rows()).map((r) => r.businessDay)).toEqual(["2026-01-11"]);
  await suite.db
    .insert(dayCutoverChanges)
    .values({ effectiveBusinessDay: "2026-01-11", dayCutover: "06:00:00" });
  await drain();
  expect((await rows()).map((r) => r.businessDay)).toEqual(["2026-01-10", "2026-01-11"]);
  expect((await next(new Date("2026-01-11T05:00:00Z")))?.businessDay).toBe("2026-01-10");
});
