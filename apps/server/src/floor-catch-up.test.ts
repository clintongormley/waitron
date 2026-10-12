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
  locations,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { readZonePlan, saveZonePlan, type ZonePlanSave } from "./floor-plan.js";
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
import { tableServiceZone } from "./testing/floor-today-venue.js";
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

/** Each table the till's floor read lists, with the joined table it names, if any. */
async function readJoined(): Promise<Map<string, string | null>> {
  const answer = await send("GET", "/api/tables/state");
  expect(answer.status).toBe(200);
  const tables = (await answer.json()) as { id: string; today: { inJoinedTable: string | null } }[];
  return new Map(tables.map((t) => [t.id, t.today.inJoinedTable]));
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
function zone(): Promise<string> {
  return tableServiceZone(v);
}

/** A label no other case uses: names are unique across the venue. */
function fresh(label: string): string {
  return `${label} ${randomUUID().slice(0, 6)}`;
}

type Entry = ZonePlanSave["tables"][number];

function entry(key: string, label: string, extra: Partial<Entry> = {}): Entry {
  return { key, label, seats: 4, fixed: false, placement: place(0, 0), partKeys: [], ...extra };
}

function place(x: number, y: number) {
  return { x, y, width: 8, height: 8, shape: "rect" as const, rotation: 0 };
}

function save(zoneId: string, revision: number, tables: Entry[]) {
  return inTx(v, (tx) => saveZonePlan(tx, v.cfg, REMOVALS, zoneId, { revision, tables }, NOW));
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
  const { revision, ids } = await save(zoneId, 0, [entry("t", label)]);
  const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, zoneId));
  const tableId = plan.tables.find((t) => t.id === ids.t)!.liveTableId!;
  return { zoneId, tableId, masterId: ids.t!, revision };
}

/**
 * A zone where a party holds T9 while the save deletes it and makes Long table, under T9's name,
 * of Counter 3, 4 and 5, all three off the plan; Bar stays placed. Long table waits for its name.
 */
async function longWaitsForItsName() {
  const zoneId = await zone();
  const [long, c3, c4, c5, bar] = [
    fresh("T9"),
    fresh("Counter 3"),
    fresh("Counter 4"),
    fresh("Counter 5"),
    fresh("Bar"),
  ];
  const first = await save(zoneId, 0, [
    entry("t9", long, { placement: place(0, 0) }),
    entry("c3", c3, { seats: 2, placement: null }),
    entry("c4", c4, { seats: 6, placement: null }),
    entry("c5", c5, { seats: 4, placement: null }),
    entry("bar", bar, { placement: place(60, 0) }),
  ]);
  const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, zoneId));
  const liveOf = (key: string) => plan.tables.find((t) => t.id === first.ids[key])!.liveTableId!;
  const held = await seatAt(liveOf("t9"));
  await save(zoneId, first.revision, [
    entry("c3", c3, { id: first.ids.c3, seats: 2, placement: null }),
    entry("c4", c4, { id: first.ids.c4, seats: 6, placement: null }),
    entry("c5", c5, { id: first.ids.c5, seats: 4, placement: null }),
    entry("bar", bar, { id: first.ids.bar, placement: place(60, 0) }),
    entry("long", long, { seats: 10, placement: place(0, 20), partKeys: ["c3", "c4", "c5"] }),
  ]);
  await reset(zoneId);
  const waiting = await readJoined();
  expect(waiting.get(liveOf("c4"))).toBeNull();
  return {
    held,
    long,
    t3: liveOf("c3"),
    t4: liveOf("c4"),
    t5: liveOf("c5"),
    bar: liveOf("bar"),
  };
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

  it("a table made a part while a party sits at it stays usable until the party finishes", async () => {
    const zoneId = await zone();
    const [long, c3, c4, c5] = [
      fresh("Long"),
      fresh("Counter 3"),
      fresh("Counter 4"),
      fresh("Counter 5"),
    ];
    const first = await save(zoneId, 0, [
      entry("c3", c3, { seats: 2, placement: place(0, 0) }),
      entry("c4", c4, { seats: 6, placement: place(20, 0) }),
      entry("c5", c5, { seats: 4, placement: place(40, 0) }),
    ]);
    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, zoneId));
    const liveOf = (key: string) => plan.tables.find((t) => t.id === first.ids[key])!.liveTableId!;
    const [t3, t4, t5] = [liveOf("c3"), liveOf("c4"), liveOf("c5")];
    const partyId = await seatAt(t3);
    await save(zoneId, first.revision, [
      entry("c3", c3, { id: first.ids.c3, seats: 2, placement: null }),
      entry("c4", c4, { id: first.ids.c4, seats: 6, placement: null }),
      entry("c5", c5, { id: first.ids.c5, seats: 4, placement: null }),
      entry("long", long, { seats: 10, placement: place(0, 20), partKeys: ["c3", "c4", "c5"] }),
    ]);
    const answer = await send("POST", `/api/zones/${zoneId}/today/reset`, {});
    expect(answer.status).toBe(204);

    const before = await readJoined();
    expect(before.get(t3)).toBeNull();
    expect(before.get(t4)).toBe(long);
    expect(before.get(t5)).toBe(long);

    await finish(partyId);
    expect((await readJoined()).get(t3)).toBe(long);
  });

  it("a part a party holds when its joined table goes live stays usable until the party finishes", async () => {
    const z = await longWaitsForItsName();
    const p2 = await seatAt(z.t3);
    const joined = await send("POST", `/api/parties/${p2}/join`, {
      tableId: z.t4,
      expectedPartyRevision: await revisionOf(v, p2),
    });
    expect(joined.status).toBe(200);

    await finish(z.held);
    const live = await readJoined();
    expect(live.get(z.t5)).toBe(z.long);
    expect(live.get(z.t3)).toBeNull();
    expect(live.get(z.t4)).toBeNull();

    const split = await send("POST", `/api/parties/${p2}/split-table`, {
      tableId: z.t4,
      billId: null,
      expectedPartyRevision: await revisionOf(v, p2),
    });
    expect(split.status).toBe(200);
    const p3 = ((await split.json()) as { partyId: string }).partyId;
    expect((await readJoined()).get(z.t4)).toBeNull();

    await finish(p2);
    const afterP2 = await readJoined();
    expect(afterP2.get(z.t3)).toBe(z.long);
    expect(afterP2.get(z.t4)).toBeNull();

    await finish(p3);
    expect((await readJoined()).get(z.t4)).toBe(z.long);
  });

  it("a part merged on today's map when its joined table goes live stays usable until the merge ends", async () => {
    const z = await longWaitsForItsName();
    const placed = await send("POST", `/api/tables/${z.t3}/today/place`, { x: 20, y: 40 });
    expect(placed.status).toBe(204);
    const merged = await send("POST", `/api/tables/${z.t3}/today/merge`, {
      targetId: z.bar,
      side: "right",
      seats: 6,
    });
    expect(merged.status).toBe(204);

    await finish(z.held);
    const live = await readJoined();
    expect(live.get(z.t4)).toBe(z.long);
    expect(live.get(z.t3)).toBeNull();

    const party = await seatAt(z.bar);
    expect((await readJoined()).get(z.t3)).toBeNull();
    await finish(party);
    expect((await readJoined()).get(z.t3)).toBeNull();

    const split = await send("POST", `/api/tables/${z.bar}/today/split`, {});
    expect(split.status).toBe(204);
    expect((await readJoined()).get(z.t3)).toBe(z.long);
    expect((await todayRow(z.t3))?.x).not.toBeNull();
  });

  it("a part whose merge is split after its joined table goes live is free, still joined and still placed", async () => {
    const z = await longWaitsForItsName();
    expect((await send("POST", `/api/tables/${z.t3}/today/place`, { x: 20, y: 40 })).status).toBe(
      204,
    );
    const merged = await send("POST", `/api/tables/${z.t3}/today/merge`, {
      targetId: z.bar,
      side: "right",
      seats: 6,
    });
    expect(merged.status).toBe(204);
    await finish(z.held);
    await readJoined();
    expect((await send("POST", `/api/tables/${z.bar}/today/split`, {})).status).toBe(204);

    const answer = await send("GET", "/api/tables/state");
    expect(answer.status).toBe(200);
    const tables = (await answer.json()) as {
      id: string;
      state: string;
      condition: string;
      today: { inJoinedTable: string | null; placement: unknown };
    }[];
    const part = tables.find((t) => t.id === z.t3)!;
    expect(part).toMatchObject({ state: "free", condition: "free" });
    expect(part.today.inJoinedTable).toBe(z.long);
    expect(part.today.placement).not.toBeNull();
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
});

/**
 * Runs `act` at 05:00 Madrid on the next business day (cutover 04:00), then puts the venue's
 * cutover and every zone's day back, so later cases start on NOW's business day again.
 */
async function onNextDay(act: () => Promise<void>): Promise<void> {
  const [{ cutover }] = (await inTx(v, (tx) =>
    tx
      .select({ cutover: locations.dayCutover })
      .from(locations)
      .where(eq(locations.id, v.cfg.locationId)),
  )) as [{ cutover: string }];
  await inTx(v, (tx) =>
    tx.update(locations).set({ dayCutover: "04:00" }).where(eq(locations.id, v.cfg.locationId)),
  );
  // Two hours ahead of UTC on this date.
  clockAt = new Date("2026-10-11T03:00:00Z");
  try {
    await act();
  } finally {
    clockAt = NOW;
    await withTransaction(v.db, async (tx) => {
      await tx
        .update(locations)
        .set({ dayCutover: cutover })
        .where(eq(locations.id, v.cfg.locationId));
      await tx
        .update(floorTodayZones)
        .set({ businessDay: "2026-10-10" })
        .where(eq(floorTodayZones.businessDay, "2026-10-11"));
    });
  }
}

/** A zone whose master renames its one live table; answers the ids and both names. */
async function renamedInMaster() {
  const label = fresh("Day");
  const renamed = fresh("Day b");
  const planned = await plannedTable(label);
  await save(planned.zoneId, planned.revision, [entry("t", renamed, { id: planned.masterId })]);
  return { ...planned, label, renamed, generation: (await generationOf(planned.zoneId))! };
}

/** Seats `tableId`'s party at a second free table of the venue's tables zone too. */
async function joinSecond(partyId: string): Promise<string> {
  const second = await v.table(fresh("Second"));
  const answer = await send("POST", `/api/parties/${partyId}/join`, {
    tableId: second,
    expectedPartyRevision: await revisionOf(v, partyId),
  });
  expect(answer.status).toBe(200);
  return second;
}

describe("on a new business day, the till's floor routes reset today's plan before acting", () => {
  it("resets before seating", async () => {
    const { zoneId, tableId, renamed, generation } = await renamedInMaster();

    await onNextDay(async () => {
      await seatAt(tableId);

      expect(await generationOf(zoneId)).toBe(generation + 1);
      expect((await tableRow(v, tableId)).label).toBe(renamed);
    });
  });

  // The party sits outside the planned zone; the planned zone shows whether the reset ran. Each
  // body is built on the old day, so split's join runs before the reset is due.
  const routes: [string, string, (partyId: string) => Promise<Record<string, unknown>>][] = [
    ["finish", "finish", async () => ({})],
    ["move", "move", async () => ({ toTableId: await v.table(fresh("Move to")) })],
    ["join", "join", async () => ({ tableId: await v.table(fresh("Join to")) })],
    [
      "split",
      "split-table",
      async (partyId) => ({ tableId: await joinSecond(partyId), billId: null }),
    ],
  ];

  it.each(routes)("resets before %s", async (_, path, bodyFor) => {
    const { zoneId, tableId, renamed, generation } = await renamedInMaster();
    const partyId = await seatAt(await v.table(fresh("Seated")));
    const body = await bodyFor(partyId);

    await onNextDay(async () => {
      const answer = await send("POST", `/api/parties/${partyId}/${path}`, {
        ...body,
        expectedPartyRevision: await revisionOf(v, partyId),
      });

      expect(answer.status).toBe(200);
      expect(await generationOf(zoneId)).toBe(generation + 1);
      expect((await tableRow(v, tableId)).label).toBe(renamed);
    });
  });
});
