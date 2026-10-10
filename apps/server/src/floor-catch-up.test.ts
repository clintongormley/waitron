import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorTodayTables,
  floorTodayZones,
  floorZones,
  locations,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { zoneSalePolicies, zoneServicePolicies } from "@waitron/venue-service";
import { saveZonePlan, type ZonePlanSave } from "./floor-plan.js";
import { resetZone } from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  counterOrder,
  inTx,
  pay,
  revisionOf,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { handOverOrder } from "./working-order.js";
import "./errors.js";

let v: PartyVenue;
let app: Hono;
let cookie: string;

const NOW = new Date("2026-10-10T12:00:00Z");
const REMOVALS = enabledTableRemovals(ALL_MODULES);
let clockAt = NOW;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

beforeAll(async () => {
  const clock: TrustedClock = {
    ...v.clock,
    now: () => ({ ...v.clock.now(), instant: clockAt }),
  };
  app = new Hono();
  mountTillApi(
    app,
    {
      db: v.db,
      backend: v.backend,
      clock,
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

/** The till's floor read; answers the tables it lists. */
async function readFloor(): Promise<{ id: string; label: string }[]> {
  const answer = await send("GET", "/api/tables/state");
  expect(answer.status).toBe(200);
  return (await answer.json()) as { id: string; label: string }[];
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

/** A fresh table-service zone, so one case's plans never meet another's. */
async function zone(): Promise<string> {
  const id = randomUUID();
  await inTx(v, async (tx) => {
    const [tables] = await tx
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, v.tables.zoneId));
    await tx
      .insert(floorZones)
      .values({ id, locationId: v.cfg.locationId, name: `Zone ${id.slice(0, 8)}` });
    await tx.insert(zoneServicePolicies).values({
      locationId: v.cfg.locationId,
      zoneId: id,
      departmentId: tables!.departmentId,
    });
    await tx.insert(zoneSalePolicies).values({ zoneId: id, orderStart: "table" });
  });
  return id;
}

/** A label no other case uses: names are unique across the venue. */
function fresh(label: string): string {
  return `${label} ${randomUUID().slice(0, 6)}`;
}

type Entry = ZonePlanSave["tables"][number];

function entry(key: string, label: string, extra: Partial<Entry> = {}): Entry {
  return { key, label, seats: 4, fixed: false, placement: place(0, 0), ...extra };
}

function place(x: number, y: number) {
  return { x, y, width: 8, height: 8, shape: "rect" as const, rotation: 0 };
}

function save(zoneId: string, revision: number, tables: Entry[]) {
  return inTx(v, (tx) =>
    saveZonePlan(tx, v.cfg, REMOVALS, zoneId, { revision, tables, joins: [] }, NOW),
  );
}

const reset = (zoneId: string) => inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW));

async function todayRow(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorTodayTables).where(eq(floorTodayTables.tableId, tableId)),
  );
  return row;
}

async function moveToday(tableId: string, x: number): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(floorTodayTables).set({ x }).where(eq(floorTodayTables.tableId, tableId)),
  );
}

async function tableExists(tableId: string): Promise<boolean> {
  const rows = await inTx(v, (tx) =>
    tx.select({ id: diningTables.id }).from(diningTables).where(eq(diningTables.id, tableId)),
  );
  return rows.length > 0;
}

async function generationOf(zoneId: string): Promise<number | undefined> {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId)),
  );
  return row?.generation;
}

/** A zone whose first saved master holds one live table; answers both ids. */
async function plannedTable(label: string) {
  const zoneId = await zone();
  const tableId = await v.table(label, zoneId);
  const { revision, ids } = await save(zoneId, 0, [entry("t", label, { liveTableId: tableId })]);
  return { zoneId, tableId, masterId: ids.t!, revision };
}

describe("the till's floor routes catch today's plan up", () => {
  it("brings a table back to the master on the first floor read after its party finishes", async () => {
    const label = fresh("T1");
    const { zoneId, tableId, masterId, revision } = await plannedTable(label);
    const partyId = await seatAt(tableId);
    await moveToday(tableId, 30);
    await save(zoneId, revision, [entry("t", label, { id: masterId, placement: place(50, 0) })]);
    await reset(zoneId);
    expect(await todayRow(tableId)).toMatchObject({ x: 30 });

    await finish(partyId);
    expect(await todayRow(tableId)).toMatchObject({ x: 30 });
    await readFloor();

    expect(await todayRow(tableId)).toMatchObject({ x: 50 });
  });

  it("removes a table deleted from the master once its party finishes", async () => {
    const label = fresh("T4");
    const { zoneId, tableId, revision } = await plannedTable(label);
    const other = fresh("T5");
    const partyId = await seatAt(tableId);
    await save(zoneId, revision, [entry("other", other, { placement: place(20, 0) })]);
    await reset(zoneId);
    expect((await readFloor()).map((t) => t.id)).toContain(tableId);

    await finish(partyId);
    expect(await tableExists(tableId)).toBe(true);
    const floor = await readFloor();

    expect(await tableExists(tableId)).toBe(false);
    expect(floor.map((t) => t.id)).not.toContain(tableId);
    expect(floor.map((t) => t.label)).toContain(other);
  });

  it("creates a new table that was waiting for its name once the old one is free", async () => {
    const four = fresh("Terrace 4");
    const nine = fresh("Terrace 9");
    const { zoneId, tableId, masterId, revision } = await plannedTable(four);
    const partyId = await seatAt(tableId);
    await save(zoneId, revision, [
      entry("t", nine, { id: masterId }),
      entry("new", four, { placement: place(20, 0) }),
    ]);
    await reset(zoneId);
    expect((await tableRow(v, tableId)).label).toBe(four);

    await finish(partyId);
    const floor = await readFloor();

    expect(floor.find((t) => t.id === tableId)?.label).toBe(nine);
    const created = floor.find((t) => t.label === four);
    expect(created).toBeDefined();
    expect(created!.id).not.toBe(tableId);
  });

  it("frees a table when its delivery is collected, at the next read", async () => {
    const label = fresh("Delivered");
    const { zoneId, tableId, revision } = await plannedTable(label);
    const order = await counterOrder(v, "Paella");
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ deliveryTableId: tableId }).where(eq(workingOrders.id, order)),
    );
    await save(zoneId, revision, []);
    await reset(zoneId);
    expect(await tableExists(tableId)).toBe(true);

    await pay(v, order, "20.00");
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, order));
    expect(await tableExists(tableId)).toBe(true);
    await readFloor();

    expect(await tableExists(tableId)).toBe(false);
    const [released] = await inTx(v, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, order)),
    );
    expect(released).toMatchObject({ deliveryTableId: null, deliveryTableLabel: label });
  });

  it("does nothing when no reset happened while the table was taken", async () => {
    const { zoneId, tableId } = await plannedTable(fresh("Kept"));
    const generation = await generationOf(zoneId);
    const partyId = await seatAt(tableId);
    await moveToday(tableId, 30);

    await finish(partyId);
    await readFloor();

    expect(await todayRow(tableId)).toMatchObject({ x: 30 });
    expect(await generationOf(zoneId)).toBe(generation);
  });

  // Last: it moves every zone of the shared venue to the next business day.
  it("resets before seating on a new business day", async () => {
    const label = fresh("Day");
    const renamed = fresh("Day b");
    const { zoneId, tableId, masterId, revision } = await plannedTable(label);
    await save(zoneId, revision, [entry("t", renamed, { id: masterId })]);
    const generation = (await generationOf(zoneId))!;
    const [{ cutover }] = (await inTx(v, (tx) =>
      tx
        .select({ cutover: locations.dayCutover })
        .from(locations)
        .where(eq(locations.id, v.cfg.locationId)),
    )) as [{ cutover: string }];
    await inTx(v, (tx) =>
      tx.update(locations).set({ dayCutover: "04:00" }).where(eq(locations.id, v.cfg.locationId)),
    );
    // 05:00 in Europe/Madrid, two hours ahead of UTC on this date.
    clockAt = new Date("2026-10-11T03:00:00Z");

    try {
      await seatAt(tableId);

      expect(await generationOf(zoneId)).toBe(generation + 1);
      expect((await tableRow(v, tableId)).label).toBe(renamed);
    } finally {
      clockAt = NOW;
      await withTransaction(v.db, (tx) =>
        tx.update(locations).set({ dayCutover: cutover }).where(eq(locations.id, v.cfg.locationId)),
      );
    }
  });
});
