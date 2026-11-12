import { floorLabelSuffix } from "./testing/floor-label.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  floorResetTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodayTables,
  floorTodayZones,
  floorZones,
} from "@waitron/db";
import { zoneSalePolicies, zoneServicePolicies } from "@waitron/venue-service";
import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";
import { readLayout, saveLayout, type ZonePlanSave } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { catchUpDue, ensureToday, moveToday, takeOffToday } from "./floor-today-store.js";
import { leaveMergesRestoring, writeMerge } from "./floor-today-merges.js";
import { finishTable } from "./testing/party-close-fixture.js";
import { inTx, OPERATOR, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import {
  giveKeptSize,
  mergeOf,
  plannedZone,
  standardAndDinner,
  todayRow,
  zoneRevisionOf,
} from "./testing/floor-today-venue.js";
import { createTable } from "./testing/live-table.js";
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
    await tx.insert(floorZones).values({ id, name: `Zone ${id.slice(0, 8)}` });
    await tx.insert(zoneServicePolicies).values({
      zoneId: id,
      departmentId: tables!.departmentId,
    });
    await tx.insert(zoneSalePolicies).values({ zoneId: id, orderStart: "table" });
  });
  return id;
}

function fresh(label: string): string {
  return `${label} ${floorLabelSuffix()}`;
}

type Entry = ZonePlanSave["tables"][number];

function place(x: number, y: number, extra: { width?: number; rotation?: number } = {}) {
  return { x, y, width: 8, height: 6, shape: "round" as const, rotation: 0, ...extra };
}

async function read(): Promise<Map<string, TableState>> {
  const states = await inTx(v, (tx) => listTablesWithState(tx, [], NOW));
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
        REMOVALS,
        await defaultLayout(tx, v.cfg, zoneId),
        { revision: 0, tables: entries },
        NOW,
      ),
    );
    const plan = await inTx(v, async (tx) =>
      readLayout(tx, await defaultLayout(tx, v.cfg, zoneId)),
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
      zoneRevision: 1,
      name: null,
      joinName: null,
      needsMoving: false,
    });
    expect(states.get(b)!.today).toEqual({
      placement: place(20, 5, { width: 10, rotation: 45 }),
      seats: 2,
      fixed: false,
      takenOff: false,
      joinId,
      joinSeats: 7,
      zoneRevision: 1,
      name: null,
      joinName: null,
      needsMoving: false,
    });
    expect(states.get(spare)!.today).toEqual({
      placement: null,
      seats: null,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      zoneRevision: 1,
      name: null,
      joinName: null,
      needsMoving: false,
    });
    expect(states.get(off)!.today).toEqual({
      placement: null,
      seats: 6,
      fixed: false,
      takenOff: true,
      joinId: null,
      joinSeats: null,
      zoneRevision: 1,
      name: null,
      joinName: null,
      needsMoving: false,
    });
  });

  it("names each table by its short name, or by its full name when it has none", async () => {
    const [named, unnamed] = [fresh("Front 1"), fresh("Back 2")];
    const { withShort, without } = await inTx(v, async (tx) => ({
      withShort: (
        await createTable(tx, v.cfg, { label: named, zoneId: v.tables.zoneId, shortName: "Fr1" })
      ).id,
      without: (await createTable(tx, v.cfg, { label: unnamed, zoneId: v.tables.zoneId })).id,
    }));

    const states = await read();
    expect(states.get(withShort)!.shortName).toBe("Fr1");
    expect(states.get(without)!.shortName).toBe(unnamed);
  });

  it("names every real member with its ordinary group in the wire answer", async () => {
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
        REMOVALS,
        await defaultLayout(tx, v.cfg, zoneId),
        { revision: 0, tables: entries },
        NOW,
      ),
    );
    const plan = await inTx(v, async (tx) =>
      readLayout(tx, await defaultLayout(tx, v.cfg, zoneId)),
    );
    const liveId = (label: string) => plan.tables.find((t) => t.label === label)!.liveTableId!;

    const states = await read();
    const group = states.get(liveId(c3))!.today!.joinId;
    expect(group).not.toBeNull();
    for (const part of [c3, c4, c5]) {
      expect(states.get(liveId(part))!.today).toMatchObject({ joinId: group, joinName: long, joinSeats: 10 });
      expect(states.get(liveId(part))!.today).not.toHaveProperty("joined");
    }
    expect(states.has(liveId(long))).toBe(false);
    expect(states.get(liveId(plain))!.today!.joinId).toBeNull();
  });
});

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
      Object.values(tables).filter((id) => id != null).map((id) => states.get(id)!.today!.zoneRevision);

    const first = await read();
    expect(revisionsOf(first, one.table)).toEqual([1, 1, 1, 1]);
    expect(first.get(unplanned)!.today.zoneRevision).toBe(0);
    expect(first.has(noToday)).toBe(false);

    await onNextDay(async () => {
      await inTx(v, (tx) => ensureToday(tx, REMOVALS, NEXT_DAY));
      const two = await LONG_TABLE(NEXT_DAY);
      const next = await inTx(v, (tx) => listTablesWithState(tx, [], NEXT_DAY)).then(
        (states) => new Map(states.map((s) => [s.id, s])),
      );
      expect(revisionsOf(next, one.table)).toEqual([2, 2, 2, 2]);
      expect(revisionsOf(next, two.table)).toEqual([1, 1, 1, 1]);
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
        targetId: grouped.table.c3!,
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
    expect(states.get(named.table.c3!)!.today).toMatchObject({ name: null, joinName: expect.any(String) });
    const members = ["bar", "c3", "c4", "c5"].map((key) => grouped.table[key]!);
    for (const member of members) {
      expect(states.get(member)!.today).toMatchObject({ name: null, joinName: groupName });
    }
  });
});

async function seatAndFinishAcross(tableId: string, reset: () => Promise<unknown>): Promise<void> {
  const { partyId, revision } = await seat(v, tableId);
  await reset();
  await inTx(v, (tx) =>
    finishTable(tx, { partyId, expectedPartyRevision: revision, operatorId: OPERATOR }),
  );
}

const catchUp = () => inTx(v, (tx) => ensureToday(tx, REMOVALS, NOW));

async function readyToMoveOf(tableId: string): Promise<boolean | undefined> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ readyToMove: floorResetTables.readyToMove })
      .from(floorResetTables)
      .where(eq(floorResetTables.tableId, tableId)),
  );
  return row?.readyToMove;
}

describe("the till's table-state answer says what needs moving", () => {
  /** 3 stands at 0 in Standard and 40 in Dinner, 6 at 60 in both; guests at 3 leave after a reset onto Dinner. */
  async function threeFreedAfterDinner() {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));
    const s = await standardAndDinner(
      v,
      NOW,
      [
        { key: "t3", label: fresh("3") },
        { key: "t6", label: fresh("6") },
      ],
      { standard: { t3: 0, t6: 60 }, dinner: { t3: 40, t6: 60 } },
    );
    await s.onto(s.d.standard);
    const [t3, t6] = [s.live("t3"), s.live("t6")];
    await seatAndFinishAcross(t3, () => s.onto(s.d.dinner));
    return { ...s, t3, t6 };
  }

  it("reports needsMoving", async () => {
    const z = await threeFreedAfterDinner();
    await catchUp();

    const states = await read();
    expect(states.get(z.t3)!.today).toMatchObject({
      needsMoving: true,
      placement: { x: 0 },
    });
    expect(states.get(z.t6)!.today.needsMoving).toBe(false);
  });

  it("marking moves the room's revision", async () => {
    const z = await threeFreedAfterDinner();
    const before = (await zoneRevisionOf(v, z.d.zoneId))!;

    await catchUp();
    expect(await readyToMoveOf(z.t3)).toBe(true);
    expect(await zoneRevisionOf(v, z.d.zoneId)).toBe(before + 1);

    await catchUp();
    expect(await zoneRevisionOf(v, z.d.zoneId)).toBe(before + 1);
  });

  it.each([2, 3])("a marked saved group of %i members stays pending while its far member still moves", async (count) => {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));
    const keys = count === 2 ? ["t4", "t5"] : ["t3", "t4", "t5"];
    const s = await standardAndDinner(v, NOW,
      [...keys.map((key) => ({ key, label: fresh(key) })),
       { key: "group", label: fresh("Saved group"), partKeys: keys }],
      { standard: Object.fromEntries([...keys.map((key, i) => [key, i * 20]), ["group", null]]),
        dinner: Object.fromEntries([...keys.map((key) => [key, null]), ["group", 0]]) });
    await s.onto(s.d.dinner);
    const ids = keys.map(s.live);
    await seatAndFinishAcross(ids[0]!, () => s.onto(s.d.standard));
    await catchUp();
    const states = await read();
    for (const id of ids) {
      expect(states.get(id)!.today!.needsMoving).toBe(true);
      expect(states.get(id)!.today!.placement).not.toBeNull();
      expect(await readyToMoveOf(id)).toBe(true);
    }
    await inTx(v, async (tx) => {
      await leaveMergesRestoring(tx, ids);
      await takeOffToday(tx, ids[0]!);
      await moveToday(tx, ids.at(-1)!, { x: 99, y: 0 });
    });
    expect((await todayRow(v, ids.at(-1)!))!.x).toBe(99);
    const due = await inTx(v, (tx) => tx.select({ id: floorZones.id }).from(floorZones)
      .where(and(eq(floorZones.id, s.d.zoneId), catchUpDue(floorZones.id))));
    expect(due).toEqual([]);
    await catchUp();
    for (const id of ids) expect(await readyToMoveOf(id)).toBe(true);
    expect((await todayRow(v, ids.at(-1)!))!.x).toBe(99);
  });

  it("a member of a marked group whose own change is seats only (seats changed today) reads false", async () => {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));
    const s = await standardAndDinner(
      v,
      NOW,
      [
        { key: "t4", label: fresh("4") },
        { key: "t5", label: fresh("5") },
        { key: "t45", label: fresh("4+5"), partKeys: ["t4", "t5"] },
      ],
      { standard: { t4: 0, t5: 20, t45: null }, dinner: { t4: 0, t5: 40, t45: null } },
    );
    await s.onto(s.d.standard);
    const [t4, t5] = [s.live("t4"), s.live("t5")];
    await inTx(v, (tx) =>
      tx.update(floorTodayTables).set({ seats: 2 }).where(eq(floorTodayTables.tableId, t4)),
    );
    await seatAndFinishAcross(t4, () => s.onto(s.d.dinner));

    await catchUp();

    expect(await readyToMoveOf(t4)).toBe(true);
    const states = await read();
    expect(states.get(t5)!.today.needsMoving).toBe(true);
    expect(states.get(t4)!.today).toMatchObject({ needsMoving: false, seats: 2 });
  });

  it("refuses seating the member of a marked group that moves, and seats the one the till shows free", async () => {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));
    const s = await standardAndDinner(
      v,
      NOW,
      [
        { key: "t4", label: fresh("4") },
        { key: "t5", label: fresh("5") },
        { key: "t45", label: fresh("4+5"), partKeys: ["t4", "t5"] },
      ],
      { standard: { t4: 0, t5: 20, t45: null }, dinner: { t4: 0, t5: 40, t45: null } },
    );
    await s.onto(s.d.standard);
    const [t4, t5] = [s.live("t4"), s.live("t5")];
    await inTx(v, (tx) =>
      tx.update(floorTodayTables).set({ seats: 2 }).where(eq(floorTodayTables.tableId, t4)),
    );
    await seatAndFinishAcross(t4, () => s.onto(s.d.dinner));
    await catchUp();
    expect(await readyToMoveOf(t4)).toBe(true);

    await expect(seat(v, t5)).rejects.toMatchObject({
      code: "table.needs_moving",
      params: { tableId: t5 },
    });
    await seat(v, t4);
  });
});
