import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { diningTables, floorTodayJoins, floorTodayTables } from "@waitron/db";
import type { JoinSide } from "@waitron/shared";
import { leaveMergesRestoring, mergeMembers, writeMerge } from "./floor-today-merges.js";
import { inTx, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { mergeOf, plannedZone, todayRow } from "./testing/floor-today-venue.js";
import "./errors.js";

let v: PartyVenue;

const NOW = new Date("2026-10-10T12:00:00Z");

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

  it("refuses a merge without seats, even of tables the saved plan joins, and writes nothing", async () => {
    const { table } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);

    await expect(merge(table.b!, table.a!, "right", null)).rejects.toMatchObject({
      code: "merge.seats_required",
      params: {},
    });

    expect(await place(table.b!)).toEqual({ x: 20, y: 0, rotation: 0 });
    expect(await mergeOf(v, table.a!)).toBeNull();
    expect(await mergeOf(v, table.b!)).toBeNull();
  });

  it("grows a merge with a third table, working its seats out again", async () => {
    const { table } = await threeTables([{ seats: 6, keys: ["a", "b"] }]);
    await merge(table.b!, table.a!, "right", 8);

    await expect(merge(table.c!, table.b!, "bottom", null)).rejects.toMatchObject({
      code: "merge.seats_required",
      params: {},
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
      [table.s!, table.a!, "table.not_on_today_plan", table.s!],
      [table.a!, table.s!, "table.not_on_today_plan", table.s!],
      [unplanned, table.a!, "table.not_on_today_plan", unplanned],
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
