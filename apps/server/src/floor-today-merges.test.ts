import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorResetJoinTables,
  floorResetJoins,
  floorTodayJoins,
  floorTodayTables,
} from "@waitron/db";
import type { JoinSide } from "@waitron/shared";
import {
  leaveMergesRestoring,
  mergeMembers,
  savedJoinSeats,
  writeMerge,
} from "./floor-today-merges.js";
import { resetZone } from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { inTx, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { mergeOf, plannedZone, resaveMaster, todayRow } from "./testing/floor-today-venue.js";
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

const merge = (
  movingId: string,
  targetId: string,
  side: JoinSide,
  seats: number | null,
  free = true,
) => inTx(v, (tx) => writeMerge(tx, v.cfg, { movingId, targetId, side, seats, free }));

async function setToday(
  tableId: string,
  values: Partial<typeof floorTodayTables.$inferInsert>,
): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(floorTodayTables).set(values).where(eq(floorTodayTables.tableId, tableId)),
  );
}

async function place(tableId: string) {
  const row = await todayRow(v, tableId);
  return { x: row!.x, y: row!.y, rotation: row!.rotation };
}

const byId = <T extends { tableId: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.tableId.localeCompare(b.tableId));

/** A and B 8×8 at (0, 0) and (20, 0), C at (40, 0) turned 30°. */
async function threeTables(joins: { seats: number; keys: string[] }[] = []) {
  return plannedZone(
    v,
    [
      { key: "a", place: { x: 0, y: 0 } },
      { key: "b", place: { x: 20, y: 0 } },
      { key: "c", place: { x: 40, y: 0, rotation: 30 } },
    ],
    joins,
    NOW,
  );
}

describe("today's merges", () => {
  it("merges two tables, the moving one against the target, with each one's place before", async () => {
    const { zoneId, table } = await threeTables();
    const a = table.a!;
    const b = table.b!;

    await merge(b, a, "right", 8);

    expect(await place(b)).toEqual({ x: 8, y: 0, rotation: 0 });
    expect(await place(a)).toEqual({ x: 0, y: 0, rotation: 0 });
    const merged = await mergeOf(v, a);
    expect(merged!.seats).toBe(8);
    expect(merged!.members).toEqual(
      byId([
        { tableId: a, beforeX: 0, beforeY: 0, beforeRotation: 0 },
        { tableId: b, beforeX: 20, beforeY: 0, beforeRotation: 0 },
      ]),
    );
    const [join] = await inTx(v, (tx) =>
      tx.select().from(floorTodayJoins).where(eq(floorTodayJoins.id, merged!.joinId)),
    );
    expect(join!.zoneId).toBe(zoneId);
    expect((await inTx(v, (tx) => mergeMembers(tx, a))).sort()).toEqual([a, b].sort());
  });

  it("takes the seats from the saved join with exactly these tables", async () => {
    const { table } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);

    expect(await inTx(v, (tx) => savedJoinSeats(tx, [table.b!, table.a!]))).toBe(6);
    await merge(table.b!, table.a!, "right", null);

    expect((await mergeOf(v, table.a!))!.seats).toBe(6);
  });

  it("takes the seats sent over the saved join's", async () => {
    const { table } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);

    await merge(table.b!, table.a!, "right", 9);

    expect((await mergeOf(v, table.a!))!.seats).toBe(9);
  });

  it("refuses a merge with no saved join and no seats, and writes nothing", async () => {
    const { table } = await threeTables([
      { seats: 10, keys: ["a", "b", "c"] },
      { seats: 5, keys: ["a", "c"] },
    ]);

    expect(await inTx(v, (tx) => savedJoinSeats(tx, [table.a!, table.b!]))).toBeNull();
    expect(await inTx(v, (tx) => savedJoinSeats(tx, [table.a!, "missing-table"]))).toBeNull();
    await expect(merge(table.b!, table.a!, "right", null)).rejects.toMatchObject({
      code: "floor_plan.invalid",
      params: { field: "seats" },
    });

    expect(await place(table.b!)).toEqual({ x: 20, y: 0, rotation: 0 });
    expect(await mergeOf(v, table.a!)).toBeNull();
    expect(await mergeOf(v, table.b!)).toBeNull();
  });

  it("finds no saved join for a table that is not in the master", async () => {
    const { table } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    const loose = await v.table(`Loose ${table.a!.slice(0, 6)}`);

    expect(await inTx(v, (tx) => savedJoinSeats(tx, [table.a!, loose]))).toBeNull();
    expect(await inTx(v, (tx) => savedJoinSeats(tx, [table.a!]))).toBeNull();
  });

  it("finds no saved join when two tables stand on one master table", async () => {
    const { table } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    const [b] = await inTx(v, (tx) =>
      tx
        .select({ planTableId: diningTables.planTableId })
        .from(diningTables)
        .where(eq(diningTables.id, table.b!)),
    );
    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set({ planTableId: b!.planTableId })
        .where(eq(diningTables.id, table.c!)),
    );

    expect(await inTx(v, (tx) => savedJoinSeats(tx, [table.a!, table.b!, table.c!]))).toBeNull();
  });

  it("grows a merge with a third table, working its seats out again", async () => {
    const { table } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    await merge(table.b!, table.a!, "right", 8);

    await expect(merge(table.c!, table.b!, "bottom", null)).rejects.toMatchObject({
      code: "floor_plan.invalid",
      params: { field: "seats" },
    });
    expect(await place(table.c!)).toEqual({ x: 40, y: 0, rotation: 30 });

    await merge(table.c!, table.b!, "bottom", 12);

    expect(await place(table.c!)).toEqual({ x: 8, y: 8, rotation: 0 });
    const merged = await mergeOf(v, table.a!);
    expect(merged!.seats).toBe(12);
    expect(merged!.members.map((m) => m.tableId)).toEqual(
      [table.a!, table.b!, table.c!].sort((x, y) => x.localeCompare(y)),
    );
    expect(merged!.members.find((m) => m.tableId === table.c)).toEqual({
      tableId: table.c,
      beforeX: 40,
      beforeY: 0,
      beforeRotation: 30,
    });
  });

  it("grows a merge on another side when a member already stands on the side sent", async () => {
    const { table } = await threeTables();
    await merge(table.b!, table.a!, "right", 8);

    await merge(table.c!, table.a!, "right", 12);

    // A at (0, 0) on the grid's top edge: its top is held onto A itself, so C goes below.
    expect(await place(table.b!)).toEqual({ x: 8, y: 0, rotation: 0 });
    expect(await place(table.c!)).toEqual({ x: 0, y: 8, rotation: 0 });
  });

  it("grows a merge to a saved join of three", async () => {
    const { table } = await threeTables([{ seats: 11, keys: ["a", "b", "c"] }]);
    await merge(table.b!, table.a!, "right", 8);

    await merge(table.c!, table.a!, "left", null);

    expect((await mergeOf(v, table.a!))!.seats).toBe(11);
    expect((await mergeOf(v, table.c!))!.joinId).toBe((await mergeOf(v, table.a!))!.joinId);
  });

  it("refuses a fixed table either way, a merged moving table, two zones and one table twice", async () => {
    const { table } = await plannedZone(
      v,
      [
        { key: "a", place: { x: 0, y: 0 } },
        { key: "b", place: { x: 20, y: 0 } },
        { key: "c", place: { x: 40, y: 0 } },
        { key: "f", place: { x: 60, y: 0 }, fixed: true },
      ],
      [],
      NOW,
    );
    const other = await plannedZone(v, [{ key: "o", place: { x: 0, y: 0 } }], [], NOW);

    await expect(merge(table.f!, table.a!, "right", 8)).rejects.toMatchObject({
      code: "table.fixed",
      params: { tableId: table.f },
    });
    await expect(merge(table.a!, table.f!, "right", 8)).rejects.toMatchObject({
      code: "table.fixed",
      params: { tableId: table.f },
    });
    await merge(table.b!, table.a!, "right", 8);
    await expect(merge(table.b!, table.c!, "right", 8)).rejects.toMatchObject({
      code: "table.merged",
      params: { tableId: table.b },
    });
    await expect(merge(other.table.o!, table.c!, "right", 8)).rejects.toMatchObject({
      code: "service_zone.join_mismatch",
      params: { orderZoneId: (await zoneOf(table.c!))!, tableZoneId: other.zoneId },
    });
    await expect(merge(table.c!, table.c!, "right", 8)).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "targetId" },
    });
    expect(await place(table.c!)).toEqual({ x: 40, y: 0, rotation: 0 });
    expect(await mergeOf(v, table.c!)).toBeNull();
  });

  it("refuses a spare and a taken-off table, either way", async () => {
    const { table } = await plannedZone(
      v,
      [
        { key: "a", place: { x: 0, y: 0 } },
        { key: "b", place: { x: 20, y: 0 } },
        { key: "s", place: null },
        { key: "t", place: { x: 40, y: 0 } },
      ],
      [],
      NOW,
    );
    await setToday(table.t!, { takenOff: true });
    const unplanned = await v.table(`Unplanned ${table.a!.slice(0, 6)}`);

    for (const [moving, target, code, tableId] of [
      [table.s!, table.a!, "table.not_in_floor_plan", table.s!],
      [table.a!, table.s!, "table.not_in_floor_plan", table.s!],
      [unplanned, table.a!, "table.not_in_floor_plan", unplanned],
      [table.t!, table.a!, "table.taken_off", table.t!],
      [table.a!, table.t!, "table.taken_off", table.t!],
    ] as const) {
      await expect(merge(moving, target, "right", 8)).rejects.toMatchObject({
        code,
        params: { tableId },
      });
    }
    await expect(merge(table.a!, "missing-table", "right", 8)).rejects.toMatchObject({
      code: "table.not_found",
    });
  });

  it("refuses a held table or one needing clearing only when both must be free", async () => {
    const { table } = await threeTables();
    await seat(v, table.a!);

    await expect(merge(table.b!, table.a!, "right", 8)).rejects.toMatchObject({
      code: "tab.already_open",
      params: { tableId: table.a },
    });
    await expect(merge(table.a!, table.b!, "right", 8)).rejects.toMatchObject({
      code: "tab.already_open",
      params: { tableId: table.a },
    });
    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set({ needsClearingSince: NOW.toISOString() })
        .where(eq(diningTables.id, table.c!)),
    );
    await expect(merge(table.c!, table.b!, "right", 8)).rejects.toMatchObject({
      code: "table.needs_clearing",
      params: { tableId: table.c },
    });
    await expect(merge(table.b!, table.c!, "right", 8)).rejects.toMatchObject({
      code: "table.needs_clearing",
      params: { tableId: table.c },
    });

    await merge(table.b!, table.a!, "right", 8, false);
    await merge(table.c!, table.b!, "bottom", 12, false);

    expect((await mergeOf(v, table.a!))!.members).toHaveLength(3);
  });

  it("puts each table that leaves back where it stood before, and ends a merge left with one", async () => {
    const { table } = await threeTables();
    await merge(table.b!, table.a!, "right", 8);
    await merge(table.c!, table.b!, "bottom", 12);

    await inTx(v, (tx) => leaveMergesRestoring(tx, [table.c!]));

    expect(await place(table.c!)).toEqual({ x: 40, y: 0, rotation: 30 });
    expect(await mergeOf(v, table.c!)).toBeNull();
    expect((await mergeOf(v, table.a!))!.members.map((m) => m.tableId).sort()).toEqual(
      [table.a!, table.b!].sort(),
    );
    expect(await place(table.b!)).toEqual({ x: 8, y: 0, rotation: 0 });

    await inTx(v, (tx) => leaveMergesRestoring(tx, [table.a!, table.b!]));

    expect(await place(table.a!)).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(await place(table.b!)).toEqual({ x: 20, y: 0, rotation: 0 });
    expect(await mergeOf(v, table.a!)).toBeNull();
    expect(await mergeOf(v, table.b!)).toBeNull();
    expect(await inTx(v, (tx) => mergeMembers(tx, table.a!))).toEqual([]);
  });

  it("ends a merge one table leaves, the other going back too", async () => {
    const { table } = await threeTables();
    await merge(table.c!, table.a!, "right", 8);
    expect(await place(table.c!)).toEqual({ x: 8, y: 0, rotation: 0 });

    await inTx(v, (tx) => leaveMergesRestoring(tx, [table.a!, table.b!]));

    expect(await place(table.c!)).toEqual({ x: 40, y: 0, rotation: 30 });
    expect(await place(table.b!)).toEqual({ x: 20, y: 0, rotation: 0 });
    expect(await mergeOf(v, table.c!)).toBeNull();
  });
});

async function zoneOf(tableId: string): Promise<string | null> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ zoneId: diningTables.zoneId })
      .from(diningTables)
      .where(eq(diningTables.id, tableId)),
  );
  return row!.zoneId;
}

describe("today's copy of the master's joins", () => {
  const seatsOf = (tableIds: string[]) => inTx(v, (tx) => savedJoinSeats(tx, tableIds));
  const reset = (zoneId: string) => inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW));

  async function copiedJoins(zoneId: string): Promise<{ seats: number; members: number }[]> {
    return inTx(v, async (tx) => {
      const joins = await tx
        .select({ id: floorResetJoins.id, seats: floorResetJoins.seats })
        .from(floorResetJoins)
        .where(eq(floorResetJoins.zoneId, zoneId));
      const answer = [];
      for (const join of joins) {
        const members = await tx
          .select({ id: floorResetJoinTables.id })
          .from(floorResetJoinTables)
          .where(eq(floorResetJoinTables.joinId, join.id));
        answer.push({ seats: join.seats, members: members.length });
      }
      return answer;
    });
  }

  it("a join deleted from the master mid-day still gives today's merge its seats, until the next reset", async () => {
    const { zoneId, table } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    await resaveMaster(v, zoneId, { joins: [] }, NOW);

    expect(await seatsOf([table.a!, table.b!])).toBe(6);
    await reset(zoneId);
    expect(await seatsOf([table.a!, table.b!])).toBeNull();
  });

  it("a join whose master table was deleted mid-day still gives today's merge its seats", async () => {
    const { zoneId, table, master } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    await resaveMaster(v, zoneId, { joins: [], drop: [master.b!] }, NOW);

    expect(await seatsOf([table.a!, table.b!])).toBe(6);
  });

  it("a reset replaces the zone's copy rather than adding to it", async () => {
    const { zoneId, table, master } = await threeTables([
      { seats: 6, keys: ["a", "b"] },
      { seats: 9, keys: ["a", "c"] },
    ]);
    await resaveMaster(
      v,
      zoneId,
      { joins: [{ seats: 7, masterIds: [master.a!, master.b!] }] },
      NOW,
    );

    await reset(zoneId);

    expect(await seatsOf([table.a!, table.b!])).toBe(7);
    expect(await seatsOf([table.a!, table.c!])).toBeNull();
    expect(await copiedJoins(zoneId)).toEqual([{ seats: 7, members: 2 }]);
  });

  it("resetting one zone leaves another zone's copy alone", async () => {
    const one = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    const two = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    await resaveMaster(v, two.zoneId, { joins: [] }, NOW);

    await reset(one.zoneId);
    expect(await seatsOf([two.table.a!, two.table.b!])).toBe(6);
    await reset(two.zoneId);
    expect(await seatsOf([two.table.a!, two.table.b!])).toBeNull();
  });

  it("finds no copied join when one of the tables has no reset row, or one is named twice", async () => {
    const { table } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    const loose = await v.table(`Loose ${table.a!.slice(0, 6)}`);

    expect(await seatsOf([table.a!, table.b!])).toBe(6);
    expect(await seatsOf([table.a!, table.b!, loose])).toBeNull();
    expect(await seatsOf([table.a!, table.a!, table.b!])).toBeNull();
  });

  it("copies no join whose master table two live tables follow", async () => {
    const { zoneId, table } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    const [b] = await inTx(v, (tx) =>
      tx
        .select({ planTableId: diningTables.planTableId })
        .from(diningTables)
        .where(eq(diningTables.id, table.b!)),
    );
    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set({ planTableId: b!.planTableId })
        .where(eq(diningTables.id, table.c!)),
    );

    await reset(zoneId);

    expect(await copiedJoins(zoneId)).toEqual([]);
    expect(await seatsOf([table.a!, table.b!])).toBeNull();
  });

  it("a reset after a copied member's master table was deleted replaces the copy without a refusal", async () => {
    const { zoneId, table, master } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    await resaveMaster(v, zoneId, { joins: [], drop: [master.b!] }, NOW);

    await reset(zoneId);

    const [b] = await inTx(v, (tx) =>
      tx.select({ id: diningTables.id }).from(diningTables).where(eq(diningTables.id, table.b!)),
    );
    expect(b).toBeUndefined();
    expect(await copiedJoins(zoneId)).toEqual([]);
    expect(await seatsOf([table.a!, table.b!])).toBeNull();
  });
});
