import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorZones,
  floorTodayTables,
  kitchenTimingDefaults,
  locations,
  partyTables,
} from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { mergeOf, plannedZone } from "./testing/floor-today-venue.js";
import { seedSessionDevice } from "./testing/session-device.js";
import "./errors.js";

let v: PartyVenue;
let app: Hono;
let cookie: string;

const REMOVALS = enabledTableRemovals(ALL_MODULES);

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

beforeAll(async () => {
  app = new Hono();
  mountTillApi(
    app,
    {
      db: v.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      tableRemovals: REMOVALS,
      secureCookies: false,
      venueLocale: v.cfg.locale,
    },
    () => {},
  );
  const deviceId = await seedSessionDevice(v.db, v.cfg);
  const session = await inTx(v, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    return loginWithPin(tx, { deviceId, personId: person!.id, pin: "5555" });
  });
  cookie = `${SESSION_COOKIE}=${session.token}`;
});

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

/** A 200 naming a room and its revision. */
async function expectRevision(answer: Response): Promise<void> {
  expect({ status: answer.status, body: await answer.json() }).toEqual({
    status: 200,
    body: { zoneId: expect.any(String), revision: expect.any(Number) },
  });
}

async function merge(movingId: string, targetId: string, side: string): Promise<void> {
  const answer = await post(`/api/tables/${movingId}/today/merge`, { targetId, side, seats: 8 });
  await expectRevision(answer);
}

async function refusal(answer: Promise<Response>): Promise<{ status: number; body: unknown }> {
  const settled = await answer;
  return { status: settled.status, body: await settled.json() };
}

/** The party the floor read shows at each table, in the order asked. */
async function holders(...tableIds: string[]): Promise<(string | null)[]> {
  const answer = await app.request("/api/tables/state", { headers: { cookie } });
  expect(answer.status, await answer.clone().text()).toBe(200);
  const tables = (await answer.json()) as { id: string; party: { id: string } | null }[];
  return tableIds.map((id) => tables.find((t) => t.id === id)!.party?.id ?? null);
}

async function heldRows(tableId: string): Promise<number> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({ id: partyTables.id })
      .from(partyTables)
      .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt))),
  );
  return rows.length;
}

async function needsClearing(tableId: string): Promise<void> {
  await inTx(v, (tx) =>
    tx
      .update(diningTables)
      .set({ needsClearingSince: new Date().toISOString() })
      .where(eq(diningTables.id, tableId)),
  );
}

async function threeTables(fixed = false) {
  const { table } = await plannedZone(v, [
    { key: "a", place: { x: 0, y: 0 }, fixed },
    { key: "b", place: { x: 20, y: 0 }, fixed },
    { key: "c", place: { x: 40, y: 0 }, fixed },
  ]);
  return { a: table.a!, b: table.b!, c: table.c! };
}

async function takeOff(tableId: string): Promise<void> {
  const answer = await post(`/api/tables/${tableId}/today/take-off`, {});
  await expectRevision(answer);
}

describe("seating at a table taken off today", () => {
  it("refuses the table the path names, and seats nobody", async () => {
    const { a } = await threeTables();
    await takeOff(a);

    expect(await refusal(post(`/api/tables/${a}/seat`, { guestCount: 2 }))).toEqual({
      status: 409,
      body: { error: { code: "table.taken_off", params: { tableId: a } } },
    });
    expect(await heldRows(a)).toBe(0);
  });

  it("refuses one of the other tables, and seats nobody", async () => {
    const { a, b } = await threeTables();
    await takeOff(b);

    expect(
      await refusal(post(`/api/tables/${a}/seat`, { guestCount: 2, withTableIds: [b] })),
    ).toEqual({
      status: 409,
      body: { error: { code: "table.taken_off", params: { tableId: b } } },
    });
    expect(await heldRows(a)).toBe(0);
    expect(await heldRows(b)).toBe(0);
  });

  it("names the first taken-off table in the order sent", async () => {
    const { a, b, c } = await threeTables();
    // Sent larger id first, so the order sent and the order by id disagree.
    const [lo, hi] = [b, c].sort();
    await takeOff(lo!);
    await takeOff(hi!);

    expect(
      await refusal(post(`/api/tables/${a}/seat`, { guestCount: 2, withTableIds: [hi, lo] })),
    ).toEqual({
      status: 409,
      body: { error: { code: "table.taken_off", params: { tableId: hi } } },
    });
  });
});

describe("seating at a merge", () => {
  it("seats a party at every table of a free merge", async () => {
    const { a, b, c } = await threeTables();
    await merge(a, b, "right");
    await merge(c, b, "left");

    const answer = await post(`/api/tables/${c}/seat`, { guestCount: 6 });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const { partyId } = (await answer.json()) as { partyId: string };

    expect(await holders(a, b, c)).toEqual([partyId, partyId, partyId]);
    for (const member of [a, b, c]) expect(await heldRows(member)).toBe(1);
  });

  it("refuses to seat a merge one of whose tables needs clearing, and seats nobody", async () => {
    const { a, b } = await threeTables();
    await merge(a, b, "right");
    await needsClearing(b);

    expect(await refusal(post(`/api/tables/${a}/seat`, { guestCount: 2 }))).toEqual({
      status: 409,
      body: { error: { code: "table.needs_clearing", params: { tableId: b } } },
    });
    expect(await heldRows(a)).toBe(0);
    expect(await heldRows(b)).toBe(0);
  });
});

describe("seating at a merge, which table a refusal names", () => {
  it("names the first member by id when two need clearing", async () => {
    const { a, b, c } = await threeTables();
    // Merged larger id first, so the members' rows are written out of id order.
    const [lo, hi] = [a, c].sort();
    await merge(hi!, b, "right");
    await merge(lo!, b, "left");
    await needsClearing(lo!);
    await needsClearing(hi!);

    expect(await refusal(post(`/api/tables/${b}/seat`, { guestCount: 2 }))).toEqual({
      status: 409,
      body: { error: { code: "table.needs_clearing", params: { tableId: lo } } },
    });
  });
});

describe("seating one party at several tables", () => {
  it("seats at a fixed table and every member of a free merge named together", async () => {
    const { table } = await plannedZone(v, [
      { key: "f", place: { x: 0, y: 0 }, fixed: true },
      { key: "b", place: { x: 20, y: 0 } },
      { key: "c", place: { x: 40, y: 0 } },
    ]);
    const [f, b, c] = [table.f!, table.b!, table.c!];
    await merge(b, c, "right");

    const answer = await post(`/api/tables/${f}/seat`, { guestCount: 4, withTableIds: [b, c] });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const { partyId } = (await answer.json()) as { partyId: string };

    expect(await holders(f, b, c)).toEqual([partyId, partyId, partyId]);
  });

  it("accepts another table of the path table's own merge", async () => {
    const { a, b } = await threeTables();
    await merge(a, b, "right");

    const answer = await post(`/api/tables/${a}/seat`, { guestCount: 2, withTableIds: [b] });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const { partyId } = (await answer.json()) as { partyId: string };

    expect(await holders(a, b)).toEqual([partyId, partyId]);
    expect(await heldRows(b)).toBe(1);
  });

  it("accepts a table named twice", async () => {
    const { a: f1, b: f2 } = await threeTables(true);

    const answer = await post(`/api/tables/${f1}/seat`, { guestCount: 2, withTableIds: [f2, f2] });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const { partyId } = (await answer.json()) as { partyId: string };

    expect(await holders(f1, f2)).toEqual([partyId, partyId]);
    expect(await heldRows(f2)).toBe(1);
  });

  it("refuses a table of another venue as not found, and seats nobody", async () => {
    const { a: f1 } = await threeTables(true);
    const elsewhere = randomUUID();
    const id = randomUUID();
    await inTx(v, async (tx) => {
      await tx.insert(locations).values({
        id: elsewhere,
        name: "Other",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      });
      await tx.insert(kitchenTimingDefaults).values({ locationId: elsewhere });
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: elsewhere, name: "Other tables" })
        .returning({ id: floorZones.id });
      await tx.insert(diningTables).values({
        id,
        locationId: elsewhere,
        zoneId: zone!.id,
        label: `Elsewhere ${id.slice(0, 6)}`,
      });
      await tx.insert(floorTodayTables).values({
        tableId: id,
        seats: 4,
        x: 0,
        y: 0,
        width: 8,
        height: 8,
        shape: "rect",
        rotation: 0,
      });
    });

    expect(
      await refusal(post(`/api/tables/${f1}/seat`, { guestCount: 2, withTableIds: [id] })),
    ).toEqual({
      status: 404,
      body: { error: { code: "table.not_found", params: { tableId: id } } },
    });
    expect(await heldRows(f1)).toBe(0);
    expect(await heldRows(id)).toBe(0);
  });

  it("seats one party at two tables in one request", async () => {
    const { a: f1, b: f2 } = await threeTables(true);

    const answer = await post(`/api/tables/${f1}/seat`, { guestCount: 2, withTableIds: [f2] });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const { partyId } = (await answer.json()) as { partyId: string };

    expect(await holders(f1, f2)).toEqual([partyId, partyId]);
    expect(await mergeOf(v, f1)).toBeNull();
    expect(await mergeOf(v, f2)).toBeNull();
  });

  it("answers the party's revision after the other tables joined", async () => {
    const { a: f1, b: f2 } = await threeTables(true);
    const answer = await post(`/api/tables/${f1}/seat`, { guestCount: 2, withTableIds: [f2] });
    const { partyId, revision } = (await answer.json()) as { partyId: string; revision: number };

    const rename = await app.request(`/api/parties/${partyId}/name`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Ana", expectedPartyRevision: revision }),
    });
    expect(rename.status, await rename.clone().text()).toBe(200);
  });

  it("brings every table of another table's merge into the party", async () => {
    const { a, b, c } = await threeTables();
    await merge(b, c, "right");

    const answer = await post(`/api/tables/${a}/seat`, { guestCount: 2, withTableIds: [b] });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const { partyId } = (await answer.json()) as { partyId: string };

    expect(await holders(a, b, c)).toEqual([partyId, partyId, partyId]);
  });

  it("seats nobody when one of the other tables cannot be joined", async () => {
    const { a: f1, b: f2 } = await threeTables(true);
    await needsClearing(f2);

    expect(
      await refusal(post(`/api/tables/${f1}/seat`, { guestCount: 2, withTableIds: [f2] })),
    ).toEqual({
      status: 409,
      body: { error: { code: "table.needs_clearing", params: { tableId: f2 } } },
    });
    expect(await holders(f1)).toEqual([null]);
    expect(await heldRows(f1)).toBe(0);
  });

  it("refuses a malformed list of other tables", async () => {
    const { a: f1 } = await threeTables(true);
    const invalid = {
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "withTableIds" } } },
    };

    expect(await refusal(post(`/api/tables/${f1}/seat`, { withTableIds: "x" }))).toEqual(invalid);
    expect(await refusal(post(`/api/tables/${f1}/seat`, { withTableIds: [f1] }))).toEqual(invalid);
    expect(
      await refusal(post(`/api/tables/${f1}/seat`, { withTableIds: [f1.toUpperCase()] })),
    ).toEqual(invalid);
    expect(await refusal(post(`/api/tables/${f1}/seat`, { withTableIds: ["nope"] }))).toEqual({
      status: 404,
      body: { error: { code: "table.not_found", params: { tableId: "nope" } } },
    });
    expect(await heldRows(f1)).toBe(0);
  });
});
