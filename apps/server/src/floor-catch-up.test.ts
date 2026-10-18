import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorResetTables,
  floorTodaySplitParts,
  floorTodayTables,
  floorTodayZones,
  floorZones,
  joinedTableApart,
  locations,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { readLayout, saveLayout, type ZonePlanSave } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { catchUpDue, resetZone } from "./floor-today-store.js";
import { resetTable } from "./floor-today-reset-table.js";
import { splitOff } from "./floor-today-split-group.js";
import { writeMerge } from "./floor-today-merges.js";
import { writeClearingWorkflow } from "@waitron/venue-service";
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
  giveKeptSize,
  plannedZone,
  standardAndDinner as standardAndDinnerIn,
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

describe("the till's floor routes catch today's plan up", () => {
  it("leaves a table where it stands, needing moving, on the first floor read after its party finishes", async () => {
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

    expect(await todayRow(tableId)).toMatchObject({ x: 30 });
    expect(await readyOf(tableId)).toEqual({ pending: true, readyToMove: true });
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

  it("a table made a part while a party sits at it keeps its joined table waiting, then needing moving once the party finishes", async () => {
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
    expect(before.get(t4)).toBeNull();
    expect(before.get(t5)).toBeNull();

    await finish(partyId);
    const after = await readJoined();
    expect(after.get(t3)).toBeNull();
    expect(after.get(t4)).toBeNull();
    expect(after.get(t5)).toBeNull();
    for (const part of [t3, t4, t5]) {
      expect(await readyOf(part)).toEqual({ pending: true, readyToMove: true });
    }
  });

  it("parts parties hold when their joined table's name comes free keep it waiting until every party finishes", async () => {
    const z = await longWaitsForItsName();
    const p2 = await seatAt(z.t3);
    const joined = await send("POST", `/api/parties/${p2}/join`, {
      tableId: z.t4,
      expectedPartyRevision: await revisionOf(v, p2),
    });
    expect(joined.status).toBe(200);

    await finish(z.held);
    const live = await readJoined();
    expect(live.get(z.t5)).toBeNull();
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
    expect(afterP2.get(z.t3)).toBeNull();
    expect(afterP2.get(z.t4)).toBeNull();

    await finish(p3);
    const afterP3 = await readJoined();
    for (const part of [z.t3, z.t4, z.t5]) expect(afterP3.get(part)).toBe(z.long);
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

function standardAndDinner(
  tables: { key: string; label: string; partKeys?: string[] }[],
  placedIn: { standard: Record<string, number | null>; dinner: Record<string, number | null> },
) {
  return standardAndDinnerIn(v, NOW, tables, placedIn);
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

  it("a table needing clearing with no today's row gets one at Reset to saved plan, as a held one does", async () => {
    const { zoneId, tableId } = await plannedTable(fresh("Unrowed"));
    await reset(zoneId);
    await inTx(v, (tx) => tx.delete(floorTodayTables).where(eq(floorTodayTables.tableId, tableId)));
    await markNeedsClearing(tableId);

    await reset(zoneId);

    expect(await todayRow(tableId)).toMatchObject({ x: 0, takenOff: false });
    expect(await resetRowOf(tableId)).toEqual({ pending: true, placed: false });
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

  it("a joined table the reset creates waits while guests sit at one of its parts", async () => {
    const zoneId = await zone();
    const [long, c3, c4, c5] = [
      fresh("Long"),
      fresh("Counter 3"),
      fresh("Counter 4"),
      fresh("Counter 5"),
    ];
    const first = await save(zoneId, 0, [
      entry("c3", c3, { placement: place(0, 0) }),
      entry("c4", c4, { placement: place(20, 0) }),
      entry("c5", c5, { placement: place(40, 0) }),
    ]);
    await reset(zoneId);
    const liveOf = await liveIdsOf(zoneId, first.ids);
    const parts = [liveOf("c3"), liveOf("c4"), liveOf("c5")];
    const partyId = await seatAt(parts[0]!);
    await save(zoneId, first.revision, [
      entry("c3", c3, { id: first.ids.c3, placement: null }),
      entry("c4", c4, { id: first.ids.c4, placement: null }),
      entry("c5", c5, { id: first.ids.c5, placement: null }),
      entry("long", long, { placement: place(0, 20), partKeys: ["c3", "c4", "c5"] }),
    ]);
    const before = await todayRows(parts);

    await reset(zoneId);

    expect((await readFloor()).map((t) => t.label)).not.toContain(long);
    expect(await todayRows(parts)).toEqual(before);
    for (const part of parts) {
      expect(await resetRowOf(part)).toEqual({ pending: true, placed: false });
    }
    const joined = await readJoined();
    for (const part of parts) expect(joined.get(part)).toBeNull();

    await finish(partyId);

    const after = await readJoined();
    for (const part of parts) {
      expect(after.get(part)).toBeNull();
      expect(await readyOf(part)).toEqual({ pending: true, readyToMove: true });
    }
    expect(await todayRows(parts)).toEqual(before);
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

  it("Update layout keeps table 9 off at its new place", async () => {
    const z = await nineTakenOff();

    await z.update(z.d.dinner);

    expect(await todayRow(z.t9)).toMatchObject({ x: 40, takenOff: true });
  });

  it("a reset onto a set puts table 9 back at its new place", async () => {
    const z = await nineTakenOff();

    await z.onto(z.d.dinner);

    expect(await todayRow(z.t9)).toMatchObject({ x: 40, takenOff: false });
  });
});

async function readyOf(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ pending: floorResetTables.pending, readyToMove: floorResetTables.readyToMove })
      .from(floorResetTables)
      .where(eq(floorResetTables.tableId, tableId)),
  );
  return row;
}

/** The till's floor read, by table. */
async function readStates() {
  const answer = await send("GET", "/api/tables/state");
  expect(answer.status).toBe(200);
  const tables = (await answer.json()) as {
    id: string;
    label: string;
    condition: string;
    today: { needsMoving: boolean };
  }[];
  return new Map(tables.map((t) => [t.id, t]));
}

const clearingWorkflow = (on: boolean) => inTx(v, (tx) => writeClearingWorkflow(tx, on));

/**
 * Table 3 stands at 0 in Standard and 40 in Dinner, beside `more`; guests sit at 3 when the zone
 * resets onto Dinner.
 */
async function threeSeatedAcrossDinner(
  more: { key: string; standard: number | null; dinner: number | null; partKeys?: string[] }[] = [],
) {
  const s = await standardAndDinner(
    [
      { key: "t3", label: fresh("3") },
      ...more.map((m) => ({ key: m.key, label: fresh(m.key), partKeys: m.partKeys })),
    ],
    {
      standard: { t3: 0, ...Object.fromEntries(more.map((m) => [m.key, m.standard])) },
      dinner: { t3: 40, ...Object.fromEntries(more.map((m) => [m.key, m.dinner])) },
    },
  );
  await s.onto(s.d.standard);
  const t3 = s.live("t3");
  const partyId = await seatAt(t3);
  await s.onto(s.d.dinner);
  expect(await todayRow(t3)).toMatchObject({ x: 0 });
  return { ...s, t3, partyId };
}

describe("a table that frees up after a reset needs moving", () => {
  it("a table that frees up after a reset needs moving and stays put", async () => {
    await clearingWorkflow(false);
    const z = await threeSeatedAcrossDinner();

    await finish(z.partyId);
    const states = await readStates();

    expect(await todayRow(z.t3)).toMatchObject({ x: 0 });
    expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: true });
    expect(states.get(z.t3)!.today.needsMoving).toBe(true);
    await readStates();
    expect(await todayRow(z.t3)).toMatchObject({ x: 0 });
  });

  it("with clearing on, a table shows Needs clearing first and Needs moving once cleared", async () => {
    await clearingWorkflow(true);
    try {
      const z = await threeSeatedAcrossDinner();

      await finish(z.partyId);
      const first = await readStates();
      expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: false });
      expect(first.get(z.t3)).toMatchObject({
        condition: "needs_clearing",
        today: { needsMoving: false },
      });

      const cleared = await send("POST", `/api/tables/${z.t3}/cleared`, {});
      expect(cleared.status).toBe(204);
      const second = await readStates();

      expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: true });
      expect(second.get(z.t3)!.today.needsMoving).toBe(true);
      expect(await todayRow(z.t3)).toMatchObject({ x: 0 });
    } finally {
      await clearingWorkflow(false);
    }
  });

  it("a seats-only change still applies by itself", async () => {
    await clearingWorkflow(false);
    const label = fresh("Seats");
    const { zoneId, tableId, masterId, revision } = await plannedTable(label);
    const partyId = await seatAt(tableId);
    await save(zoneId, revision, [entry("t", label, { id: masterId, seats: 6 })]);
    await reset(zoneId);
    expect(await todayRow(tableId)).toMatchObject({ seats: 4 });

    await finish(partyId);
    const states = await readStates();

    expect(await todayRow(tableId)).toMatchObject({ x: 0, seats: 6 });
    expect(await readyOf(tableId)).toEqual({ pending: false, readyToMove: false });
    expect(states.get(tableId)!.today.needsMoving).toBe(false);
  });

  it("a row waiting for its name still applies", async () => {
    await clearingWorkflow(false);
    const zoneId = await zone();
    const [p, q, r] = [fresh("P"), fresh("Q"), fresh("R")];
    const first = await save(zoneId, 0, [
      entry("p", p, { placement: place(0, 0) }),
      entry("q", q, { placement: place(20, 0) }),
    ]);
    const liveOf = await liveIdsOf(zoneId, first.ids);
    const [tp, tq] = [liveOf("p"), liveOf("q")];
    const partyId = await seatAt(tq);
    await save(zoneId, first.revision, [
      entry("p", q, { id: first.ids.p, placement: place(50, 0) }),
      entry("q", r, { id: first.ids.q, placement: place(20, 0) }),
    ]);
    await reset(zoneId);
    expect(await readyOf(tp)).toEqual({ pending: true, readyToMove: false });
    await moveToday(tp, 30);

    await finish(partyId);
    await readStates();

    expect((await tableRow(v, tp)).label).toBe(q);
    expect((await tableRow(v, tq)).label).toBe(r);
    expect(await todayRow(tp)).toMatchObject({ x: 30 });
    expect(await readyOf(tp)).toEqual({ pending: false, readyToMove: false });
  });

  it("a table seated with no today's row is still seeded", async () => {
    await clearingWorkflow(false);
    const label = fresh("Unrowed seat");
    const { zoneId, tableId, masterId, revision } = await plannedTable(label);
    const partyId = await seatAt(tableId);
    await inTx(v, (tx) => tx.delete(floorTodayTables).where(eq(floorTodayTables.tableId, tableId)));
    await save(zoneId, revision, [entry("t", label, { id: masterId, placement: place(50, 0) })]);

    await reset(zoneId);
    expect(await todayRow(tableId)).toMatchObject({ x: 50, takenOff: false });

    await finish(partyId);
    await readStates();
    expect(await todayRow(tableId)).toMatchObject({ x: 50 });
    expect(await readyOf(tableId)).toEqual({ pending: false, readyToMove: false });
  });

  it("Reset table's catch-up marks another table, not moves it", async () => {
    await clearingWorkflow(false);
    const z = await threeSeatedAcrossDinner([
      { key: "t4", standard: 60, dinner: null },
      { key: "t5", standard: 80, dinner: null },
      { key: "t6", standard: 100, dinner: null },
      { key: "long", standard: null, dinner: 60, partKeys: ["t4", "t5", "t6"] },
    ]);
    const [t4, long] = [z.live("t4"), z.live("long")];
    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, NOW, { tableId: long, partIds: [t4], seats: 6 }),
    );
    await finish(z.partyId);
    expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: false });

    await inTx(v, (tx) =>
      resetTable(tx, v.cfg, REMOVALS, NOW, { tableId: long, partIds: [t4], seats: null }),
    );

    expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: true });
    expect(await todayRow(z.t3)).toMatchObject({ x: 0 });
  });

  it("Split's catch-up marks another table, not moves it", async () => {
    await clearingWorkflow(false);
    const z = await plannedZone(
      v,
      [
        { key: "c3", label: "Counter 3", seats: 2, place: null },
        { key: "c4", label: "Counter 4", seats: 6, place: null },
        { key: "c5", label: "Counter 5", seats: 4, place: null },
        {
          key: "long",
          label: "Long table",
          seats: 10,
          place: { x: 10, y: 20, width: 6, height: 2 },
          partKeys: ["c3", "c4", "c5"],
        },
        { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0, width: 2, height: 2 } },
        { key: "t3", label: "3", place: { x: 60, y: 0 } },
      ],
      NOW,
    );
    for (const key of ["c3", "c4", "c5"])
      await giveKeptSize(v, z.master[key]!, { width: 2, height: 2 });
    const [t3, long, bar] = [z.table.t3!, z.table.long!, z.table.bar!];
    const partyId = await seatAt(t3);
    const layout = await inTx(v, (tx) => defaultLayout(tx, v.cfg, z.zoneId));
    const saved = await inTx(v, (tx) => readLayout(tx, v.cfg, layout));
    await save(
      z.zoneId,
      saved.revision,
      saved.tables.map((t) => ({
        id: t.id,
        key: t.id,
        label: t.label,
        seats: t.seats,
        fixed: t.fixed,
        placement: t.id === z.master.t3 ? place(80, 0) : t.placement,
        partKeys: t.partIds,
      })),
    );
    await reset(z.zoneId);
    await inTx(v, (tx) =>
      writeMerge(tx, v.cfg, { movingId: bar, targetId: long, side: "left", seats: 12, free: true }),
    );
    await finish(partyId);
    expect(await readyOf(t3)).toEqual({ pending: true, readyToMove: false });

    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, NOW, { tableId: bar, partIds: [bar], seats: null }),
    );

    expect(await mergeOf(v, bar)).toBeNull();
    expect(await readyOf(t3)).toEqual({ pending: true, readyToMove: true });
    expect(await todayRow(t3)).toMatchObject({ x: 60 });
  });

  it("a marked table taken off the map goes to its new place by itself, still off", async () => {
    await clearingWorkflow(false);
    const z = await threeSeatedAcrossDinner();
    await finish(z.partyId);
    expect((await readStates()).get(z.t3)!.today.needsMoving).toBe(true);

    await expectRevision(v, send("POST", `/api/tables/${z.t3}/today/take-off`, {}));
    const states = await readStates();

    expect(await readyOf(z.t3)).toEqual({ pending: false, readyToMove: false });
    expect(await todayRow(z.t3)).toMatchObject({ x: 40, takenOff: true });
    expect(states.get(z.t3)!.today.needsMoving).toBe(false);
  });

  it("a room whose only waiting rows still need moving is not caught up again", async () => {
    await clearingWorkflow(false);
    const z = await threeSeatedAcrossDinner();
    const due = async () =>
      (
        await inTx(v, (tx) =>
          tx
            .select({ id: floorZones.id })
            .from(floorZones)
            .where(and(eq(floorZones.id, z.d.zoneId), catchUpDue(floorZones.id))),
        )
      ).length;
    expect(await due()).toBe(1);

    await finish(z.partyId);
    await readStates();
    expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: true });
    expect(await due()).toBe(0);

    await inTx(v, (tx) =>
      tx.update(floorTodayTables).set({ takenOff: true }).where(eq(floorTodayTables.tableId, z.t3)),
    );
    expect(await due()).toBe(1);
  });

  /** Whether the till's floor read would catch the room up. */
  async function dueIn(zoneId: string): Promise<number> {
    const rows = await inTx(v, (tx) =>
      tx
        .select({ id: floorZones.id })
        .from(floorZones)
        .where(and(eq(floorZones.id, zoneId), catchUpDue(floorZones.id))),
    );
    return rows.length;
  }

  const setToday = (tableId: string, values: Partial<typeof floorTodayTables.$inferInsert>) =>
    inTx(v, (tx) =>
      tx.update(floorTodayTables).set(values).where(eq(floorTodayTables.tableId, tableId)),
    );

  it("a marked table moved by hand onto its new place applies by itself, but not while turned", async () => {
    await clearingWorkflow(false);
    const z = await threeSeatedAcrossDinner();
    await finish(z.partyId);
    await readStates();

    await setToday(z.t3, { x: 40, rotation: 15 });
    expect(await dueIn(z.d.zoneId)).toBe(0);
    expect((await readStates()).get(z.t3)!.today.needsMoving).toBe(true);
    expect(await readyOf(z.t3)).toEqual({ pending: true, readyToMove: true });

    await setToday(z.t3, { rotation: 0 });
    expect(await dueIn(z.d.zoneId)).toBe(1);
    await readStates();
    expect(await readyOf(z.t3)).toEqual({ pending: false, readyToMove: false });
  });

  it("a marked table that loses its place applies by itself at its new place", async () => {
    await clearingWorkflow(false);
    const z = await threeSeatedAcrossDinner();
    await finish(z.partyId);
    await readStates();

    await setToday(z.t3, {
      x: null,
      y: null,
      width: null,
      height: null,
      shape: null,
      rotation: null,
    });
    expect(await dueIn(z.d.zoneId)).toBe(1);
    await readStates();

    expect(await readyOf(z.t3)).toEqual({ pending: false, readyToMove: false });
    expect(await todayRow(z.t3)).toMatchObject({ x: 40, takenOff: false });
  });
});

describe("no reset puts a table down on another", () => {
  const setToday = (tableId: string, values: Partial<typeof floorTodayTables.$inferInsert>) =>
    inTx(v, (tx) =>
      tx.update(floorTodayTables).set(values).where(eq(floorTodayTables.tableId, tableId)),
    );
  const at = (x: number) => ({ x, y: 0, width: 8, height: 8, shape: "rect" as const, rotation: 0 });

  async function dueIn(zoneId: string): Promise<number> {
    const rows = await inTx(v, (tx) =>
      tx
        .select({ id: floorZones.id })
        .from(floorZones)
        .where(and(eq(floorZones.id, zoneId), catchUpDue(floorZones.id))),
    );
    return rows.length;
  }

  /** Stored 6 goes to 40 in Dinner, where 7 stands in Standard; guests sit at 7 across the reset onto Dinner. */
  async function sixBehindSeven(
    more: {
      key: string;
      standard: number | null;
      dinner: number | null;
      partKeys?: string[];
    }[] = [],
  ) {
    const s = await standardAndDinner(
      [
        { key: "t6", label: fresh("6") },
        { key: "t7", label: fresh("7") },
        ...more.map((m) => ({ key: m.key, label: fresh(m.key), partKeys: m.partKeys })),
      ],
      {
        standard: { t6: null, t7: 40, ...Object.fromEntries(more.map((m) => [m.key, m.standard])) },
        dinner: { t6: 40, t7: 80, ...Object.fromEntries(more.map((m) => [m.key, m.dinner])) },
      },
    );
    await s.onto(s.d.standard);
    const [t6, t7] = [s.live("t6"), s.live("t7")];
    const partyId = await seatAt(t7);
    await s.onto(s.d.dinner);
    expect(await todayRow(t6)).toMatchObject({ x: null });
    expect(await readyOf(t6)).toEqual({ pending: true, readyToMove: false });
    return { ...s, t6, t7, partyId };
  }

  it("Update to Dinner keeps 2 and 1 in place while 3 waits", async () => {
    await clearingWorkflow(false);
    const s = await standardAndDinner(
      [
        { key: "t3", label: fresh("3") },
        { key: "t2", label: fresh("2") },
        { key: "t1", label: fresh("1") },
      ],
      { standard: { t3: 0, t2: 20, t1: 40 }, dinner: { t3: 80, t2: 0, t1: 20 } },
    );
    await s.onto(s.d.standard);
    const [t3, t2, t1] = [s.live("t3"), s.live("t2"), s.live("t1")];
    await seatAt(t3);

    await s.update(s.d.dinner);

    expect(await todayRows([t3, t2, t1])).toMatchObject([{ x: 0 }, { x: 20 }, { x: 40 }]);
    expect(await readyOf(t3)).toEqual({ pending: true, readyToMove: false });
    expect(await readyOf(t2)).toEqual({ pending: true, readyToMove: true });
    expect(await readyOf(t1)).toEqual({ pending: true, readyToMove: true });
    const states = await readStates();
    expect([t3, t2, t1].map((id) => states.get(id)!.today.needsMoving)).toEqual([
      false,
      true,
      true,
    ]);
    expect(await todayRows([t3, t2, t1])).toMatchObject([{ x: 0 }, { x: 20 }, { x: 40 }]);
  });

  it("a stored table whose new place is taken waits off the map, and a later read places it once the place is clear", async () => {
    await clearingWorkflow(false);
    const z = await sixBehindSeven();

    const states = await readStates();
    expect(states.get(z.t6)!.today.needsMoving).toBe(false);
    expect(await todayRow(z.t6)).toMatchObject({ x: null });
    expect(await readyOf(z.t6)).toEqual({ pending: true, readyToMove: false });

    await setToday(z.t7, { x: 100 });
    await readStates();

    expect(await todayRow(z.t6)).toMatchObject({ x: 40, takenOff: false });
    expect(await readyOf(z.t6)).toEqual({ pending: false, readyToMove: false });
  });

  it("a taken-off table blocks nothing", async () => {
    const s = await standardAndDinner(
      [
        { key: "t6", label: fresh("6") },
        { key: "t7", label: fresh("7") },
      ],
      { standard: { t6: null, t7: 40 }, dinner: { t6: 40, t7: 40 } },
    );
    await s.onto(s.d.standard);
    const [t6, t7] = [s.live("t6"), s.live("t7")];
    await setToday(t7, { takenOff: true });

    await s.update(s.d.dinner);

    expect(await todayRow(t6)).toMatchObject({ x: 40, takenOff: false });
    expect(await readyOf(t6)).toEqual({ pending: false, readyToMove: false });
    expect(await todayRow(t7)).toMatchObject({ x: 40, takenOff: true });
  });

  it("Update layout keeps a taken-off table off at its new place even while another table stands there", async () => {
    const s = await standardAndDinner(
      [
        { key: "t9", label: fresh("9") },
        { key: "t7", label: fresh("7") },
      ],
      { standard: { t9: 0, t7: 40 }, dinner: { t9: 40, t7: 80 } },
    );
    await s.onto(s.d.standard);
    const [t9, t7] = [s.live("t9"), s.live("t7")];
    await setToday(t9, { takenOff: true });
    await seatAt(t7);

    await s.update(s.d.dinner);

    expect(await todayRow(t9)).toMatchObject({ x: 40, takenOff: true });
    expect(await readyOf(t9)).toEqual({ pending: false, readyToMove: false });
  });

  it("a table blocked on a later read is marked, and a stored table may then be put down on it, as it needs moving (spec §7.5, No lock)", async () => {
    await clearingWorkflow(false);
    const s = await standardAndDinner(
      [
        { key: "b", label: fresh("B") },
        { key: "c", label: fresh("C") },
        { key: "t6", label: fresh("6") },
      ],
      { standard: { b: 0, c: 40, t6: null }, dinner: { b: 40, c: 80, t6: 0 } },
    );
    await s.onto(s.d.standard);
    const [b, c, t6] = [s.live("b"), s.live("c"), s.live("t6")];
    const partyB = await seatAt(b);
    await seatAt(c);
    await s.onto(s.d.dinner);
    expect(await todayRow(t6)).toMatchObject({ x: null });

    await finish(partyB);
    const states = await readStates();

    expect(await readyOf(b)).toEqual({ pending: true, readyToMove: true });
    expect(states.get(b)!.today.needsMoving).toBe(true);
    expect(await todayRow(b)).toMatchObject({ x: 0 });
    expect(await todayRow(t6)).toMatchObject({ x: 0 });
  });

  it("a free table whose new place is taken on a later read is marked, and the room is not caught up again", async () => {
    await clearingWorkflow(false);
    const s = await standardAndDinner(
      [
        { key: "b", label: fresh("B") },
        { key: "c", label: fresh("C") },
      ],
      { standard: { b: 0, c: 80 }, dinner: { b: 40, c: 80 } },
    );
    await s.onto(s.d.standard);
    const [b, c] = [s.live("b"), s.live("c")];
    const partyB = await seatAt(b);
    await s.onto(s.d.dinner);
    await setToday(c, { x: 40 });

    await finish(partyB);
    await readStates();

    expect(await readyOf(b)).toEqual({ pending: true, readyToMove: true });
    expect(await todayRow(b)).toMatchObject({ x: 0 });
    expect(await dueIn(s.d.zoneId)).toBe(0);
  });

  it("a joined group waiting for its stored joined table's place is not caught up on every read", async () => {
    await clearingWorkflow(false);
    const s = await standardAndDinner(
      [
        { key: "t4", label: fresh("4") },
        { key: "t5", label: fresh("5") },
        { key: "t45", label: fresh("4+5"), partKeys: ["t4", "t5"] },
        { key: "t8", label: fresh("8") },
      ],
      {
        standard: { t4: 0, t5: 20, t45: null, t8: 60 },
        dinner: { t4: null, t5: null, t45: 60, t8: 60 },
      },
    );
    await s.onto(s.d.standard);
    const [t4, t5, t45] = [s.live("t4"), s.live("t5"), s.live("t45")];

    await s.onto(s.d.dinner);
    await readStates();

    expect(await todayRows([t4, t5, t45])).toMatchObject([{ x: 0 }, { x: 20 }, { x: null }]);
    expect(await readyOf(t45)).toEqual({ pending: true, readyToMove: false });
    expect(await dueIn(s.d.zoneId)).toBe(0);
  });

  /** 6 waits behind 8, moved onto its new place by hand; 7 needs moving; nothing else waits. */
  async function sixBehindEight(
    more: {
      key: string;
      standard: number | null;
      dinner: number | null;
      partKeys?: string[];
    }[] = [],
  ) {
    const z = await sixBehindSeven([{ key: "t8", standard: 120, dinner: 120 }, ...more]);
    const t8 = z.live("t8");
    await setToday(t8, { x: 40 });
    await finish(z.partyId);
    await readStates();
    expect(await readyOf(z.t7)).toEqual({ pending: true, readyToMove: true });
    expect(await readyOf(z.t6)).toEqual({ pending: true, readyToMove: false });
    expect(await dueIn(z.d.zoneId)).toBe(0);
    return { ...z, t8 };
  }

  it("a room whose only waiting rows are stored tables with their place taken is caught up only once the place clears", async () => {
    await clearingWorkflow(false);
    const z = await sixBehindEight();
    expect(await todayRow(z.t6)).toMatchObject({ x: null });

    await setToday(z.t8, { x: 120 });
    expect(await dueIn(z.d.zoneId)).toBe(1);
    await readStates();

    expect(await todayRow(z.t6)).toMatchObject({ x: 40 });
    expect(await readyOf(z.t6)).toEqual({ pending: false, readyToMove: false });
  });

  it("a table taken off after the reset no longer blocks a stored table", async () => {
    await clearingWorkflow(false);
    const z = await sixBehindEight();

    await setToday(z.t8, { takenOff: true });
    expect(await dueIn(z.d.zoneId)).toBe(1);
    await readStates();

    expect(await todayRow(z.t6)).toMatchObject({ x: 40, takenOff: false });
  });

  it("a part out of service inside a joined table blocks nothing", async () => {
    await clearingWorkflow(false);
    const z = await sixBehindEight([
      { key: "t4", standard: 0, dinner: null },
      { key: "t5", standard: 20, dinner: null },
      { key: "t45", standard: null, dinner: 0, partKeys: ["t4", "t5"] },
    ]);
    const t4 = z.live("t4");
    await setToday(t4, at(40));
    expect((await readJoined()).get(t4)).not.toBeNull();

    await setToday(z.t8, { x: 120 });
    expect(await dueIn(z.d.zoneId)).toBe(1);
    await readStates();

    expect(await todayRow(z.t6)).toMatchObject({ x: 40 });
    expect(await readyOf(z.t6)).toEqual({ pending: false, readyToMove: false });
  });
});
