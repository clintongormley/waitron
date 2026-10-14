import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatementSync } from "node:sqlite";
import { asc, eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  appendOrderAmendment,
  devices,
  locations,
  locationDayCutoverChanges,
  newId,
  parties,
  orderDrafts,
  orderDraftEvents,
  orderGroupEvents,
  billPayments,
  workingOrders,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons, sessions, hashSessionToken } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
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
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const backend = new WorkforceBackend();
let locationId: string, otherLocation: string, personId: string, nodeId: string, deviceId: string;
const now = new Date("2026-01-09T12:00:00Z");
const scope = () => ({ locationId, now, batchSize: 2 });
const event = (at: string) => ({
  personId,
  locationId,
  nodeId,
  at,
  offsetMinutes: 60,
  origin: jobOrigin("dashboard"),
});
async function begin(generation = "open-one") {
  const { beginAttendanceDiscovery } = await import("./attendance-discovery.js");
  return run((tx) => beginAttendanceDiscovery(tx, { locationId, generation }));
}
async function pass(batchSize = 2) {
  const { discoverAttendanceDays } = await import("./attendance-discovery.js");
  return run((tx) => discoverAttendanceDays(tx, { ...scope(), batchSize }));
}
async function next(at = now) {
  const { nextAttendanceDay } = await import("./attendance-discovery.js");
  return run((tx) => nextAttendanceDay(tx, { locationId, now: at }));
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
  await seedTenant(suite.db);
  const places = await suite.db
    .insert(locations)
    .values([
      {
        name: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "04:00",
        invoiceLocales: ["es"],
        operationDescription: "Restaurant",
      },
      {
        name: "Other",
        timeZone: "UTC",
        dayCutover: "04:00",
        invoiceLocales: ["en"],
        operationDescription: "Restaurant",
      },
    ])
    .returning({ id: locations.id });
  [locationId, otherLocation] = places.map((r) => r.id) as [string, string];
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  deviceId = (await seedDevice(suite.db, { locationId: brandLocationId(locationId) })).deviceId;
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Ana", pinHash: "scrypt$00$00", role: "admin" })
    .returning({ id: persons.id });
  personId = person!.id;
});

describe("durable attendance discovery", () => {
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
      locationId,
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
    expect(await next(new Date(endAt))).toEqual({ locationId, businessDay, startAt, endAt });
    expect(await next(new Date(Date.parse(endAt) - 1))).toBeNull();
  });
  it("uses cutover history, exact boundaries and oldest-first catchup without creating empty days", async () => {
    await suite.db
      .insert(locationDayCutoverChanges)
      .values({ locationId, effectiveBusinessDay: "2026-01-07", dayCutover: "06:00:00" });
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
  it("uses captured location instead of a session's moved device and ignores another location", async () => {
    const id = await signIn("2026-01-05T12:00:00Z");
    await run((tx) =>
      recordAttendanceFact(tx, {
        source: "session",
        key: id,
        personId,
        locationId,
        kind: "sign-in",
        at: "2026-01-05T12:00:00Z",
        offsetMinutes: 60,
        outcome: "qualified",
      }),
    );
    await suite.db
      .update(devices)
      .set({ locationId: otherLocation })
      .where(eq(devices.id, deviceId));
    await signIn("2026-01-06T12:00:00Z");
    await begin();
    await drain();
    expect((await rows()).map((r) => [r.locationId, r.businessDay])).toEqual([
      [locationId, "2026-01-05"],
    ]);
  });
  it("discovers retained unpaid amendments, discarded drafts, group events and bill requests", async () => {
    const partyId = newId(),
      orderId = newId(),
      draftId = newId();
    await suite.db.insert(parties).values({ id: partyId, openedBy: personId });
    await suite.db
      .insert(workingOrders)
      .values({ id: orderId, source: "dashboard", locationId, nodeId, orderNumber: 1, partyId });
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
      locationId,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
      status: "published",
      publishedAt: "2026-01-04T12:00:00Z",
    });
    await suite.db.insert(shifts).values([
      {
        personId,
        locationId,
        rosterVersionId: version,
        startsAt: "2026-01-05T08:00:00.000Z",
        endsAt: "2026-01-05T17:00:00.000Z",
        startsOffsetMinutes: 60,
        endsOffsetMinutes: 60,
      },
      {
        personId,
        locationId,
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
    await suite.db
      .insert(workingOrders)
      .values({ id: orderId, source: "dashboard", locationId, nodeId, orderNumber: 1 });
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
      .values({ id, locationId, periodStart: "2026-01-05", periodEnd: "2026-01-11" });
    await begin();
    await drain();
    expect(await rows()).toEqual([]);
    await suite.db.insert(shifts).values({
      personId,
      locationId,
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
      locationId,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
      status: "published",
      publishedAt: "2026-01-04T12:00:00Z",
    });
    await suite.db.insert(shifts).values({
      id: shiftId,
      personId,
      locationId,
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
    await suite.db
      .insert(workingOrders)
      .values({ id: orderId, source: "dashboard", locationId, nodeId, orderNumber: 1 });
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
    .insert(locationDayCutoverChanges)
    .values({ locationId, effectiveBusinessDay: "2026-01-11", dayCutover: "06:00:00" });
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
  await suite.db.update(locations).set({ dayCutover: "06:00" }).where(eq(locations.id, locationId));
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
  await suite.db
    .insert(workingOrders)
    .values({ id: orderId, partyId, source: "dashboard", locationId, nodeId, orderNumber: 1 });
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

it("qualifies a captured pending bill at its saved instant and location when the retained outcome arrives", async () => {
  const orderId = newId(),
    paymentId = newId();
  await suite.db
    .insert(workingOrders)
    .values({ id: orderId, source: "dashboard", locationId: otherLocation, orderNumber: 1 });
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
      locationId,
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
  expect(fact).toMatchObject({ outcome: "qualifying", locationId, at: "2026-01-05T11:00:00.000Z" });
  expect(
    (await rows()).filter((r) => r.dirtyRevision !== r.evaluatedRevision).map((r) => r.businessDay),
  ).toEqual(["2026-01-05"]);
});

it("reassigns a future published shift to its new start-day after a scheduled cutover changes", async () => {
  const version = newId();
  await suite.db.insert(rosterVersions).values({
    id: version,
    locationId,
    periodStart: "2026-01-05",
    periodEnd: "2026-01-11",
    status: "published",
    publishedAt: "2026-01-04T12:00:00Z",
  });
  await suite.db.insert(shifts).values({
    personId,
    locationId,
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
    .insert(locationDayCutoverChanges)
    .values({ locationId, effectiveBusinessDay: "2026-01-11", dayCutover: "06:00:00" });
  await drain();
  expect((await rows()).map((r) => r.businessDay)).toEqual(["2026-01-10", "2026-01-11"]);
  expect((await next(new Date("2026-01-11T05:00:00Z")))?.businessDay).toBe("2026-01-10");
});
