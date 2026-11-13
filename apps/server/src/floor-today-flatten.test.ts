import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorResetTables,
  floorTodayJoinTables,
  tableMerges,
  partyTables,
  workingOrders,
  todayColumns,
} from "@waitron/db";
import type { AppError, JoinSide } from "@waitron/shared";
import { foodOnItsWay } from "./delivery-release.js";
import { writeMerge } from "./floor-today-merges.js";
import { splitOff } from "./floor-today-split-group.js";
import {
  catchUpZone,
  resetZone,
  takeOffToday,
  putBackToday,
  updateLayout,
  todayBusinessDay,
} from "./floor-today-store.js";
import { readLayout, saveLayout } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { finishTable } from "./testing/party-close-fixture.js";
import { splitTable } from "./testing/table-action-fixture.js";
import {
  activeTablesOf,
  billsOfParty,
  commandFor,
  counterOrder,
  inTx,
  partyAt,
  pay,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { giveKeptSize, mergeOf, plannedZone, todayRow } from "./testing/floor-today-venue.js";
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
  await inTx(v, (tx) => resetZone(tx, REMOVALS, zone.zoneId, NOW, "due"));
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
  await inTx(v, (tx) => resetZone(tx, REMOVALS, zone.zoneId, NOW, "due"));
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

async function everything() {
  return inTx(v, async (tx) => ({
    today: await tx
      .select(todayColumns)
      .from(diningTables)
      .where(eq(diningTables.onFloor, true))
      .orderBy(asc(diningTables.id)),
    joins: await tx.select().from(tableMerges).orderBy(asc(tableMerges.id)),
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

    await push(table.bar!, table.c3!, "left");

    expect(await membersOf(table.bar!)).toEqual(
      sorted([table.bar!, table.c3!, table.c4!, table.c5!]),
    );
    expect((await mergeOf(v, table.bar!))!.seats).toBe(12);
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
  });

  it("Long table with Counter 5 split off brings Counter 3 and 4 only", async () => {
    const { table } = await LONG_TABLE();
    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, NOW, {
        expectedParties: [],
        tableId: table.c3!,
        partIds: [table.c5!],
        seats: 8,
      }),
    );
    const c5Before = await todayRow(v, table.c5!);

    await push(table.bar!, table.c3!, "left");

    expect(await membersOf(table.bar!)).toEqual(sorted([table.bar!, table.c3!, table.c4!]));
    expect(await placeOf(table.c3!)).toEqual({ x: 10, y: 20 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20 });
    expect(await placeOf(table.bar!)).toEqual({ x: 8, y: 20 });
    expect(await todayRow(v, table.c5!)).toEqual(c5Before);
    expect(await mergeOf(v, table.c5!)).toBeNull();
  });
});

describe("refusals of a free push with a joined table", () => {
  it("a group dragged onto Long table is still refused table.merged", async () => {
    const { table } = await LONG_WINDOW_STOOL();
    await push(table.stool!, table.bar!, "right", 5);
    const before = await everything();

    const error = await refusalOf(push(table.bar!, table.c3!, "left"));

    expect({ code: error?.code, params: error?.params }).toEqual({
      code: "table.merged",
      params: { tableId: table.bar! },
    });
    expect(await everything()).toEqual(before);
  });

  it("Bar can join a saved group while another member needs clearing", async () => {
    const { table } = await LONG_TABLE();
    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set({ needsClearingSince: NOW.toISOString() })
        .where(eq(diningTables.id, table.c4!)),
    );
    await push(table.bar!, table.c3!, "left");
    expect(await membersOf(table.bar!)).toEqual(
      sorted([table.bar!, table.c3!, table.c4!, table.c5!]),
    );
  });

  it("Bar can join a saved group while food is on its way to it", async () => {
    const { table } = await LONG_TABLE();
    await foodOnItsWayTo(table.c3!);
    await push(table.bar!, table.c3!, "left");
    expect(await membersOf(table.bar!)).toEqual(
      sorted([table.bar!, table.c3!, table.c4!, table.c5!]),
    );
  });
});

describe("Split a table and the floor-wide reset on a flattened group", () => {
  const counters = (table: Record<string, string>) =>
    [
      [table.c3!, 10],
      [table.c4!, 12],
      [table.c5!, 14],
    ] as const;

  it("Split a table on a seated flattened group takes the last table off with a new bill", async () => {
    const { table } = await LONG_TABLE();
    await push(table.bar!, table.c3!, "left");
    const { partyId } = await seat(v, table.bar!);
    expect(sorted(await activeTablesOf(v, partyId))).toEqual(
      sorted([table.bar!, table.c3!, table.c4!, table.c5!]),
    );
    const command = await commandFor(v, partyId);

    const split = await inTx(v, (tx) => splitTable(tx, v.cfg, partyId, table.c5!, null, command));

    expect(await partyAt(v, table.c5!)).toBe(split.partyId);
    expect(split.partyId).not.toBe(partyId);
    expect(split.billId).not.toBeNull();
    expect(await billsOfParty(v, split.partyId)).toEqual([split.billId]);
    expect(sorted(await activeTablesOf(v, partyId))).toEqual(
      sorted([table.bar!, table.c3!, table.c4!]),
    );
    expect(await membersOf(table.bar!)).toEqual(sorted([table.bar!, table.c3!, table.c4!]));
    expect(await mergeOf(v, table.c5!)).toBeNull();
    expect(await placeOf(table.c5!)).toEqual({ x: 14, y: 20 });
    expect(await placeOf(table.c4!)).toEqual({ x: 12, y: 20 });
  });

  it("a reset dissolves a free group whose members all belong to that reset", async () => {
    const { table, zoneId } = await LONG_TABLE();
    await push(table.bar!, table.c3!, "left");
    await inTx(v, (tx) => resetZone(tx, REMOVALS, zoneId, NOW, "due"));
    for (const [id, x] of counters(table)) {
      expect(await todayRow(v, id)).toMatchObject({
        x,
        y: 20,
        width: 2,
        height: 2,
        takenOff: false,
      });
    }
    expect(await membersOf(table.c3!)).toEqual(sorted([table.c3!, table.c4!, table.c5!]));
    expect(await placeOf(table.bar!)).toEqual({ x: 40, y: 0 });
    expect(await mergeOf(v, table.bar!)).toBeNull();
  });

  it("with guests at the group the reset moves nothing in it, even once they leave", async () => {
    const { table, zoneId } = await LONG_TABLE();
    await push(table.bar!, table.c3!, "left");
    const { partyId } = await seat(v, table.bar!);
    const before = await everything();

    await inTx(v, (tx) => resetZone(tx, REMOVALS, zoneId, NOW, "due"));

    expect(await everything()).toEqual(before);

    const command = await commandFor(v, partyId);
    await inTx(v, (tx) => finishTable(tx, { partyId, ...command }));
    await inTx(v, (tx) => catchUpZone(tx, REMOVALS, zoneId, NOW));

    const after = await everything();
    expect(after.today).toEqual(before.today);
    expect(after.joins).toEqual(before.joins);
    expect(after.joinTables).toEqual(before.joinTables);
    const marked = await inTx(v, (tx) =>
      tx
        .select({ tableId: floorResetTables.tableId })
        .from(floorResetTables)
        .where(and(eq(floorResetTables.zoneId, zoneId), eq(floorResetTables.readyToMove, true))),
    );
    expect(marked.map((row) => row.tableId).sort()).toEqual([]);
  });
});

it("reset applies an edited saved membership, leaving its former member separate", async () => {
  const { table, master, zoneId } = await LONG_TABLE();
  const layout = await inTx(v, async (tx) =>
    readLayout(tx, await defaultLayout(tx, v.cfg, zoneId)),
  );
  await inTx(v, async (tx) =>
    saveLayout(
      tx,
      REMOVALS,
      await defaultLayout(tx, v.cfg, zoneId),
      {
        revision: layout.revision,
        tables: layout.tables.map((t) => ({
          id: t.id,
          key: t.id,
          label: t.label,
          seats: t.seats,
          fixed: t.fixed,
          placement:
            t.id === master.c5
              ? { x: 60, y: 60, width: 2, height: 2, shape: "rect" as const, rotation: 0 }
              : t.placement,
          partKeys: t.partIds.filter((id) => id !== master.c5),
        })),
      },
      NOW,
    ),
  );
  await inTx(v, (tx) => resetZone(tx, REMOVALS, zoneId, NOW, "due"));
  expect(await membersOf(table.c3!)).toEqual(sorted([table.c3!, table.c4!]));
  expect(await mergeOf(v, table.c5!)).toBeNull();
  expect(await placeOf(table.c5!)).toEqual({ x: 60, y: 60 });
  expect(
    await inTx(v, (tx) =>
      tx
        .select()
        .from(floorResetTables)
        .where(and(eq(floorResetTables.zoneId, zoneId), eq(floorResetTables.pending, true))),
    ),
  ).toEqual([]);
});

it.each([false, true])(
  "Update layout keeps a taken-off member out; outside group after Put back: %s",
  async (outside) => {
    const { table, zoneId } = await LONG_TABLE();
    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, NOW, {
        tableId: table.c3!,
        partIds: [table.c5!],
        seats: 6,
        expectedParties: [],
      }),
    );
    await inTx(v, (tx) => takeOffToday(tx, table.c5!));
    await inTx(v, async (tx) => {
      const key = await defaultLayout(tx, v.cfg, zoneId);
      const layout = await readLayout(tx, key);
      await updateLayout(tx, REMOVALS, zoneId, await todayBusinessDay(tx, NOW), NOW, {
        setId: key.setId,
        layoutRevision: layout.revision,
      });
    });
    expect(await mergeOf(v, table.c3!)).toBeNull();
    expect(await todayRow(v, table.c5!)).toMatchObject({ takenOff: true });
    if (outside) await push(table.bar!, table.c3!, "left");
    const before = await mergeOf(v, table.c3!);
    await inTx(v, (tx) => putBackToday(tx, table.c5!));
    await inTx(v, (tx) => catchUpZone(tx, REMOVALS, zoneId, NOW));
    if (outside) expect(await mergeOf(v, table.c3!)).toEqual(before);
    else expect(await membersOf(table.c3!)).toEqual(sorted([table.c3!, table.c4!, table.c5!]));
  },
);
