import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodaySplitParts,
  floorTodayTables,
  parties,
  partyTables,
  workingOrders,
} from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { foodOnItsWay } from "./delivery-release.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  counterOrder,
  inTx,
  pay,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import { giveKeptSize, mergeOf, plannedZone, todayRow } from "./testing/floor-today-venue.js";
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
    const { table } = await barOnLong();
    expect(await placeOf(table.bar!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });

    await ok(splitOff(table.bar!, [table.bar!]));

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

  it("Counter 5 ticked: Bar, Counter 3 and 4 stay a group with the seats sent (10); Counter 5 stands where it was with 4 seats, still split off", async () => {
    const { table } = await barOnLong();

    await ok(splitOff(table.c3!, [table.c5!], 10));

    expect(await groupOf(table.bar!)).toEqual({
      seats: 10,
      members: [table.bar!, table.c3!, table.c4!].sort(),
    });
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await seatsOf(table.c5!)).toBe(4);
    expect(await groupOf(table.c5!)).toBeNull();
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  });

  it("Bar and Counter 5 ticked: Long table over Counter 3 and 4 with the seats sent (8), Counter 5 split off beside it", async () => {
    const { table } = await barOnLong();

    await ok(splitOff(table.c4!, [table.bar!, table.c5!], 8));

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

  it("Counter 4 and 5 ticked: Bar and Counter 3 stay a group (seats sent)", async () => {
    const { table } = await barOnLong();

    await ok(splitOff(table.bar!, [table.c4!, table.c5!], 6));

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
    const { table } = await LONG_TABLE();
    await merge(table.long!, table.bar!, "right");
    expect(await placeOf(table.c3!)).toEqual({ x: 42, y: 0, width: 2, height: 2 });

    await ok(splitOff(table.c5!, [table.bar!]));

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
    await merge(table.bar!, table.c5!, "right", 6);
    await merge(table.c6!, table.c5!, "left", 6);
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

  it("guests at the group: refused for now, nothing written", async () => {
    const { table } = await barOnLong();
    await seat(v, table.bar!);
    const before = await everything();
    const first = [table.bar!, table.c3!, table.c4!, table.c5!].sort()[0]!;

    await refused(splitOff(table.bar!, [table.bar!]), 409, "tab.already_open", {
      tableId: first,
    });
    expect(await everything()).toEqual(before);
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
