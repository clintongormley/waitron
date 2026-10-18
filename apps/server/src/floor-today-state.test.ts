import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodayTables,
  floorTodayZones,
  floorZones,
} from "@waitron/db";
import { zoneSalePolicies, zoneServicePolicies } from "@waitron/venue-service";
import { readLayout, saveLayout, type ZonePlanSave } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { splitJoinedTable } from "./floor-today-split.js";
import { ensureToday } from "./floor-today-store.js";
import { writeMerge } from "./floor-today-merges.js";
import { inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { giveKeptSize, mergeOf, plannedZone } from "./testing/floor-today-venue.js";
import { listTablesWithState, type TableState } from "./working-order.js";
import "./errors.js";

let v: PartyVenue;

const NOW = new Date("2026-10-10T12:00:00Z");
const NEXT_DAY = new Date("2026-10-11T12:00:00Z");
const REMOVALS = enabledTableRemovals(ALL_MODULES);

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

async function zone(): Promise<string> {
  const id = randomUUID();
  await inTx(v, async (tx) => {
    const [tables] = await tx
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, v.tables.zoneId));
    await tx
      .insert(floorZones)
      .values({ id, locationId: v.cfg.locationId, name: `Zone ${id.slice(0, 8)}` });
    await tx.insert(zoneServicePolicies).values({
      locationId: v.cfg.locationId,
      zoneId: id,
      departmentId: tables!.departmentId,
    });
    await tx.insert(zoneSalePolicies).values({ zoneId: id, orderStart: "table" });
  });
  return id;
}

function fresh(label: string): string {
  return `${label} ${randomUUID().slice(0, 6)}`;
}

type Entry = ZonePlanSave["tables"][number];

function place(x: number, y: number, extra: { width?: number; rotation?: number } = {}) {
  return { x, y, width: 8, height: 6, shape: "round" as const, rotation: 0, ...extra };
}

async function read(): Promise<Map<string, TableState>> {
  const states = await inTx(v, (tx) => listTablesWithState(tx, v.cfg, [], undefined, NOW));
  return new Map(states.map((s) => [s.id, s]));
}

describe("the till's table-state answer carries today's plan", () => {
  it("gives each planned table its today's row, a spare no placement, and a merge's tables one join", async () => {
    const zoneId = await zone();
    const [la, lb, ls, lo] = [fresh("A"), fresh("B"), fresh("S"), fresh("O")];
    const entries: Entry[] = [
      { key: "a", label: la, seats: 4, fixed: true, placement: place(3, 5), partKeys: [] },
      {
        key: "b",
        label: lb,
        seats: 2,
        fixed: false,
        placement: place(20, 5, { width: 10, rotation: 45 }),
        partKeys: [],
      },
      { key: "s", label: ls, seats: null, fixed: false, placement: null, partKeys: [] },
      { key: "o", label: lo, seats: 6, fixed: false, placement: place(40, 0), partKeys: [] },
    ];
    await inTx(v, async (tx) =>
      saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        await defaultLayout(tx, v.cfg, zoneId),
        { revision: 0, tables: entries },
        NOW,
      ),
    );
    const plan = await inTx(v, async (tx) =>
      readLayout(tx, v.cfg, await defaultLayout(tx, v.cfg, zoneId)),
    );
    const liveId = (label: string) => plan.tables.find((t) => t.label === label)!.liveTableId!;
    const [a, b, spare, off] = [la, lb, ls, lo].map(liveId) as [string, string, string, string];
    const joinId = await inTx(v, async (tx) => {
      await tx
        .update(floorTodayTables)
        .set({ takenOff: true })
        .where(eq(floorTodayTables.tableId, off));
      const [join] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId, seats: 7 })
        .returning({ id: floorTodayJoins.id });
      for (const tableId of [a, b]) {
        await tx
          .insert(floorTodayJoinTables)
          .values({ joinId: join!.id, tableId, beforeX: 0, beforeY: 0, beforeRotation: 0 });
      }
      return join!.id;
    });

    const states = await read();
    expect(states.get(a)!.today).toEqual({
      placement: place(3, 5),
      seats: 4,
      fixed: true,
      takenOff: false,
      joinId,
      joinSeats: 7,
      inJoinedTable: null,
      joined: null,
      splitOffFrom: null,
      zoneRevision: 1,
      name: null,
      joinName: null,
    });
    expect(states.get(b)!.today).toEqual({
      placement: place(20, 5, { width: 10, rotation: 45 }),
      seats: 2,
      fixed: false,
      takenOff: false,
      joinId,
      joinSeats: 7,
      inJoinedTable: null,
      joined: null,
      splitOffFrom: null,
      zoneRevision: 1,
      name: null,
      joinName: null,
    });
    expect(states.get(spare)!.today).toEqual({
      placement: null,
      seats: null,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      inJoinedTable: null,
      joined: null,
      splitOffFrom: null,
      zoneRevision: 1,
      name: null,
      joinName: null,
    });
    expect(states.get(off)!.today).toEqual({
      placement: null,
      seats: 6,
      fixed: false,
      takenOff: true,
      joinId: null,
      joinSeats: null,
      inJoinedTable: null,
      joined: null,
      splitOffFrom: null,
      zoneRevision: 1,
      name: null,
      joinName: null,
    });
  });

  it("names the joined table on each part, and on nothing else", async () => {
    const zoneId = await zone();
    const [long, c3, c4, c5, plain] = [
      fresh("Long"),
      fresh("Counter 3"),
      fresh("Counter 4"),
      fresh("Counter 5"),
      fresh("Plain"),
    ];
    const entries: Entry[] = [
      { key: "c3", label: c3, seats: 2, fixed: false, placement: null, partKeys: [] },
      { key: "c4", label: c4, seats: 6, fixed: false, placement: null, partKeys: [] },
      { key: "c5", label: c5, seats: 4, fixed: false, placement: null, partKeys: [] },
      {
        key: "long",
        label: long,
        seats: 10,
        fixed: false,
        placement: place(3, 5),
        partKeys: ["c3", "c4", "c5"],
      },
      { key: "plain", label: plain, seats: 4, fixed: false, placement: place(30, 5), partKeys: [] },
    ];
    await inTx(v, async (tx) =>
      saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        await defaultLayout(tx, v.cfg, zoneId),
        { revision: 0, tables: entries },
        NOW,
      ),
    );
    const plan = await inTx(v, async (tx) =>
      readLayout(tx, v.cfg, await defaultLayout(tx, v.cfg, zoneId)),
    );
    const liveId = (label: string) => plan.tables.find((t) => t.label === label)!.liveTableId!;

    const states = await read();
    for (const part of [c3, c4, c5]) {
      expect(states.get(liveId(part))!.today.inJoinedTable).toBe(long);
    }
    expect(states.get(liveId(long))!.today.inJoinedTable).toBeNull();
    expect(states.get(liveId(plain))!.today.inJoinedTable).toBeNull();
  });
});

/** Long table (10 seats, 6 × 2 at 10, 20) made of Counter 3 (2 × 2 kept), 4 (2 × 2 kept) and 5 (no kept size), and Bar placed. */
async function longPlusBar() {
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
      { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0 } },
    ],
    NOW,
  );
  await giveKeptSize(v, zone.master.c3!, { width: 2, height: 2 });
  await giveKeptSize(v, zone.master.c4!, { width: 2, height: 2 });
  return zone;
}

const split = (tableId: string, partIds: string[], seats: number | null) =>
  inTx(v, (tx) => splitJoinedTable(tx, v.cfg, { tableId, partIds, seats }));

describe("the till's table-state answer says what is joined and what is split off", () => {
  it("says which parts of Long table are still joined, and which were split off", async () => {
    const { table } = await longPlusBar();
    await split(table.long!, [table.c5!], 6);

    const states = await read();
    const long = states.get(table.long!)!;
    expect(long.today.joined).toEqual({
      parts: [table.c3, table.c4],
      splitOff: [table.c5],
      apart: false,
    });
    expect(long.today.splitOffFrom).toBeNull();
    expect(states.get(table.c5!)!.today.splitOffFrom).toBe(table.long);
    expect(states.get(table.c5!)!.today.inJoinedTable).toBeNull();
    expect(states.get(table.c5!)!.today.joined).toBeNull();
    expect(states.get(table.c3!)!.today.inJoinedTable).toBe(long.label);
    expect(states.get(table.c3!)!.today.splitOffFrom).toBeNull();
    expect(states.get(table.bar!)!.today.joined).toBeNull();
    expect(states.get(table.bar!)!.today.splitOffFrom).toBeNull();
  });

  it("says Long table has come apart once one part is left", async () => {
    const { table } = await longPlusBar();
    await split(table.long!, [table.c4!, table.c5!], null);

    const states = await read();
    expect(states.get(table.long!)!.today.joined).toEqual({
      parts: [],
      splitOff: [table.c3, table.c4, table.c5],
      apart: true,
    });
    for (const part of [table.c3!, table.c4!, table.c5!]) {
      expect(states.get(part)!.today.splitOffFrom).toBe(table.long);
    }
  });

  it("lists Long table's parts in number order, though they were added last to first", async () => {
    const { table } = await plannedZone(
      v,
      [
        { key: "c5", label: "Counter 5", seats: 4, place: null },
        { key: "c4", label: "Counter 4", seats: 6, place: null },
        { key: "c3", label: "Counter 3", seats: 2, place: null },
        {
          key: "long",
          label: "Long table",
          seats: 10,
          place: { x: 10, y: 20, width: 6, height: 2 },
          partKeys: ["c5", "c4", "c3"],
        },
      ],
      NOW,
    );
    await split(table.long!, [table.c3!], 8);
    expect((await read()).get(table.long!)!.today.joined).toEqual({
      parts: [table.c4, table.c5],
      splitOff: [table.c3],
      apart: false,
    });

    await split(table.long!, [table.c4!], null);
    expect((await read()).get(table.long!)!.today.joined).toEqual({
      parts: [],
      splitOff: [table.c3, table.c4, table.c5],
      apart: true,
    });
  });
});

/** Long table (10 seats, 6 × 2 at 10, 20) = Counter 3 (2 seats), 4 (6) and 5 (4), each kept 2 × 2; Bar (4 seats, 2 × 2 at 40, 0). */
async function LONG_TABLE(now = NOW) {
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
    now,
  );
  for (const key of ["c3", "c4", "c5"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

/** Runs `act`, then puts every zone the next day reached back on NOW's business day. */
async function onNextDay(act: () => Promise<void>): Promise<void> {
  try {
    await act();
  } finally {
    await inTx(v, (tx) =>
      tx
        .update(floorTodayZones)
        .set({ businessDay: "2026-10-10" })
        .where(eq(floorTodayZones.businessDay, "2026-10-11")),
    );
  }
}

describe("the till's table-state answer carries the room's revision", () => {
  it("every table of a room reads the room's revision", async () => {
    const one = await LONG_TABLE();
    const unplanned = await v.table(fresh("Unplanned"));
    const noToday = await v.table(fresh("No today"), v.tables.zoneId, { today: false });
    const revisionsOf = (states: Map<string, TableState>, tables: Record<string, string>) =>
      Object.values(tables).map((id) => states.get(id)!.today!.zoneRevision);

    const first = await read();
    expect(revisionsOf(first, one.table)).toEqual([1, 1, 1, 1, 1]);
    expect(first.get(unplanned)!.today.zoneRevision).toBe(0);
    expect(first.has(noToday)).toBe(false);

    await onNextDay(async () => {
      await inTx(v, (tx) => ensureToday(tx, v.cfg, REMOVALS, NEXT_DAY));
      const two = await LONG_TABLE(NEXT_DAY);
      const next = await inTx(v, (tx) =>
        listTablesWithState(tx, v.cfg, [], undefined, NEXT_DAY),
      ).then((states) => new Map(states.map((s) => [s.id, s])));
      expect(revisionsOf(next, one.table)).toEqual([2, 2, 2, 2, 2]);
      expect(revisionsOf(next, two.table)).toEqual([1, 1, 1, 1, 1]);
      expect(next.get(unplanned)!.today.zoneRevision).toBe(0);
      expect(next.has(noToday)).toBe(false);
    });
  });
});

describe("the till's table-state answer carries today's names", () => {
  it("the floor read carries a table's and a group's name for today", async () => {
    const named = await LONG_TABLE();
    const grouped = await LONG_TABLE();
    await inTx(v, (tx) =>
      writeMerge(tx, v.cfg, {
        movingId: grouped.table.bar!,
        targetId: grouped.table.long!,
        side: "left",
        seats: 14,
        free: true,
      }),
    );
    const { joinId } = (await mergeOf(v, grouped.table.bar!))!;
    const tableName = fresh("Window seat");
    const groupName = fresh("García birthday");
    await inTx(v, async (tx) => {
      await tx
        .update(floorTodayTables)
        .set({ name: tableName })
        .where(eq(floorTodayTables.tableId, named.table.bar!));
      await tx
        .update(floorTodayJoins)
        .set({ name: groupName })
        .where(eq(floorTodayJoins.id, joinId));
    });

    const states = await read();
    expect(states.get(named.table.bar!)!.today).toMatchObject({ name: tableName, joinName: null });
    expect(states.get(named.table.long!)!.today).toMatchObject({ name: null, joinName: null });
    const members = ["bar", "c3", "c4", "c5"].map((key) => grouped.table[key]!);
    for (const member of members) {
      expect(states.get(member)!.today).toMatchObject({ name: null, joinName: groupName });
    }
  });
});
