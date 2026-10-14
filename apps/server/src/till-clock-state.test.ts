import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  locations,
  nodes,
  locationDayCutoverChanges,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  appendToChain,
  timeEntries,
} from "@waitron/workforce";
import { readTillClockState } from "./till-clock-state.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const backend = new WorkforceBackend();
let personId: string;
let otherPersonId: string;
let locationId: string;
let nodeId: string;

beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Clock venue",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00:00",
    })
    .returning({ id: locations.id });
  locationId = location!.id;
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const people = await suite.db
    .insert(persons)
    .values([
      { displayName: "Ana", pinHash: "seed", role: "staff" },
      { displayName: "Luis", pinHash: "seed", role: "manager" },
    ])
    .returning({ id: persons.id });
  personId = people[0]!.id;
  otherPersonId = people[1]!.id;
});

function event(at: string, subject = personId, place = locationId, node = nodeId) {
  return {
    personId: subject,
    nodeId: node,
    locationId: place,
    at,
    offsetMinutes: 60,
    origin: jobOrigin("dashboard"),
  };
}

async function read(at = "2026-01-05T12:00:00Z", place = locationId) {
  return withTransaction(suite.db, (tx) =>
    readTillClockState(tx, { personId, locationId: place }, new Date(at)),
  );
}

async function lastId() {
  const rows = await suite.db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(eq(timeEntries.personId, personId), eq(timeEntries.nodeId, nodeId)))
    .orderBy(timeEntries.sequenceNo);
  return rows.at(-1)!.id;
}

describe("till own clock state", () => {
  it("includes an approved missing event but ignores requested events and targeted retimes", async () => {
    const append = (
      status: "requested" | "approved",
      missingEntryKind: "in" | "out",
      at: string,
      target: string | null = null,
    ) =>
      withTransaction(suite.db, (tx) =>
        appendToChain(
          tx,
          { nodeId, locationId },
          {
            personId,
            entryKind: "correction",
            eventAt: at,
            eventOffsetMinutes: 60,
            recordedByPersonId: otherPersonId,
            origin: jobOrigin("dashboard"),
            correctsEntryId: target,
            correctionReason: "Missing time",
            correctionStatus: status,
            correctionActorId: otherPersonId,
            extension: {
              authorKind: "manager",
              direction: "worker_request",
              missingEntryKind: target === null ? missingEntryKind : null,
              respondsToEntryId: null,
              payPeriodClosureId: null,
            },
          },
        ),
      );
    await append("requested", "in", "2026-01-05T09:00:00Z");
    expect(await read()).toMatchObject({ state: "out", lastEntryId: null, firstClockIn: true });
    const missing = await append("approved", "in", "2026-01-05T09:00:00Z");
    expect(await read()).toMatchObject({
      state: "working",
      lastEntryId: missing.id,
      firstClockIn: false,
    });
    await append("approved", "in", "2026-01-05T12:00:00Z", missing.id);
    expect(await read()).toMatchObject({ state: "working", lastEntryId: missing.id });
    await withTransaction(suite.db, (tx) => backend.clockOut(tx, event("2026-01-05T10:00:00Z")));
    expect(await read()).toMatchObject({
      state: "out",
      lastEntryId: await lastId(),
      firstClockIn: false,
    });
    await expect(
      withTransaction(suite.db, (tx) => backend.breakEnd(tx, event("2026-01-05T13:00:00Z"))),
    ).rejects.toMatchObject({ code: "attendance.no_open_entry" });
  });

  it("reads an automatic out and ignores its later acknowledgment", async () => {
    await withTransaction(suite.db, (tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z")));
    const automatic = await withTransaction(suite.db, (tx) =>
      appendToChain(
        tx,
        { nodeId, locationId },
        {
          personId,
          entryKind: "out",
          eventAt: "2026-01-05T10:00:00Z",
          eventOffsetMinutes: 60,
          recordedByPersonId: null,
          origin: jobOrigin("dashboard"),
          extension: {
            authorKind: "automatic",
            direction: null,
            missingEntryKind: null,
            respondsToEntryId: null,
            payPeriodClosureId: null,
          },
        },
      ),
    );
    await withTransaction(suite.db, (tx) =>
      appendToChain(
        tx,
        { nodeId, locationId },
        {
          personId,
          entryKind: "confirmation",
          eventAt: "2026-01-05T12:00:00Z",
          eventOffsetMinutes: 60,
          recordedByPersonId: personId,
          origin: jobOrigin("dashboard"),
          extension: {
            authorKind: "worker",
            direction: null,
            missingEntryKind: null,
            respondsToEntryId: automatic.id,
            payPeriodClosureId: null,
          },
        },
      ),
    );
    expect(await read()).toMatchObject({
      state: "out",
      lastEntryId: automatic.id,
      firstClockIn: false,
    });
    await withTransaction(suite.db, (tx) => backend.clockIn(tx, event("2026-01-05T12:00:00Z")));
    expect(await read()).toMatchObject({ state: "working" });
  });

  it("reads own live state across chains and days without another person's rows", async () => {
    await withTransaction(suite.db, (tx) =>
      backend.clockIn(tx, event("2026-01-05T11:00:00Z", otherPersonId)),
    );
    expect(await read()).toEqual({
      personId,
      locationId,
      businessDay: "2026-01-05",
      state: "out",
      activeLocationId: null,
      lastEntryId: null,
      firstClockIn: true,
    });
    for (const [method, at, state] of [
      ["clockIn", "2026-01-05T09:00:00Z", "working"],
      ["breakStart", "2026-01-05T10:00:00Z", "on_break"],
      ["breakEnd", "2026-01-05T10:30:00Z", "working"],
      ["clockOut", "2026-01-05T10:30:00Z", "out"],
    ] as const) {
      await withTransaction(suite.db, (tx) => backend[method](tx, event(at)));
      expect(await read()).toEqual({
        personId,
        locationId,
        businessDay: "2026-01-05",
        state,
        activeLocationId: state === "out" ? null : locationId,
        lastEntryId: await lastId(),
        firstClockIn: false,
      });
    }
    expect((await read("2026-01-06T03:59:59Z")).firstClockIn).toBe(false);
    expect(await read("2026-01-06T04:00:00Z")).toMatchObject({
      businessDay: "2026-01-06",
      firstClockIn: true,
    });
  });

  it("keeps yesterday's open shift open and uses its active location", async () => {
    await withTransaction(suite.db, (tx) => backend.clockIn(tx, event("2026-01-04T18:00:00Z")));
    const [other] = await suite.db
      .insert(locations)
      .values({
        name: "Other venue",
        invoiceLocales: ["es"],
        operationDescription: "Restaurant",
        timeZone: "UTC",
        dayCutover: "00:00:00",
      })
      .returning({ id: locations.id });
    expect(await read()).toMatchObject({
      state: "working",
      activeLocationId: locationId,
      firstClockIn: true,
    });
    expect(await read("2026-01-05T12:00:00Z", other!.id)).toMatchObject({
      state: "working",
      activeLocationId: locationId,
      locationId: other!.id,
      firstClockIn: true,
    });
    await expect(
      withTransaction(suite.db, (tx) => backend.clockIn(tx, event("2026-01-05T12:00:00Z"))),
    ).rejects.toMatchObject({ code: "attendance.already_open" });
  });

  it("honours a scheduled cutover and its half-open business-day boundary", async () => {
    await suite.db
      .insert(locationDayCutoverChanges)
      .values({ locationId, effectiveBusinessDay: "2026-01-05", dayCutover: "06:00:00" });
    await withTransaction(suite.db, (tx) => backend.clockIn(tx, event("2026-01-05T05:00:00Z")));
    expect(await read("2026-01-05T04:59:59Z")).toMatchObject({
      businessDay: "2026-01-04",
      firstClockIn: true,
    });
    expect(await read("2026-01-05T05:00:00Z")).toMatchObject({
      businessDay: "2026-01-05",
      firstClockIn: false,
    });
  });

  it("orders simultaneous cross-node entries by recording time then node and sequence", async () => {
    const ids = ["10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001"];
    await suite.db.insert(nodes).values(ids.map((id) => ({ id, locationId, name: id })));
    const at = "2026-01-05T09:00:00Z";
    const recorded = () => new Date("2026-01-05T12:00:00Z");
    const append = (node: string, entryKind: "in" | "out" | "break_start", clock = recorded) =>
      withTransaction(suite.db, (tx) =>
        appendToChain(
          tx,
          { locationId, nodeId: node },
          {
            personId,
            entryKind,
            eventAt: at,
            eventOffsetMinutes: 60,
            recordedByPersonId: personId,
            origin: jobOrigin("dashboard"),
          },
          clock,
        ),
      );
    await append(ids[1]!, "out");
    await append(ids[0]!, "in");
    expect(await read()).toMatchObject({ state: "out" });
    const later = await append(ids[0]!, "in", () => new Date("2026-01-05T12:01:00Z"));
    expect(await read()).toMatchObject({ state: "working", lastEntryId: later.id });
    const breaking = await append(ids[0]!, "break_start", () => new Date("2026-01-05T12:01:00Z"));
    expect(await read()).toMatchObject({ state: "on_break", lastEntryId: breaking.id });
    await expect(
      withTransaction(suite.db, (tx) => backend.breakStart(tx, event("2026-01-05T12:00:00Z"))),
    ).rejects.toMatchObject({ code: "attendance.already_open" });
  });
});
