import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorResetTables,
  floorTodaySplitParts,
  floorTodayTables,
  floorTodayZones,
  joinedTableApart,
  locations,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { readLayout, saveLayout, type ZonePlanSave } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { resetZone, type ResetOnto } from "./floor-today-store.js";
import { holdersOf, memberTables } from "./parties.js";
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
import {
  expectRevision,
  mergeOf,
  setsDepartment,
  tableServiceZone,
  withFloorRevision,
  zoneRevisionOf,
} from "./testing/floor-today-venue.js";
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

/** A request; a change to today's floor carries the room's revision unless the body names one. */
async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(await withFloorRevision(v, path, body)) }),
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

/** The table's today as the till's floor read shows it. */
async function todayOf(tableId: string): Promise<{
  placement: unknown;
  joinId: string | null;
  inJoinedTable: string | null;
}> {
  const answer = await send("GET", "/api/tables/state");
  expect(answer.status).toBe(200);
  const tables = (await answer.json()) as {
    id: string;
    today: { placement: unknown; joinId: string | null; inJoinedTable: string | null };
  }[];
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
  return inTx(v, async (tx) =>
    saveLayout(
      tx,
      v.cfg,
      REMOVALS,
      await defaultLayout(tx, v.cfg, zoneId),
      { revision, tables },
      NOW,
    ),
  );
}

const reset = (zoneId: string) =>
  inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW, "due"));

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

/** A zone whose first saved master holds one live table; answers both ids. */
async function plannedTable(label: string) {
  const zoneId = await zone();
  const { revision, ids } = await save(zoneId, 0, [entry("t", label)]);
  const plan = await inTx(v, async (tx) =>
    readLayout(tx, v.cfg, await defaultLayout(tx, v.cfg, zoneId)),
  );
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
  const plan = await inTx(v, async (tx) =>
    readLayout(tx, v.cfg, await defaultLayout(tx, v.cfg, zoneId)),
  );
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

/**
 * A zone where guests sit at Counter 3 when the save makes Long table of Counter 3, 4 and 5, and the
 * reset puts Long table on the map at once; Counter 3 stays where it stood, Bar is placed.
 */
async function counter3HeldAsLongGoesLive() {
  const zoneId = await zone();
  const [long, c3, c4, c5, bar] = [
    fresh("Long"),
    fresh("Counter 3"),
    fresh("Counter 4"),
    fresh("Counter 5"),
    fresh("Bar"),
  ];
  const first = await save(zoneId, 0, [
    entry("c3", c3, { seats: 2, placement: place(0, 0) }),
    entry("c4", c4, { seats: 6, placement: place(20, 0) }),
    entry("c5", c5, { seats: 4, placement: place(40, 0) }),
    entry("bar", bar, { placement: place(60, 40) }),
  ]);
  const plan = await inTx(v, async (tx) =>
    readLayout(tx, v.cfg, await defaultLayout(tx, v.cfg, zoneId)),
  );
  const liveOf = (key: string) => plan.tables.find((t) => t.id === first.ids[key])!.liveTableId!;
  const partyId = await seatAt(liveOf("c3"));
  await save(zoneId, first.revision, [
    entry("c3", c3, { id: first.ids.c3, seats: 2, placement: null }),
    entry("c4", c4, { id: first.ids.c4, seats: 6, placement: null }),
    entry("c5", c5, { id: first.ids.c5, seats: 4, placement: null }),
    entry("bar", bar, { id: first.ids.bar, placement: place(60, 40) }),
    entry("long", long, { seats: 10, placement: place(0, 20), partKeys: ["c3", "c4", "c5"] }),
  ]);
  await reset(zoneId);
  const tables = await readFloor();
  const z = {
    partyId,
    long: tables.find((t) => t.label === long)!.id,
    t3: liveOf("c3"),
    t4: liveOf("c4"),
    t5: liveOf("c5"),
    bar: liveOf("bar"),
  };
  const live = await readJoined();
  expect(live.get(z.t3)).toBeNull();
  expect(live.get(z.t4)).toBe(long);
  return z;
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
    const plan = await inTx(v, async (tx) =>
      readLayout(tx, v.cfg, await defaultLayout(tx, v.cfg, zoneId)),
    );
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
    expect({ status: answer.status, body: await answer.json() }).toEqual({
      status: 200,
      body: { zoneId, revision: (await zoneRevisionOf(v, zoneId))! },
    });

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
    await expectRevision(v, placed);
    const merged = await send("POST", `/api/tables/${z.t3}/today/merge`, {
      targetId: z.bar,
      side: "right",
      seats: 6,
    });
    await expectRevision(v, merged);

    await finish(z.held);
    const live = await readJoined();
    expect(live.get(z.t4)).toBe(z.long);
    expect(live.get(z.t3)).toBeNull();

    const party = await seatAt(z.bar);
    expect((await readJoined()).get(z.t3)).toBeNull();
    await finish(party);
    expect((await readJoined()).get(z.t3)).toBeNull();

    const split = await send("POST", `/api/tables/${z.bar}/today/split-off`, { partIds: [z.t3] });
    await expectRevision(v, split);
    expect((await readJoined()).get(z.t3)).toBe(z.long);
    expect((await todayRow(z.t3))?.x).not.toBeNull();
  });

  it("a part whose merge is split after its joined table goes live is free, still joined and still placed", async () => {
    const z = await longWaitsForItsName();
    await expectRevision(v, send("POST", `/api/tables/${z.t3}/today/place`, { x: 20, y: 40 }));
    const merged = await send("POST", `/api/tables/${z.t3}/today/merge`, {
      targetId: z.bar,
      side: "right",
      seats: 6,
    });
    await expectRevision(v, merged);
    await finish(z.held);
    await readJoined();
    await expectRevision(
      v,
      send("POST", `/api/tables/${z.bar}/today/split-off`, { partIds: [z.t3] }),
    );

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

  for (const pushed of ["Bar onto Long", "Long onto Bar"] as const) {
    it(`a part in use when its joined table goes live is an ordinary table once free, after ${pushed} makes a group`, async () => {
      const z = await counter3HeldAsLongGoesLive();
      const stood = (await todayOf(z.t3)).placement;
      expect(stood).not.toBeNull();
      const [moving, targetId] = pushed === "Bar onto Long" ? [z.bar, z.long] : [z.long, z.bar];

      const merged = await send("POST", `/api/tables/${moving}/today/merge`, {
        targetId,
        side: pushed === "Bar onto Long" ? "left" : "right",
        seats: 14,
      });
      await expectRevision(v, merged);
      const group = (await todayOf(z.bar)).joinId;
      expect(group).not.toBeNull();
      expect((await todayOf(z.t4)).joinId).toBe(group);
      expect((await todayOf(z.t5)).joinId).toBe(group);
      expect(await todayOf(z.t3)).toMatchObject({ joinId: null, placement: stood });

      await finish(z.partyId);

      expect(await todayOf(z.t3)).toMatchObject({
        inJoinedTable: null,
        joinId: null,
        placement: stood,
      });
      const seated = await send("POST", `/api/tables/${z.t3}/seat`, {});
      expect(seated.status, await seated.clone().text()).toBe(200);
    });
  }

  it("does nothing when no reset happened while the table was taken", async () => {
    const { zoneId, tableId } = await plannedTable(fresh("Kept"));
    const zoneRevision = await zoneRevisionOf(v, zoneId);
    const partyId = await seatAt(tableId);
    await moveToday(tableId, 30);

    await finish(partyId);
    await readFloor();

    expect(await todayRow(tableId)).toMatchObject({ x: 30 });
    expect(await zoneRevisionOf(v, zoneId)).toBe(zoneRevision);
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
  return { ...planned, label, renamed, zoneRevision: (await zoneRevisionOf(v, planned.zoneId))! };
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
    const { zoneId, tableId, renamed, zoneRevision } = await renamedInMaster();

    await onNextDay(async () => {
      await seatAt(tableId);

      expect(await zoneRevisionOf(v, zoneId)).toBe(zoneRevision + 1);
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
    const { zoneId, tableId, renamed, zoneRevision } = await renamedInMaster();
    const partyId = await seatAt(await v.table(fresh("Seated")));
    const body = await bodyFor(partyId);

    await onNextDay(async () => {
      const answer = await send("POST", `/api/parties/${partyId}/${path}`, {
        ...body,
        expectedPartyRevision: await revisionOf(v, partyId),
      });

      expect(answer.status).toBe(200);
      expect(await zoneRevisionOf(v, zoneId)).toBe(zoneRevision + 1);
      expect((await tableRow(v, tableId)).label).toBe(renamed);
    });
  });
});

/** The live table each of the first save's entries made, by entry key. */
async function liveIdsOf(zoneId: string, ids: Record<string, string>) {
  const plan = await inTx(v, async (tx) =>
    readLayout(tx, v.cfg, await defaultLayout(tx, v.cfg, zoneId)),
  );
  return (key: string) => plan.tables.find((t) => t.id === ids[key])!.liveTableId!;
}

/**
 * Bar is pushed onto Long, an ordinary table, and guests sit at the group; the saved plan then
 * makes Long of Counter 3 and 4 (and 5), and the reset makes Long a joined table while the group
 * waits for its guests. Stool stands apart.
 */
async function longJoinedInSeatedGroup(counters: 2 | 3) {
  const zoneId = await zone();
  const keys = ["c3", "c4", "c5"].slice(0, counters);
  const labels: Record<string, string> = {
    long: fresh("Long"),
    bar: fresh("Bar"),
    stool: fresh("Stool"),
    c3: fresh("Counter 3"),
    c4: fresh("Counter 4"),
    c5: fresh("Counter 5"),
  };
  const first = await save(zoneId, 0, [
    entry("long", labels.long!, { placement: place(0, 20) }),
    ...keys.map((key, i) => entry(key, labels[key]!, { placement: place(20 + 20 * i, 40) })),
    entry("bar", labels.bar!, { placement: place(60, 0) }),
    entry("stool", labels.stool!, { placement: place(80, 60) }),
  ]);
  const liveOf = await liveIdsOf(zoneId, first.ids);
  const merged = send("POST", `/api/tables/${liveOf("bar")}/today/merge`, {
    targetId: liveOf("long"),
    side: "left",
    seats: 12,
  });
  await expectRevision(v, merged);
  const partyId = await seatAt(liveOf("long"));
  await save(zoneId, first.revision, [
    entry("long", labels.long!, { id: first.ids.long, placement: place(0, 20), partKeys: keys }),
    ...keys.map((key) => entry(key, labels[key]!, { id: first.ids[key], placement: null })),
    entry("bar", labels.bar!, { id: first.ids.bar, placement: place(60, 0) }),
    entry("stool", labels.stool!, { id: first.ids.stool, placement: place(80, 60) }),
  ]);
  await reset(zoneId);
  const joined = await readJoined();
  const z = { zoneId, partyId, long: liveOf("long"), bar: liveOf("bar"), stool: liveOf("stool") };
  const counter = keys.map(liveOf);
  for (const id of counter) expect(joined.get(id)).toBe(labels.long);
  expect((await mergeOf(v, z.long))?.members.map((m) => m.tableId).sort()).toEqual(
    [z.long, z.bar].sort(),
  );
  return { ...z, counter };
}

/**
 * Long, an ordinary table, is pushed onto Bar, a table split off Jar; guests sit at Jar, so the
 * group waits with Jar's split when the reset makes Long of Counter 3 and 4. Nobody sits at the
 * group. Stool stands apart.
 */
async function longJoinedInFreeGroup() {
  const zoneId = await zone();
  const [long, c3, c4, jar, bar, ledge, rail, stool] = [
    fresh("Long"),
    fresh("Counter 3"),
    fresh("Counter 4"),
    fresh("Jar"),
    fresh("Bar"),
    fresh("Ledge"),
    fresh("Rail"),
    fresh("Stool"),
  ];
  const tables = (counters: Entry[]) => [
    ...counters,
    entry("jar", jar, { placement: place(60, 0), partKeys: ["bar", "ledge", "rail"] }),
    entry("bar", bar, { placement: null }),
    entry("ledge", ledge, { placement: null }),
    entry("rail", rail, { placement: null }),
    entry("stool", stool, { placement: place(80, 60) }),
  ];
  const first = await save(
    zoneId,
    0,
    tables([
      entry("long", long, { placement: place(0, 20) }),
      entry("c3", c3, { placement: place(20, 40) }),
      entry("c4", c4, { placement: place(40, 40) }),
    ]),
  );
  const liveOf = await liveIdsOf(zoneId, first.ids);
  const z = {
    zoneId,
    long: liveOf("long"),
    bar: liveOf("bar"),
    jar: liveOf("jar"),
    stool: liveOf("stool"),
    counter: [liveOf("c3"), liveOf("c4")],
  };
  await expectRevision(
    v,
    send("POST", `/api/tables/${z.jar}/today/split-off`, { partIds: [z.bar], seats: 8 }),
  );
  const barStood = await todayRow(z.bar);
  await expectRevision(
    v,
    send("POST", `/api/tables/${z.long}/today/merge`, {
      targetId: z.bar,
      side: "right",
      seats: 12,
    }),
  );
  const partyId = await seatAt(z.jar);
  const kept = (key: string) => ({ id: first.ids[key] });
  await save(zoneId, first.revision, [
    entry("long", long, { ...kept("long"), placement: place(0, 20), partKeys: ["c3", "c4"] }),
    entry("c3", c3, { ...kept("c3"), placement: null }),
    entry("c4", c4, { ...kept("c4"), placement: null }),
    entry("jar", jar, {
      ...kept("jar"),
      placement: place(60, 0),
      partKeys: ["bar", "ledge", "rail"],
    }),
    entry("bar", bar, { ...kept("bar"), placement: null }),
    entry("ledge", ledge, { ...kept("ledge"), placement: null }),
    entry("rail", rail, { ...kept("rail"), placement: null }),
    entry("stool", stool, { ...kept("stool"), placement: place(80, 60) }),
  ]);
  await reset(zoneId);
  const joined = await readJoined();
  for (const id of z.counter) expect(joined.get(id)).toBe(long);
  expect((await mergeOf(v, z.long))?.members.map((m) => m.tableId).sort()).toEqual(
    [z.long, z.bar].sort(),
  );
  const holders = await inTx(v, (tx) => holdersOf(tx, [z.long, z.bar]));
  expect(holders.size).toBe(0);
  return { ...z, partyId, barStood };
}

/** The joined table's split rows, by part. */
async function splitRowsOf(joinedId: string): Promise<string[]> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({ partId: floorTodaySplitParts.partTableId })
      .from(floorTodaySplitParts)
      .where(eq(floorTodaySplitParts.joinedTableId, joinedId)),
  );
  return rows.map((row) => row.partId).sort();
}

const tablesOf = (partyId: string) =>
  inTx(v, async (tx) => (await memberTables(tx, partyId)).sort());

const sorted = (...ids: string[]) => [...ids].sort();

async function refusal(answer: Promise<Response>): Promise<{ status: number; body: unknown }> {
  const settled = await answer;
  return { status: settled.status, body: await settled.json() };
}

/** Today's rows of the tables, in the order given. */
async function todayRows(tableIds: readonly string[]) {
  const rows = [];
  for (const id of tableIds) rows.push(await todayRow(id));
  return rows;
}

/** 1 when the floor counts the joined table as come apart. */
async function apart(tableId: string): Promise<number | null> {
  const rows = await v.db.all<{ id: string; named: number | null }>(
    sql`select dt.id, ${joinedTableApart(sql`dt.id`)} as named from dining_tables dt`,
  );
  return rows.find((row) => row.id === tableId)!.named;
}

describe("a joined table the reset leaves in one of today's groups", () => {
  it("refuses splitting it down to one while guests sit at the group, writing nothing", async () => {
    const z = await longJoinedInSeatedGroup(2);
    const group = await mergeOf(v, z.long);
    const revision = await revisionOf(v, z.partyId);
    const tables = [z.long, z.bar, ...z.counter];
    const rows = await todayRows(tables);

    const answer = send("POST", `/api/tables/${z.long}/today/split-off`, {
      partIds: [z.counter[0]],
    });

    expect(await refusal(answer)).toEqual({
      status: 409,
      body: { error: { code: "tab.already_open", params: { tableId: sorted(z.long, z.bar)[0] } } },
    });
    expect(await todayRows(tables)).toEqual(rows);
    expect(await mergeOf(v, z.long)).toEqual(group);
    expect(await tablesOf(z.partyId)).toEqual(sorted(z.long, z.bar));
    expect(await revisionOf(v, z.partyId)).toBe(revision);
    expect(await splitRowsOf(z.long)).toEqual([]);
  });

  it("splitting it down to one ends a free group first, putting both tables back where they stood", async () => {
    const z = await longJoinedInFreeGroup();
    const before = new Map((await mergeOf(v, z.long))!.members.map((m) => [m.tableId, m]));

    const answer = send("POST", `/api/tables/${z.long}/today/split-off`, {
      partIds: [z.counter[0]],
    });

    await expectRevision(v, answer);
    expect(await mergeOf(v, z.long)).toBeNull();
    expect(await mergeOf(v, z.bar)).toBeNull();
    const long = before.get(z.long)!;
    expect(await todayRow(z.long)).toMatchObject({
      x: long.beforeX,
      y: long.beforeY,
      rotation: long.beforeRotation,
    });
    expect(await todayRow(z.bar)).toEqual(z.barStood);
    expect(await todayRow(z.counter[0]!)).toMatchObject({
      x: long.beforeX,
      y: long.beforeY,
      width: 8,
      height: 8,
    });
    expect(await splitRowsOf(z.long)).toEqual(sorted(...z.counter));
    expect(await apart(z.long)).toBe(1);
  });

  it("splitting parts off it while two stay joined leaves the group as it is", async () => {
    const z = await longJoinedInSeatedGroup(3);
    const group = await mergeOf(v, z.long);
    const longBefore = (await todayRow(z.long))!;

    const answer = send("POST", `/api/tables/${z.long}/today/split-off`, {
      partIds: [z.counter[0]],
      seats: 6,
    });

    await expectRevision(v, answer);
    expect(await mergeOf(v, z.long)).toEqual(group);
    // The counters stand side by side from Long's left edge; Counter 3, 8 wide, took the first place.
    expect(await todayRow(z.long)).toMatchObject({
      x: longBefore.x! + 8,
      y: longBefore.y,
      width: 16,
      height: 8,
      seats: 6,
    });
    expect(await tablesOf(z.partyId)).toEqual(sorted(z.long, z.bar));
    expect(await splitRowsOf(z.long)).toEqual([z.counter[0]]);
  });

  it("a table pushed onto it joins the group, and the joined table stays whole in it", async () => {
    const z = await longJoinedInFreeGroup();

    const answer = send("POST", `/api/tables/${z.stool}/today/merge`, {
      targetId: z.long,
      side: "right",
      seats: 14,
    });

    await expectRevision(v, answer);
    const group = await mergeOf(v, z.long);
    expect(group?.members.map((m) => m.tableId).sort()).toEqual(sorted(z.long, z.bar, z.stool));
    expect(await splitRowsOf(z.long)).toEqual([]);
  });

  it("guests joining a table pushed onto it hold the group, the joined table whole in it", async () => {
    const z = await longJoinedInSeatedGroup(2);

    const answer = await send("POST", `/api/parties/${z.partyId}/join`, {
      zoneRevision: await zoneRevisionOf(v, z.zoneId),
      tableId: z.stool,
      bills: "merge",
      expectedPartyRevision: await revisionOf(v, z.partyId),
      otherPartyId: null,
      merge: { moving: z.stool, target: z.long, side: "right", seats: 14 },
    });

    expect(answer.status, await answer.clone().text()).toBe(200);
    const group = await mergeOf(v, z.long);
    expect(group?.members.map((m) => m.tableId).sort()).toEqual(sorted(z.long, z.bar, z.stool));
    expect(await tablesOf(z.partyId)).toEqual(sorted(z.long, z.bar, z.stool));
    expect(await splitRowsOf(z.long)).toEqual([]);
  });

  it("Reset table keeps the guests at it, their party's revision and the group", async () => {
    const z = await longJoinedInSeatedGroup(3);
    await expectRevision(
      v,
      send("POST", `/api/tables/${z.long}/today/split-off`, {
        partIds: [z.counter[0]],
        seats: 6,
      }),
    );
    const revision = await revisionOf(v, z.partyId);
    const group = await mergeOf(v, z.long);

    const answer = send("POST", `/api/tables/${z.long}/today/reset`, {
      partIds: [z.counter[0]],
    });

    await expectRevision(v, answer);
    expect(await tablesOf(z.partyId)).toEqual(sorted(z.long, z.bar));
    expect(await revisionOf(v, z.partyId)).toBe(revision);
    expect(await mergeOf(v, z.long)).toEqual(group);
    expect(await splitRowsOf(z.long)).toEqual([]);
  });
});

const MARKED = "2026-10-10T11:00:00.000Z";

const markNeedsClearing = (tableId: string) =>
  inTx(v, (tx) =>
    tx.update(diningTables).set({ needsClearingSince: MARKED }).where(eq(diningTables.id, tableId)),
  );

async function resetRowOf(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ pending: floorResetTables.pending, placed: floorResetTables.placed })
      .from(floorResetTables)
      .where(eq(floorResetTables.tableId, tableId)),
  );
  return row;
}

/**
 * A department with Standard and Dinner holding the same tables, `placedIn` naming each table's
 * place in each; answers the live tables by key and a reset onto either set.
 */
async function standardAndDinner(
  tables: { key: string; label: string; partKeys?: string[] }[],
  placedIn: { standard: Record<string, number | null>; dinner: Record<string, number | null> },
) {
  const d = await setsDepartment(v, new Date("2026-10-09T06:00:00Z"));
  const saveSet = async (setId: string, entries: Entry[]) => {
    const plan = await inTx(v, (tx) => readLayout(tx, v.cfg, { setId, zoneId: d.zoneId }));
    return inTx(v, (tx) =>
      saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        { setId, zoneId: d.zoneId },
        { revision: plan.revision, tables: entries },
        NOW,
      ),
    );
  };
  const at = (x: number | null | undefined) => (x == null ? null : place(x, 0));
  const { ids } = await saveSet(
    d.standard,
    tables.map((t) =>
      entry(t.key, t.label, {
        placement: at(placedIn.standard[t.key]),
        partKeys: t.partKeys ?? [],
      }),
    ),
  );
  const standard = await inTx(v, (tx) =>
    readLayout(tx, v.cfg, { setId: d.standard, zoneId: d.zoneId }),
  );
  const keyOf = new Map(Object.entries(ids).map(([key, id]) => [id, key]));
  await saveSet(
    d.dinner,
    standard.tables.map((t) => ({
      id: t.id,
      key: t.id,
      label: t.label,
      seats: t.seats,
      fixed: t.fixed,
      placement: at(placedIn.dinner[keyOf.get(t.id)!]),
      partKeys: t.partIds,
    })),
  );
  const live = (key: string) => standard.tables.find((t) => t.id === ids[key])!.liveTableId!;
  const onto = (setId: string, options?: { keepTakenOff: boolean }) =>
    inTx(v, (tx) =>
      resetZone(
        tx,
        v.cfg,
        REMOVALS,
        d.zoneId,
        NOW,
        { setId, occurrence: null } satisfies ResetOnto,
        options,
      ),
    );
  return { d, live, onto };
}

/** 4 and 5 stand in Standard and 4+5 is off; Dinner stands 4+5 and leaves 4 and 5 off. */
async function fourAndFive() {
  const s = await standardAndDinner(
    [
      { key: "t4", label: fresh("4") },
      { key: "t5", label: fresh("5") },
      { key: "t45", label: fresh("4+5"), partKeys: ["t4", "t5"] },
    ],
    { standard: { t4: 0, t5: 20, t45: null }, dinner: { t4: null, t5: null, t45: 0 } },
  );
  return { ...s, t4: s.live("t4"), t5: s.live("t5"), t45: s.live("t45") };
}

describe("the reset waiting rules", () => {
  it("a free table needing clearing stays where it is at Reset to saved plan", async () => {
    const { zoneId, tableId } = await plannedTable(fresh("Wiped"));
    await reset(zoneId);
    await moveToday(tableId, 30);
    await markNeedsClearing(tableId);

    await reset(zoneId);

    expect(await todayRow(tableId)).toMatchObject({ x: 30 });
    expect(await resetRowOf(tableId)).toEqual({ pending: true, placed: false });
    expect((await tableRow(v, tableId)).needsClearingSince).toBe(MARKED);
  });

  it("the zone reset no longer clears needs clearing on split-off tables it takes back", async () => {
    const zoneId = await zone();
    const [long, c3, c4] = [fresh("Long"), fresh("Counter 3"), fresh("Counter 4")];
    const { ids } = await save(zoneId, 0, [
      entry("c3", c3, { placement: null }),
      entry("c4", c4, { placement: null }),
      entry("long", long, { placement: place(0, 20), partKeys: ["c3", "c4"] }),
    ]);
    await reset(zoneId);
    const liveOf = await liveIdsOf(zoneId, ids);
    const [t3, t4, tLong] = [liveOf("c3"), liveOf("c4"), liveOf("long")];
    await expectRevision(
      v,
      send("POST", `/api/tables/${tLong}/today/split-off`, { partIds: [t4], seats: 2 }),
    );
    await markNeedsClearing(t4);
    const split = await splitRowsOf(tLong);
    expect(split).toEqual(sorted(t3, t4));
    const before = await todayRows([tLong, t3, t4]);

    await reset(zoneId);

    expect((await tableRow(v, t4)).needsClearingSince).toBe(MARKED);
    expect(await splitRowsOf(tLong)).toEqual(split);
    expect(await todayRows([tLong, t3, t4])).toEqual(before);
    expect(await resetRowOf(tLong)).toEqual({ pending: true, placed: false });
  });

  it("taking 4 into 4+5 waits while 4 has guests", async () => {
    const z = await fourAndFive();
    await z.onto(z.d.standard);
    await seatAt(z.t4);
    const before = await todayRows([z.t4, z.t5, z.t45]);
    expect(before.map((row) => row?.x)).toEqual([0, 20, null]);

    await z.onto(z.d.dinner);

    expect(await todayRows([z.t4, z.t5, z.t45])).toEqual(before);
    const joined = await readJoined();
    expect(joined.get(z.t4)).toBeNull();
    expect(joined.get(z.t5)).toBeNull();
    await seatAt(z.t5);
  });

  it("4+5 with guests waits joined under a layout that leaves it off", async () => {
    const z = await fourAndFive();
    await z.onto(z.d.dinner);
    await seatAt(z.t45);
    const longBefore = await todayRow(z.t45);
    expect(longBefore).toMatchObject({ x: 0 });

    await z.onto(z.d.standard);

    expect(await todayRow(z.t45)).toEqual(longBefore);
    for (const part of [z.t4, z.t5]) {
      expect(await resetRowOf(part)).toEqual({ pending: true, placed: false });
      expect(await todayRow(part)).toMatchObject({ x: null });
      expect(await refusal(send("POST", `/api/tables/${part}/seat`, {}))).toEqual({
        status: 409,
        body: { error: { code: "table.in_joined_table", params: { tableId: part } } },
      });
    }
  });

  /** Table 9 stands at 0 in Standard and at 40 in Dinner, and is taken off today under Standard. */
  async function nineTakenOff() {
    const s = await standardAndDinner([{ key: "t9", label: fresh("9") }], {
      standard: { t9: 0 },
      dinner: { t9: 40 },
    });
    await s.onto(s.d.standard);
    const t9 = s.live("t9");
    await inTx(v, (tx) =>
      tx.update(floorTodayTables).set({ takenOff: true }).where(eq(floorTodayTables.tableId, t9)),
    );
    return { ...s, t9 };
  }

  it("a reset with keepTakenOff keeps table 9 off at its new place", async () => {
    const z = await nineTakenOff();

    await z.onto(z.d.dinner, { keepTakenOff: true });

    expect(await todayRow(z.t9)).toMatchObject({ x: 40, takenOff: true });
  });

  it("a reset without keepTakenOff puts table 9 back at its new place", async () => {
    const z = await nineTakenOff();

    await z.onto(z.d.dinner);

    expect(await todayRow(z.t9)).toMatchObject({ x: 40, takenOff: false });
  });
});
