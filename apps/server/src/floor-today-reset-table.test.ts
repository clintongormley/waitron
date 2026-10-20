import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
  joinedOutOfService,
  joinedTableApart,
  parties,
  partyTables,
  workingOrders,
} from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { compareLabels } from "@waitron/shared";
import { foodOnItsWay } from "./delivery-release.js";
import { readLayout, saveLayout } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { catchUpZone, resetZone } from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { finishTable } from "./testing/party-close-fixture.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  commandFor,
  counterOrder,
  inTx,
  OPERATOR,
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
  type PlannedEntry,
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
const REMOVALS = enabledTableRemovals(ALL_MODULES);

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

const seatsBody = (seats?: number) => (seats === undefined ? {} : { seats });

/** Split tables… on `tableId`, ticking `partIds`. */
const splitOff = (tableId: string, partIds: string[], seats?: number) =>
  post(`/api/tables/${tableId}/today/split-off`, tableId, { partIds, ...seatsBody(seats) });

/** Reset table on the joined table `tableId`, expecting `partIds` back. */
const reset = (tableId: string, partIds: string[], seats?: number) =>
  post(`/api/tables/${tableId}/today/reset`, tableId, { partIds, ...seatsBody(seats) });

/** Free tables: `moving` pushed onto `target` on `side`. */
const merge = (moving: string, target: string, side: string, seats = 12) =>
  ok(post(`/api/tables/${moving}/today/merge`, moving, { targetId: target, side, seats }));

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

async function markNeedsClearing(tableId: string): Promise<void> {
  await inTx(v, (tx) =>
    tx
      .update(diningTables)
      .set({ needsClearingSince: NOW.toISOString() })
      .where(eq(diningTables.id, tableId)),
  );
}

async function clearingSince(tableId: string): Promise<string | null> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ since: diningTables.needsClearingSince })
      .from(diningTables)
      .where(eq(diningTables.id, tableId)),
  );
  return row!.since;
}

/** `act` answers a 200 naming the room, its revision one past what it was before. */
async function settles(act: () => Promise<Response>, zoneId: string): Promise<void> {
  const before = (await zoneRevisionOf(v, zoneId))!;
  await expectRevision(v, act(), zoneId, before + 1);
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
  answer: Response | Promise<Response>,
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
const LONG_SAVED = { x: 10, y: 20, width: 6, height: 2 };

/** Long table split apart with nobody seated: Counter 4 and 5 ticked, so Counter 3 comes off too, each where Long table laid it. */
async function longApart() {
  const zone = await LONG_TABLE();
  const { table } = zone;
  await ok(splitOff(table.long!, [table.c4!, table.c5!]));
  expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
  expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
  expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
  expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
  return zone;
}

/** Counter 5 split off Long table, which stands over Counter 3 and 4 with 6 seats. */
async function c5SplitOff() {
  const zone = await LONG_TABLE();
  await ok(splitOff(zone.table.long!, [zone.table.c5!], 6));
  expect(await placeOf(zone.table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
  return zone;
}

/** Counter 5 split off, pushed together with Bar, nobody seated: a bill moved to Bar opens its party at Bar alone (backlog A594), so Counter 5 is free in a group with guests. */
async function guestsAtBarAlone(table: Record<string, string | undefined>): Promise<void> {
  await merge(table.bar!, table.c5!, "right", 8);
  const order = await counterOrder(v, "Paella");
  await inTx(v, (tx) =>
    moveBill(
      tx,
      v.cfg,
      order,
      { tableId: table.bar! },
      {
        bills: "separate",
        partyId: null,
        otherPartyId: null,
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      },
    ),
  );
  expect(await partyAt(v, table.bar!)).not.toBeNull();
  expect(await partyAt(v, table.c5!)).toBeNull();
  expect(await placeOf(table.bar!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
}

describe("Reset table", () => {
  it("every table free: Counter 5 split off, Long table moved to the middle; Reset table puts Long table whole at its saved place with 10 seats and Counter 5 leaves the map", async () => {
    const { table, zoneId } = await c5SplitOff();
    await ok(post(`/api/tables/${table.long!}/today/move`, table.long!, { x: 30, y: 30 }));

    await settles(() => reset(table.long!, [table.c5!], 3), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await placeOf(table.c5!)).toEqual(NO_PLACE);
    expect(await seatsOf(table.c5!)).toBe(4);
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });

  it("one table stays apart: Counter 4 and 5 split off, guests at Counter 5; Reset table takes Counter 4 back, Long table over Counter 3 and 4 at its saved place's left end with the seats sent (8)", async () => {
    const { table, zoneId } = await longApart();
    const { partyId } = await seat(v, table.c5!);

    await settles(() => reset(table.long!, [table.c3!, table.c4!], 8), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 4, height: 2 });
    expect(await seatsOf(table.long!)).toBe(8);
    expect(await placeOf(table.c3!)).toEqual(NO_PLACE);
    expect(await placeOf(table.c4!)).toEqual(NO_PLACE);
    expect(await seatsOf(table.c3!)).toBe(2);
    expect(await seatsOf(table.c4!)).toBe(6);
    expect(await partyAt(v, table.c5!)).toBe(partyId);
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
  });

  it("Counter 4 needs clearing, Counter 5 pushed together with Bar with nobody seated: Reset table takes both back, clears Counter 4's mark, ends the group and Bar goes back by the bar counter", async () => {
    const { table, zoneId } = await longApart();
    await markNeedsClearing(table.c4!);
    await merge(table.bar!, table.c5!, "right", 8);
    expect(await placeOf(table.bar!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await settles(() => reset(table.long!, [table.c3!, table.c4!, table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await clearingSince(table.c4!)).toBeNull();
    expect(await groupOf(table.bar!)).toBeNull();
    expect(await groupOf(table.c5!)).toBeNull();
    const groupRows = await inTx(v, async (tx) => ({
      joins: await tx.select().from(floorTodayJoins).where(eq(floorTodayJoins.id, joinId)),
      members: await tx
        .select()
        .from(floorTodayJoinTables)
        .where(eq(floorTodayJoinTables.joinId, joinId)),
    }));
    expect(groupRows).toEqual({ joins: [], members: [] });
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await seatsOf(table.bar!)).toBe(4);
    for (const key of ["c3", "c4", "c5"]) {
      expect(await placeOf(table[key]!)).toEqual(NO_PLACE);
    }
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });

  it("Long table taken off for today comes back on the map", async () => {
    const { table, zoneId } = await c5SplitOff();
    await ok(post(`/api/tables/${table.long!}/today/take-off`, table.long!, {}));
    expect((await todayRow(v, table.long!))!.takenOff).toBe(true);

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect((await todayRow(v, table.long!))!.takenOff).toBe(false);
    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await seatsOf(table.long!)).toBe(10);
  });
});

describe("Reset table, more cases", () => {
  it("gives a table taken back its own saved seats: Counter 5 given 3 seats while split off comes back with 4", async () => {
    const { table, zoneId } = await c5SplitOff();
    await ok(post(`/api/tables/${table.c5!}/today/seats`, table.c5!, { seats: 3 }));
    expect(await seatsOf(table.c5!)).toBe(3);

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await seatsOf(table.c5!)).toBe(4);
  });

  it("Counter 5 in a group with Bar where guests sit, Counter 3 and 4 free: Reset table takes Counter 3 and 4 back and leaves the group as it is", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.bar!, table.c5!, "right", 8);
    const { partyId } = await seat(v, table.bar!);
    expect(await partyAt(v, table.c5!)).toBe(partyId);

    await settles(() => reset(table.long!, [table.c3!, table.c4!], 8), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 4, height: 2 });
    expect(await seatsOf(table.long!)).toBe(8);
    expect(await groupOf(table.c5!)).toEqual({
      seats: 8,
      members: [table.bar!, table.c5!].sort(),
    });
    expect(await placeOf(table.bar!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
  });

  it("Counter 5 in a group with Bar where guests sit at Bar alone, Counter 3 and 4 free: Reset table asks for seats, then takes Counter 3 and 4 back and leaves the group as it is", async () => {
    const { table, zoneId } = await longApart();
    await guestsAtBarAlone(table);

    await refused(
      reset(table.long!, [table.c3!, table.c4!]),
      400,
      "joined_table.seats_required",
      {},
    );
    await settles(() => reset(table.long!, [table.c3!, table.c4!], 8), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 4, height: 2 });
    expect(await groupOf(table.c5!)).toEqual({
      seats: 8,
      members: [table.bar!, table.c5!].sort(),
    });
    expect(await placeOf(table.bar!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
  });

  it("one group holding Counter 4, Counter 5 and Bar, nobody seated: Reset table takes all back, the group ends and Bar goes back by the bar counter", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.bar!, table.c5!, "right", 8);
    await merge(table.c4!, table.bar!, "right", 10);
    expect(await groupOf(table.bar!)).toEqual({
      seats: 10,
      members: [table.bar!, table.c4!, table.c5!].sort(),
    });

    await settles(() => reset(table.long!, [table.c3!, table.c4!, table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await groupOf(table.bar!)).toBeNull();
    expect(await groupOf(table.c4!)).toBeNull();
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });
});

describe("Reset table refused, nothing written", () => {
  it("nothing to take back: food on its way to the one table split off", async () => {
    const { table } = await c5SplitOff();
    const order = await counterOrder(v, "Paella");
    await inTx(v, (tx) =>
      tx
        .update(workingOrders)
        .set({ deliveryTableId: table.c5! })
        .where(eq(workingOrders.id, order)),
    );
    await pay(v, order, "20.00");
    const onItsWay = await inTx(v, (tx) =>
      tx
        .select({ id: workingOrders.id })
        .from(workingOrders)
        .where(and(eq(workingOrders.id, order), foodOnItsWay())),
    );
    expect(onItsWay).toHaveLength(1);
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "joined_table.nothing_to_join", {
      tableId: table.long!,
    });
    expect(await everything()).toEqual(before);
  });

  it("Counter 3 and 4 in a group with Bar where guests sit, Counter 5 free: refused naming Counter 3 and 4", async () => {
    const { table } = await LONG_TABLE();
    await merge(table.bar!, table.long!, "left");
    await seat(v, table.bar!);
    await ok(splitOff(table.bar!, [table.c5!], 10));
    expect(await groupOf(table.bar!)).toEqual({
      seats: 10,
      members: [table.bar!, table.c3!, table.c4!].sort(),
    });
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "joined_table.tables_in_group", {
      tableId: table.long!,
      partIds: [table.c3!, table.c4!],
    });
    expect(await everything()).toEqual(before);
  });

  it("Counter 5, the one table split off, in a group with Bar where guests sit at Bar alone: refused naming Counter 5, the group and Bar's place unchanged", async () => {
    const { table, zoneId } = await c5SplitOff();
    await guestsAtBarAlone(table);
    const revision = await zoneRevisionOf(v, zoneId);
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "joined_table.tables_in_group", {
      tableId: table.long!,
      partIds: [table.c5!],
    });
    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(revision);
    expect(await groupOf(table.c5!)).toEqual({
      seats: 8,
      members: [table.bar!, table.c5!].sort(),
    });
  });

  for (const [first, second] of [
    ["c3", "c4"],
    ["c4", "c3"],
  ] as const) {
    it(`Counter 3 and 4 in a group with Bar where guests sit, renamed "Table 01" on ${first} and "Table 1" on ${second}, which the till lists as equal: refused naming ${first} first`, async () => {
      const { table } = await LONG_TABLE();
      await merge(table.bar!, table.long!, "left");
      await seat(v, table.bar!);
      await ok(splitOff(table.bar!, [table.c5!], 10));
      const suffix = randomUUID().slice(0, 6);
      await relabel(table[first]!, `Table 01 ${suffix}`);
      await relabel(table[second]!, `Table 1 ${suffix}`);
      expect(compareLabels(`Table 01 ${suffix}`, `Table 1 ${suffix}`)).toBe(0);
      const before = await everything();

      await refused(reset(table.long!, [table.c5!]), 409, "joined_table.tables_in_group", {
        tableId: table.long!,
        partIds: [table[first]!, table[second]!],
      });
      expect(await everything()).toEqual(before);
    });
  }

  it("nothing to take back: Long table whole", async () => {
    const { table } = await LONG_TABLE();
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "joined_table.nothing_to_join", {
      tableId: table.long!,
    });
    expect(await everything()).toEqual(before);
  });

  it("nothing to take back: guests at the one table split off, which is in no group", async () => {
    const { table } = await c5SplitOff();
    await seat(v, table.c5!);
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "joined_table.nothing_to_join", {
      tableId: table.long!,
    });
    expect(await everything()).toEqual(before);
  });

  it("the tables sent are not the ones free", async () => {
    const { table } = await c5SplitOff();
    const before = await everything();

    await refused(reset(table.long!, [table.c4!]), 409, "joined_table.out_of_date", {
      tableId: table.long!,
    });
    expect(await everything()).toEqual(before);
  });

  it("some stay apart and no seats were sent", async () => {
    const { table } = await longApart();
    await seat(v, table.c5!);
    const before = await everything();

    await refused(
      reset(table.long!, [table.c3!, table.c4!]),
      400,
      "joined_table.seats_required",
      {},
    );
    expect(await everything()).toEqual(before);
  });

  it("a table that is not a joined table", async () => {
    const { table } = await LONG_TABLE();
    const before = await everything();

    await refused(reset(table.bar!, [table.c5!]), 404, "joined_table.not_found", {
      tableId: table.bar!,
    });
    expect(await everything()).toEqual(before);
  });

  it("a till that read an older floor", async () => {
    const { table, zoneId } = await c5SplitOff();
    const revision = (await zoneRevisionOf(v, zoneId))!;
    const before = await everything();

    await refused(
      app.request(`/api/tables/${table.long!}/today/reset`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ zoneRevision: revision - 1, partIds: [table.c5!] }),
      }),
      409,
      "floor_today.out_of_date",
      { zoneId, revision },
    );
    expect(await everything()).toEqual(before);
  });
});

describe("Reset table from two tills at once", () => {
  it("two tills press Reset table on Long table at once: one is applied, the other is told the floor has changed", async () => {
    const { table, zoneId } = await c5SplitOff();
    const revision = await readRevision(table.long!);
    const press = () =>
      app.request(`/api/tables/${table.long!}/today/reset`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ zoneRevision: revision, partIds: [table.c5!] }),
      });

    const answers = await Promise.all([press(), press()]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    await refused(
      answers.find((answer) => answer.status === 409)!,
      409,
      "floor_today.out_of_date",
      { zoneId, revision: revision + 1 },
    );
    expect(await zoneRevisionOf(v, zoneId)).toBe(revision + 1);
    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await placeOf(table.c5!)).toEqual(NO_PLACE);
    expect(await seatsOf(table.c5!)).toBe(4);
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });
});

/** LONG_TABLE with a third table, Stool (2 seats, 2 × 2 at 30, 0), off Long table's saved place. */
async function LONG_TABLE_AND_STOOL() {
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
      { key: "stool", label: "Stool", seats: 2, place: { x: 30, y: 0, width: 2, height: 2 } },
    ],
    NOW,
  );
  for (const key of ["c3", "c4", "c5"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

const moveTo = (tableId: string, x: number, y: number) =>
  ok(post(`/api/tables/${tableId}/today/move`, tableId, { x, y }));

describe("Reset table's place check", () => {
  it("Bar moved into Long table's saved place: refused naming Bar, and nothing changes", async () => {
    const { table } = await c5SplitOff();
    await moveTo(table.long!, 30, 30);
    await moveTo(table.bar!, 11, 20);
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "table.place_taken", {
      tableId: table.long!,
      standingId: table.bar!,
    });
    expect(await everything()).toEqual(before);
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
    expect(await placeOf(table.long!)).toEqual({ x: 30, y: 30, width: 4, height: 2 });
  });

  it("a table only touching the saved place's edge does not count", async () => {
    const { table, zoneId } = await c5SplitOff();
    await moveTo(table.long!, 30, 30);
    await moveTo(table.bar!, 16, 20);

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await placeOf(table.bar!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
  });

  it("a table taken off for today does not count", async () => {
    const { table, zoneId } = await c5SplitOff();
    await moveTo(table.long!, 30, 30);
    await moveTo(table.bar!, 11, 20);
    await ok(post(`/api/tables/${table.bar!}/today/take-off`, table.bar!, {}));
    expect((await todayRow(v, table.bar!))!.x).toBe(11);

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
  });

  it("a table staying apart that overlaps counts: guests at Counter 5, moved to 13, 20; refused naming Counter 5", async () => {
    const { table } = await longApart();
    await seat(v, table.c5!);
    await moveTo(table.c5!, 13, 20);
    const before = await everything();

    await refused(reset(table.long!, [table.c3!, table.c4!], 8), 409, "table.place_taken", {
      tableId: table.long!,
      standingId: table.c5!,
    });
    expect(await everything()).toEqual(before);
  });

  it("the refusal leaves a group it would have ended: Counter 5 pushed together with Bar, Stool moved into the saved place; refused naming Stool", async () => {
    const { table } = await LONG_TABLE_AND_STOOL();
    await ok(splitOff(table.long!, [table.c4!, table.c5!]));
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    await markNeedsClearing(table.c4!);
    await merge(table.bar!, table.c5!, "right", 8);
    expect(await placeOf(table.bar!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
    await moveTo(table.stool!, 12, 21);
    const before = await everything();

    await refused(reset(table.long!, [table.c3!, table.c4!, table.c5!]), 409, "table.place_taken", {
      tableId: table.long!,
      standingId: table.stool!,
    });
    expect(await everything()).toEqual(before);
    expect(await groupOf(table.bar!)).toEqual({
      seats: 8,
      members: [table.bar!, table.c5!].sort(),
    });
    expect(await placeOf(table.bar!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
  });

  it("two tables in the saved place: the first by label, Bar, is named", async () => {
    const { table } = await LONG_TABLE_AND_STOOL();
    await ok(splitOff(table.long!, [table.c5!], 6));
    await moveTo(table.long!, 30, 30);
    await moveTo(table.stool!, 10, 20);
    await moveTo(table.bar!, 14, 20);
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "table.place_taken", {
      tableId: table.long!,
      standingId: table.bar!,
    });
    expect(await everything()).toEqual(before);
  });

  it("a table Reset table takes back does not count: Counter 5 free inside the saved place", async () => {
    const { table, zoneId } = await c5SplitOff();
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await placeOf(table.c5!)).toEqual(NO_PLACE);
  });

  it("the middle table, apart with guests in its own slot, is refused, naming it", async () => {
    const { table } = await longApart();
    await seat(v, table.c4!);
    const before = await everything();

    await refused(reset(table.long!, [table.c3!, table.c5!], 6), 409, "table.place_taken", {
      tableId: table.long!,
      standingId: table.c4!,
    });
    expect(await everything()).toEqual(before);
  });
});

const BAR = { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0, width: 2, height: 2 } };

/** Long table (10 seats) = Counter 3, 4 and 5, each kept 2 × 2, saved at `long`; `others` beside it, those in `kept` kept 2 × 2 too. */
async function longTableWith(
  long: PlannedEntry["place"],
  others: PlannedEntry[],
  kept: string[] = [],
) {
  const zone = await plannedZone(
    v,
    [
      { key: "c3", label: "Counter 3", seats: 2, place: null },
      { key: "c4", label: "Counter 4", seats: 6, place: null },
      { key: "c5", label: "Counter 5", seats: 4, place: null },
      { key: "long", label: "Long table", seats: 10, place: long, partKeys: ["c3", "c4", "c5"] },
      ...others,
    ],
    NOW,
  );
  for (const key of ["c3", "c4", "c5", ...kept])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

/** Renames `tableId`; the room's first read after `plannedZone` names its tables as the plan does, so call this after it. */
async function relabel(tableId: string, label: string): Promise<void> {
  await inTx(v, (tx) => tx.update(diningTables).set({ label }).where(eq(diningTables.id, tableId)));
}

describe("Reset table's place check, more cases", () => {
  it("Bar pushed onto Counter 5's left, inside the saved place, nobody seated: the group ends first, so Bar goes back by the bar counter and Long table is whole at its saved place", async () => {
    const { table, zoneId } = await c5SplitOff();
    await moveTo(table.long!, 30, 30);
    await merge(table.bar!, table.c5!, "left", 8);
    expect(await placeOf(table.bar!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await groupOf(table.bar!)).toBeNull();
  });

  it("a joined table come apart does not count though its own row stays placed: Window moved into the saved place, then both its tables split off and moved away", async () => {
    const { table, zoneId } = await longTableWith(
      LONG_SAVED,
      [
        BAR,
        { key: "w1", label: "Window 1", seats: 2, place: null },
        { key: "w2", label: "Window 2", seats: 2, place: null },
        {
          key: "window",
          label: "Window",
          seats: 4,
          place: { x: 50, y: 10, width: 4, height: 2 },
          partKeys: ["w1", "w2"],
        },
      ],
      ["w1", "w2"],
    );
    await ok(splitOff(table.long!, [table.c5!], 6));
    await moveTo(table.long!, 30, 30);
    await moveTo(table.window!, 10, 20);
    await ok(splitOff(table.window!, [table.w1!]));
    expect(await splitRowsOf(table.window!)).toEqual([table.w1!, table.w2!].sort());
    await moveTo(table.w1!, 60, 0);
    await moveTo(table.w2!, 64, 0);
    expect(await placeOf(table.window!)).toEqual({ x: 10, y: 20, width: 4, height: 2 });
    expect((await todayRow(v, table.window!))!.takenOff).toBe(false);

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
  });

  it("Bar saved turned 195°, moved so its centre is on the saved place's corner, overlaps it by exactly one square: refused naming Bar", async () => {
    const { table } = await longTableWith(LONG_SAVED, [
      { ...BAR, place: { ...BAR.place, rotation: 195 } },
    ]);
    await ok(splitOff(table.long!, [table.c5!], 6));
    await moveTo(table.long!, 30, 30);
    await moveTo(table.bar!, 9, 19);
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "table.place_taken", {
      tableId: table.long!,
      standingId: table.bar!,
    });
    expect(await everything()).toEqual(before);
  });

  it("Table 2.10, Table 2.9 and Table 10 all in the saved place: Table 2.10 is named, the first in the order the till lists tables", async () => {
    const { table } = await longTableWith(LONG_SAVED, [
      { key: "t210", label: "Table 2.10", seats: 2, place: { x: 40, y: 0, width: 2, height: 2 } },
      { key: "t29", label: "Table 2.9", seats: 2, place: { x: 44, y: 0, width: 2, height: 2 } },
      { key: "t10", label: "Table 10", seats: 2, place: { x: 48, y: 0, width: 2, height: 2 } },
    ]);
    await ok(splitOff(table.long!, [table.c5!], 6));
    await moveTo(table.long!, 30, 30);
    await moveTo(table.t10!, 10, 20);
    await moveTo(table.t29!, 12, 20);
    await moveTo(table.t210!, 14, 20);
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "table.place_taken", {
      tableId: table.long!,
      standingId: table.t210!,
    });
    expect(await everything()).toEqual(before);
  });

  for (const [first, second] of [
    ["bar", "stool"],
    ["stool", "bar"],
  ] as const) {
    it(`two labels the till lists as equal, "Table 01" on ${first} and "Table 1" on ${second}: ${first} is named`, async () => {
      const { table } = await LONG_TABLE_AND_STOOL();
      await ok(splitOff(table.long!, [table.c5!], 6));
      await moveTo(table.long!, 30, 30);
      await moveTo(table.bar!, 10, 20);
      await moveTo(table.stool!, 14, 20);
      const suffix = randomUUID().slice(0, 6);
      await relabel(table[first]!, `Table 01 ${suffix}`);
      await relabel(table[second]!, `Table 1 ${suffix}`);
      expect(compareLabels(`Table 01 ${suffix}`, `Table 1 ${suffix}`)).toBe(0);

      await refused(reset(table.long!, [table.c5!]), 409, "table.place_taken", {
        tableId: table.long!,
        standingId: table[first]!,
      });
      expect((await tableRow(v, table[first]!)).label).toBe(`Table 01 ${suffix}`);
    });
  }

  it("the place reaches from the first table joined to the last: guests at Counter 4, moved away; Reset table for Counter 3 and 5 puts Long table over all three slots", async () => {
    const { table, zoneId } = await longApart();
    await seat(v, table.c4!);
    await moveTo(table.c4!, 30, 0);

    await settles(() => reset(table.long!, [table.c3!, table.c5!], 6), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await seatsOf(table.long!)).toBe(6);
    expect(await placeOf(table.c4!)).toEqual({ x: 30, y: 0, width: 2, height: 2 });
  });
});

const SIX = {
  key: "six",
  label: "Table 6",
  seats: 2,
  place: { x: 14, y: 20, width: 2, height: 2 },
};

describe("Reset table's place check, against a layout that overlaps its own tables", () => {
  it("Long table saved over Table 6, which stands at its own saved place: Reset table puts Long table back overlapping it", async () => {
    const { table, zoneId } = await longTableWith(LONG_SAVED, [SIX]);
    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await placeOf(table.six!)).toEqual(SIX.place);
    await ok(splitOff(table.long!, [table.c5!], 6));

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await placeOf(table.six!)).toEqual(SIX.place);
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });

  it("Table 6 moved one square off its own saved place: refused naming Table 6, and nothing changes", async () => {
    const { table } = await longTableWith(LONG_SAVED, [SIX]);
    await ok(splitOff(table.long!, [table.c5!], 6));
    await moveTo(table.six!, 15, 20);
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "table.place_taken", {
      tableId: table.long!,
      standingId: table.six!,
    });
    expect(await everything()).toEqual(before);
  });
});

describe("Reset table on a joined table saved with no place", () => {
  /** Long table saved with no place, put out today at 10, 20 (8 × 8, the size a new table gets). */
  async function longPutOut(others: PlannedEntry[]) {
    const zone = await longTableWith(null, others);
    await ok(
      post(`/api/tables/${zone.table.long!}/today/place`, zone.table.long!, { x: 10, y: 20 }),
    );
    expect(await placeOf(zone.table.long!)).toEqual({ x: 10, y: 20, width: 8, height: 8 });
    return zone;
  }

  it("Counter 5 split off, Bar on the map: Reset table puts Long table whole where it stands, at the size a new table gets", async () => {
    const { table, zoneId } = await longPutOut([BAR]);
    await ok(splitOff(table.long!, [table.c5!], 6));
    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 4, height: 8 });

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 8, height: 8 });
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await placeOf(table.c5!)).toEqual(NO_PLACE);
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });

  it("Counter 5 split off, no other table on the map: the same", async () => {
    const { table, zoneId } = await longPutOut([{ ...BAR, place: null }]);
    await ok(splitOff(table.long!, [table.c5!], 6));

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 8, height: 8 });
    expect(await placeOf(table.c5!)).toEqual(NO_PLACE);
  });

  it("split apart, guests at Counter 5: Reset table for Counter 3 and 4 puts Long table over their slots from its own row", async () => {
    const { table, zoneId } = await longPutOut([BAR]);
    await ok(splitOff(table.long!, [table.c4!, table.c5!]));
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
    await seat(v, table.c5!);

    await settles(() => reset(table.long!, [table.c3!, table.c4!], 8), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 4, height: 8 });
    expect(await seatsOf(table.long!)).toBe(8);
  });

  it("split apart, every table free, Bar on the map: with nowhere to stand Long table comes back whole off the map", async () => {
    const { table, zoneId } = await longPutOut([BAR]);
    await ok(splitOff(table.long!, [table.c4!, table.c5!]));
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());

    await settles(() => reset(table.long!, [table.c3!, table.c4!, table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(NO_PLACE);
    expect(await seatsOf(table.long!)).toBe(10);
    expect((await todayRow(v, table.long!))!.takenOff).toBe(false);
    for (const key of ["c3", "c4", "c5"]) expect(await placeOf(table[key]!)).toEqual(NO_PLACE);
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });

  it("Counter 5 split off, then Long table taken off for today: Reset table leaves Long table off the map", async () => {
    const { table, zoneId } = await longPutOut([BAR]);
    await ok(splitOff(table.long!, [table.c5!], 6));
    await ok(post(`/api/tables/${table.long!}/today/take-off`, table.long!, {}));
    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 4, height: 8 });
    expect((await todayRow(v, table.long!))!.takenOff).toBe(true);

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(NO_PLACE);
    expect((await todayRow(v, table.long!))!.takenOff).toBe(false);
  });

  it("Counter 3, the first part, split off with 8 seats: Reset table puts Long table back where it stood before", async () => {
    const { table, zoneId } = await longPutOut([BAR]);
    await ok(splitOff(table.long!, [table.c3!], 8));
    expect(await placeOf(table.long!)).toEqual({ x: 12, y: 20, width: 4, height: 8 });

    await settles(() => reset(table.long!, [table.c3!]), zoneId);

    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 8, height: 8 });
  });

  it("Table 6 standing at its own saved place inside where Long table stood: the place comes from today's map, not the saved row, so Table 6 still counts and is named", async () => {
    const { table } = await longPutOut([SIX]);
    expect(await placeOf(table.six!)).toEqual(SIX.place);
    await ok(splitOff(table.long!, [table.c5!], 6));
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "table.place_taken", {
      tableId: table.long!,
      standingId: table.six!,
    });
    expect(await everything()).toEqual(before);
  });
});

async function apart(tableId: string): Promise<number | null> {
  const rows = await v.db.all<{ id: string; named: number | null }>(
    sql`select dt.id, ${joinedTableApart(sql`dt.id`)} as named from dining_tables dt`,
  );
  return rows.find((row) => row.id === tableId)!.named;
}

async function out(tableId: string): Promise<number | null> {
  const rows = await v.db.all<{ id: string; named: number | null }>(
    sql`select dt.id, ${joinedOutOfService(sql`dt.id`)} as named from dining_tables dt`,
  );
  return rows.find((row) => row.id === tableId)!.named;
}

/**
 * Long table saved over Counter 4 and 5 (at `long`), guests seated at Counter 3, then the plan
 * saved with Counter 3 joined into Long table and the room reset while the guests stay.
 */
async function longAroundHeldCounter3(long: PlannedEntry["place"]) {
  const zone = await plannedZone(
    v,
    [
      { key: "c3", label: "Counter 3", seats: 2, place: null },
      { key: "c4", label: "Counter 4", seats: 6, place: null },
      { key: "c5", label: "Counter 5", seats: 4, place: null },
      { key: "long", label: "Long table", seats: 10, place: long, partKeys: ["c4", "c5"] },
    ],
    v.clock.now().instant,
  );
  const { zoneId, master } = zone;
  await giveKeptSize(v, master.c3!, { width: 2, height: 2 });
  await giveKeptSize(v, master.c4!, { width: 2, height: 2 });
  await seat(v, zone.table.c3!);
  await inTx(v, async (tx) => {
    const plan = await readLayout(tx, v.cfg, await defaultLayout(tx, v.cfg, zoneId));
    const tables = plan.tables.map((t) => ({
      id: t.id,
      key: t.id,
      label: t.label,
      seats: t.seats,
      fixed: t.fixed,
      placement: t.placement,
      partKeys: t.id === master.long ? [master.c3!, master.c4!, master.c5!] : t.partIds,
    }));
    await saveLayout(
      tx,
      v.cfg,
      REMOVALS,
      await defaultLayout(tx, v.cfg, zoneId),
      { revision: plan.revision, tables },
      v.clock.now().instant,
    );
  });
  await inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, v.clock.now().instant, "due"));
  return zone;
}

describe("Reset table on a joined table come apart around a part the guests held through the room's reset", () => {
  it("brings Long table back at its saved place, not where staff moved it", async () => {
    const { table, zoneId } = await longAroundHeldCounter3({ x: 10, y: 20, width: 6, height: 2 });
    await moveTo(table.long!, 15, 25);
    await ok(splitOff(table.long!, [table.c5!]));
    expect(await apart(table.long!)).toBe(1);
    expect(await splitRowsOf(table.long!)).toEqual([table.c4!, table.c5!].sort());
    expect(await placeOf(table.long!)).toMatchObject({ x: 15, y: 25 });

    await settles(() => reset(table.long!, [table.c4!, table.c5!]), zoneId);

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await seatsOf(table.long!)).toBe(10);
  });
});

describe("Reset table on a joined table come apart around a table with guests a new layout joins to it", () => {
  it("saved with no place and put out today: Long table comes back off the map, not built out from where its row stood", async () => {
    const { table, master, zoneId } = await longTableWith(null, [
      BAR,
      { key: "c6", label: "Counter 6", seats: 2, place: { x: 60, y: 40 } },
    ]);
    await ok(post(`/api/tables/${table.long!}/today/place`, table.long!, { x: 10, y: 20 }));
    await ok(splitOff(table.long!, [table.c4!, table.c5!]));
    await seat(v, table.c6!);
    await inTx(v, async (tx) => {
      const layout = await defaultLayout(tx, v.cfg, zoneId);
      const plan = await readLayout(tx, v.cfg, layout);
      const tables = plan.tables.map((t) => ({
        id: t.id,
        key: t.id,
        label: t.label,
        seats: t.seats,
        fixed: t.fixed,
        placement: t.id === master.c6 ? null : t.placement,
        partKeys:
          t.id === master.long ? [master.c3!, master.c4!, master.c5!, master.c6!] : t.partIds,
      }));
      await saveLayout(tx, v.cfg, REMOVALS, layout, { revision: plan.revision, tables }, NOW);
    });
    await inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW, "due"));
    expect(await apart(table.long!)).toBe(1);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
    expect(await placeOf(table.long!)).toEqual({ x: 10, y: 20, width: 8, height: 8 });

    await ok(reset(table.long!, [table.c3!, table.c4!, table.c5!]));

    expect(await placeOf(table.long!)).toEqual(NO_PLACE);
    expect(await seatsOf(table.long!)).toBe(10);
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });
});

describe("a room's reset while guests sit at a part saved into Long table", () => {
  it("leaves Long table's whole group waiting: Long table cannot be put on the map", async () => {
    const { table } = await longAroundHeldCounter3(null);

    const rows = await inTx(v, (tx) =>
      tx
        .select({ tableId: floorResetTables.tableId, pending: floorResetTables.pending })
        .from(floorResetTables)
        .where(inArray(floorResetTables.tableId, [table.long!, table.c3!, table.c4!, table.c5!])),
    );
    expect(rows.map((row) => row.pending)).toEqual([true, true, true, true]);
    await refused(
      post(`/api/tables/${table.long!}/today/place`, table.long!, { x: 30, y: 30 }),
      409,
      "table.in_joined_table",
      { tableId: table.long! },
    );
    expect(await placeOf(table.long!)).toEqual(NO_PLACE);
  });
});

describe("Reset table, what it leaves alone", () => {
  it.each<[string, (table: Record<string, string>) => Promise<void>]>([
    [
      "took off",
      async (table) => {
        await inTx(v, (tx) =>
          tx
            .update(floorTodayTables)
            .set({ takenOff: true })
            .where(eq(floorTodayTables.tableId, table.c5!)),
        );
      },
    ],
    [
      "made an unplaced spare",
      async (table) => {
        await inTx(v, (tx) =>
          tx
            .update(floorTodayTables)
            .set({ x: null, y: null, width: null, height: null, shape: null, rotation: null })
            .where(eq(floorTodayTables.tableId, table.c5!)),
        );
      },
    ],
  ])("takes back a table split off that an older till %s", async (_name, setup) => {
    const { table, zoneId } = await c5SplitOff();
    await setup(table);

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await todayRow(v, table.c5!)).toMatchObject({ takenOff: false, x: null });
    expect(await out(table.c5!)).toBe(1);
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });

  it("leaves every other table as it was: Bar's row is unchanged", async () => {
    const { table, zoneId } = await c5SplitOff();
    const bar = await todayRow(v, table.bar!);

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await todayRow(v, table.bar!)).toEqual(bar);
  });

  it("keeps the guests at Long table and their party's revision", async () => {
    const { table, zoneId } = await LONG_TABLE();
    const { partyId } = await seat(v, table.long!);
    await ok(splitOff(table.long!, [table.c5!], 6));
    const revision = await revisionOf(v, partyId);

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

    expect(await partyAt(v, table.long!)).toBe(partyId);
    expect(await revisionOf(v, partyId)).toBe(revision);
  });
});

describe("Reset table refused when the tables sent are not the ones free, nothing written", () => {
  it("Long table come apart, Counter 3 left out of the tables sent", async () => {
    const { table } = await longApart();
    const before = await everything();

    await refused(reset(table.long!, [table.c4!, table.c5!]), 409, "joined_table.out_of_date", {
      tableId: table.long!,
    });
    expect(await everything()).toEqual(before);
  });

  it("a second Reset table finds nothing to take back", async () => {
    const { table } = await c5SplitOff();
    await ok(reset(table.long!, [table.c5!]));
    const before = await everything();

    await refused(reset(table.long!, [table.c5!]), 409, "joined_table.nothing_to_join", {
      tableId: table.long!,
    });
    expect(await everything()).toEqual(before);
  });

  it("the second of two tills is refused once guests sit at a table it expected back, then the tables free come back", async () => {
    const { table, zoneId } = await longApart();
    await seat(v, table.c5!);
    const before = await everything();

    await refused(
      reset(table.long!, [table.c3!, table.c4!, table.c5!]),
      409,
      "joined_table.out_of_date",
      { tableId: table.long! },
    );
    expect(await everything()).toEqual(before);

    await settles(() => reset(table.long!, [table.c3!, table.c4!], 6), zoneId);

    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
    expect(await seatsOf(table.long!)).toBe(6);
  });
});

describe("Reset table and the room's reset", () => {
  it("after a Reset to {set} plan, the tables taken back are joined and Long table in service", async () => {
    const { table, zoneId } = await LONG_TABLE();
    await seat(v, table.long!);
    await ok(splitOff(table.long!, [table.c4!, table.c5!]));
    const before = (await zoneRevisionOf(v, zoneId))!;
    await inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, v.clock.now().instant, "due"));
    expect(await zoneRevisionOf(v, zoneId)).toBe(before + 1);

    await settles(() => reset(table.long!, [table.c4!, table.c5!], 8), zoneId);

    expect(await zoneRevisionOf(v, zoneId)).toBe(before + 2);

    expect(await out(table.c4!)).toBe(1);
    expect(await out(table.c5!)).toBe(1);
    expect(await apart(table.long!)).toBe(0);
    expect(await placeOf(table.long!)).toEqual({ x: 12, y: 20, width: 4, height: 2 });
    expect(await seatsOf(table.long!)).toBe(8);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!]);
  });

  it("a room's reset after a partial Reset table waits for the guests left apart, then marks Long table needing moving", async () => {
    const { table, zoneId } = await LONG_TABLE();
    const { partyId } = await seat(v, table.long!);
    await ok(splitOff(table.long!, [table.c4!, table.c5!]));
    await ok(reset(table.long!, [table.c4!, table.c5!], 8));

    await inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW, "due"));

    expect(await placeOf(table.long!)).toEqual({ x: 12, y: 20, width: 4, height: 2 });
    expect(await seatsOf(table.long!)).toBe(8);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!]);

    const command = await commandFor(v, partyId);
    await inTx(v, (tx) => finishTable(tx, { partyId, ...command }));
    await inTx(v, (tx) => catchUpZone(tx, v.cfg, REMOVALS, zoneId, NOW));

    expect(await placeOf(table.long!)).toEqual({ x: 12, y: 20, width: 4, height: 2 });
    expect(await seatsOf(table.long!)).toBe(8);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!]);
    const [marked] = await inTx(v, (tx) =>
      tx
        .select({ readyToMove: floorResetTables.readyToMove })
        .from(floorResetTables)
        .where(eq(floorResetTables.tableId, table.long!)),
    );
    expect(marked).toEqual({ readyToMove: true });
  });

  it("Back to its saved place works on Long table after Reset table", async () => {
    const { table } = await c5SplitOff();
    await ok(reset(table.long!, [table.c5!]));
    await moveTo(table.long!, 30, 30);

    await ok(post(`/api/tables/${table.long!}/today/back`, table.long!, {}));

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await seatsOf(table.long!)).toBe(10);
  });
});

describe("Reset table on a joined table still standing", () => {
  it("Counter 6 free, guests at Counter 5 between it and the tables still joined: refused naming Counter 5, nothing written", async () => {
    const { table, zoneId } = await plannedZone(
      v,
      [
        { key: "c3", label: "Counter 3", seats: 2, place: null },
        { key: "c4", label: "Counter 4", seats: 2, place: null },
        { key: "c5", label: "Counter 5", seats: 2, place: null },
        { key: "c6", label: "Counter 6", seats: 2, place: null },
        {
          key: "long",
          label: "Long table",
          seats: 8,
          place: { x: 10, y: 20, width: 8, height: 2 },
          partKeys: ["c3", "c4", "c5", "c6"],
        },
      ],
      NOW,
    ).then(async (zone) => {
      for (const key of ["c3", "c4", "c5", "c6"])
        await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
      return zone;
    });
    await ok(splitOff(table.long!, [table.c6!], 6));
    await ok(splitOff(table.long!, [table.c5!], 4));
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
    await seat(v, table.c5!);
    await moveTo(table.long!, 15, 25);
    expect(await apart(table.long!)).toBe(0);
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!, table.c6!].sort());
    const revision = await readRevision(table.long!);
    const before = await everything();

    await refused(reset(table.long!, [table.c6!], 8), 409, "table.place_taken", {
      tableId: table.long!,
      standingId: table.c5!,
    });
    expect(await everything()).toEqual(before);
    expect(await zoneRevisionOf(v, zoneId)).toBe(revision);
  });
});
