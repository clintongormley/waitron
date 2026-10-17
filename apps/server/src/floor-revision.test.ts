import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorTodayJoins, floorTodayTables, floorTodayZones } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { readLayout, saveLayout, type ZonePlanSave } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import {
  moveChangedRooms,
  moveRoom,
  roomPrints,
  roomRevision,
  roomRevisions,
  sentRevision,
  zonesOf,
} from "./floor-revision.js";
import { ensureToday, moveToday, resetZone } from "./floor-today-store.js";
import { writeMerge } from "./floor-today-merges.js";
import { splitJoinedTable } from "./floor-today-split.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { finishTable } from "./testing/party-close-fixture.js";
import {
  commandFor,
  inTx,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  giveKeptSize,
  mergeOf,
  plannedZone,
  splitOffRow,
  todayRow,
  zoneRevisionOf,
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
const NEXT_DAY = new Date("2026-10-11T12:00:00Z");
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
  return zone;
}

const printOf = async (zoneId: string) =>
  (await inTx(v, (tx) => roomPrints(tx, v.cfg, [zoneId]))).get(zoneId);
const readFloor = (now = NOW) => inTx(v, (tx) => ensureToday(tx, v.cfg, REMOVALS, now));
const resetToSaved = (zoneId: string) =>
  inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW, "due"));

async function finish(partyId: string): Promise<void> {
  const sent = await commandFor(v, partyId);
  await inTx(v, (tx) => finishTable(tx, { partyId, ...sent }));
}

/** Saves the zone's plan again, as read, after `change`. */
async function resave(
  zoneId: string,
  change: (tables: ZonePlanSave["tables"]) => ZonePlanSave["tables"],
): Promise<void> {
  const plan = await inTx(v, async (tx) =>
    readLayout(tx, v.cfg, await defaultLayout(tx, v.cfg, zoneId)),
  );
  const tables = plan.tables.map((table) => ({
    id: table.id,
    key: table.id,
    label: table.label,
    seats: table.seats,
    fixed: table.fixed,
    placement: table.placement,
    partKeys: table.partIds,
  }));
  await inTx(v, async (tx) =>
    saveLayout(
      tx,
      v.cfg,
      REMOVALS,
      await defaultLayout(tx, v.cfg, zoneId),
      { revision: plan.revision, tables: change(tables) },
      NOW,
    ),
  );
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

describe("the room's revision", () => {
  it("a new room's first plan save makes its revision 1, and the next day's reset 2", async () => {
    const { zoneId } = await LONG_TABLE();
    expect(await zoneRevisionOf(v, zoneId)).toBe(1);

    await onNextDay(async () => {
      await readFloor(NEXT_DAY);
      expect(await zoneRevisionOf(v, zoneId)).toBe(2);
    });
  });

  it("is 0 for a room with no today's plan", async () => {
    expect(await inTx(v, (tx) => roomRevision(tx, v.tables.zoneId))).toBe(0);
  });

  it("consecutive floor reads with a reset still pending leave the revision as it is", async () => {
    const { zoneId, table, master } = await LONG_TABLE();
    await seat(v, table.bar!);
    await resave(zoneId, (tables) =>
      tables.map((t) => (t.id === master.bar ? { ...t, label: `${t.label} b` } : t)),
    );
    await resetToSaved(zoneId);
    const revision = (await zoneRevisionOf(v, zoneId))!;

    await readFloor();
    expect(await zoneRevisionOf(v, zoneId)).toBe(revision);
    await readFloor();
    expect(await zoneRevisionOf(v, zoneId)).toBe(revision);
  });

  it("a catch-up that only hides a table moves the revision by one", async () => {
    const { zoneId, table, master } = await LONG_TABLE();
    const { partyId } = await seat(v, table.bar!);
    await resave(zoneId, (tables) => tables.filter((t) => t.id !== master.bar));
    await resetToSaved(zoneId);
    expect(await todayRow(v, table.bar!)).toBeDefined();
    const revision = (await zoneRevisionOf(v, zoneId))!;
    await finish(partyId);

    await readFloor();

    expect(await todayRow(v, table.bar!)).toBeUndefined();
    expect(await zoneRevisionOf(v, zoneId)).toBe(revision + 1);
  });

  it("one floor read catching up two rooms moves only the room its catch-up changed, by one", async () => {
    const held = await LONG_TABLE();
    await seat(v, held.table.bar!);
    await resave(held.zoneId, (tables) =>
      tables.map((t) => (t.id === held.master.bar ? { ...t, label: `${t.label} b` } : t)),
    );
    await resetToSaved(held.zoneId);
    const freed = await LONG_TABLE();
    const { partyId } = await seat(v, freed.table.bar!);
    await resave(freed.zoneId, (tables) => tables.filter((t) => t.id !== freed.master.bar));
    await resetToSaved(freed.zoneId);
    const heldRevision = (await zoneRevisionOf(v, held.zoneId))!;
    const freedRevision = (await zoneRevisionOf(v, freed.zoneId))!;
    await finish(partyId);

    await readFloor();

    expect(await todayRow(v, freed.table.bar!)).toBeUndefined();
    expect(await zoneRevisionOf(v, freed.zoneId)).toBe(freedRevision + 1);
    expect(await zoneRevisionOf(v, held.zoneId)).toBe(heldRevision);
  });

  it("a new day's reset whose catch-up also renames a table moves the revision by exactly one", async () => {
    const { zoneId, table, master } = await LONG_TABLE();
    const renamed = `${(await tableRow(v, table.bar!)).label} b`;
    await resave(zoneId, (tables) =>
      tables.map((t) => (t.id === master.bar ? { ...t, label: renamed } : t)),
    );
    expect((await tableRow(v, table.bar!)).label).not.toBe(renamed);
    const revision = (await zoneRevisionOf(v, zoneId))!;

    await onNextDay(async () => {
      await readFloor(NEXT_DAY);
      expect((await tableRow(v, table.bar!)).label).toBe(renamed);
      expect(await zoneRevisionOf(v, zoneId)).toBe(revision + 1);
    });
  });
});

describe("roomPrints", () => {
  it("prints a zone with no tables as an empty list", async () => {
    const { zoneId } = await plannedZone(v, [], NOW);
    expect(await printOf(zoneId)).toBe("[]");
  });

  it("differs after a table moves, and not after it is placed where it stands", async () => {
    const { zoneId, table } = await LONG_TABLE();
    const before = await printOf(zoneId);

    await inTx(v, (tx) => moveToday(tx, v.cfg, table.bar!, { x: 40, y: 0 }));
    expect(await printOf(zoneId)).toBe(before);

    await inTx(v, (tx) => moveToday(tx, v.cfg, table.bar!, { x: 50, y: 0 }));
    expect(await printOf(zoneId)).not.toBe(before);
  });

  it("differs after a group's seats change", async () => {
    const { zoneId, table } = await LONG_TABLE();
    await inTx(v, (tx) =>
      writeMerge(tx, v.cfg, {
        movingId: table.bar!,
        targetId: table.long!,
        side: "left",
        seats: 14,
        free: true,
      }),
    );
    expect(await todayRow(v, table.bar!)).toMatchObject({ x: 8, y: 20 });
    const before = await printOf(zoneId);
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await inTx(v, (tx) =>
      tx.update(floorTodayJoins).set({ seats: 12 }).where(eq(floorTodayJoins.id, joinId)),
    );

    expect(await printOf(zoneId)).not.toBe(before);
  });

  it("a table's name changes the room's print; writing the same name again does not", async () => {
    const { zoneId, table } = await LONG_TABLE();
    const before = await printOf(zoneId);
    const name = `Window seat ${randomUUID().slice(0, 6)}`;
    const nameBar = () =>
      inTx(v, (tx) =>
        tx.update(floorTodayTables).set({ name }).where(eq(floorTodayTables.tableId, table.bar!)),
      );

    await nameBar();
    const named = await printOf(zoneId);
    expect(named).not.toBe(before);

    await nameBar();
    expect(await printOf(zoneId)).toBe(named);
  });

  it("a group's name changes the print of the room holding it", async () => {
    const { zoneId, table } = await LONG_TABLE();
    await inTx(v, (tx) =>
      writeMerge(tx, v.cfg, {
        movingId: table.bar!,
        targetId: table.long!,
        side: "left",
        seats: 14,
        free: true,
      }),
    );
    const before = await printOf(zoneId);
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await inTx(v, (tx) =>
      tx
        .update(floorTodayJoins)
        .set({ name: `García birthday ${randomUUID().slice(0, 6)}` })
        .where(eq(floorTodayJoins.id, joinId)),
    );

    expect(await printOf(zoneId)).not.toBe(before);
  });

  it("differs after a split row is written", async () => {
    const { zoneId, table } = await LONG_TABLE();
    await inTx(v, (tx) =>
      splitJoinedTable(tx, v.cfg, { tableId: table.long!, partIds: [table.c5!], seats: 6 }),
    );
    expect(await todayRow(v, table.c5!)).toMatchObject({ x: 14, y: 20, width: 2, height: 2 });
    const before = await printOf(zoneId);

    await splitOffRow(v, table.long!, table.c4!);

    expect(await printOf(zoneId)).not.toBe(before);
  });

  it("answers one print per zone asked for", async () => {
    const one = await LONG_TABLE();
    const two = await LONG_TABLE();
    const prints = await inTx(v, (tx) => roomPrints(tx, v.cfg, [one.zoneId, two.zoneId]));
    expect([...prints.keys()].sort()).toEqual([one.zoneId, two.zoneId].sort());
    expect(prints.get(one.zoneId)).toBe(await printOf(one.zoneId));
    expect(prints.get(one.zoneId)).not.toBe(prints.get(two.zoneId));
  });
});

describe("moving rooms", () => {
  it("moveChangedRooms moves only the zones whose prints differ", async () => {
    const one = await LONG_TABLE();
    const two = await LONG_TABLE();
    const zones = [one.zoneId, two.zoneId];
    const moved = await inTx(v, async (tx) => {
      const revisions = await roomRevisions(tx, zones);
      const before = await roomPrints(tx, v.cfg, zones);
      await moveToday(tx, v.cfg, one.table.bar!, { x: 50, y: 0 });
      const after = await roomPrints(tx, v.cfg, zones);
      return moveChangedRooms(tx, revisions, before, after);
    });

    expect(moved).toEqual(new Map([[one.zoneId, 2]]));
    expect(await zoneRevisionOf(v, one.zoneId)).toBe(2);
    expect(await zoneRevisionOf(v, two.zoneId)).toBe(1);
  });

  it("moveChangedRooms leaves out a changed zone that has no today's plan to move", async () => {
    const { zoneId } = await LONG_TABLE();
    const bare = v.tables.zoneId;
    const moved = await inTx(v, (tx) =>
      moveChangedRooms(
        tx,
        new Map([
          [zoneId, 1],
          [bare, 0],
        ]),
        new Map([
          [zoneId, "before"],
          [bare, "before"],
        ]),
        new Map([
          [zoneId, "after"],
          [bare, "after"],
        ]),
      ),
    );

    expect(moved).toEqual(new Map([[zoneId, 2]]));
    expect(await zoneRevisionOf(v, zoneId)).toBe(2);
    expect(await inTx(v, (tx) => roomRevision(tx, bare))).toBe(0);
  });

  it("moveRoom sets the revision one past where the request found it, once", async () => {
    const { zoneId } = await LONG_TABLE();
    expect(await inTx(v, (tx) => moveRoom(tx, zoneId, 1))).toBe(2);
    expect(await inTx(v, (tx) => moveRoom(tx, zoneId, 1))).toBe(2);
    expect(await zoneRevisionOf(v, zoneId)).toBe(2);
  });

  it("moveRoom leaves a room with no today's plan at what it was", async () => {
    expect(await inTx(v, (tx) => moveRoom(tx, v.tables.zoneId, 0))).toBe(0);
    expect(await inTx(v, (tx) => roomRevision(tx, v.tables.zoneId))).toBe(0);
  });

  it("roomRevisions answers each zone asked for, 0 for one with no today's plan", async () => {
    const { zoneId } = await LONG_TABLE();
    const revisions = await inTx(v, (tx) => roomRevisions(tx, [zoneId, v.tables.zoneId]));
    expect(revisions).toEqual(
      new Map([
        [zoneId, 1],
        [v.tables.zoneId, 0],
      ]),
    );
  });

  it("zonesOf answers each zone of the tables once", async () => {
    const one = await LONG_TABLE();
    const two = await LONG_TABLE();
    const zones = await inTx(v, (tx) =>
      zonesOf(tx, v.cfg, [one.table.bar!, one.table.long!, two.table.c3!]),
    );
    expect(zones.sort()).toEqual([one.zoneId, two.zoneId].sort());
  });
});

describe("sentRevision", () => {
  it("answers undefined when the body carries none", () => {
    expect(sentRevision({})).toBeUndefined();
  });

  it.each([0, 7, Number.MAX_SAFE_INTEGER])("answers %s", (value) => {
    expect(sentRevision({ zoneRevision: value })).toBe(value);
  });

  it.each([-1, 1.5, "3", null, Number.MAX_SAFE_INTEGER + 1])("refuses %s", (value) => {
    let error: unknown;
    try {
      sentRevision({ zoneRevision: value });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("management.request_invalid");
    expect((error as AppError).params).toEqual({ field: "zoneRevision" });
  });
});
