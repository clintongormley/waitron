import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { observedMoveBillBody } from "./testing/move-bill-fixture.js";
import { observedTableActionBody } from "./testing/table-action-fixture.js";
import { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import {
  diningTables,
  floorTodayJoinTables,
  floorTodayJoins,
  parties,
  partyTables,
  workingOrders,
  todayColumns,
  todaySet,
} from "@waitron/db";
import { hashPin, loginWithPin } from "@waitron/identity";
import { partyTablesName } from "@waitron/shared";
import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";
import { foodOnItsWay } from "./delivery-release.js";
import { leaveMergesRestoring } from "./floor-today-merges.js";
import { resetZone } from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
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
  withSplitPartyReads,
} from "./testing/floor-today-venue.js";
import { seedSessionDevice, sessionCookieForTest } from "./testing/session-device.js";
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
  // Fixed so a run across the venue's 05:00 day change keeps the room it read:
  // docs/developers/testing-guide.md#a-floor-test-pins-the-till-apis-clock-away-from-the-day-change
  const clock: TrustedClock = { ...v.clock, now: () => ({ ...v.clock.now(), instant: NOW }) };
  app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: v.db,
      backend: v.backend,
      clock,
      cfg: v.cfg,
      tableRemovals: enabledTableRemovals(ALL_MODULES),
      secureCookies: false,
      venueLocale: v.cfg.locale,
    },
    () => {},
  );
  const deviceId = await seedSessionDevice(v.db);
  const session = await inTx(v, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Anna",
      pinHash: hashPin("5555"),
      role: "staff",
    });
    return loginWithPin(tx, { deviceId, personId: person!.id, pin: "5555" });
  });
  cookie = await sessionCookieForTest(v.db, session.token);
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
  await inTx(v, (tx) => resetZone(tx, enabledTableRemovals(ALL_MODULES), zone.zoneId, NOW, "due"));
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
    body: JSON.stringify(
      await observedTableActionBody(
        v.db,
        path,
        await withSplitPartyReads(v, path, {
          zoneRevision: await readRevision(revisionAt),
          ...body,
        }),
      ),
    ),
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
  await merge(zone.table.bar!, zone.table.c3!, "left");
  return zone;
}

async function placeOf(tableId: string) {
  const row = await todayRow(v, tableId);
  return { x: row!.x, y: row!.y, width: row!.width, height: row!.height };
}

async function seatsOf(tableId: string) {
  return (await todayRow(v, tableId))!.seats;
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
  expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
  expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
  expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20, width: 2, height: 2 });
  return zone;
}

async function everything() {
  return inTx(v, async (tx) => ({
    today: await tx
      .select(todayColumns)
      .from(diningTables)
      .where(eq(diningTables.onFloor, true))
      .orderBy(asc(diningTables.id)),
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

describe("Split tables… on a group with nobody seated", () => {
  it("A pushed onto B's right, A or B ticked from either table: the group ends and A goes back where it stood", async () => {
    for (const [from, ticked] of [
      ["a", "b"],
      ["b", "b"],
      ["a", "a"],
      ["b", "a"],
    ] as const) {
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

      await settles(() => splitOff(table[from]!, [table[ticked]!]), zoneId);

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
  });

  it("Counter 4 pushed onto Counter 3's left, Bar ticked: Counter 4 stands on the wrong side, so they stay a group", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.c4!, table.c3!, "left", 6);
    await merge(table.bar!, table.c4!, "left", 8);
    expect(await placeOf(table.c4!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.bar!, [table.bar!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c4!].sort() });
    expect(await placeOf(table.c4!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
  });

  it("Counter 4 pushed below Counter 5 where Counter 4 stood, Counter 3 onto Counter 5's left, Counter 5 ticked: Counter 4 stands two squares low, so they stay a group", async () => {
    const { table, zoneId } = await longApart();
    await ok(post(`/api/tables/${table.c4!}/today/move`, table.c4!, { x: 30, y: 30 }));
    await ok(post(`/api/tables/${table.c5!}/today/move`, table.c5!, { x: 12, y: 20 }));
    await merge(table.c4!, table.c5!, "bottom", 6);
    await merge(table.c3!, table.c5!, "left", 8);
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 22, width: 2, height: 2 });
    const before = await everything();

    await refused(splitOff(table.c3!, [table.c5!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.c3!, [table.c5!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c4!].sort() });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 22, width: 2, height: 2 });
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
  });

  it("splitting off a free member leaves a remaining member needing clearing", async () => {
    const { table } = await barOnLong();
    await markNeedsClearing(table.c4!);

    await ok(splitOff(table.bar!, [table.bar!], 10));

    expect((await tableRow(v, table.c4!)).needsClearingSince).toBe(NOW.toISOString());
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
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
  });

  it("Bar, Counter 4 and 5 ticked: Counter 3 alone ends the group and stays split off where it stands", async () => {
    const { table, zoneId } = await barOnLong();
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await settles(() => splitOff(table.c3!, [table.bar!, table.c4!, table.c5!]), zoneId);

    expect(await groupRowsOf(joinId)).toEqual({ joins: [], members: [] });
    expect(await groupOf(table.c3!)).toBeNull();
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0, width: 2, height: 2 });
  });

  it("Bar and Counter 4 ticked: Counter 3 and 5 are not side by side in Long table, so they stay a group with the seats sent and Counter 4 stands where it stood", async () => {
    const { table, zoneId } = await barOnLong();
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
  });

  it("Counter 5 pushed onto Counter 3's left and Bar onto Counter 5, Bar ticked: Counter 3 and 5 stay a group, Counter 5 where it stands", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.c5!, table.c3!, "left", 6);
    await merge(table.bar!, table.c5!, "left", 8);
    expect(await placeOf(table.c5!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.bar!, [table.bar!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c5!].sort() });
    expect(await placeOf(table.c5!)).toEqual({ x: 8, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20, width: 2, height: 2 });
  });

  it("Counter 4 pushed below Counter 3, Bar ticked: they stand where Long table cannot cover them, so they stay a group", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.c4!, table.c3!, "bottom", 6);
    await merge(table.bar!, table.c3!, "left", 8);
    expect(await placeOf(table.c4!)).toEqual({ x: 10, y: 22, width: 2, height: 2 });
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);

    await settles(() => splitOff(table.bar!, [table.bar!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c4!].sort() });
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
    expect(await placeOf(table.c4!)).toEqual({ x: 10, y: 22, width: 2, height: 2 });
  });

  it("a counter turned unlike Counter 3 where Long table would put it stays in a group", async () => {
    const { table, zoneId } = await longApart();
    await merge(table.c4!, table.c3!, "right", 6);
    await merge(table.bar!, table.c3!, "left", 8);
    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set(todaySet({ rotation: 45 }))
        .where(eq(diningTables.id, table.c4!)),
    );

    await settles(() => splitOff(table.bar!, [table.bar!], 6), zoneId);

    expect(await groupOf(table.c3!)).toEqual({ seats: 6, members: [table.c3!, table.c4!].sort() });
  });
});

async function withClearing<T>(fn: () => Promise<T>): Promise<T> {
  await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, true));
  try {
    return await fn();
  } finally {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));
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
      expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20, width: 2, height: 2 });
      for (const key of ["c3", "c4", "c5"] as const) {
        expect((await tableRow(v, table[key]!)).needsClearingSince).toBeNull();
      }
      expect(await revisionOf(v, guests.partyId)).toBe(revision + 1);
    });
  });

  it("the kitchen gets one moved notice", async () => {
    const { table, guests } = await guestsAtGroup();

    const groupId = (await mergeOf(v, table.bar!))!.joinId;
    const [group] = await inTx(v, (tx) =>
      tx
        .select({ name: floorTodayJoins.name })
        .from(floorTodayJoins)
        .where(eq(floorTodayJoins.id, groupId)),
    );
    await ok(splitOff(table.bar!, [table.bar!], 10));

    expect((await activeTablesOf(v, guests.partyId)).sort()).toEqual(
      [table.c3!, table.c4!, table.c5!].sort(),
    );
    expect(await noticesOn([guests.tabId])).toEqual([
      {
        working_order_id: guests.tabId,
        kind: "moved",
        moved_to: `${group!.name!} (${await partyNameOf(guests.partyId)})`,
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
        body: JSON.stringify(
          await observedMoveBillBody(v.db, `/api/bills/${billId}/move`, {
            partyId: null,
            submissionId: randomUUID(),
            allergy: { party: { answer: "none", guests: [] }, ticks: [] },
            to: { tableId },
            otherPartyId: null,
          }),
        ),
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
  it("Bar ticked while the party holds Bar alone is refused merge.strands_party naming Bar, nothing written", async () => {
    await withClearing(async () => {
      const { table } = await partyAtBarAlone();
      const before = await everything();

      await refused(splitOff(table.bar!, [table.bar!], 10), 409, "merge.strands_party", {
        tableId: table.bar!,
        field: "partIds",
      });
      expect(await everything()).toEqual(before);
    });
  });

  it("Bar ticked while the party holds Bar alone, having sat at Long table earlier and left it, is refused merge.strands_party naming Bar, nothing written", async () => {
    await withClearing(async () => {
      const { table, partyId } = await partyAtBarAlone();
      const earlier = new Date(NOW.getTime() - 60 * 60_000).toISOString();
      await inTx(v, (tx) =>
        tx
          .insert(partyTables)
          .values({ partyId, tableId: table.c3!, joinedAt: earlier, leftAt: earlier }),
      );
      const before = await everything();

      await refused(splitOff(table.bar!, [table.bar!], 10), 409, "merge.strands_party", {
        tableId: table.bar!,
        field: "partIds",
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
  await inTx(v, (tx) => resetZone(tx, enabledTableRemovals(ALL_MODULES), zone.zoneId, NOW, "due"));
  const { table } = zone;
  await inTx(v, (tx) => leaveMergesRestoring(tx, [table.c6!, table.c7!]));
  await merge(table.c6!, table.c5!, "right", 14);
  await merge(table.c7!, table.c6!, "right", 14);
  expect(await groupOf(table.c3!)).toEqual({
    seats: 14,
    members: [table.c3!, table.c4!, table.c5!, table.c6!, table.c7!].sort(),
  });
  expect(await placeOf(table.c6!)).toEqual({ x: 16, y: 20, width: 2, height: 2 });
  expect(await placeOf(table.c7!)).toEqual({ x: 18, y: 20, width: 2, height: 2 });
  return zone;
}

describe("Split tables… on a group holding the tables of two joined tables", () => {
  it("Counter 5 and 7 ticked: Counter 3, 4 and 6 come from both, so they stay a group with the seats sent", async () => {
    const { table, zoneId } = await shortOnLong();
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
  });
});

describe("Split tables… on a group: refusals write nothing", () => {
  it("a ticked table not in the group is refused merge.member_invalid", async () => {
    const { table } = await barOnLong();
    const before = await everything();

    const outsider = randomUUID();
    await refused(splitOff(table.bar!, [outsider]), 400, "merge.member_invalid", {
      tableId: outsider,
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

  it("seats missing when Long table comes back partly is refused merge.seats_required", async () => {
    const { table } = await barOnLong();
    const before = await everything();

    await refused(splitOff(table.bar!, [table.bar!, table.c5!]), 400, "merge.seats_required", {});
    expect(await everything()).toEqual(before);
  });
});

describe("split party observations", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const [name, expectedParties] of [
    ["missing", undefined],
    ["null", null],
    ["not a list", {}],
    ["not an object", [null]],
    ["invalid id", [{ id: "not-an-id", revision: 0 }]],
    ["missing revision", [{ id }]],
    ["fractional revision", [{ id, revision: 0.5 }]],
    ["negative revision", [{ id, revision: -1 }]],
    ["coerced revision", [{ id, revision: "0" }]],
    [
      "duplicate id",
      [
        { id, revision: 0 },
        { id: id.toUpperCase(), revision: 1 },
      ],
    ],
  ] as const) {
    it(`refuses ${name} party observations without changing the group`, async () => {
      const { table } = await barOnLong();
      const before = await everything();
      await refused(
        post(`/api/tables/${table.bar!}/today/split-off`, table.bar!, {
          partIds: [table.bar!],
          expectedParties,
        }),
        400,
        "management.request_invalid",
        { field: "expectedParties" },
      );
      expect(await everything()).toEqual(before);
    });
  }

  it("checks the party revision before stranding or missing seats", async () => {
    const { table, partyId } = await partyAtBarAlone();
    const revision = await revisionOf(v, partyId);
    const before = await everything();
    await refused(
      post(`/api/tables/${table.bar!}/today/split-off`, table.bar!, {
        partIds: [table.bar!],
        expectedParties: [{ id: partyId, revision: revision + 1 }],
      }),
      409,
      "party.out_of_date",
      { partyId, revision },
    );
    expect(await everything()).toEqual(before);
  });

  it("refuses a party read at a table that is now free", async () => {
    const old = await guestsAtGroup();
    const { table } = await barOnLong();
    const revision = await revisionOf(v, old.guests.partyId);
    const before = await everything();
    await refused(
      post(`/api/tables/${table.bar!}/today/split-off`, table.bar!, {
        partIds: [table.bar!],
        expectedParties: [{ id: old.guests.partyId, revision }],
      }),
      409,
      "party.out_of_date",
      { partyId: old.guests.partyId, revision },
    );
    expect(await everything()).toEqual(before);
  });

  it("refuses a different party even when its revision matches", async () => {
    const old = await guestsAtGroup();
    const current = await guestsAtGroup();
    const revision = await revisionOf(v, current.guests.partyId);
    expect(await revisionOf(v, old.guests.partyId)).toBe(revision);
    const before = await everything();
    const answer = await post(
      `/api/tables/${current.table.bar!}/today/split-off`,
      current.table.bar!,
      {
        partIds: [current.table.bar!],
        seats: 10,
        expectedParties: [{ id: old.guests.partyId, revision }],
      },
    );
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "party.out_of_date" } });
    expect(await everything()).toEqual(before);
  });
});
