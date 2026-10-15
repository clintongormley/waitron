import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  appendOrderAmendment,
  billPayments,
  devices,
  locations,
  newId,
  orderDraftEvents,
  orderDrafts,
  orderGroupEvents,
  parties,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons, sessions, hashSessionToken } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  attendanceOperationFacts,
  rosterVersions,
  shifts,
  requestSwap,
  acceptSwap,
  decideSwap,
  timeEntries,
  type AttendanceDay,
} from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const backend = new WorkforceBackend();
let ana: string, bea: string, caro: string, diego: string;
let locationId: string,
  elsewhere: string,
  nodeId: string,
  deviceId: string,
  orderId: string,
  partyId: string;
const day = (): AttendanceDay => ({
  locationId,
  businessDay: "2026-01-05",
  startAt: "2026-01-05T03:00:00.000Z",
  endAt: "2026-01-06T03:00:00.000Z",
});
async function facts(scope = day()) {
  const { readAttendanceFacts } = await import("./attendance-facts.js");
  return run((tx) => readAttendanceFacts(tx, scope));
}
async function planned(scope = day()) {
  const { readPlannedAttendanceShifts } = await import("./attendance-facts.js");
  return run((tx) => readPlannedAttendanceShifts(tx, scope));
}
async function signIn(personId: string, at: string) {
  const id = newId();
  await suite.db
    .insert(sessions)
    .values({ id, personId, deviceId, tokenHash: hashSessionToken(id), openedAt: at });
  return id;
}
async function amendment(at: string, kind: "order_placed" | "order_cancelled" = "order_placed") {
  return run((tx) =>
    appendOrderAmendment(tx, {
      workingOrderId: orderId,
      kind,
      actorId: bea,
      reason: kind === "order_cancelled" ? "Changed mind" : null,
      origin: jobOrigin("dashboard"),
      capturedByNodeId: nodeId,
      eventAt: new Date(at),
      eventOffsetMinutes: 0,
    }),
  );
}
const event = (at: string) => ({
  personId: ana,
  locationId,
  nodeId,
  at,
  offsetMinutes: 0,
  origin: jobOrigin("dashboard"),
});
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
        name: "Elsewhere",
        timeZone: "UTC",
        dayCutover: "04:00",
        invoiceLocales: ["en"],
        operationDescription: "Restaurant",
      },
    ])
    .returning({ id: locations.id });
  [locationId, elsewhere] = places.map((r) => r.id) as [string, string];
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  deviceId = (await seedDevice(suite.db, { locationId: brandLocationId(locationId) })).deviceId;
  const people = await suite.db
    .insert(persons)
    .values(
      ["Ana", "Bea", "Caro", "Diego"].map((displayName) => ({
        displayName,
        pinHash: "scrypt$00$00",
        role: "admin" as const,
      })),
    )
    .returning({ id: persons.id });
  [ana, bea, caro, diego] = people.map((r) => r.id) as [string, string, string, string];
  partyId = newId();
  orderId = newId();
  await suite.db.insert(parties).values({ id: partyId, openedBy: diego });
  await suite.db
    .insert(workingOrders)
    .values({ id: orderId, source: "dashboard", locationId, nodeId, orderNumber: 1, partyId });
});

describe("attendance source facts", () => {
  it("attributes sign-in, unpaid orders and collection to their own actors and original instants", async () => {
    const session = await signIn(ana, "2026-01-05T08:00:00.987Z");
    const placed = await amendment("2026-01-05T12:00:00Z");
    await run((tx) =>
      recordAttendanceFact(tx, {
        source: "whole-payment",
        key: "collection",
        personId: caro,
        locationId,
        kind: "payment",
        at: "2026-01-05T16:40:00Z",
        offsetMinutes: 0,
        outcome: "pending",
      }),
    );
    await run((tx) =>
      recordAttendanceFact(tx, {
        source: "whole-payment",
        key: "collection",
        personId: diego,
        locationId,
        kind: "payment",
        at: "2026-01-06T18:00:00Z",
        offsetMinutes: 0,
        outcome: "qualified",
      }),
    );
    await suite.db
      .update(devices)
      .set({ lastSeenAt: "2026-01-05T19:00:00Z" })
      .where(eq(devices.id, deviceId));
    expect(await facts()).toEqual([
      {
        source: "session",
        key: session,
        personId: ana,
        locationId,
        kind: "sign-in",
        at: "2026-01-05T08:00:00.000Z",
        offsetMinutes: 60,
      },
      {
        source: "order",
        key: placed.id,
        personId: bea,
        locationId,
        kind: "order",
        at: "2026-01-05T12:00:00.000Z",
        offsetMinutes: 60,
      },
      {
        source: "whole-payment",
        key: "collection",
        personId: caro,
        locationId,
        kind: "payment",
        at: "2026-01-05T16:40:00.000Z",
        offsetMinutes: 60,
      },
    ]);
    expect(await facts()).toEqual(await facts());
  });
  it("retains cancelled unpaid work and discarded drafts without crediting the current owner", async () => {
    const placed = await amendment("2026-01-05T12:00:00Z");
    const cancelled = await amendment("2026-01-05T13:00:00Z", "order_cancelled");
    const draftId = newId(),
      draftEvent = newId(),
      groupEvent = newId();
    await suite.db.insert(orderDrafts).values({
      id: draftId,
      partyId,
      ownerId: diego,
      state: "discarded",
      updatedAt: "2026-01-05T20:00:00Z",
    });
    await suite.db.insert(orderDraftEvents).values({
      id: draftEvent,
      draftId,
      kind: "discarded",
      actorId: caro,
      fromPerson: ana,
      toPerson: ana,
      detail: {},
      createdAt: "2026-01-05T14:00:00Z",
    });
    await suite.db.insert(orderGroupEvents).values([
      {
        id: groupEvent,
        partyId,
        kind: "reordered",
        actorId: ana,
        detail: {},
        createdAt: "2026-01-05T15:00:00Z",
      },
      {
        partyId,
        kind: "reordered",
        actorDeviceId: deviceId,
        detail: {},
        createdAt: "2026-01-05T21:00:00Z",
      },
    ]);
    expect((await facts()).map((f) => [f.key, f.personId, f.at])).toEqual([
      [placed.id, bea, "2026-01-05T12:00:00.000Z"],
      [cancelled.id, bea, "2026-01-05T13:00:00.000Z"],
      [`event:${draftEvent}`, caro, "2026-01-05T14:00:00.000Z"],
      [`group:${groupEvent}`, ana, "2026-01-05T15:00:00.000Z"],
    ]);
  });
  it("includes the lower day boundary, excludes the upper boundary and another location", async () => {
    const included = await signIn(ana, "2026-01-05T04:00:00+01:00");
    await signIn(ana, "2026-01-06T03:00:00Z");
    await signIn(ana, "2026-01-05T02:59:59Z");
    await run((tx) =>
      recordAttendanceFact(tx, {
        source: "order",
        key: "elsewhere",
        personId: bea,
        locationId: elsewhere,
        kind: "order",
        at: "2026-01-05T15:00:00Z",
        offsetMinutes: 0,
        outcome: "qualified",
      }),
    );
    expect((await facts()).map((f) => f.key)).toEqual([included]);
  });
  it("a captured session keeps its original location after a device moves", async () => {
    const id = await signIn(ana, "2026-01-05T09:00:00Z");
    await run((tx) =>
      recordAttendanceFact(tx, {
        source: "session",
        key: id,
        personId: ana,
        locationId,
        kind: "sign-in",
        at: "2026-01-05T09:00:00Z",
        offsetMinutes: 0,
        outcome: "qualified",
      }),
    );
    await suite.db.update(devices).set({ locationId: elsewhere }).where(eq(devices.id, deviceId));
    expect((await facts()).map((f) => [f.key, f.locationId])).toEqual([[id, locationId]]);
    expect(await facts({ ...day(), locationId: elsewhere })).toEqual([]);
  });
  it("ignores pending and refused actions and retains a qualifying payment after decline", async () => {
    const id = newId();
    await suite.db.insert(billPayments).values({
      id,
      workingOrderId: orderId,
      submissionId: "one",
      fingerprint: "one",
      kind: "contribution",
      method: "card",
      applied: 100,
      state: "declined",
      requestedBy: caro,
      source: "device",
      deviceId,
      createdAt: "2026-01-05T10:00:00Z",
      receivedAt: "2026-01-06T19:00:00Z",
      attestedBy: diego,
      attestationNote: "Provider confirmation",
    });
    for (const outcome of ["pending", "refused"] as const) {
      await run((tx) =>
        recordAttendanceFact(tx, {
          source: "whole-payment",
          key: outcome,
          personId: ana,
          locationId,
          kind: "payment",
          at: "2026-01-05T20:00:00Z",
          offsetMinutes: 0,
          outcome,
        }),
      );
    }
    expect(await facts()).toEqual([
      {
        source: "bill-payment",
        key: id,
        personId: caro,
        locationId,
        kind: "payment",
        at: "2026-01-05T10:00:00.000Z",
        offsetMinutes: 60,
      },
    ]);
  });
  it("captured payment evidence replaces its retained row without duplicate or later timestamp", async () => {
    const id = newId();
    await suite.db.insert(billPayments).values({
      id,
      workingOrderId: orderId,
      submissionId: "one",
      fingerprint: "one",
      kind: "contribution",
      method: "card",
      applied: 100,
      state: "received",
      requestedBy: diego,
      source: "device",
      deviceId,
      createdAt: "2026-01-05T12:00:00Z",
      receivedAt: "2026-01-05T13:00:00Z",
    });
    await run((tx) =>
      recordAttendanceFact(tx, {
        source: "bill-payment",
        key: id,
        personId: caro,
        locationId,
        kind: "payment",
        at: "2026-01-05T11:00:00Z",
        offsetMinutes: 0,
        outcome: "qualified",
      }),
    );
    expect((await facts()).map((f) => [f.key, f.personId, f.at])).toEqual([
      [id, caro, "2026-01-05T11:00:00.000Z"],
    ]);
  });
  it("break instants count, targeted retimes and acknowledgments do not create activity", async () => {
    await run((tx) => backend.clockIn(tx, event("2026-01-05T08:00:00Z")));
    await run((tx) => backend.breakStart(tx, event("2026-01-05T12:00:00Z")));
    await run((tx) => backend.breakEnd(tx, event("2026-01-05T12:30:00Z")));
    const entries = await suite.db.select().from(timeEntries);
    const request = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: entries[1]!.id,
        at: "2026-01-05T12:10:00Z",
        offsetMinutes: 0,
        reason: "Corrected break",
        actorPersonId: ana,
        origin: jobOrigin("dashboard"),
      }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: bea }),
    );
    const out = await run((tx) =>
      backend.recordAutomaticClose(tx, {
        ...event("2026-01-05T17:00:00Z"),
        openEntryId: entries[0]!.id,
      }),
    );
    await run((tx) =>
      backend.confirmAutomaticEntry(tx, {
        nodeId,
        entryId: out,
        workerPersonId: ana,
        origin: jobOrigin("dashboard"),
      }),
    );
    expect((await facts()).map((f) => [f.source, f.key, f.at])).toEqual([
      ["clock", entries[1]!.id, "2026-01-05T12:00:00.000Z"],
      ["clock", entries[2]!.id, "2026-01-05T12:30:00.000Z"],
    ]);
  });
  it("empty retained sources and no captured operations produce no facts", async () => {
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual([]);
    expect(await facts()).toEqual([]);
  });
  it("includes approved missing break entries at event time rather than approval time", async () => {
    await run((tx) => backend.clockIn(tx, event("2026-01-05T08:00:00Z")));
    await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z")));
    for (const [missingEntryKind, at] of [
      ["break_start", "2026-01-05T12:00:00Z"],
      ["break_end", "2026-01-05T12:30:00Z"],
    ] as const) {
      const correctionId = await run((tx) =>
        backend.requestCorrection(tx, {
          nodeId,
          personId: ana,
          locationId,
          missingEntryKind,
          at,
          offsetMinutes: 0,
          reason: "Forgot break",
          actorPersonId: ana,
          origin: jobOrigin("dashboard"),
        }),
      );
      await run((tx) =>
        backend.approveCorrection(tx, { nodeId, correctionId, approverPersonId: bea }),
      );
    }
    expect((await facts()).map((f) => [f.kind, f.personId, f.at])).toEqual([
      ["break", ana, "2026-01-05T12:00:00.000Z"],
      ["break", ana, "2026-01-05T12:30:00.000Z"],
    ]);
  });
  it("does not assign a location to a retained party event with conflicting bill locations", async () => {
    await suite.db
      .insert(workingOrders)
      .values({ source: "dashboard", locationId: elsewhere, orderNumber: 2, partyId });
    await suite.db.insert(orderGroupEvents).values({
      partyId,
      kind: "reordered",
      actorId: ana,
      detail: {},
      createdAt: "2026-01-05T12:00:00Z",
    });
    expect(await facts()).toEqual([]);
    expect(await facts({ ...day(), locationId: elsewhere })).toEqual([]);
  });
  it.each([
    [
      "2026-03-29T01:30:00.000Z",
      "2026-03-28",
      "2026-03-28T03:00:00.000Z",
      "2026-03-29T02:00:00.000Z",
      120,
    ],
    [
      "2026-10-25T01:30:00.000Z",
      "2026-10-24",
      "2026-10-24T02:00:00.000Z",
      "2026-10-25T03:00:00.000Z",
      60,
    ],
  ])(
    "uses the venue offset at %s across DST",
    async (at, businessDay, startAt, endAt, offsetMinutes) => {
      const id = await signIn(ana, at);
      expect(await facts({ locationId, businessDay, startAt, endAt })).toEqual([
        {
          source: "session",
          key: id,
          personId: ana,
          locationId,
          kind: "sign-in",
          at,
          offsetMinutes,
        },
      ]);
    },
  );
});

describe("planned attendance shifts", () => {
  async function version(status: "draft" | "published" | "superseded", place = locationId) {
    const id = newId();
    await suite.db.insert(rosterVersions).values({
      id,
      locationId: place,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
      status,
      publishedAt: status === "draft" ? null : "2026-01-04T12:00:00Z",
    });
    return id;
  }
  async function shift(
    rosterVersionId: string | null,
    startsAt: string,
    endsAt: string,
    place = locationId,
  ) {
    const id = newId();
    await suite.db.insert(shifts).values({
      id,
      personId: ana,
      locationId: place,
      startsAt,
      endsAt,
      startsOffsetMinutes: 60,
      endsOffsetMinutes: 60,
      rosterVersionId,
    });
    return id;
  }
  it("returns only current published same-location shifts by start-day, retaining split and spillover ends", async () => {
    const published = await version("published");
    const first = await shift(published, "2026-01-05T03:00:00.000Z", "2026-01-05T11:00:00.000Z");
    const second = await shift(published, "2026-01-05T17:00:00.000Z", "2026-01-06T04:00:00.000Z");
    await shift(await version("draft"), "2026-01-05T09:00:00.000Z", "2026-01-05T10:00:00.000Z");
    await shift(
      await version("superseded"),
      "2026-01-05T09:00:00.000Z",
      "2026-01-05T10:00:00.000Z",
    );
    await shift(null, "2026-01-05T09:00:00.000Z", "2026-01-05T10:00:00.000Z");
    await shift(published, "2026-01-06T03:00:00.000Z", "2026-01-06T04:00:00.000Z");
    await shift(published, "2026-01-04T20:00:00.000Z", "2026-01-05T04:00:00.000Z");
    await shift(
      await version("published", elsewhere),
      "2026-01-05T09:00:00.000Z",
      "2026-01-05T10:00:00.000Z",
      elsewhere,
    );
    expect(await planned()).toEqual([
      {
        id: first,
        personId: ana,
        locationId,
        startsAt: "2026-01-05T03:00:00.000Z",
        endsAt: "2026-01-05T11:00:00.000Z",
        rosterVersionId: published,
      },
      {
        id: second,
        personId: ana,
        locationId,
        startsAt: "2026-01-05T17:00:00.000Z",
        endsAt: "2026-01-06T04:00:00.000Z",
        rosterVersionId: published,
      },
    ]);
  });
  it("swap approval does not pretend to reassign the source shift", async () => {
    const published = await version("published");
    const id = await shift(published, "2026-01-05T09:00:00.000Z", "2026-01-05T17:00:00.000Z");
    const swap = await run((tx) =>
      requestSwap(tx, {
        requestedByPersonId: ana,
        fromShiftId: id,
        toPersonId: bea,
        toShiftId: null,
      }),
    );
    await run((tx) => acceptSwap(tx, { swapId: swap, acceptingPersonId: bea }));
    await run((tx) =>
      decideSwap(tx, { swapId: swap, decision: "approved", decidedByPersonId: caro }),
    );
    expect((await planned()).map((s) => [s.id, s.personId])).toEqual([[id, ana]]);
  });
});
