import { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorResetTables,
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodaySplitParts,
  floorTodayTables,
  parties,
  partyTables,
  workingOrders,
} from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { partyTablesName } from "@waitron/shared";
import { writeClearingWorkflow } from "@waitron/venue-service";
import { foodOnItsWay } from "./delivery-release.js";
import { saveZonePlan, type ZonePlanSave } from "./floor-plan.js";
import { resetZone } from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  activeTablesOf,
  billRow,
  counterOrder,
  inTx,
  linesOf,
  order,
  partyAt,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  expectRevision,
  giveKeptSize,
  mergeOf,
  plannedZone,
  todayRow,
  zoneRevisionOf,
} from "./testing/floor-today-venue.js";
import { seedSessionDevice } from "./testing/session-device.js";
import "./errors.js";

let v: PartyVenue;
let app: Hono;
let cookie: string;

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
      tableRemovals: enabledTableRemovals(ALL_MODULES),
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

const NOW = new Date("2026-10-10T12:00:00Z");

/** Long table (10 seats, 6 × 2 at 10, 20) = Counter 3 (2 seats), 4 (6) and 5 (4), each kept 2 × 2; Bar (4 seats, 2 × 2 at 40, 0). */
async function LONG_TABLE() {
  const zone = await plannedZone(
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
    ],
    NOW,
  );
  for (const key of ["c3", "c4", "c5"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

/** Long table (12 seats, 8 × 2 at 10, 20) = Counter 3, 4, 5 and 6 (2 seats each), kept 2 × 2; Bar as above. */
async function LONG_OF_FOUR() {
  const zone = await plannedZone(
    v,
    [
      { key: "c3", label: "Counter 3", seats: 2, place: null },
      { key: "c4", label: "Counter 4", seats: 2, place: null },
      { key: "c5", label: "Counter 5", seats: 2, place: null },
      { key: "c6", label: "Counter 6", seats: 2, place: null },
      {
        key: "long",
        label: "Long table",
        seats: 12,
        place: { x: 10, y: 20, width: 8, height: 2 },
        partKeys: ["c3", "c4", "c5", "c6"],
      },
      { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0, width: 2, height: 2 } },
    ],
    NOW,
  );
  for (const key of ["c3", "c4", "c5", "c6"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

/** The room's revision as a till's floor read shows it at `tableId`. */
async function readRevision(tableId: string): Promise<number> {
  const answer = await app.request("/api/tables/state", { headers: { cookie } });
  expect(answer.status, await answer.clone().text()).toBe(200);
  const tables = (await answer.json()) as { id: string; today: { zoneRevision: number } | null }[];
  return tables.find((t) => t.id === tableId)!.today!.zoneRevision;
}

async function post(path: string, revisionAt: string, body: Record<string, unknown>) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ zoneRevision: await readRevision(revisionAt), ...body }),
  });
}

async function ok(answer: Promise<Response>): Promise<void> {
  const settled = await answer;
  expect(settled.status, await settled.clone().text()).toBe(200);
}

/** Free tables: `moving` pushed onto `target` on `side`, the group's seats `seats`. */
const merge = (moving: string, target: string, side: string, seats = 12) =>
  ok(post(`/api/tables/${moving}/today/merge`, moving, { targetId: target, side, seats }));

/** Split tables… on `tableId`, ticking `partIds`. */
const splitOff = (tableId: string, partIds: string[], seats?: number) =>
  post(`/api/tables/${tableId}/today/split-off`, tableId, {
    partIds,
    ...(seats === undefined ? {} : { seats }),
  });

/** Long table's group: Bar pushed onto Long table, side left, seats 12. */
async function barOnLong() {
  const zone = await LONG_TABLE();
  await merge(zone.table.bar!, zone.table.long!, "left");
  return zone;
}

async function placeOf(tableId: string) {
  const row = await todayRow(v, tableId);
  return { x: row!.x, y: row!.y, width: row!.width, height: row!.height };
}

async function seatsOf(tableId: string) {
  return (await todayRow(v, tableId))!.seats;
}

async function splitRowsOf(joinedTableId: string): Promise<string[]> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({ partId: floorTodaySplitParts.partTableId })
      .from(floorTodaySplitParts)
      .where(eq(floorTodaySplitParts.joinedTableId, joinedTableId)),
  );
  return rows.map((row) => row.partId).sort();
}

async function groupOf(tableId: string) {
  const group = await mergeOf(v, tableId);
  return group === null
    ? null
    : { seats: group.seats, members: group.members.map((m) => m.tableId).sort() };
}

async function foodOnItsWayTo(tableId: string): Promise<void> {
  const counter = await counterOrder(v, "Paella");
  await inTx(v, (tx) =>
    tx.update(workingOrders).set({ deliveryTableId: tableId }).where(eq(workingOrders.id, counter)),
  );
  await pay(v, counter, "20.00");
  const onItsWay = await inTx(v, (tx) =>
    tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, counter), foodOnItsWay())),
  );
  expect(onItsWay).toHaveLength(1);
}

async function markNeedsClearing(tableId: string): Promise<void> {
  await inTx(v, (tx) =>
    tx
      .update(diningTables)
      .set({ needsClearingSince: NOW.toISOString() })
      .where(eq(diningTables.id, tableId)),
  );
}

/** The group's own rows: its `floor_today_joins` row and its member rows. */
async function groupRowsOf(joinId: string) {
  return inTx(v, async (tx) => ({
    joins: await tx.select().from(floorTodayJoins).where(eq(floorTodayJoins.id, joinId)),
    members: await tx
      .select()
      .from(floorTodayJoinTables)
      .where(eq(floorTodayJoinTables.joinId, joinId)),
  }));
}

/** `act` answers a 200 naming the room, its revision one past what it was before. */
async function settles(act: () => Promise<Response>, zoneId: string): Promise<void> {
  const before = (await zoneRevisionOf(v, zoneId))!;
  await expectRevision(v, act(), zoneId, before + 1);
}

/** Every one of Long table's tables split off and standing where Long table puts them, in no group; Bar by the bar counter. */
async function longApart() {
  const zone = await barOnLong();
  const { table } = zone;
  await ok(splitOff(table.bar!, [table.c4!, table.c5!], 6));
  await ok(splitOff(table.bar!, [table.bar!]));
  expect(await groupOf(table.c3!)).toBeNull();
  expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
  expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
  expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
  return zone;
}

async function everything() {
  return inTx(v, async (tx) => ({
    today: await tx.select().from(floorTodayTables).orderBy(asc(floorTodayTables.id)),
    split: await tx.select().from(floorTodaySplitParts).orderBy(asc(floorTodaySplitParts.id)),
    joins: await tx.select().from(floorTodayJoins).orderBy(asc(floorTodayJoins.id)),
    joinTables: await tx
      .select()
      .from(floorTodayJoinTables)
      .orderBy(asc(floorTodayJoinTables.tableId)),
    partyTables: await tx.select().from(partyTables).orderBy(asc(partyTables.id)),
    parties: await tx
      .select({ id: parties.id, revision: parties.revision })
      .from(parties)
      .orderBy(asc(parties.id)),
    clearing: await tx
      .select({ id: diningTables.id, since: diningTables.needsClearingSince })
      .from(diningTables)
      .orderBy(asc(diningTables.id)),
  }));
}

async function refused(
  answer: Promise<Response>,
  status: number,
  code: string,
  params: Record<string, unknown>,
) {
  const settled = await answer;
  expect({ status: settled.status, body: await settled.json() }).toEqual({
    status,
    body: { error: { code, params } },
  });
}

const NO_PLACE = { x: null, y: null, width: null, height: null };

describe("Split tables… on a group with nobody seated", () => {
  it("Bar ticked: Long table is whole by the window with 10 seats and Bar goes back by the bar counter", async () => {
    const { table, zoneId } = await barOnLong();
    expect(await placeOf(table.bar!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await settles(() => splitOff(table.bar!, [table.bar!]), zoneId);

    expect(await groupRowsOf(joinId)).toEqual({ joins: [], members: [] });

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 6, height: 2 });
    expect(await seatsOf(table.long!)).toBe(10);
    expect((await todayRow(v, table.long!))!.takenOff).toBe(false);
    for (const [key, seats] of [
      ["c3", 2],
      ["c4", 6],
      ["c5", 4],
    ] as const) {
      expect(await placeOf(table[key]!), (await tableRow(v, table[key]!)).label).toEqual(NO_PLACE);
      expect(await seatsOf(table[key]!)).toBe(seats);
    }
    expect(await splitRowsOf(table.long!)).toEqual([]);
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await groupOf(table.bar!)).toBeNull();
    expect(await groupOf(table.c3!)).toBeNull();
  });

  it("A pushed onto B's right, B ticked from either table: the group ends and A goes back where it stood", async () => {
    for (const from of ["a", "b"] as const) {
      const { table, zoneId } = await plannedZone(
        v,
        [
          { key: "a", place: { x: 0, y: 0 } },
          { key: "b", place: { x: 20, y: 0 } },
        ],
        NOW,
      );
      await merge(table.a!, table.b!, "right", 8);
      expect(await placeOf(table.a!)).toMatchObject({ x: 28, y: 0 });
      const { joinId } = (await mergeOf(v, table.a!))!;

      await settles(() => splitOff(table[from]!, [table.b!]), zoneId);

      expect(await groupRowsOf(joinId)).toEqual({ joins: [], members: [] });
      expect(await todayRow(v, table.a!)).toMatchObject({ x: 0, y: 0, rotation: 0 });
      expect(await todayRow(v, table.b!)).toMatchObject({ x: 20, y: 0, rotation: 0 });
    }
  });

  it("Counter 5 ticked: Bar, Counter 3 and 4 stay a group with the seats sent (10); Counter 5 stands where it was with 4 seats, still split off", async () => {
    const { table, zoneId } = await barOnLong();

    await settles(() => splitOff(table.c3!, [table.c5!], 10), zoneId);

    expect(await groupOf(table.bar!)).toEqual({
      seats: 10,
      members: [table.bar!, table.c3!, table.c4!].sort(),
    });
    expect(await placeOf(table.bar!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await seatsOf(table.c5!)).toBe(4);
    expect(await groupOf(table.c5!)).toBeNull();
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });

  it("Bar and Counter 5 ticked: Long table over Counter 3 and 4 with the seats sent (8), Counter 5 split off beside it", async () => {
    const { table, zoneId } = await barOnLong();
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await settles(() => splitOff(table.c4!, [table.bar!, table.c5!], 8), zoneId);

    expect(await groupRowsOf(joinId)).toEqual({ joins: [], members: [] });
    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 4, height: 2 });
    expect(await seatsOf(table.long!)).toBe(8);
    expect(await placeOf(table.c3!)).toEqual(NO_PLACE);
    expect(await placeOf(table.c4!)).toEqual(NO_PLACE);
    expect(await seatsOf(table.c3!)).toBe(2);
    expect(await seatsOf(table.c4!)).toBe(6);
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await groupOf(table.c3!)).toBeNull();
  });

  it("Bar and Counter 3 ticked: Long table over Counter 4 and 5 with the seats sent (10), Counter 3 split off beside it", async () => {
    const { table, zoneId } = await barOnLong();
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await settles(() => splitOff(table.c4!, [table.bar!, table.c3!], 10), zoneId);

    expect(await groupRowsOf(joinId)).toEqual({ joins: [], members: [] });
    expect(await placeOf(table.long!)).toEqual({ x: 12, y: 20, width: 4, height: 2 });
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await placeOf(table.c4!)).toEqual(NO_PLACE);
    expect(await placeOf(table.c5!)).toEqual(NO_PLACE);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!]);
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
  });

  it("Counter 4 pushed onto Counter 3's left, Bar ticked: Counter 4 stands on the wrong side, so they stay a group", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.c4!, table.c3!, "left", 6);
    await merge(table.bar!, table.c4!, "left", 8);
    expect(await placeOf(table.c4!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });
    const longBefore = await todayRow(v, table.long!);
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.bar!, [table.bar!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c4!].sort() });
    expect(await placeOf(table.c4!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });

  it("Counter 4 pushed below Counter 5 where Counter 4 stood, Counter 3 onto Counter 5's left, Counter 5 ticked: Counter 4 stands two squares low, so they stay a group", async () => {
    const { table, zoneId } = await longApart();
    await ok(post(`/api/tables/${table.c4!}/today/move`, table.c4!, { x: 30, y: 30 }));
    await ok(post(`/api/tables/${table.c5!}/today/move`, table.c5!, { x: 12, y: 20 }));
    await merge(table.c4!, table.c5!, "bottom", 6);
    await merge(table.c3!, table.c5!, "left", 8);
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 22, width: 2, height: 2 });
    const longBefore = await todayRow(v, table.long!);
    const before = await everything();

    await refused(splitOff(table.c3!, [table.c5!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.c3!, [table.c5!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c4!].sort() });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 22, width: 2, height: 2 });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });

  it("Counter 4 and 5 ticked: Bar and Counter 3 stay a group (seats sent)", async () => {
    const { table, zoneId } = await barOnLong();

    await settles(() => splitOff(table.bar!, [table.c4!, table.c5!], 6), zoneId);

    expect(await groupOf(table.bar!)).toEqual({
      seats: 6,
      members: [table.bar!, table.c3!].sort(),
    });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await seatsOf(table.c4!)).toBe(6);
    expect(await seatsOf(table.c5!)).toBe(4);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });

  it("after Long table was dragged onto Bar, Bar ticked: Long table is whole where its tables stand", async () => {
    const { table, zoneId } = await LONG_TABLE();
    await merge(table.long!, table.bar!, "right");
    expect(await placeOf(table.c3!)).toEqual({ x: 42, y: 0, width: 2, height: 2 });

    await settles(() => splitOff(table.c5!, [table.bar!]), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 42, y: 0, width: 6, height: 2 });
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await placeOf(table.c3!)).toEqual(NO_PLACE);
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });

  it("a counter marked needs clearing is taken back and its mark cleared", async () => {
    const { table } = await barOnLong();
    await markNeedsClearing(table.c4!);

    await ok(splitOff(table.bar!, [table.bar!]));

    expect((await tableRow(v, table.c4!)).needsClearingSince).toBeNull();
    expect(await placeOf(table.c4!)).toEqual(NO_PLACE);
    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 6, height: 2 });
  });

  it("food on its way to Counter 4: Bar ticked leaves Counter 3, 4 and 5 a group and asks seats", async () => {
    const { table } = await barOnLong();
    await foodOnItsWayTo(table.c4!);
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await ok(splitOff(table.bar!, [table.bar!], 12));
    expect(await groupOf(table.c3!)).toEqual({
      seats: 12,
      members: [table.c3!, table.c4!, table.c5!].sort(),
    });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });

  it("two counters split off a Long table that still stands over the other two stay a group with Bar gone", async () => {
    const { table } = await LONG_OF_FOUR();
    await ok(splitOff(table.long!, [table.c5!, table.c6!], 4));
    await merge(table.c6!, table.c5!, "right", 6);
    await merge(table.bar!, table.c6!, "right", 6);
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c6!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
    expect(await groupOf(table.c5!)).toEqual({
      seats: 6,
      members: [table.bar!, table.c5!, table.c6!].sort(),
    });
    const before = await everything();

    await refused(splitOff(table.c5!, [table.bar!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await ok(splitOff(table.c5!, [table.bar!], 4));
    expect(await groupOf(table.c5!)).toEqual({
      seats: 4,
      members: [table.c5!, table.c6!].sort(),
    });
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!, table.c6!].sort());
    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 4, height: 2 });
    expect(await seatsOf(table.long!)).toBe(4);
  });

  it("Bar, Counter 4 and 5 ticked: Counter 3 alone ends the group and stays split off where it stands", async () => {
    const { table, zoneId } = await barOnLong();
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await settles(() => splitOff(table.c3!, [table.bar!, table.c4!, table.c5!]), zoneId);

    expect(await groupRowsOf(joinId)).toEqual({ joins: [], members: [] });
    expect(await groupOf(table.c3!)).toBeNull();
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });

  it("a counter whose seats were changed today comes back into Long table with its saved seats", async () => {
    const { table, zoneId } = await longApart();
    await ok(post(`/api/tables/${table.c4!}/today/seats`, table.c4!, { seats: 3 }));
    expect(await seatsOf(table.c4!)).toBe(3);
    await merge(table.c4!, table.c3!, "right", 6);
    await merge(table.c5!, table.c4!, "right", 6);
    await merge(table.bar!, table.c3!, "left", 8);

    await settles(() => splitOff(table.bar!, [table.bar!]), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 6, height: 2 });
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await seatsOf(table.c4!)).toBe(6);
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });

  it("Bar and Counter 4 ticked: Counter 3 and 5 are not side by side in Long table, so they stay a group with the seats sent and Counter 4 stands where it stood", async () => {
    const { table, zoneId } = await barOnLong();
    const longBefore = await todayRow(v, table.long!);
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!, table.c4!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.bar!, [table.bar!, table.c4!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c5!].sort() });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await groupOf(table.c4!)).toBeNull();
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });

  it("Counter 5 pushed onto Counter 3's left and Bar onto Counter 5, Bar ticked: Counter 3 and 5 stay a group, Counter 5 where it stands", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.c5!, table.c3!, "left", 6);
    await merge(table.bar!, table.c5!, "left", 8);
    expect(await placeOf(table.c5!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });
    const longBefore = await todayRow(v, table.long!);
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.bar!, [table.bar!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c5!].sort() });
    expect(await placeOf(table.c5!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });

  it("Counter 4 pushed below Counter 3, Bar ticked: they stand where Long table cannot cover them, so they stay a group", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.c4!, table.c3!, "bottom", 6);
    await merge(table.bar!, table.c3!, "left", 8);
    expect(await placeOf(table.c4!)).toEqual({ x: 10, y: 22, width: 2, height: 2 });
    const longBefore = await todayRow(v, table.long!);
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.bar!, [table.bar!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c4!].sort() });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 10, y: 22, width: 2, height: 2 });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });

  it("a counter turned unlike Counter 3 where Long table would put it stays in a group", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.c4!, table.c3!, "right", 6);
    await merge(table.bar!, table.c3!, "left", 8);
    await inTx(v, (tx) =>
      tx
        .update(floorTodayTables)
        .set({ rotation: 45 })
        .where(eq(floorTodayTables.tableId, table.c4!)),
    );
    const longBefore = await todayRow(v, table.long!);

    await settles(() => splitOff(table.bar!, [table.bar!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c4!].sort() });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
  });

  it("Counter 3 turned a quarter, Counter 4 pushed on its right, Bar ticked: Long table comes back over them, turned", async () => {
    const { table, zoneId } = await longApart();
    for (let turn = 0; turn < 6; turn++) {
      await ok(post(`/api/tables/${table.c3!}/today/rotate`, table.c3!, {}));
    }
    await merge(table.c4!, table.c3!, "right", 6);
    await merge(table.bar!, table.c3!, "left", 8);
    expect((await todayRow(v, table.c4!))!.rotation).toBe(90);

    await settles(() => splitOff(table.bar!, [table.bar!], 6), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 9, y: 21, width: 4, height: 2 });
    expect((await todayRow(v, table.long!))!.rotation).toBe(90);
    expect(await seatsOf(table.long!)).toBe(6);
    expect(await placeOf(table.c3!)).toEqual(NO_PLACE);
    expect(await placeOf(table.c4!)).toEqual(NO_PLACE);
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
  });

  it("Long table turned one step, Bar pushed onto it, Bar ticked: Long table is whole again where its tables stand, turned", async () => {
    const { table, zoneId } = await LONG_TABLE();
    await ok(post(`/api/tables/${table.long!}/today/rotate`, table.long!, {}));
    const turned = await todayRow(v, table.long!);
    await merge(table.bar!, table.long!, "left");

    await settles(() => splitOff(table.bar!, [table.bar!]), zoneId);

    const long = await todayRow(v, table.long!);
    expect({ ...(await placeOf(table.long!)), rotation: long!.rotation }).toEqual({
      x: turned!.x,
      y: turned!.y,
      width: 6,
      height: 2,
      rotation: 15,
    });
    expect(long!.seats).toBe(10);
    expect(await splitRowsOf(table.long!)).toEqual([]);
    expect(await groupOf(table.c3!)).toBeNull();
  });

  it("a 1 × 1 stool pushed onto the wrong side, a square off where Long table would put it, stays in a group", async () => {
    const { table, zoneId } = await plannedZone(
      v,
      [
        { key: "s1", label: "Stool 1", seats: 1, place: null },
        { key: "s2", label: "Stool 2", seats: 1, place: null },
        { key: "s3", label: "Stool 3", seats: 1, place: null },
        {
          key: "long",
          label: "Long table",
          seats: 3,
          place: { x: 10, y: 20, width: 3, height: 1 },
          partKeys: ["s1", "s2", "s3"],
        },
        { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0, width: 2, height: 2 } },
        { key: "t", label: "T", seats: 2, place: { x: 30, y: 30, width: 1, height: 1 } },
      ],
      NOW,
    ).then(async (zone) => {
      for (const key of ["s1", "s2", "s3"])
        await giveKeptSize(v, zone.master[key]!, { width: 1, height: 1 });
      return zone;
    });
    await merge(table.bar!, table.long!, "left", 7);
    await ok(splitOff(table.bar!, [table.s2!, table.s3!], 5));
    await ok(splitOff(table.bar!, [table.bar!]));
    expect(await splitRowsOf(table.long!)).toEqual([table.s1!, table.s2!, table.s3!].sort());
    expect(await placeOf(table.s1!)).toEqual({ x: 10, y: 20, width: 1, height: 1 });
    expect(await placeOf(table.s2!)).toEqual({ x: 11, y: 20, width: 1, height: 1 });
    await merge(table.s2!, table.s1!, "top", 2);
    expect(await placeOf(table.s2!)).toEqual({ x: 10, y: 19, width: 1, height: 1 });
    await ok(post(`/api/tables/${table.t!}/today/move`, table.t!, { x: 11, y: 20 }));
    expect(await placeOf(table.t!)).toEqual({ x: 11, y: 20, width: 1, height: 1 });
    await merge(table.bar!, table.s1!, "left", 6);
    const longBefore = await todayRow(v, table.long!);
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.bar!, [table.bar!], 2), zoneId);

    expect(await groupOf(table.s1!)).toEqual({ seats: 2, members: [table.s1!, table.s2!].sort() });
    expect(await placeOf(table.s1!)).toEqual({ x: 10, y: 20, width: 1, height: 1 });
    expect(await placeOf(table.s2!)).toEqual({ x: 10, y: 19, width: 1, height: 1 });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
    expect(await splitRowsOf(table.long!)).toEqual([table.s1!, table.s2!, table.s3!].sort());
  });

  it("Long table saved with no place, put out today and split, comes back whole at the size a new table gets", async () => {
    const { table, zoneId, master } = await plannedZone(
      v,
      [
        { key: "c3", label: "Counter 3", seats: 2, place: null },
        { key: "c4", label: "Counter 4", seats: 6, place: null },
        { key: "c5", label: "Counter 5", seats: 4, place: null },
        { key: "long", label: "Long table", seats: 10, place: null, partKeys: ["c3", "c4", "c5"] },
        { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0, width: 2, height: 2 } },
      ],
      NOW,
    );
    for (const key of ["c3", "c4", "c5"])
      await giveKeptSize(v, master[key]!, { width: 2, height: 2 });
    await ok(post(`/api/tables/${table.long!}/today/place`, table.long!, { x: 10, y: 20 }));
    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 8, height: 8 });
    await ok(splitOff(table.long!, [table.c4!, table.c5!], 2));
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 23, width: 2, height: 2 });
    await merge(table.c4!, table.c3!, "right", 6);
    await merge(table.c5!, table.c4!, "right", 6);
    await merge(table.bar!, table.c3!, "left", 8);

    await settles(() => splitOff(table.bar!, [table.bar!]), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 8, height: 8 });
    expect(await seatsOf(table.long!)).toBe(10);
    for (const key of ["c3", "c4", "c5"]) expect(await placeOf(table[key]!)).toEqual(NO_PLACE);
    expect(await splitRowsOf(table.long!)).toEqual([]);
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await groupOf(table.c3!)).toBeNull();
  });

  it("a reset waiting on food on its way to Long table itself is applied once Bar is ticked and Long table is whole", async () => {
    const { table, zoneId, master, revision } = await barOnLong();
    await foodOnItsWayTo(table.long!);
    const removals = enabledTableRemovals(ALL_MODULES);
    const saved: ZonePlanSave["tables"] = [];
    for (const [key, seats, partKeys, placement] of [
      ["c3", 2, [], null],
      ["c4", 6, [], null],
      ["c5", 4, [], null],
      ["long", 10, ["c3", "c4", "c5"], { x: 30, y: 30, width: 6, height: 2 }],
      ["bar", 4, [], { x: 40, y: 0, width: 2, height: 2 }],
    ] as const) {
      saved.push({
        id: master[key]!,
        key,
        label: (await tableRow(v, table[key]!)).label,
        seats,
        fixed: false,
        placement: placement && { ...placement, shape: "rect" as const, rotation: 0 },
        partKeys: [...partKeys],
      });
    }
    await inTx(v, async (tx) => {
      await saveZonePlan(tx, v.cfg, removals, zoneId, { revision, tables: saved }, NOW);
      await resetZone(tx, v.cfg, removals, zoneId, NOW);
    });
    const waiting = () =>
      inTx(v, (tx) =>
        tx
          .select({ tableId: floorResetTables.tableId })
          .from(floorResetTables)
          .where(and(eq(floorResetTables.zoneId, zoneId), eq(floorResetTables.pending, true))),
      );
    expect(await waiting()).toHaveLength(5);
    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 6, height: 2 });
    await readRevision(table.bar!);
    expect(await waiting()).toHaveLength(5);

    await settles(() => splitOff(table.bar!, [table.bar!]), zoneId);

    expect(await waiting()).toEqual([]);
    expect(await placeOf(table.long!)).toEqual({ x: 30, y: 30, width: 6, height: 2 });
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await splitRowsOf(table.long!)).toEqual([]);
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
  });
});

async function withClearing<T>(fn: () => Promise<T>): Promise<T> {
  await inTx(v, (tx) => writeClearingWorkflow(tx, true));
  try {
    return await fn();
  } finally {
    await inTx(v, (tx) => writeClearingWorkflow(tx, false));
  }
}

/** The party's name from its tables, in the order it holds them. */
async function partyNameOf(partyId: string): Promise<string> {
  const labels: string[] = [];
  for (const id of await activeTablesOf(v, partyId)) labels.push((await tableRow(v, id)).label);
  return partyTablesName(labels);
}

function noticesOn(billIds: string[]) {
  return v.db.all<{ working_order_id: string; kind: string; moved_to: string }>(
    sql`
      select working_order_id, kind, moved_to from kitchen_notices
      where working_order_id in (${sql.join(
        billIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by rowid`,
  );
}

/** Guests seated at Long table's group (Bar pushed onto Long table, seats 12), a Burger sent to the kitchen. */
async function guestsAtGroup() {
  const zone = await barOnLong();
  const guests = await seat(v, zone.table.bar!);
  await order(v, guests.tabId, "Burger");
  const { table } = zone;
  expect(await activeTablesOf(v, guests.partyId)).toEqual(
    expect.arrayContaining([table.bar!, table.c3!, table.c4!, table.c5!]),
  );
  return { ...zone, guests };
}

describe("Split tables… on a group with guests seated", () => {
  it("Bar ticked: Bar comes off without guests, needs clearing, and goes back by the bar counter; the party stays at Counter 3, 4 and 5, a group with the seats sent", async () => {
    await withClearing(async () => {
      const { table, zoneId, guests } = await guestsAtGroup();
      const revision = await revisionOf(v, guests.partyId);

      await settles(() => splitOff(table.bar!, [table.bar!], 10), zoneId);

      expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
      expect(await groupOf(table.bar!)).toBeNull();
      expect(await partyAt(v, table.bar!)).toBeNull();
      expect((await tableRow(v, table.bar!)).needsClearingSince).not.toBeNull();
      expect((await activeTablesOf(v, guests.partyId)).sort()).toEqual(
        [table.c3!, table.c4!, table.c5!].sort(),
      );
      expect(await groupOf(table.c3!)).toEqual({
        seats: 10,
        members: [table.c3!, table.c4!, table.c5!].sort(),
      });
      expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
      expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
      for (const key of ["c3", "c4", "c5"] as const) {
        expect((await tableRow(v, table[key]!)).needsClearingSince).toBeNull();
      }
      expect(await revisionOf(v, guests.partyId)).toBe(revision + 1);
    });
  });

  it("the kitchen gets one moved notice", async () => {
    const { table, guests } = await guestsAtGroup();

    await ok(splitOff(table.bar!, [table.bar!], 10));

    expect((await activeTablesOf(v, guests.partyId)).sort()).toEqual(
      [table.c3!, table.c4!, table.c5!].sort(),
    );
    expect(await noticesOn([guests.tabId])).toEqual([
      {
        working_order_id: guests.tabId,
        kind: "moved",
        moved_to: await partyNameOf(guests.partyId),
      },
    ]);
  });

  it("Counter 4 and 5 ticked: the guests stay at Bar and Counter 3, the party's revision moved once", async () => {
    const { table, guests } = await guestsAtGroup();
    const revision = await revisionOf(v, guests.partyId);

    await ok(splitOff(table.bar!, [table.c4!, table.c5!], 6));

    expect(await revisionOf(v, guests.partyId)).toBe(revision + 1);
    expect((await activeTablesOf(v, guests.partyId)).sort()).toEqual(
      [table.bar!, table.c3!].sort(),
    );
    expect(await groupOf(table.bar!)).toEqual({
      seats: 6,
      members: [table.bar!, table.c3!].sort(),
    });
    expect(await partyAt(v, table.c4!)).toBeNull();
    expect(await partyAt(v, table.c5!)).toBeNull();
  });

  it("with clearing off, Bar needs no clearing", async () => {
    const { table } = await guestsAtGroup();

    await ok(splitOff(table.bar!, [table.bar!], 10));

    expect(await partyAt(v, table.bar!)).toBeNull();
    expect((await tableRow(v, table.bar!)).needsClearingSince).toBeNull();
  });

  it("the bill keeps its lines and its party", async () => {
    const { table, guests } = await guestsAtGroup();
    const lines = await linesOf(v, guests.tabId);
    expect(lines).toHaveLength(1);

    await ok(splitOff(table.bar!, [table.bar!], 10));

    expect((await billRow(v, guests.tabId)).partyId).toBe(guests.partyId);
    expect(await linesOf(v, guests.tabId)).toEqual(lines);
  });

  it("Bar ticked with seats missing is refused merge.seats_required, nothing written", async () => {
    const { table } = await guestsAtGroup();
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);
  });
});

/** A counter order moved to `tableId`, which opens a party holding that table alone; its id. */
async function partyAloneAt(tableId: string): Promise<string> {
  const billId = await counterOrder(v, "Paella");
  await ok(
    Promise.resolve(
      app.request(`/api/bills/${billId}/move`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ to: { tableId }, otherPartyId: null }),
      }),
    ),
  );
  const partyId = (await billRow(v, billId)).partyId!;
  expect(await activeTablesOf(v, partyId)).toEqual([tableId]);
  return partyId;
}

/** Long table's group with a party holding Bar alone. */
async function partyAtBarAlone() {
  const zone = await barOnLong();
  const { table } = zone;
  const partyId = await partyAloneAt(table.bar!);
  expect(await groupOf(table.bar!)).toEqual({
    seats: 12,
    members: [table.bar!, table.c3!, table.c4!, table.c5!].sort(),
  });
  return { ...zone, partyId };
}

describe("Split tables… on a group a party holds only some of", () => {
  it("Bar ticked while the party holds Bar alone is refused tab.already_open naming Bar, nothing written", async () => {
    await withClearing(async () => {
      const { table } = await partyAtBarAlone();
      const before = await everything();

      await refused(splitOff(table.bar!, [table.bar!], 10), 409, "tab.already_open", {
        tableId: table.bar!,
      });
      expect(await everything()).toEqual(before);
    });
  });

  it("Bar ticked while the party holds Bar alone, having sat at Long table earlier and left it, is refused tab.already_open naming Bar, nothing written", async () => {
    await withClearing(async () => {
      const { table, partyId } = await partyAtBarAlone();
      const earlier = new Date(NOW.getTime() - 60 * 60_000).toISOString();
      await inTx(v, (tx) =>
        tx
          .insert(partyTables)
          .values({ partyId, tableId: table.long!, joinedAt: earlier, leftAt: earlier }),
      );
      const before = await everything();

      await refused(splitOff(table.bar!, [table.bar!], 10), 409, "tab.already_open", {
        tableId: table.bar!,
      });
      expect(await everything()).toEqual(before);
    });
  });

  it("Counter 5 ticked while the party holds Bar alone: the party keeps Bar and its revision, and Counter 5 needs no clearing", async () => {
    await withClearing(async () => {
      const { table, zoneId, partyId } = await partyAtBarAlone();
      const revision = await revisionOf(v, partyId);

      await settles(() => splitOff(table.bar!, [table.c5!], 10), zoneId);

      expect(await activeTablesOf(v, partyId)).toEqual([table.bar!]);
      expect(await revisionOf(v, partyId)).toBe(revision);
      expect((await tableRow(v, table.c5!)).needsClearingSince).toBeNull();
      expect(await groupOf(table.bar!)).toEqual({
        seats: 10,
        members: [table.bar!, table.c3!, table.c4!].sort(),
      });
      expect(await groupOf(table.c5!)).toBeNull();
    });
  });

  it("Counter 5 ticked with seats missing while the party holds Bar alone is refused merge.seats_required, nothing written", async () => {
    const { table } = await partyAtBarAlone();
    const before = await everything();

    await refused(splitOff(table.bar!, [table.c5!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);
  });

  it("Long table's tables back in a group with Bar, a party holding Counter 3 alone, Bar ticked: Long table is not put back, and Counter 3, 4 and 5 stay a group with the seats sent", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.c4!, table.c3!, "right", 6);
    await merge(table.c5!, table.c4!, "right", 6);
    await merge(table.bar!, table.c3!, "left", 8);
    const partyId = await partyAloneAt(table.c3!);
    const revision = await revisionOf(v, partyId);
    const longBefore = await todayRow(v, table.long!);

    await settles(() => splitOff(table.bar!, [table.bar!], 12), zoneId);

    expect(await groupOf(table.c3!)).toEqual({
      seats: 12,
      members: [table.c3!, table.c4!, table.c5!].sort(),
    });
    expect(await activeTablesOf(v, partyId)).toEqual([table.c3!]);
    expect(await revisionOf(v, partyId)).toBe(revision);
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });
});

/** LONG_TABLE plus Short table (4 seats, 4 × 2 at 40, 10) = Counter 6 and 7 (2 seats each, kept 2 × 2), pushed onto Long table's right: one group of five. */
async function shortOnLong() {
  const zone = await plannedZone(
    v,
    [
      { key: "c3", label: "Counter 3", seats: 2, place: null },
      { key: "c4", label: "Counter 4", seats: 6, place: null },
      { key: "c5", label: "Counter 5", seats: 4, place: null },
      { key: "c6", label: "Counter 6", seats: 2, place: null },
      { key: "c7", label: "Counter 7", seats: 2, place: null },
      {
        key: "long",
        label: "Long table",
        seats: 10,
        place: { x: 10, y: 20, width: 6, height: 2 },
        partKeys: ["c3", "c4", "c5"],
      },
      {
        key: "short",
        label: "Short table",
        seats: 4,
        place: { x: 40, y: 10, width: 4, height: 2 },
        partKeys: ["c6", "c7"],
      },
    ],
    NOW,
  );
  for (const key of ["c3", "c4", "c5", "c6", "c7"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  const { table } = zone;
  await merge(table.short!, table.long!, "right", 14);
  expect(await groupOf(table.c3!)).toEqual({
    seats: 14,
    members: [table.c3!, table.c4!, table.c5!, table.c6!, table.c7!].sort(),
  });
  expect(await placeOf(table.c6!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
  expect(await placeOf(table.c7!)).toEqual({ x: 18, y: 20, width: 2, height: 2 });
  return zone;
}

describe("Split tables… on a group holding the tables of two joined tables", () => {
  it("Short table's two counters ticked: Long table is whole again, and Counter 6 and 7 go back where Short table stood", async () => {
    const { table, zoneId } = await shortOnLong();

    await settles(() => splitOff(table.c3!, [table.c6!, table.c7!]), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 6, height: 2 });
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await splitRowsOf(table.long!)).toEqual([]);
    expect(await placeOf(table.c6!)).toEqual({ x: 40, y: 10, width: 2, height: 2 });
    expect(await placeOf(table.c7!)).toEqual({ x: 42, y: 10, width: 2, height: 2 });
    expect(await splitRowsOf(table.short!)).toEqual([table.c6!, table.c7!].sort());
    expect(await groupOf(table.c3!)).toBeNull();
  });

  it("Counter 5 and 7 ticked: Counter 3, 4 and 6 come from both, so they stay a group with the seats sent", async () => {
    const { table, zoneId } = await shortOnLong();
    const longBefore = await todayRow(v, table.long!);
    const before = await everything();

    await refused(splitOff(table.c3!, [table.c5!, table.c7!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.c3!, [table.c5!, table.c7!], 10), zoneId);

    expect(await groupOf(table.c3!)).toEqual({
      seats: 10,
      members: [table.c3!, table.c4!, table.c6!].sort(),
    });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c6!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
    expect(await splitRowsOf(table.short!)).toEqual([table.c6!, table.c7!].sort());
  });
});

describe("Split tables… on a group: refusals write nothing", () => {
  it("a ticked table not in the group is refused merge.member_invalid", async () => {
    const { table } = await barOnLong();
    const before = await everything();

    await refused(splitOff(table.bar!, [table.long!]), 400, "merge.member_invalid", {
      tableId: table.long!,
      field: "partIds",
    });
    expect(await everything()).toEqual(before);
  });

  it("every table ticked is refused merge.split_all", async () => {
    const { table } = await barOnLong();
    const before = await everything();

    await refused(
      splitOff(table.c3!, [table.bar!, table.c3!, table.c4!, table.c5!], 4),
      409,
      "merge.split_all",
      { tableId: table.c3!, field: "partIds" },
    );
    expect(await everything()).toEqual(before);
  });

  it("seats missing when a group stays is refused merge.seats_required", async () => {
    const { table } = await barOnLong();
    const before = await everything();

    await refused(splitOff(table.bar!, [table.c5!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);
  });

  it("seats missing when Long table comes back partly is refused joined_table.seats_required", async () => {
    const { table } = await barOnLong();
    const before = await everything();

    await refused(
      splitOff(table.bar!, [table.bar!, table.c5!]),
      400,
      "joined_table.seats_required",
      {},
    );
    expect(await everything()).toEqual(before);
  });
});

describe("Split tables… on a joined table in no group", () => {
  it("Split tables… on Long table whole on the map is unchanged", async () => {
    const { table } = await LONG_TABLE();

    await ok(splitOff(table.long!, [table.c5!], 8));

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 4, height: 2 });
    expect(await seatsOf(table.long!)).toBe(8);
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
    expect(await groupOf(table.long!)).toBeNull();
  });
});
