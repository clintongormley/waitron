import { floorLabelSuffix } from "./testing/floor-label.js";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { tableMerges, todayColumns, todaySet, diningTables } from "@waitron/db";
import type { AppError } from "@waitron/shared";
import { writeMerge } from "./floor-today-merges.js";
import { markMoved } from "./floor-today-mark-moved.js";
import { nameToday, sameName } from "./floor-today-name.js";
import { splitOff } from "./floor-today-split-group.js";
import {
  backToSaved,
  ensureToday,
  moveToday,
  putBackToday,
  resetZone,
  rotateToday,
  seatsToday,
  takeOffToday,
} from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { finishTable, partyRevision } from "./testing/party-close-fixture.js";
import { moveGuests, splitTable } from "./testing/table-action-fixture.js";
import {
  commandFor,
  inTx,
  OPERATOR,
  partyAt,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  giveKeptSize,
  mergeOf,
  plannedZone,
  type PlannedEntry,
  todayRow,
  zoneRevisionOf,
  withSplitPartyReads,
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

/** Long table (10 seats) = Counter 3 (2), 4 (6) and 5 (4), each kept 2 × 2; Bar (4 seats). */
async function LONG_TABLE(more: PlannedEntry[] = []) {
  const zone = await plannedZone(v, [
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
    ...more,
  ]);
  for (const key of ["c3", "c4", "c5"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

const REMOVALS = enabledTableRemovals(ALL_MODULES);

const suffixed = (name: string) => `${name} ${floorLabelSuffix()}`;

const rename = (tableId: string, name: string | null) =>
  inTx(v, (tx) => nameToday(tx, v.cfg, tableId, name));

const pushBarOntoLong = (table: Record<string, string>) =>
  inTx(v, (tx) =>
    writeMerge(tx, v.cfg, {
      movingId: table.bar!,
      targetId: table.c3!,
      side: "left",
      seats: 12,
      free: true,
    }),
  );

async function refusalOf(work: Promise<unknown>): Promise<AppError | null> {
  return (await work.then(
    () => null,
    (thrown: unknown) => thrown,
  )) as AppError | null;
}

async function refused(work: Promise<unknown>): Promise<{ code: string; params: unknown }> {
  const error = await refusalOf(work);
  return { code: error?.code ?? "none", params: error?.params };
}

async function everything() {
  return inTx(v, async (tx) => ({
    tables: await tx.select(todayColumns).from(diningTables).where(eq(diningTables.onFloor, true)),
    joins: await tx.select().from(tableMerges),
  }));
}

async function groupName(tableId: string): Promise<string | null | undefined> {
  const merge = await mergeOf(v, tableId);
  if (merge === null) return undefined;
  const [row] = await inTx(v, (tx) =>
    tx.select().from(tableMerges).where(eq(tableMerges.id, merge.joinId)),
  );
  return row!.name;
}

async function labelOf(tableId: string): Promise<string> {
  return (await tableRow(v, tableId)).label;
}

describe("nameToday", () => {
  it("names a single table on its own row and touches no group", async () => {
    const { table } = await LONG_TABLE();
    const joinsBefore = (await everything()).joins;
    const name = suffixed("Window");

    await rename(table.bar!, name);

    expect((await todayRow(v, table.bar!))!.name).toBe(name);
    expect((await everything()).joins).toEqual(joinsBefore);
  });

  it("names the group, not the member, when the table is in one", async () => {
    const { table } = await LONG_TABLE();
    await pushBarOntoLong(table);
    const name = suffixed("García birthday");

    await rename(table.c4!, name);

    expect(await groupName(table.bar!)).toBe(name);
    for (const key of ["bar", "c3", "c4", "c5"]) {
      expect((await todayRow(v, table[key]!))!.name).toBeNull();
    }
  });

  it("names a saved group and a table split off it separately", async () => {
    const { table } = await LONG_TABLE();
    const long = suffixed("Long feast");
    await rename(table.c3!, long);
    expect(await groupName(table.c3!)).toBe(long);

    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, new Date(), {
        expectedParties: [],
        tableId: table.c3!,
        partIds: [table.c5!],
        seats: 8,
      }),
    );
    const c5 = suffixed("Corner");
    await rename(table.c5!, c5);

    expect((await todayRow(v, table.c5!))!.name).toBe(c5);
    expect(await groupName(table.c3!)).toBe(long);
  });

  it("clears a name with null", async () => {
    const { table } = await LONG_TABLE();
    await rename(table.bar!, suffixed("Window"));

    await rename(table.bar!, null);

    expect((await todayRow(v, table.bar!))!.name).toBeNull();
  });

  it("stores null for a table renamed to its own saved name", async () => {
    const { table } = await LONG_TABLE();
    await rename(table.bar!, suffixed("Window"));

    await rename(table.bar!, await labelOf(table.bar!));

    expect((await todayRow(v, table.bar!))!.name).toBeNull();
  });

  it("trims a name and clears it when only spaces are left", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Window");
    await rename(table.bar!, `  ${name}  `);
    expect((await todayRow(v, table.bar!))!.name).toBe(name);

    await rename(table.bar!, "   ");

    expect((await todayRow(v, table.bar!))!.name).toBeNull();
  });

  it("refuses a name over 40 characters", async () => {
    const { table } = await LONG_TABLE();
    const before = await everything();

    expect(await refused(rename(table.bar!, "x".repeat(41)))).toEqual({
      code: "management.request_invalid",
      params: { field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("writes nothing when the name is the one it already has", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Window");
    await rename(table.bar!, name);
    await pushBarOntoLong(table);
    const group = suffixed("Group");
    await rename(table.c3!, group);
    const before = await everything();

    await rename(table.c4!, group);

    expect(await everything()).toEqual(before);
  });

  it("writes nothing when a table with no name is cleared", async () => {
    const { table } = await LONG_TABLE();
    const before = await everything();

    await rename(table.bar!, null);

    expect(await everything()).toEqual(before);
  });
});

describe("nameToday leaves a name it already has alone, even when another table shares it", () => {
  const writeName = (tableId: string, name: string) =>
    inTx(v, (tx) =>
      tx.update(diningTables).set(todaySet({ name })).where(eq(diningTables.id, tableId)),
    );

  it("a table", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Window");
    await rename(table.bar!, name);
    await writeName(table.c3!, name);
    const before = await everything();

    await rename(table.bar!, name);

    expect(await everything()).toEqual(before);
  });

  it("a group", async () => {
    const { table } = await LONG_TABLE();
    await pushBarOntoLong(table);
    const name = suffixed("García birthday");
    await rename(table.c4!, name);
    await writeName(table.c3!, name);
    const before = await everything();

    await rename(table.c4!, name);

    expect(await everything()).toEqual(before);
  });
});

describe("nameToday refuses a name in use, writing nothing", () => {
  it("another table's saved name, in other capitals", async () => {
    const { table } = await LONG_TABLE();
    const label = (await labelOf(table.c3!)).toUpperCase();
    const before = await everything();

    expect(await refused(rename(table.bar!, label))).toEqual({
      code: "table.label_taken",
      params: { todayName: label, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("a saved name of a table the map does not show", async () => {
    const { table } = await LONG_TABLE();
    const label = await labelOf(table.c3!);
    const before = await everything();

    expect(await refused(rename(table.bar!, label))).toEqual({
      code: "table.label_taken",
      params: { todayName: label, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("a saved name of a table in another zone", async () => {
    const other = await LONG_TABLE();
    const { table } = await LONG_TABLE();
    const label = await labelOf(other.table.bar!);
    const before = await everything();

    expect(await refused(rename(table.bar!, label))).toEqual({
      code: "table.label_taken",
      params: { todayName: label, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("another shown table's today's name", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Window");
    await rename(table.c3!, name);
    const before = await everything();

    expect(await refused(rename(table.bar!, name))).toEqual({
      code: "table.label_taken",
      params: { todayName: name, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("another group's today's name", async () => {
    const first = await LONG_TABLE();
    await pushBarOntoLong(first.table);
    const name = suffixed("García birthday");
    await rename(first.table.bar!, name);
    const { table } = await LONG_TABLE();
    const before = await everything();

    expect(await refused(rename(table.bar!, name))).toEqual({
      code: "table.label_taken",
      params: { todayName: name, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("a group renamed to one of its own members' saved names", async () => {
    const { table } = await LONG_TABLE();
    await pushBarOntoLong(table);
    const label = await labelOf(table.c3!);
    const before = await everything();

    expect(await refused(rename(table.c4!, label))).toEqual({
      code: "table.label_taken",
      params: { todayName: label, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("a group renamed to one of its own members' today's names", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Window");
    await rename(table.bar!, name);
    await pushBarOntoLong(table);
    const before = await everything();

    expect(await refused(rename(table.c4!, name))).toEqual({
      code: "table.label_taken",
      params: { todayName: name, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("the same name in capitals with an accent, either way round", async () => {
    const suffix = floorLabelSuffix();
    const lower = `García birthday ${suffix}`;
    const upper = `GARCÍA BIRTHDAY ${suffix}`;
    for (const [taken, asked] of [
      [lower, upper],
      [upper, lower],
    ] as const) {
      const { table } = await LONG_TABLE();
      await rename(table.c3!, taken);
      const before = await everything();

      expect(await refused(rename(table.bar!, asked))).toEqual({
        code: "table.label_taken",
        params: { todayName: asked, field: "name" },
      });
      expect(await everything()).toEqual(before);
      await rename(table.c3!, null);
    }
  });

  it("a taken-off table's today's name", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Window");
    await rename(table.bar!, name);
    await inTx(v, (tx) => takeOffToday(tx, table.bar!));
    const before = await everything();

    expect(await refused(rename(table.c3!, name))).toEqual({
      code: "table.label_taken",
      params: { todayName: name, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("a name retained on a real group member", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Stale");
    await inTx(v, (tx) =>
      tx.update(diningTables).set(todaySet({ name })).where(eq(diningTables.id, table.c3!)),
    );

    await expect(rename(table.bar!, name)).rejects.toMatchObject({
      code: "table.label_taken",
      params: { todayName: name, field: "name" },
    });
  });
});

describe("nameToday refuses a table the map does not offer", () => {
  it("a table taken off", async () => {
    const { table } = await LONG_TABLE();
    await inTx(v, (tx) => takeOffToday(tx, table.bar!));
    const before = await everything();

    expect(await refused(rename(table.bar!, suffixed("Window")))).toEqual({
      code: "table.taken_off",
      params: { tableId: table.bar! },
    });
    expect(await everything()).toEqual(before);
  });

  it("a saved group's real member can name the group", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Window");
    await rename(table.c3!, name);
    expect(await groupName(table.c3!)).toBe(name);
    expect((await todayRow(v, table.c3!))!.name).toBeNull();
  });
});

describe("sameName", () => {
  it("ignores capitals, accented ones included", () => {
    expect(sameName("Í", "í")).toBe(true);
    expect(sameName("GARCÍA", "garcía")).toBe(true);
  });

  it("matches the composed and decomposed spellings of one name", () => {
    const composed = "García".normalize("NFC");
    const decomposed = "García".normalize("NFD");
    expect(composed.length).not.toBe(decomposed.length);
    expect(sameName(composed, decomposed)).toBe(true);
  });

  it("keeps an accent apart from the plain letter", () => {
    expect(sameName("Garcia", "García")).toBe(false);
  });
});

describe("what moves, ends or keeps today's name", () => {
  const REMOVALS = enabledTableRemovals(ALL_MODULES);
  const MORE: PlannedEntry[] = [
    { key: "window", label: "Window", seats: 2, place: { x: 60, y: 0, width: 2, height: 2 } },
    { key: "c6", label: "Counter 6", seats: 2, place: { x: 80, y: 0, width: 2, height: 2 } },
    { key: "t9", label: "Table 9", seats: 4, place: { x: 100, y: 0, width: 2, height: 2 } },
  ];

  /** Snug (6 seats) = Counter 7 (2) and Counter 8 (4), each kept 2 × 2. */
  const nameOf = async (tableId: string) => (await todayRow(v, tableId))!.name;
  const joinRow = (joinId: string) =>
    inTx(v, (tx) => tx.select().from(tableMerges).where(eq(tableMerges.id, joinId)));
  const leftOn = (tableId: string, name: string) =>
    inTx(v, (tx) =>
      tx.update(diningTables).set(todaySet({ name })).where(eq(diningTables.id, tableId)),
    );
  const push = (movingId: string, targetId: string, seats: number) =>
    inTx(v, (tx) => writeMerge(tx, v.cfg, { movingId, targetId, side: "left", seats, free: true }));
  const moveGuestsTo = (partyId: string, toTableId: string) =>
    inTx(v, async (tx) => {
      await moveGuests(tx, v.cfg, partyId, toTableId, {
        expectedPartyRevision: await partyRevision(tx, partyId),
        operatorId: OPERATOR,
        otherPartyId: null,
      });
    });

  it("Bar pushed onto a renamed Long table: the group takes Long's name, Long's own goes, Bar keeps its own (moves)", async () => {
    const { table } = await LONG_TABLE();
    const long = suffixed("Long window");
    const bar = suffixed("Window");
    await rename(table.c3!, long);
    await rename(table.bar!, bar);

    await pushBarOntoLong(table);

    expect(await groupName(table.bar!)).toBe(long);
    expect(await nameOf(table.c3!)).toBeNull();
    expect(await nameOf(table.bar!)).toBe(bar);
  });

  it("a renamed Long table split down to Counter 5 loses its name, and Counter 5 keeps its own (moves)", async () => {
    const { table } = await LONG_TABLE();
    await rename(table.c3!, suffixed("Long window"));
    const corner = suffixed("Corner");
    await leftOn(table.c5!, corner);

    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, new Date(), {
        expectedParties: [],
        tableId: table.c3!,
        partIds: [table.c3!, table.c4!],
        seats: null,
      }),
    );

    expect(await mergeOf(v, table.c3!)).toBeNull();
    expect(await nameOf(table.c5!)).toBe(corner);
  });

  it("Back to saved place on Bar in a group of two ends the group Pair (ends)", async () => {
    const { table } = await LONG_TABLE(MORE);
    await push(table.window!, table.bar!, 6);
    await rename(table.bar!, suffixed("Pair"));
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await inTx(v, (tx) => backToSaved(tx, v.cfg, [], table.bar!, new Date()));

    expect(await joinRow(joinId)).toEqual([]);
  });

  it("the party's Split a table on one table of a seated group of two ends the group (ends)", async () => {
    const { table } = await LONG_TABLE(MORE);
    await push(table.window!, table.bar!, 6);
    await rename(table.bar!, suffixed("Pair"));
    const { joinId } = (await mergeOf(v, table.bar!))!;
    const { partyId } = await seat(v, table.bar!);

    await inTx(v, async (tx) => {
      const expectedPartyRevision = await partyRevision(tx, partyId);
      await splitTable(tx, v.cfg, partyId, table.window!, null, {
        expectedPartyRevision,
        operatorId: OPERATOR,
      });
    });

    expect(await joinRow(joinId)).toEqual([]);
  });

  it("Move guests keeping only part of their group of two ends the group (ends)", async () => {
    const { table } = await LONG_TABLE(MORE);
    await push(table.window!, table.bar!, 6);
    await rename(table.bar!, suffixed("Pair"));
    const { joinId } = (await mergeOf(v, table.bar!))!;
    const { partyId } = await seat(v, table.bar!);

    await moveGuestsTo(partyId, table.bar!);

    expect(await joinRow(joinId)).toEqual([]);
  });

  it("Split tables… on a group leaving one table ends the group, and that table's own name stands (ends)", async () => {
    const { table } = await LONG_TABLE(MORE);
    const bar = suffixed("Window");
    await rename(table.bar!, bar);
    await push(table.window!, table.bar!, 6);
    await rename(table.bar!, suffixed("Pair"));
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, new Date(), {
        expectedParties: [],
        tableId: table.bar!,
        partIds: [table.window!],
        seats: null,
      }),
    );

    expect(await joinRow(joinId)).toEqual([]);
    expect(await nameOf(table.bar!)).toBe(bar);
  });

  it("the group García birthday keeps its name when Split tables… takes only Bar and three stay (keeps)", async () => {
    const { table } = await LONG_TABLE(MORE);
    await push(table.window!, table.bar!, 6);
    await push(table.c6!, table.bar!, 8);
    await push(table.t9!, table.bar!, 12);
    const group = suffixed("García birthday");
    await rename(table.bar!, group);

    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, new Date(), {
        expectedParties: [],
        tableId: table.bar!,
        partIds: [table.bar!],
        seats: 8,
      }),
    );

    expect(await mergeOf(v, table.bar!)).toBeNull();
    expect(await groupName(table.window!)).toBe(group);
  });

  it("the group García birthday keeps its name when Counter 6 is pushed onto it (keeps)", async () => {
    const { table } = await LONG_TABLE(MORE);
    await push(table.window!, table.bar!, 6);
    const group = suffixed("García birthday");
    await rename(table.bar!, group);

    await push(table.c6!, table.bar!, 8);

    expect(await groupName(table.c6!)).toBe(group);
  });

  it("Window keeps its name through Back to saved place, taking off and putting back, a move, a turn and new seats (keeps)", async () => {
    const { table } = await LONG_TABLE(MORE);
    const window = suffixed("Window");
    await rename(table.window!, window);

    await inTx(v, (tx) => backToSaved(tx, v.cfg, [], table.window!, new Date()));
    expect(await nameOf(table.window!)).toBe(window);
    await inTx(v, (tx) => takeOffToday(tx, table.window!));
    await inTx(v, (tx) => putBackToday(tx, table.window!));
    expect(await nameOf(table.window!)).toBe(window);
    await inTx(v, (tx) => moveToday(tx, table.window!, { x: 64, y: 4 }));
    await inTx(v, (tx) => rotateToday(tx, table.window!));
    await inTx(v, (tx) => seatsToday(tx, table.window!, 3));
    expect(await nameOf(table.window!)).toBe(window);
  });

  it("a renamed Long table keeps its name when Counter 5 is split off and two stay (keeps)", async () => {
    const { table } = await LONG_TABLE();
    const long = suffixed("Long window");
    await rename(table.c3!, long);

    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, new Date(), {
        expectedParties: [],
        tableId: table.c3!,
        partIds: [table.c5!],
        seats: 8,
      }),
    );

    expect(await groupName(table.c3!)).toBe(long);
  });

  it("Move guests from the group García birthday to Table 9 leaves the group, free, with its name (keeps)", async () => {
    const { table } = await LONG_TABLE(MORE);
    await push(table.window!, table.bar!, 6);
    const group = suffixed("García birthday");
    await rename(table.bar!, group);
    const { partyId } = await seat(v, table.bar!);

    await moveGuestsTo(partyId, table.t9!);

    expect(await partyAt(v, table.bar!)).toBeNull();
    expect(await groupName(table.bar!)).toBe(group);
  });
});

describe("a reset clears today's name", () => {
  const REMOVALS = enabledTableRemovals(ALL_MODULES);

  const nameOf = async (tableId: string) => (await todayRow(v, tableId))!.name;
  const resetRoom = (zoneId: string, now = new Date()) =>
    inTx(v, (tx) => resetZone(tx, REMOVALS, zoneId, now, "due"));
  const newDay = (now: Date) => inTx(v, (tx) => ensureToday(tx, REMOVALS, now));
  const finish = async (partyId: string) => {
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) => finishTable(tx, { partyId, ...command }));
  };
  const splitOffLong = async (table: Record<string, string>, partIds: string[], seats: number) => {
    const args = (await withSplitPartyReads(v, `/api/tables/${table.c3!}/today/split-off`, {
      tableId: table.c3!,
      partIds,
      seats,
    })) as Parameters<typeof splitOff>[4];
    return inTx(v, (tx) => splitOff(tx, v.cfg, REMOVALS, new Date(), args));
  };
  const leftOn = (tableId: string, name: string) =>
    inTx(v, (tx) =>
      tx.update(diningTables).set(todaySet({ name })).where(eq(diningTables.id, tableId)),
    );
  const joinRow = (joinId: string) =>
    inTx(v, (tx) => tx.select().from(tableMerges).where(eq(tableMerges.id, joinId)));

  it("Reset to {set} plan clears a free table's name and moves the revision (reset clears)", async () => {
    const { table, zoneId } = await LONG_TABLE();
    await rename(table.bar!, suffixed("Window"));
    const before = (await zoneRevisionOf(v, zoneId))!;

    await resetRoom(zoneId);

    expect(await nameOf(table.bar!)).toBeNull();
    expect(await zoneRevisionOf(v, zoneId)).toBe(before + 1);
  });

  it("a table with guests keeps its name until the party finishes and it is put back (reset clears)", async () => {
    const { table, zoneId } = await LONG_TABLE();
    const { partyId } = await seat(v, table.bar!);
    const name = suffixed("Window");
    await rename(table.bar!, name);

    await resetRoom(zoneId);
    expect(await nameOf(table.bar!)).toBe(name);

    await finish(partyId);
    await newDay(new Date());

    expect(await nameOf(table.bar!)).toBeNull();
  });

  it("a free group's row goes, and every member's name with it (reset clears)", async () => {
    const { table, zoneId } = await LONG_TABLE([{ key: "window", place: { x: 80, y: 0 } }]);
    await rename(table.bar!, suffixed("Window"));
    await inTx(v, (tx) =>
      writeMerge(tx, v.cfg, {
        movingId: table.window!,
        targetId: table.bar!,
        side: "left",
        seats: 8,
        free: true,
      }),
    );
    await rename(table.bar!, suffixed("García birthday"));
    for (const key of ["window"]) await leftOn(table[key]!, suffixed("Left"));
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await resetRoom(zoneId);

    expect(await joinRow(joinId)).toEqual([]);
    for (const key of ["bar", "window"]) {
      expect(await nameOf(table[key]!), key).toBeNull();
    }
  });

  it("Split tables… leaves the remaining ordinary group and its name intact", async () => {
    const { table } = await LONG_TABLE();
    await rename(table.c3!, suffixed("Long window"));
    const window = suffixed("Window");
    await rename(table.bar!, window);
    await pushBarOntoLong(table);
    const group = suffixed("García birthday");
    await rename(table.bar!, group);
    for (const key of ["c3", "c4", "c5"]) await leftOn(table[key]!, suffixed("Left"));
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, new Date(), {
        expectedParties: [],
        tableId: table.bar!,
        partIds: [table.bar!],
        seats: 10,
      }),
    );

    expect(await joinRow(joinId)).toMatchObject([{ name: group }]);
    expect(await mergeOf(v, table.bar!)).toBeNull();
    expect(await nameOf(table.bar!)).toBe(window);
  });

  it("a part a reset takes back into Long table once its guests leave loses its name, which is then free (reset clears)", async () => {
    const { table, zoneId } = await LONG_TABLE();
    const { partyId } = await seat(v, table.c3!);
    await resetRoom(zoneId);
    await splitOffLong(table, [table.c5!], 6);
    const corner = suffixed("Corner");
    await rename(table.c5!, corner);

    await finish(partyId);
    await resetRoom(zoneId);

    expect((await mergeOf(v, table.c3!))!.members.map((m) => m.tableId).sort()).toEqual(
      [table.c3!, table.c4!, table.c5!].sort(),
    );
    expect(await nameOf(table.c5!)).toBeNull();
    await rename(table.bar!, corner);
    expect(await nameOf(table.bar!)).toBe(corner);
  });

  it("a part Mark moved takes back into Long table once its guests leave loses its name, which is then free", async () => {
    const { table, zoneId } = await LONG_TABLE();
    const { partyId } = await seat(v, table.c3!);
    await resetRoom(zoneId);
    await splitOffLong(table, [table.c5!], 6);
    const corner = suffixed("Corner");
    await rename(table.c5!, corner);
    await finish(partyId);
    await inTx(v, (tx) => ensureToday(tx, REMOVALS, new Date()));
    expect(await mergeOf(v, table.c5!)).toBeNull();
    expect(await nameOf(table.c5!)).toBe(corner);

    await inTx(v, (tx) => markMoved(tx, REMOVALS, table.c3!, new Date()));

    expect((await mergeOf(v, table.c3!))!.members.map((m) => m.tableId).sort()).toEqual(
      [table.c3!, table.c4!, table.c5!].sort(),
    );
    expect(await nameOf(table.c5!)).toBeNull();
    await rename(table.bar!, corner);
    expect(await nameOf(table.bar!)).toBe(corner);
  });

  it.each([
    ["2026-10-24T02:32:00Z", "2026-10-23", "2026-10-24T03:00:00Z", "2026-10-24"],
    ["2026-10-24T03:09:08Z", "2026-10-24", "2026-10-25T04:00:00Z", "2026-10-25"],
    ["2026-10-24T03:21:57Z", "2026-10-24", "2026-10-25T04:00:00Z", "2026-10-25"],
    ["2026-03-28T04:21:57Z", "2026-03-28", "2026-03-29T03:00:00Z", "2026-03-29"],
    ["2026-10-23T03:21:57Z", "2026-10-23", "2026-10-24T03:00:00Z", "2026-10-24"],
    ["2026-10-25T04:21:57Z", "2026-10-25", "2026-10-26T04:00:00Z", "2026-10-26"],
  ])(
    "a new business day clears a free table's name (reset clears) from %s",
    async (at, day, boundary, nextDay) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(at));
      try {
        const { table } = await LONG_TABLE();
        const name = suffixed("Window");
        await rename(table.bar!, name);

        vi.setSystemTime(new Date(new Date(boundary).getTime() - 1));
        expect(await newDay(new Date())).toBe(day);
        expect(await nameOf(table.bar!)).toBe(name);

        vi.setSystemTime(new Date(boundary));
        expect(await newDay(new Date())).toBe(nextDay);
        expect(await nameOf(table.bar!)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

it("reserves the saved group name after splitting, while its remaining group may restore it", async () => {
  const { table } = await LONG_TABLE();
  const saved = (await groupName(table.c3!))!;
  await inTx(v, (tx) =>
    splitOff(tx, v.cfg, REMOVALS, new Date(), {
      tableId: table.c3!,
      partIds: [table.c5!],
      seats: 6,
      expectedParties: [],
    }),
  );
  await rename(table.c3!, suffixed("Dinner"));
  await rename(table.c3!, saved);
  expect(await groupName(table.c3!)).toBe(saved);
  await inTx(v, (tx) =>
    splitOff(tx, v.cfg, REMOVALS, new Date(), {
      tableId: table.c3!,
      partIds: [table.c4!],
      seats: null,
      expectedParties: [],
    }),
  );
  expect(await refused(rename(table.bar!, saved))).toEqual({
    code: "table.label_taken",
    params: { todayName: saved, field: "name" },
  });
});
