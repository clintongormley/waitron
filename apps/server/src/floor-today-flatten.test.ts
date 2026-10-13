import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodaySplitParts,
  floorTodayTables,
  joinedTableApart,
  partyTables,
  workingOrders,
} from "@waitron/db";
import type { AppError, JoinSide } from "@waitron/shared";
import { foodOnItsWay } from "./delivery-release.js";
import { writeMerge } from "./floor-today-merges.js";
import { splitJoinedTable } from "./floor-today-split.js";
import {
  counterOrder,
  inTx,
  pay,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  giveKeptSize,
  mergeOf,
  plannedZone,
  splitOffRow,
  todayRow,
} from "./testing/floor-today-venue.js";
import "./errors.js";

let v: PartyVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
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

/** LONG_TABLE, with Window table (4 × 2 at 10, 40) = Counter 6 and 7, each kept 2 × 2, and Stool (2 × 2 at 50, 0). */
async function LONG_WINDOW_STOOL() {
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
        key: "window",
        label: "Window table",
        seats: 4,
        place: { x: 10, y: 40, width: 4, height: 2 },
        partKeys: ["c6", "c7"],
      },
      { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0, width: 2, height: 2 } },
      { key: "stool", label: "Stool", seats: 1, place: { x: 50, y: 0, width: 2, height: 2 } },
    ],
    NOW,
  );
  for (const key of ["c3", "c4", "c5", "c6", "c7"]) {
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  }
  return zone;
}

const push = (movingId: string, targetId: string, side: JoinSide, seats = 12) =>
  inTx(v, (tx) => writeMerge(tx, v.cfg, { movingId, targetId, side, seats, free: true }));

async function refusalOf(work: Promise<unknown>): Promise<AppError | null> {
  return (await work.then(
    () => null,
    (thrown: unknown) => thrown,
  )) as AppError | null;
}

async function splitRowsOf(joinedTableId: string): Promise<string[]> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({ partTableId: floorTodaySplitParts.partTableId })
      .from(floorTodaySplitParts)
      .where(eq(floorTodaySplitParts.joinedTableId, joinedTableId)),
  );
  return rows.map((row) => row.partTableId).sort();
}

async function apart(tableId: string): Promise<number | null> {
  const rows = await v.db.all<{ id: string; named: number | null }>(
    sql`select dt.id, ${joinedTableApart(sql`dt.id`)} as named from dining_tables dt`,
  );
  return rows.find((row) => row.id === tableId)!.named;
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
  }));
}

async function placeOf(tableId: string) {
  const row = await todayRow(v, tableId);
  return { x: row!.x, y: row!.y };
}

const sorted = (ids: string[]) => [...ids].sort();

async function membersOf(tableId: string): Promise<string[]> {
  return (await mergeOf(v, tableId))!.members.map((m) => m.tableId);
}

async function beforeOf(tableId: string) {
  const member = (await mergeOf(v, tableId))!.members.find((m) => m.tableId === tableId)!;
  return { x: member.beforeX, y: member.beforeY, rotation: member.beforeRotation };
}

async function foodOnItsWayTo(tableId: string): Promise<void> {
  const order = await counterOrder(v, "Paella");
  await inTx(v, (tx) =>
    tx.update(workingOrders).set({ deliveryTableId: tableId }).where(eq(workingOrders.id, order)),
  );
  await pay(v, order, "20.00");
  const onItsWay = await inTx(v, (tx) =>
    tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, order), foodOnItsWay())),
  );
  expect(onItsWay).toHaveLength(1);
}

describe("a free push of or onto a joined table stores its real tables", () => {
  it("Bar pushed onto Long table makes one group of Bar, Counter 3, 4 and 5", async () => {
    const { table } = await LONG_TABLE();

    await push(table.bar!, table.long!, "left");

    expect(await splitRowsOf(table.long!)).toEqual(sorted([table.c3!, table.c4!, table.c5!]));
    expect(await membersOf(table.bar!)).toEqual(
      sorted([table.bar!, table.c3!, table.c4!, table.c5!]),
    );
    expect((await mergeOf(v, table.bar!))!.seats).toBe(12);
    expect(await mergeOf(v, table.long!)).toBeNull();
    for (const [id, x] of [
      [table.c3!, 10],
      [table.c4!, 12],
      [table.c5!, 14],
    ] as const) {
      expect(await todayRow(v, id)).toMatchObject({
        x,
        y: 20,
        width: 2,
        height: 2,
        rotation: 0,
        takenOff: false,
      });
      expect(await beforeOf(id)).toEqual({ x, y: 20, rotation: 0 });
    }
    expect(await placeOf(table.bar!)).toEqual({ x: 8, y: 20 });
    expect(await beforeOf(table.bar!)).toEqual({ x: 40, y: 0, rotation: 0 });
    expect(await apart(table.long!)).toBe(1);
  });

  it("Long table pushed onto Bar moves its tables together against Bar", async () => {
    const { table } = await LONG_TABLE();

    await push(table.long!, table.bar!, "right");

    expect(await membersOf(table.bar!)).toEqual(
      sorted([table.bar!, table.c3!, table.c4!, table.c5!]),
    );
    expect(await mergeOf(v, table.long!)).toBeNull();
    for (const [id, x, beforeX] of [
      [table.c3!, 42, 10],
      [table.c4!, 44, 12],
      [table.c5!, 46, 14],
    ] as const) {
      expect(await placeOf(id)).toEqual({ x, y: 0 });
      expect(await beforeOf(id)).toEqual({ x: beforeX, y: 20, rotation: 0 });
    }
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0 });
    expect(await splitRowsOf(table.long!)).toEqual(sorted([table.c3!, table.c4!, table.c5!]));
  });

  it("Long table with Counter 5 split off brings Counter 3 and 4 only", async () => {
    const { table } = await LONG_TABLE();
    await inTx(v, (tx) =>
      splitJoinedTable(tx, v.cfg, { tableId: table.long!, partIds: [table.c5!], seats: 8 }),
    );
    const c5Before = await todayRow(v, table.c5!);

    await push(table.bar!, table.long!, "left");

    expect(await membersOf(table.bar!)).toEqual(sorted([table.bar!, table.c3!, table.c4!]));
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20 });
    expect(await placeOf(table.bar!)).toEqual({ x: 8, y: 20 });
    expect(await todayRow(v, table.c5!)).toEqual(c5Before);
    expect(await mergeOf(v, table.c5!)).toBeNull();
    expect(await splitRowsOf(table.long!)).toEqual(sorted([table.c3!, table.c4!, table.c5!]));
  });

  it("Long table with Counter 3 split off, dragged onto Bar, brings Counter 4 and 5 against Bar", async () => {
    const { table } = await LONG_TABLE();
    await inTx(v, (tx) =>
      splitJoinedTable(tx, v.cfg, { tableId: table.long!, partIds: [table.c3!], seats: 10 }),
    );

    await push(table.long!, table.bar!, "right");

    expect(await membersOf(table.bar!)).toEqual(sorted([table.bar!, table.c4!, table.c5!]));
    expect(await placeOf(table.c4!)).toEqual({ x: 42, y: 0 });
    expect(await placeOf(table.c5!)).toEqual({ x: 44, y: 0 });
    expect(await beforeOf(table.c4!)).toEqual({ x: 12, y: 20, rotation: 0 });
    expect(await beforeOf(table.c5!)).toEqual({ x: 14, y: 20, rotation: 0 });
  });

  it("two joined tables pushed together split both", async () => {
    const { table } = await LONG_WINDOW_STOOL();

    await push(table.window!, table.long!, "right");

    expect(await membersOf(table.c3!)).toEqual(
      sorted([table.c3!, table.c4!, table.c5!, table.c6!, table.c7!]),
    );
    expect(await mergeOf(v, table.long!)).toBeNull();
    expect(await mergeOf(v, table.window!)).toBeNull();
    expect(await placeOf(table.c6!)).toEqual({ x: 16, y: 20 });
    expect(await placeOf(table.c7!)).toEqual({ x: 18, y: 20 });
    expect(await beforeOf(table.c6!)).toEqual({ x: 10, y: 40, rotation: 0 });
    expect(await beforeOf(table.c7!)).toEqual({ x: 12, y: 40, rotation: 0 });
    expect(await splitRowsOf(table.long!)).toEqual(sorted([table.c3!, table.c4!, table.c5!]));
    expect(await splitRowsOf(table.window!)).toEqual(sorted([table.c6!, table.c7!]));
  });

  it("a joined table pushed onto a group joins with its tables", async () => {
    const { table } = await LONG_WINDOW_STOOL();
    await push(table.stool!, table.bar!, "right", 5);
    expect(await placeOf(table.stool!)).toEqual({ x: 42, y: 0 });

    await push(table.long!, table.bar!, "left", 15);

    expect(await membersOf(table.bar!)).toEqual(
      sorted([table.bar!, table.stool!, table.c3!, table.c4!, table.c5!]),
    );
    expect((await mergeOf(v, table.bar!))!.seats).toBe(15);
    expect(await placeOf(table.c3!)).toEqual({ x: 34, y: 0 });
    expect(await placeOf(table.c4!)).toEqual({ x: 36, y: 0 });
    expect(await placeOf(table.c5!)).toEqual({ x: 38, y: 0 });
    expect(await mergeOf(v, table.long!)).toBeNull();
  });
});

describe("refusals of a free push with a joined table", () => {
  it("a group dragged onto Long table is still refused table.merged", async () => {
    const { table } = await LONG_WINDOW_STOOL();
    await push(table.stool!, table.bar!, "right", 5);
    const before = await everything();

    const error = await refusalOf(push(table.bar!, table.long!, "left"));

    expect({ code: error?.code, params: error?.params }).toEqual({
      code: "table.merged",
      params: { tableId: table.bar! },
    });
    expect(await everything()).toEqual(before);
  });

  it("a joined table that came apart is still refused table.in_joined_table", async () => {
    const { table } = await LONG_TABLE();
    await splitOffRow(v, table.long!, table.c4!);
    await splitOffRow(v, table.long!, table.c5!);
    const before = await everything();

    const error = await refusalOf(push(table.bar!, table.long!, "left"));

    expect({ code: error?.code, params: error?.params }).toEqual({
      code: "table.in_joined_table",
      params: { tableId: table.long! },
    });
    expect(await everything()).toEqual(before);
  });

  for (const pushed of ["Bar onto Long table", "Long table onto Bar"] as const) {
    it(`${pushed}, while Counter 4 still joined needs clearing, is refused`, async () => {
      const { table } = await LONG_TABLE();
      await inTx(v, (tx) =>
        tx
          .update(diningTables)
          .set({ needsClearingSince: NOW.toISOString() })
          .where(eq(diningTables.id, table.c4!)),
      );
      const before = await everything();

      const error = await refusalOf(
        pushed === "Bar onto Long table"
          ? push(table.bar!, table.long!, "left")
          : push(table.long!, table.bar!, "right"),
      );

      expect({ code: error?.code, params: error?.params }).toEqual({
        code: "table.needs_clearing",
        params: { tableId: table.c4! },
      });
      expect(await everything()).toEqual(before);
    });
  }

  it("Long table with guests cannot be pushed in a free merge", async () => {
    const { table } = await LONG_TABLE();
    await seat(v, table.long!);
    const before = await everything();

    const error = await refusalOf(push(table.bar!, table.long!, "left"));

    expect({ code: error?.code, params: error?.params }).toEqual({
      code: "tab.already_open",
      params: { tableId: table.long! },
    });
    expect(await everything()).toEqual(before);
  });

  it("Bar pushed onto Long table while a counter order is on its way to Long table is refused", async () => {
    const { table } = await LONG_TABLE();
    await foodOnItsWayTo(table.long!);
    const before = await everything();

    const error = await refusalOf(push(table.bar!, table.long!, "left"));

    expect({ code: error?.code, params: error?.params }).toEqual({
      code: "table.delivery_pending",
      params: { tableId: table.long! },
    });
    expect(await everything()).toEqual(before);
  });

  it("Long table dragged onto Bar while a counter order is on its way to Long table is refused", async () => {
    const { table } = await LONG_TABLE();
    await foodOnItsWayTo(table.long!);
    const before = await everything();

    const error = await refusalOf(push(table.long!, table.bar!, "right"));

    expect({ code: error?.code, params: error?.params }).toEqual({
      code: "table.delivery_pending",
      params: { tableId: table.long! },
    });
    expect(await everything()).toEqual(before);
  });
});
