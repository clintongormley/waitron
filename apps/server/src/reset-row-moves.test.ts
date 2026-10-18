import { inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorResetTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayTables,
  needsMoving,
} from "@waitron/db";
import { movesTable, type Placement } from "./floor-reset-plan.js";
import { placementColumns } from "./floor-today-store.js";
import { blocksPlace, blocksPlaceSql, standsIn, standsInSql } from "./joined-split-layout.js";
import { plannedZone } from "./testing/floor-today-venue.js";
import { inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
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

const at: Placement = { x: 10, y: 10, width: 8, height: 8, shape: "rect", rotation: 0 };

interface Case {
  name: string;
  /** Today's row; null for a table with none. */
  today: { placement: Placement | null; takenOff?: boolean; seats?: number } | null;
  inMerge?: boolean;
  splitOff?: boolean;
  target: Placement | null;
  moves: boolean;
}

const CASES: Case[] = [
  { name: "exactly at its place", today: { placement: at }, target: at, moves: false },
  { name: "x differs", today: { placement: at }, target: { ...at, x: 11 }, moves: true },
  { name: "y differs", today: { placement: at }, target: { ...at, y: 11 }, moves: true },
  { name: "width differs", today: { placement: at }, target: { ...at, width: 9 }, moves: true },
  { name: "height differs", today: { placement: at }, target: { ...at, height: 9 }, moves: true },
  {
    name: "shape differs",
    today: { placement: at },
    target: { ...at, shape: "round" },
    moves: true,
  },
  {
    name: "rotation differs",
    today: { placement: at },
    target: { ...at, rotation: 15 },
    moves: true,
  },
  { name: "into store", today: { placement: at }, target: null, moves: true },
  { name: "in a merge", today: { placement: at }, inMerge: true, target: at, moves: true },
  { name: "split off", today: { placement: at }, splitOff: true, target: at, moves: true },
  {
    name: "taken off",
    today: { placement: at, takenOff: true },
    target: { ...at, x: 40 },
    moves: false,
  },
  { name: "not drawn", today: { placement: null }, target: at, moves: false },
  { name: "no today's row", today: null, target: at, moves: false },
  { name: "seats only", today: { placement: at, seats: 2 }, target: at, moves: false },
];

describe("movesTable and the SQL rule the till and the refusals read", () => {
  it("agree on every kind of change", async () => {
    const keys = CASES.map((_, i) => `c${i}`);
    const { zoneId, table } = await plannedZone(v, [
      ...keys.map((key, i) => ({ key, place: { x: i * 10, y: 0 } })),
      { key: "joined", place: null },
    ]);
    const ids = keys.map((key) => table[key]!);
    await inTx(v, async (tx) => {
      await tx.delete(floorTodayTables).where(inArray(floorTodayTables.tableId, ids));
      await tx.delete(floorResetTables).where(inArray(floorResetTables.tableId, ids));
      const [join] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId, seats: 8 })
        .returning({ id: floorTodayJoins.id });
      for (const [i, c] of CASES.entries()) {
        const tableId = ids[i]!;
        if (c.today !== null) {
          await tx.insert(floorTodayTables).values({
            tableId,
            seats: c.today.seats ?? 4,
            takenOff: c.today.takenOff ?? false,
            ...placementColumns(c.today.placement),
          });
        }
        await tx.insert(floorResetTables).values({
          zoneId,
          tableId,
          label: `Case ${i}`,
          seats: 4,
          pending: true,
          readyToMove: true,
          ...placementColumns(c.target),
        });
        if (c.inMerge) {
          await tx
            .insert(floorTodayJoinTables)
            .values({ joinId: join!.id, tableId, beforeX: 0, beforeY: 0, beforeRotation: 0 });
        }
        if (c.splitOff) {
          await tx
            .insert(floorTodaySplitParts)
            .values({ joinedTableId: table.joined!, partTableId: tableId });
        }
      }
    });

    const rows = await inTx(v, (tx) =>
      tx
        .select({ id: diningTables.id, sql: needsMoving(diningTables.id).mapWith(Boolean) })
        .from(diningTables)
        .where(inArray(diningTables.id, ids)),
    );
    const bySql = new Map(rows.map((row) => [row.id, row.sql]));
    const answers = CASES.map((c, i) => ({
      name: c.name,
      js: movesTable(
        c.today === null
          ? null
          : {
              placement: c.today.placement,
              takenOff: c.today.takenOff ?? false,
              inMerge: c.inMerge ?? false,
              splitOff: c.splitOff ?? false,
            },
        { placement: c.target },
      ),
      sql: bySql.get(ids[i]!),
    }));

    expect(answers).toEqual(CASES.map((c) => ({ name: c.name, js: c.moves, sql: c.moves })));
  });

  it("a row that moves its table needs moving only once it is marked", async () => {
    const { zoneId, table } = await plannedZone(v, [{ key: "t", place: { x: 0, y: 0 } }]);
    const tableId = table.t!;
    await inTx(v, async (tx) => {
      await tx.delete(floorResetTables).where(inArray(floorResetTables.tableId, [tableId]));
      await tx.insert(floorResetTables).values({
        zoneId,
        tableId,
        label: "Unmarked",
        seats: 4,
        pending: true,
        ...placementColumns({ ...at, x: 50 }),
      });
    });
    const read = () =>
      inTx(v, (tx) =>
        tx
          .select({ moving: needsMoving(diningTables.id).mapWith(Boolean) })
          .from(diningTables)
          .where(inArray(diningTables.id, [tableId])),
      );
    expect(await read()).toEqual([{ moving: false }]);

    await inTx(v, (tx) =>
      tx
        .update(floorResetTables)
        .set({ readyToMove: true })
        .where(inArray(floorResetTables.tableId, [tableId])),
    );
    expect(await read()).toEqual([{ moving: true }]);
  });
});

describe("standsIn and the SQL the catch-up check reads", () => {
  const long: Placement = { x: 10, y: 20, width: 6, height: 2, shape: "rect", rotation: 0 };
  const bar = (x: number, y: number, rotation = 0): Placement => ({
    x,
    y,
    width: 2,
    height: 2,
    shape: "rect",
    rotation,
  });
  const PAIRS: [string, Placement, Placement][] = [
    ["over part of it", long, bar(11, 20)],
    ["touching its right edge", long, bar(16, 20)],
    ["touching its left edge", long, bar(8, 20)],
    ["over one square of its corner", long, bar(15, 21)],
    ["touching its corner", long, bar(16, 21)],
    ["turned, centred on it", long, bar(12, 20, 45)],
    ["turned, a corner on its edge", long, bar(12, 19 - Math.SQRT2, 45)],
    ["turned, a corner half a square in", long, bar(12, 19.5 - Math.SQRT2, 45)],
    ["inside its turned bounding box, clear of its sides", { ...long, rotation: 45 }, bar(14, 18)],
    ["turned 195°, overlapping by exactly one square", long, bar(9, 19, 195)],
    ["far away", long, bar(60, 60)],
    ["the same place", long, long],
  ];

  it("agree on every pair, both ways round", async () => {
    const lit = (p: Placement) => ({
      x: sql`${p.x}`,
      y: sql`${p.y}`,
      width: sql`${p.width}`,
      height: sql`${p.height}`,
      rotation: sql`${p.rotation}`,
    });
    const answers = [];
    for (const [name, a, b] of PAIRS) {
      for (const [first, second] of [
        [a, b],
        [b, a],
      ] as const) {
        const [row] = await v.db.all<{ hit: number }>(
          sql`select ${standsInSql(lit(first), lit(second))} as hit`,
        );
        answers.push({ name, js: standsIn(first, second), sql: row!.hit === 1 });
      }
    }
    expect(answers.map((a) => ({ name: a.name, sql: a.sql }))).toEqual(
      answers.map((a) => ({ name: a.name, sql: a.js })),
    );
    expect(answers.filter((a) => a.js).length).toBe(10);
  });
});

describe("blocksPlace and the SQL the catch-up check reads", () => {
  const place: Placement = { x: 10, y: 20, width: 6, height: 2, shape: "rect", rotation: 0 };
  const standing: Placement = { x: 12, y: 20, width: 2, height: 2, shape: "rect", rotation: 30 };
  const clear: Placement = { ...standing, x: 60 };
  const OWN: [string, Placement, Placement | null][] = [
    ["no place of its own", standing, null],
    ["standing in its own place", standing, standing],
    ["a square off its own place across", standing, { ...standing, x: 13 }],
    ["a square off its own place down", standing, { ...standing, y: 21 }],
    ["wider than its own place", standing, { ...standing, width: 3 }],
    ["taller than its own place", standing, { ...standing, height: 3 }],
    ["turned off its own place", standing, { ...standing, rotation: 45 }],
    ["round in its own place", standing, { ...standing, shape: "round" }],
    ["clear of the place, in its own place", clear, clear],
    ["clear of the place, off its own place", clear, null],
  ];

  it("agree on every case", async () => {
    const lit = (p: Placement | null) => ({
      x: sql`${p?.x ?? null}`,
      y: sql`${p?.y ?? null}`,
      width: sql`${p?.width ?? null}`,
      height: sql`${p?.height ?? null}`,
      rotation: sql`${p?.rotation ?? null}`,
      shape: sql`${p?.shape ?? null}`,
    });
    const answers = [];
    for (const [name, at, own] of OWN) {
      const [row] = await v.db.all<{ hit: number }>(
        sql`select ${blocksPlaceSql(lit(place), lit(at), lit(own))} as hit`,
      );
      answers.push({ name, js: blocksPlace(place, at, own), sql: row!.hit === 1 });
    }
    expect(answers.map((a) => ({ name: a.name, sql: a.sql }))).toEqual(
      answers.map((a) => ({ name: a.name, sql: a.js })),
    );
    expect(answers.filter((a) => a.js).map((a) => a.name)).toEqual([
      "no place of its own",
      "a square off its own place across",
      "a square off its own place down",
      "wider than its own place",
      "taller than its own place",
      "turned off its own place",
      "round in its own place",
    ]);
  });
});
