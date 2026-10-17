import { randomUUID } from "node:crypto";
import { eq, getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorZones,
  floorPlanPlacements,
  floorPlanTables,
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodayTables,
  locations,
} from "@waitron/db";
import { moveToday, placeSpareToday, resetZone, rotateToday } from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
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

const move = (tableId: string, at: { x: number; y: number }) =>
  inTx(v, (tx) => moveToday(tx, v.cfg, tableId, at));
const rotate = (tableId: string) => inTx(v, (tx) => rotateToday(tx, v.cfg, tableId));
const placeSpare = (tableId: string, at: { x: number; y: number }) =>
  inTx(v, (tx) => placeSpareToday(tx, v.cfg, tableId, at));

async function setToday(
  tableId: string,
  values: Partial<typeof floorTodayTables.$inferInsert>,
): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(floorTodayTables).set(values).where(eq(floorTodayTables.tableId, tableId)),
  );
}

async function merge(zoneId: string, tableIds: string[]): Promise<void> {
  await inTx(v, async (tx) => {
    const [join] = await tx
      .insert(floorTodayJoins)
      .values({ zoneId, seats: 8 })
      .returning({ id: floorTodayJoins.id });
    for (const tableId of tableIds) {
      await tx
        .insert(floorTodayJoinTables)
        .values({ joinId: join!.id, tableId, beforeX: 0, beforeY: 0, beforeRotation: 0 });
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

describe("today's moves", () => {
  it("moves a table on today's plan and leaves the master alone", async () => {
    const { table, master } = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }], NOW);

    await move(table.a!, { x: 12, y: 3 });

    expect(await todayRow(v, table.a!)).toMatchObject({ x: 12, y: 3 });
    expect(await masterRow(master.a!)).toMatchObject({ x: 0, y: 0 });
  });

  it("moves a merge as one, held at the edge", async () => {
    const { zoneId, table } = await plannedZone(
      v,
      [
        { key: "a", place: { x: 0, y: 0 } },
        { key: "b", place: { x: 8, y: 0 } },
      ],
      NOW,
    );
    await merge(zoneId, [table.a!, table.b!]);
    expect(await mergeOf(v, table.a!)).not.toBeNull();

    await move(table.a!, { x: 4, y: 2 });
    expect(await todayRow(v, table.a!)).toMatchObject({ x: 4, y: 2 });
    expect(await todayRow(v, table.b!)).toMatchObject({ x: 12, y: 2 });

    await move(table.b!, { x: 2, y: 0 });
    expect(await todayRow(v, table.a!)).toMatchObject({ x: 0, y: 0 });
    expect(await todayRow(v, table.b!)).toMatchObject({ x: 8, y: 0 });
  });

  it("holds a merge at the far edge too", async () => {
    const { zoneId, table } = await plannedZone(
      v,
      [
        { key: "a", place: { x: 980, y: 990 } },
        { key: "b", place: { x: 990, y: 990 } },
      ],
      NOW,
    );
    await merge(zoneId, [table.a!, table.b!]);

    await move(table.a!, { x: 995, y: 999 });

    expect(await todayRow(v, table.a!)).toMatchObject({ x: 989, y: 999 });
    expect(await todayRow(v, table.b!)).toMatchObject({ x: 999, y: 999 });
  });

  it("turns a table 15° about its centre, from 345° back to 0", async () => {
    const { table } = await plannedZone(v, [{ key: "a", place: { x: 5, y: 6 } }], NOW);

    await rotate(table.a!);
    expect(await todayRow(v, table.a!)).toMatchObject({ rotation: 15, x: 5, y: 6 });

    await setToday(table.a!, { rotation: 345 });
    await rotate(table.a!);
    expect(await todayRow(v, table.a!)).toMatchObject({ rotation: 0, x: 5, y: 6 });
  });

  it("refuses to move or turn a fixed table, and nothing moves", async () => {
    const { table } = await plannedZone(v, [{ key: "a", fixed: true, place: { x: 3, y: 4 } }], NOW);
    const before = await todayRow(v, table.a!);

    await expect(move(table.a!, { x: 20, y: 20 })).rejects.toMatchObject({
      code: "table.fixed",
      params: { tableId: table.a },
    });
    await expect(rotate(table.a!)).rejects.toMatchObject({
      code: "table.fixed",
      params: { tableId: table.a },
    });
    expect(await todayRow(v, table.a!)).toEqual(before);
  });

  it("refuses to turn a table in a merge", async () => {
    const { zoneId, table } = await plannedZone(
      v,
      [
        { key: "a", place: { x: 0, y: 0 } },
        { key: "b", place: { x: 8, y: 0 } },
      ],
      NOW,
    );
    await merge(zoneId, [table.a!, table.b!]);

    await expect(rotate(table.a!)).rejects.toMatchObject({
      code: "table.merged",
      params: { tableId: table.a },
    });
    expect(await todayRow(v, table.a!)).toMatchObject({ rotation: 0 });
  });

  it("refuses a spare, a taken-off table and a table never on a plan", async () => {
    const { zoneId, table } = await plannedZone(
      v,
      [
        { key: "spare", place: null },
        { key: "off", place: { x: 0, y: 0 } },
      ],
      NOW,
    );
    await expect(move(table.spare!, { x: 1, y: 1 })).rejects.toMatchObject({
      code: "table.not_on_today_plan",
      params: { tableId: table.spare },
    });
    await expect(rotate(table.spare!)).rejects.toMatchObject({
      code: "table.not_on_today_plan",
      params: { tableId: table.spare },
    });

    await setToday(table.off!, { takenOff: true });
    await expect(move(table.off!, { x: 1, y: 1 })).rejects.toMatchObject({
      code: "table.taken_off",
      params: { tableId: table.off },
    });
    await expect(rotate(table.off!)).rejects.toMatchObject({
      code: "table.taken_off",
      params: { tableId: table.off },
    });

    const never = await v.table(`Never ${randomUUID().slice(0, 6)}`, zoneId, { today: false });
    expect(await todayRow(v, never)).toBeUndefined();
    await expect(move(never, { x: 1, y: 1 })).rejects.toMatchObject({
      code: "table.not_on_today_plan",
      params: { tableId: never },
    });
    await expect(placeSpare(never, { x: 1, y: 1 })).rejects.toMatchObject({
      code: "table.not_on_today_plan",
      params: { tableId: never },
    });
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
      await tx.insert(floorTodayTables).values({
        tableId: id,
        seats: 4,
        x: 0,
        y: 0,
        width: 8,
        height: 8,
        shape: "rect",
        rotation: 0,
      });
    });
    const before = await todayRow(v, id);
    for (const write of [
      () => move(id, { x: 1, y: 1 }),
      () => rotate(id),
      () => placeSpare(id, { x: 1, y: 1 }),
    ]) {
      await expect(write()).rejects.toMatchObject({
        code: "table.not_found",
        params: { tableId: id },
      });
    }
    expect(await todayRow(v, id)).toEqual(before);
  });

  it("refuses a spare that is also taken off as not on the plan", async () => {
    const { table } = await plannedZone(v, [{ key: "spare", place: null }], NOW);
    await setToday(table.spare!, { takenOff: true });

    await expect(move(table.spare!, { x: 1, y: 1 })).rejects.toMatchObject({
      code: "table.not_on_today_plan",
      params: { tableId: table.spare },
    });
  });

  it("places a spare 8 × 8 at the corner it is given, and leaves a placed table where it is", async () => {
    const { table } = await plannedZone(
      v,
      [
        { key: "spare", place: null },
        { key: "placed", place: { x: 0, y: 0, width: 12, height: 6, rotation: 30 } },
      ],
      NOW,
    );

    await placeSpare(table.spare!, { x: 20, y: 10 });
    expect(await todayRow(v, table.spare!)).toMatchObject({
      x: 20,
      y: 10,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
    });

    const before = await todayRow(v, table.placed!);
    await placeSpare(table.placed!, { x: 20, y: 10 });
    expect(await todayRow(v, table.placed!)).toEqual(before);
  });

  it("refuses to place a fixed spare or a taken-off one", async () => {
    const { table } = await plannedZone(
      v,
      [
        { key: "fixed", fixed: true, place: null },
        { key: "off", place: null },
      ],
      NOW,
    );
    await setToday(table.off!, { takenOff: true });

    await expect(placeSpare(table.fixed!, { x: 1, y: 1 })).rejects.toMatchObject({
      code: "table.fixed",
      params: { tableId: table.fixed },
    });
    await expect(placeSpare(table.off!, { x: 1, y: 1 })).rejects.toMatchObject({
      code: "table.taken_off",
      params: { tableId: table.off },
    });
    expect(await todayRow(v, table.fixed!)).toMatchObject({ x: null });
    expect(await todayRow(v, table.off!)).toMatchObject({ x: null });
  });

  it("leaves a placed fixed table where it is", async () => {
    const { table } = await plannedZone(
      v,
      [{ key: "fixed", fixed: true, place: { x: 3, y: 4 } }],
      NOW,
    );
    const before = await todayRow(v, table.fixed!);

    await placeSpare(table.fixed!, { x: 20, y: 10 });

    expect(await todayRow(v, table.fixed!)).toEqual(before);
  });

  it("puts a placed spare back among the spares at the next reset", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "spare", place: null }], NOW);
    await placeSpare(table.spare!, { x: 20, y: 10 });
    expect(await todayRow(v, table.spare!)).toMatchObject({ x: 20 });

    await inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW));

    expect(await todayRow(v, table.spare!)).toMatchObject({
      x: null,
      y: null,
      width: null,
      height: null,
      shape: null,
      rotation: null,
    });
  });
});
