import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  tableInService,
  diningTables,
  floorPlans,
  floorTodayZones,
  floorZones,
  locations,
} from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { saveZonePlan } from "./floor-plan.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { deactivateZone } from "./tables.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  inTx,
  revisionOf,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import { plannedZone, tableServiceZone, todayRow } from "./testing/floor-today-venue.js";
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

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function today(tableId: string, change: string, body: unknown = {}): Promise<Response> {
  return send("POST", `/api/tables/${tableId}/today/${change}`, body);
}

async function expect204(answer: Response | Promise<Response>): Promise<void> {
  const settled = await answer;
  expect(settled.status, await settled.clone().text()).toBe(204);
}

interface FloorToday {
  placement: { x: number; y: number; rotation: number } | null;
  seats: number | null;
  takenOff: boolean;
}

async function floorToday(tableId: string): Promise<FloorToday | null> {
  const answer = await send("GET", "/api/tables/state");
  expect(answer.status).toBe(200);
  const tables = (await answer.json()) as { id: string; today: FloorToday | null }[];
  return tables.find((t) => t.id === tableId)!.today;
}

async function seatAt(tableId: string): Promise<string> {
  const answer = await send("POST", `/api/tables/${tableId}/seat`, {});
  expect(answer.status).toBe(200);
  return ((await answer.json()) as { partyId: string }).partyId;
}

async function finish(partyId: string): Promise<void> {
  const answer = await send("POST", `/api/parties/${partyId}/finish`, {
    expectedPartyRevision: await revisionOf(v, partyId),
  });
  expect(answer.status).toBe(200);
}

async function refusal(answer: Promise<Response>): Promise<{ status: number; body: unknown }> {
  const settled = await answer;
  return { status: settled.status, body: await settled.json() };
}

async function generationOf(zoneId: string): Promise<number | undefined> {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId)),
  );
  return row?.generation;
}

describe("today's routes", () => {
  it("moves, turns, takes off, puts back, places and sets seats through the routes, answering 204", async () => {
    const { table } = await plannedZone(v, [
      { key: "a", place: { x: 0, y: 0 } },
      { key: "spare", place: null },
    ]);

    await expect204(today(table.a!, "move", { x: 30, y: 12 }));
    expect((await floorToday(table.a!))?.placement).toMatchObject({ x: 30, y: 12, rotation: 0 });

    await expect204(today(table.a!, "rotate"));
    expect((await floorToday(table.a!))?.placement).toMatchObject({ x: 30, y: 12, rotation: 15 });

    await expect204(today(table.a!, "seats", { seats: 7 }));
    expect((await floorToday(table.a!))?.seats).toBe(7);

    await expect204(today(table.a!, "take-off"));
    expect(await floorToday(table.a!)).toMatchObject({ placement: null, takenOff: true });

    await expect204(today(table.a!, "put-back"));
    expect(await floorToday(table.a!)).toMatchObject({
      placement: { x: 30, y: 12, rotation: 15 },
      takenOff: false,
    });

    expect((await floorToday(table.spare!))?.placement).toBeNull();
    await expect204(today(table.spare!, "place", { x: 40, y: 50 }));
    expect((await floorToday(table.spare!))?.placement).toMatchObject({
      x: 40,
      y: 50,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
    });
  });

  it("sends a table back to its saved place", async () => {
    const { table } = await plannedZone(v, [{ key: "a", seats: 4, place: { x: 10, y: 20 } }]);
    await expect204(today(table.a!, "move", { x: 60, y: 60 }));
    await expect204(today(table.a!, "rotate"));

    await expect204(today(table.a!, "back"));

    expect(await floorToday(table.a!)).toMatchObject({
      placement: { x: 10, y: 20, rotation: 0 },
      seats: 4,
      takenOff: false,
    });
  });

  it("resets a zone to the saved plan", async () => {
    const { zoneId, table } = await plannedZone(v, [
      { key: "free", place: { x: 0, y: 0 } },
      { key: "seated", place: { x: 20, y: 0 } },
    ]);
    await seatAt(table.seated!);
    await expect204(today(table.free!, "move", { x: 50, y: 50 }));
    await expect204(today(table.seated!, "move", { x: 70, y: 70 }));

    await expect204(send("POST", `/api/zones/${zoneId}/today/reset`, {}));

    expect((await floorToday(table.free!))?.placement).toMatchObject({ x: 0, y: 0 });
    expect((await floorToday(table.seated!))?.placement).toMatchObject({ x: 70, y: 70 });
  });

  it("catches today's plan up before a change, so the change survives the next read", async () => {
    const { zoneId, table, master, revision } = await plannedZone(v, [
      { key: "t", label: "T", place: { x: 0, y: 0 } },
    ]);
    const partyId = await seatAt(table.t!);
    const label = (await tableRow(v, table.t!)).label;
    await inTx(v, (tx) =>
      saveZonePlan(tx, v.cfg, REMOVALS, zoneId, {
        revision,
        tables: [
          {
            id: master.t!,
            key: "t",
            liveTableId: table.t!,
            label,
            seats: 4,
            fixed: false,
            placement: { x: 50, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 },
          },
        ],
        joins: [],
      }),
    );
    await expect204(send("POST", `/api/zones/${zoneId}/today/reset`, {}));
    expect((await todayRow(v, table.t!))?.x).toBe(0);
    await finish(partyId);

    await expect204(today(table.t!, "move", { x: 30, y: 0 }));

    expect((await floorToday(table.t!))?.placement).toMatchObject({ x: 30, y: 0 });
  });

  it("leaves a disabled planned zone's tables off on a reset", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "a" }]);
    await inTx(v, (tx) => deactivateZone(tx, v.cfg, zoneId));
    expect(await inService(table.a!)).toBe(false);
    const generation = await generationOf(zoneId);
    expect(generation).toBe(1);

    await expect204(send("POST", `/api/zones/${zoneId}/today/reset`, {}));

    expect(await inService(table.a!)).toBe(false);
    expect(await generationOf(zoneId)).toBe(generation);
  });

  it("answers a refusal with its code and status", async () => {
    const { table } = await plannedZone(v, [
      { key: "fixed", fixed: true },
      { key: "spare", place: null },
      { key: "off", place: { x: 20, y: 0 } },
    ]);
    await expect204(today(table.off!, "take-off"));

    expect(await refusal(today(table.fixed!, "move", { x: 5, y: 5 }))).toEqual({
      status: 409,
      body: { error: { code: "table.fixed", params: { tableId: table.fixed! } } },
    });
    expect(await refusal(today(table.spare!, "rotate"))).toEqual({
      status: 409,
      body: { error: { code: "table.not_in_floor_plan", params: { tableId: table.spare! } } },
    });
    expect(await refusal(today(table.off!, "move", { x: 5, y: 5 }))).toEqual({
      status: 409,
      body: { error: { code: "table.taken_off", params: { tableId: table.off! } } },
    });
  });

  it("refuses a malformed id or body", async () => {
    const { table } = await plannedZone(v, [{ key: "a" }]);

    expect(await refusal(today("not-a-uuid", "move", { x: 1, y: 0 }))).toMatchObject({
      status: 404,
      body: { error: { code: "table.not_found" } },
    });
    expect(await refusal(today(table.a!, "move", { x: 1.5, y: 0 }))).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "x" } } },
    });
    expect(await refusal(today(table.a!, "move", { y: 0 }))).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "x" } } },
    });
    expect(await refusal(today(table.a!, "place", { x: 0, y: 1000 }))).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "y" } } },
    });
    expect(await refusal(today(table.a!, "seats", { seats: 0 }))).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "seats" } } },
    });
    expect(await refusal(today(randomUUID(), "rotate"))).toMatchObject({
      status: 404,
      body: { error: { code: "table.not_found" } },
    });
    expect(await refusal(send("POST", "/api/zones/not-a-uuid/today/reset", {}))).toMatchObject({
      status: 404,
      body: { error: { code: "zone.not_found" } },
    });
    expect(await refusal(send("POST", `/api/zones/${randomUUID()}/today/reset`, {}))).toMatchObject(
      { status: 404, body: { error: { code: "zone.not_found" } } },
    );
  });

  it("refuses another venue's zone as not found, and leaves its today's plan alone", async () => {
    const elsewhere = randomUUID();
    const zoneId = randomUUID();
    await inTx(v, async (tx) => {
      await tx.insert(locations).values({
        id: elsewhere,
        name: "Other",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      });
      await tx.insert(floorZones).values({ id: zoneId, locationId: elsewhere, name: "Elsewhere" });
      await tx.insert(floorPlans).values({ zoneId, savedAt: "2026-01-01T00:00:00.000Z" });
      await tx.insert(floorTodayZones).values({ zoneId, businessDay: "2026-01-01", generation: 1 });
    });

    const answer = await send("POST", `/api/zones/${zoneId}/today/reset`, {});
    const [row] = await inTx(v, (tx) =>
      tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId)),
    );
    expect(row).toMatchObject({ businessDay: "2026-01-01", generation: 1 });
    expect(answer.status).toBe(404);
    expect(await answer.json()).toEqual({
      error: { code: "zone.not_found", params: { zoneId } },
    });
  });

  it("leaves a zone with no master plan alone on a reset", async () => {
    const zoneId = await tableServiceZone(v);
    await v.table(`Unplanned ${randomUUID().slice(0, 6)}`, zoneId);

    await expect204(send("POST", `/api/zones/${zoneId}/today/reset`, {}));

    expect(await generationOf(zoneId)).toBeUndefined();
  });
});

describe("the till's zone list", () => {
  it("says whether each zone has a saved plan, tables or none", async () => {
    const { zoneId: withTables } = await plannedZone(v, [{ key: "a" }]);
    const { zoneId: emptyPlan } = await plannedZone(v, []);
    const unplanned = await tableServiceZone(v);

    const answer = await send("GET", "/api/zones");
    expect(answer.status).toBe(200);
    const zones = (await answer.json()) as { id: string; hasPlan: boolean }[];
    const hasPlan = (zoneId: string) => zones.find((zone) => zone.id === zoneId)?.hasPlan;
    expect([hasPlan(withTables), hasPlan(emptyPlan), hasPlan(unplanned)]).toEqual([
      true,
      true,
      false,
    ]);
  });
});

async function inService(tableId: string): Promise<boolean> {
  const [table] = await inTx(v, (tx) =>
    tx
      .select({ inService: tableInService(diningTables.id).mapWith(Boolean) })
      .from(diningTables)
      .where(eq(diningTables.id, tableId)),
  );
  return table!.inService;
}
