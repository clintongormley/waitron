import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
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
} from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { inTx, partyAt, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
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

describe("Reset table", () => {
  it("every table free: Counter 5 split off, Long table moved to the middle; Reset table puts Long table whole at its saved place with 10 seats and Counter 5 leaves the map", async () => {
    const { table, zoneId } = await c5SplitOff();
    await ok(post(`/api/tables/${table.long!}/today/move`, table.long!, { x: 30, y: 30 }));

    await settles(() => reset(table.long!, [table.c5!]), zoneId);

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

describe("Reset table refused, nothing written", () => {
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

describe("Join again beside Reset table", () => {
  it("still answers the old till: Counter 5 joined again, Long table whole where it stands", async () => {
    const { table, zoneId } = await c5SplitOff();

    await settles(
      () =>
        post(`/api/tables/${table.long!}/today/join-again`, table.long!, { partIds: [table.c5!] }),
      zoneId,
    );

    expect(await placeOf(table.long!)).toEqual(LONG_SAVED);
    expect(await placeOf(table.c5!)).toEqual(NO_PLACE);
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });
});
