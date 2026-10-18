import { randomUUID } from "node:crypto";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorZones,
  floorPlanPlacements,
  floorPlanTables,
  floorResetTables,
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodayTables,
  locations,
  workingOrders,
} from "@waitron/db";
import { foodOnItsWay } from "./delivery-release.js";
import { saveLayout, type ZonePlanSave } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import {
  backToSaved,
  moveToday,
  placeSpareToday,
  putBackToday,
  resetZone,
  rotateToday,
  seatsToday,
  takeOffToday,
} from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import {
  counterOrder,
  inTx,
  pay,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { mergeOf, plannedZone, todayRow } from "./testing/floor-today-venue.js";
import "./errors.js";

let v: PartyVenue;

const NOW = new Date("2026-10-10T12:00:00Z");
const REMOVALS = enabledTableRemovals(ALL_MODULES);

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

const takeOff = (tableId: string) => inTx(v, (tx) => takeOffToday(tx, v.cfg, tableId));
const putBack = (tableId: string) => inTx(v, (tx) => putBackToday(tx, v.cfg, tableId));
const seats = (tableId: string, n: number) => inTx(v, (tx) => seatsToday(tx, v.cfg, tableId, n));
const back = (tableId: string) => inTx(v, (tx) => backToSaved(tx, v.cfg, REMOVALS, tableId, NOW));
const reset = (zoneId: string) =>
  inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW, "due"));

async function setToday(
  tableId: string,
  values: Partial<typeof floorTodayTables.$inferInsert>,
): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(floorTodayTables).set(values).where(eq(floorTodayTables.tableId, tableId)),
  );
}

async function merge(
  zoneId: string,
  members: { tableId: string; beforeX: number; beforeY: number }[],
): Promise<void> {
  await inTx(v, async (tx) => {
    const [join] = await tx
      .insert(floorTodayJoins)
      .values({ zoneId, seats: 8 })
      .returning({ id: floorTodayJoins.id });
    for (const member of members) {
      await tx.insert(floorTodayJoinTables).values({
        joinId: join!.id,
        tableId: member.tableId,
        beforeX: member.beforeX,
        beforeY: member.beforeY,
        beforeRotation: 0,
      });
    }
  });
}

/** The master table, with its place on the zone's plan. */
async function masterRow(id: string) {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({
        ...getTableColumns(floorPlanTables),
        x: floorPlanPlacements.x,
        y: floorPlanPlacements.y,
        width: floorPlanPlacements.width,
        height: floorPlanPlacements.height,
        shape: floorPlanPlacements.shape,
        rotation: floorPlanPlacements.rotation,
      })
      .from(floorPlanTables)
      .leftJoin(floorPlanPlacements, eq(floorPlanPlacements.planTableId, floorPlanTables.id))
      .where(eq(floorPlanTables.id, id)),
  );
  return row;
}

async function resetRow(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorResetTables).where(eq(floorResetTables.tableId, tableId)),
  );
  return row;
}

async function labelOf(tableId: string): Promise<string | undefined> {
  const [row] = await inTx(v, (tx) =>
    tx.select({ label: diningTables.label }).from(diningTables).where(eq(diningTables.id, tableId)),
  );
  return row?.label;
}

function save(zoneId: string, revision: number, tables: ZonePlanSave["tables"]) {
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

function place(x: number, y: number) {
  return { x, y, width: 8, height: 8, shape: "rect" as const, rotation: 0 };
}

/** Every today's row and merge, to show a refusal wrote nothing. */
async function everything() {
  return inTx(v, async (tx) => ({
    today: await tx.select().from(floorTodayTables).orderBy(asc(floorTodayTables.id)),
    joins: await tx.select().from(floorTodayJoins).orderBy(asc(floorTodayJoins.id)),
    joinTables: await tx.select().from(floorTodayJoinTables).orderBy(asc(floorTodayJoinTables.id)),
  }));
}

describe("today's changes", () => {
  it("takes a free table off for today, keeping its place, and puts it back there", async () => {
    const { table } = await plannedZone(v, [{ key: "a", place: { x: 12, y: 7 } }], NOW);

    await takeOff(table.a!);
    expect(await todayRow(v, table.a!)).toMatchObject({ takenOff: true, x: 12, y: 7 });

    await putBack(table.a!);
    expect(await todayRow(v, table.a!)).toMatchObject({ takenOff: false, x: 12, y: 7 });
  });

  it("taking off twice, or putting back a table on the plan, changes nothing", async () => {
    const { table } = await plannedZone(
      v,
      [
        { key: "off", place: { x: 1, y: 2 } },
        { key: "on", place: { x: 3, y: 4 } },
      ],
      NOW,
    );
    await takeOff(table.off!);
    const off = await todayRow(v, table.off!);
    const on = await todayRow(v, table.on!);

    await takeOff(table.off!);
    await putBack(table.on!);

    expect(await todayRow(v, table.off!)).toEqual(off);
    expect(await todayRow(v, table.on!)).toEqual(on);

    await seat(v, table.off!);
    await takeOff(table.off!);
    expect(await todayRow(v, table.off!)).toEqual(off);
  });

  it("refuses to take off a seated table, one needing clearing, one with food on its way and one in a merge", async () => {
    const { zoneId, table } = await plannedZone(
      v,
      [
        { key: "seated", place: { x: 0, y: 0 } },
        { key: "clearing", place: { x: 10, y: 0 } },
        { key: "food", place: { x: 20, y: 0 } },
        { key: "merged", place: { x: 30, y: 0 } },
        { key: "partner", place: { x: 38, y: 0 } },
      ],
      NOW,
    );
    await seat(v, table.seated!);
    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set({ needsClearingSince: NOW.toISOString() })
        .where(eq(diningTables.id, table.clearing!)),
    );
    const order = await counterOrder(v, "Paella");
    await inTx(v, (tx) =>
      tx
        .update(workingOrders)
        .set({ deliveryTableId: table.food! })
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
    await merge(zoneId, [
      { tableId: table.merged!, beforeX: 30, beforeY: 0 },
      { tableId: table.partner!, beforeX: 38, beforeY: 0 },
    ]);

    for (const [key, code] of [
      ["seated", "tab.already_open"],
      ["clearing", "table.needs_clearing"],
      ["food", "table.delivery_pending"],
      ["merged", "table.merged"],
    ] as const) {
      await expect(takeOff(table[key]!)).rejects.toMatchObject({
        code,
        params: { tableId: table[key] },
      });
      expect(await todayRow(v, table[key]!)).toMatchObject({ takenOff: false });
    }
  });

  it("sets a table's seats for today, and a merge's for a member", async () => {
    const { zoneId, table, master } = await plannedZone(
      v,
      [
        { key: "a", place: { x: 0, y: 0 } },
        { key: "b", place: { x: 10, y: 0 } },
        { key: "c", place: { x: 18, y: 0 } },
      ],
      NOW,
    );

    await seats(table.a!, 6);
    expect(await todayRow(v, table.a!)).toMatchObject({ seats: 6 });
    expect(await masterRow(master.a!)).toMatchObject({ seats: 4 });

    await merge(zoneId, [
      { tableId: table.b!, beforeX: 10, beforeY: 0 },
      { tableId: table.c!, beforeX: 18, beforeY: 0 },
    ]);
    await seats(table.b!, 11);
    expect(await mergeOf(v, table.b!)).toMatchObject({ seats: 11 });
    expect(await todayRow(v, table.b!)).toMatchObject({ seats: 4 });
  });

  it("refuses seats for a taken-off table", async () => {
    const { table } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }], NOW);
    await takeOff(table.a!);

    await expect(seats(table.a!, 6)).rejects.toMatchObject({
      code: "table.taken_off",
      params: { tableId: table.a },
    });
    expect(await todayRow(v, table.a!)).toMatchObject({ seats: 4 });
  });

  it("puts a table back as the last reset copied it, not as the master is now", async () => {
    const { zoneId, table, master, revision } = await plannedZone(
      v,
      [{ key: "a", seats: 4, place: { x: 10, y: 10 } }],
      NOW,
    );
    await inTx(v, (tx) => moveToday(tx, v.cfg, table.a!, { x: 30, y: 30 }));
    await inTx(v, (tx) => rotateToday(tx, v.cfg, table.a!));
    await seats(table.a!, 9);
    await takeOff(table.a!);
    await setToday(table.a!, { fixed: true });
    const label = await labelOf(table.a!);
    await save(zoneId, revision, [
      {
        key: "a",
        id: master.a!,
        label: label!,
        seats: 2,
        fixed: false,
        placement: place(50, 50),
        partKeys: [],
      },
    ]);
    expect(await masterRow(master.a!)).toMatchObject({ x: 50, seats: 2 });

    await back(table.a!);

    expect(await todayRow(v, table.a!)).toMatchObject({
      x: 10,
      y: 10,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
      seats: 4,
      fixed: false,
      takenOff: false,
    });
  });

  it("takes a table out of its merge when it goes back, and puts its partner back too", async () => {
    const { zoneId, table } = await plannedZone(
      v,
      [
        { key: "a", place: { x: 0, y: 0 } },
        { key: "b", place: { x: 20, y: 0 } },
      ],
      NOW,
    );
    await setToday(table.b!, { x: 8 });
    await merge(zoneId, [
      { tableId: table.a!, beforeX: 0, beforeY: 0 },
      { tableId: table.b!, beforeX: 20, beforeY: 0 },
    ]);

    await back(table.a!);

    expect(await mergeOf(v, table.a!)).toBeNull();
    expect(await mergeOf(v, table.b!)).toBeNull();
    expect(await todayRow(v, table.a!)).toMatchObject({ x: 0, y: 0 });
    expect(await todayRow(v, table.b!)).toMatchObject({ x: 20, y: 0 });
  });

  it("refuses Back while a partner still merged in a merge of three stands in its saved place", async () => {
    const { zoneId, table } = await plannedZone(
      v,
      [
        { key: "a", place: { x: 0, y: 0 } },
        { key: "b", place: { x: 40, y: 0 } },
        { key: "c", place: { x: 60, y: 0 } },
      ],
      NOW,
    );
    await setToday(table.a!, { x: 10 });
    await setToday(table.b!, { x: 2 });
    await setToday(table.c!, { x: 18 });
    await merge(zoneId, [
      { tableId: table.a!, beforeX: 0, beforeY: 0 },
      { tableId: table.b!, beforeX: 40, beforeY: 0 },
      { tableId: table.c!, beforeX: 60, beforeY: 0 },
    ]);
    const before = await everything();

    await expect(back(table.a!)).rejects.toMatchObject({
      code: "table.place_taken",
      params: { tableId: table.a!, standingId: table.b! },
    });

    expect(await everything()).toEqual(before);
  });

  it("refuses Back while the partner of a merge of two would go back into its saved place", async () => {
    const { zoneId, table } = await plannedZone(
      v,
      [
        { key: "a", place: { x: 0, y: 0 } },
        { key: "b", place: { x: 40, y: 0 } },
      ],
      NOW,
    );
    await setToday(table.a!, { x: 30 });
    await setToday(table.b!, { x: 38 });
    await merge(zoneId, [
      { tableId: table.a!, beforeX: 0, beforeY: 0 },
      { tableId: table.b!, beforeX: 2, beforeY: 0 },
    ]);
    const before = await everything();

    await expect(back(table.a!)).rejects.toMatchObject({
      code: "table.place_taken",
      params: { tableId: table.a!, standingId: table.b! },
    });

    expect(await everything()).toEqual(before);
  });

  it("sends a table the last reset copied as a spare back to the spares", async () => {
    const { table } = await plannedZone(v, [{ key: "spare", place: null }], NOW);
    await inTx(v, (tx) => placeSpareToday(tx, v.cfg, table.spare!, { x: 20, y: 10 }));
    expect(await todayRow(v, table.spare!)).toMatchObject({ x: 20 });

    await back(table.spare!);

    expect(await todayRow(v, table.spare!)).toMatchObject({
      x: null,
      y: null,
      width: null,
      height: null,
      shape: null,
      rotation: null,
      takenOff: false,
    });
  });

  it("refuses a table whose master table was deleted, and one never on a plan", async () => {
    const { zoneId, table, revision } = await plannedZone(
      v,
      [{ key: "a", place: { x: 0, y: 0 } }],
      NOW,
    );
    await seat(v, table.a!);
    await save(zoneId, revision, []);
    await reset(zoneId);
    expect(await resetRow(table.a!)).toMatchObject({ remove: true });
    expect(await todayRow(v, table.a!)).toBeDefined();

    await expect(back(table.a!)).rejects.toMatchObject({
      code: "table.not_on_today_plan",
      params: { tableId: table.a },
    });

    const never = await v.table(`Never ${randomUUID().slice(0, 6)}`, zoneId, { today: false });
    await inTx(v, (tx) =>
      tx.insert(floorTodayTables).values({ tableId: never, seats: 4, ...place(40, 0) }),
    );
    expect(await resetRow(never)).toBeUndefined();
    await expect(back(never)).rejects.toMatchObject({
      code: "table.not_on_today_plan",
      params: { tableId: never },
    });
  });

  it("does not rename a table going back to its saved place", async () => {
    const { table } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }], NOW);
    const label = await labelOf(table.a!);
    const renamed = `Renamed ${randomUUID().slice(0, 6)}`;
    await inTx(v, (tx) =>
      tx
        .update(floorResetTables)
        .set({ label: renamed, pending: true })
        .where(eq(floorResetTables.tableId, table.a!)),
    );

    await back(table.a!);

    expect(await labelOf(table.a!)).toBe(label);
  });

  it("refuses a table of another venue as not found", async () => {
    const elsewhere = randomUUID();
    const id = randomUUID();
    await inTx(v, async (tx) => {
      await tx.insert(locations).values({
        id: elsewhere,
        name: "Other",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      });
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: elsewhere, name: "Other tables" })
        .returning({ id: floorZones.id });
      await tx.insert(diningTables).values({
        id,
        locationId: elsewhere,
        zoneId: zone!.id,
        label: `Elsewhere ${id.slice(0, 6)}`,
      });
      await tx.insert(floorTodayTables).values({ tableId: id, seats: 4, ...place(0, 0) });
    });
    const before = await todayRow(v, id);
    for (const write of [
      () => takeOff(id),
      () => putBack(id),
      () => seats(id, 6),
      () => back(id),
    ]) {
      await expect(write()).rejects.toMatchObject({
        code: "table.not_found",
        params: { tableId: id },
      });
    }
    expect(await todayRow(v, id)).toEqual(before);
  });
});
