import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorTodayJoins, floorTodaySplitParts, floorTodayTables } from "@waitron/db";
import type { AppError } from "@waitron/shared";
import { writeMerge } from "./floor-today-merges.js";
import { nameToday, sameName } from "./floor-today-name.js";
import { resetTable } from "./floor-today-reset-table.js";
import { splitJoinedTable } from "./floor-today-split.js";
import { splitOff } from "./floor-today-split-group.js";
import { ensureToday, resetZone, takeOffToday } from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { finishTable } from "./parties.js";
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

/** Long table (10 seats) = Counter 3 (2), 4 (6) and 5 (4), each kept 2 × 2; Bar (4 seats). */
async function LONG_TABLE() {
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
  ]);
  for (const key of ["c3", "c4", "c5"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

const suffixed = (name: string) => `${name} ${randomUUID().slice(0, 6)}`;

const rename = (tableId: string, name: string | null) =>
  inTx(v, (tx) => nameToday(tx, v.cfg, tableId, name));

const pushBarOntoLong = (table: Record<string, string>) =>
  inTx(v, (tx) =>
    writeMerge(tx, v.cfg, {
      movingId: table.bar!,
      targetId: table.long!,
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
    tables: await tx.select().from(floorTodayTables),
    joins: await tx.select().from(floorTodayJoins),
  }));
}

async function groupName(tableId: string): Promise<string | null | undefined> {
  const merge = await mergeOf(v, tableId);
  if (merge === null) return undefined;
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorTodayJoins).where(eq(floorTodayJoins.id, merge.joinId)),
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

  it("names a joined table in no group, and a table split off it, on their own rows", async () => {
    const { table } = await LONG_TABLE();
    const long = suffixed("Long feast");
    await rename(table.long!, long);
    expect((await todayRow(v, table.long!))!.name).toBe(long);

    await inTx(v, (tx) =>
      splitJoinedTable(tx, v.cfg, { tableId: table.long!, partIds: [table.c5!], seats: 8 }),
    );
    const c5 = suffixed("Corner");
    await rename(table.c5!, c5);

    expect((await todayRow(v, table.c5!))!.name).toBe(c5);
    expect((await todayRow(v, table.long!))!.name).toBe(long);
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
      tx.update(floorTodayTables).set({ name }).where(eq(floorTodayTables.tableId, tableId)),
    );

  it("a table", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Window");
    await rename(table.bar!, name);
    await writeName(table.long!, name);
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
    const label = (await labelOf(table.long!)).toUpperCase();
    const before = await everything();

    expect(await refused(rename(table.bar!, label))).toEqual({
      code: "table.label_taken",
      params: { label, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("a saved name of a table the map does not show", async () => {
    const { table } = await LONG_TABLE();
    const label = await labelOf(table.c3!);
    const before = await everything();

    expect(await refused(rename(table.bar!, label))).toEqual({
      code: "table.label_taken",
      params: { label, field: "name" },
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
      params: { label, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("another shown table's today's name", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Window");
    await rename(table.long!, name);
    const before = await everything();

    expect(await refused(rename(table.bar!, name))).toEqual({
      code: "table.label_taken",
      params: { label: name, field: "name" },
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
      params: { label: name, field: "name" },
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
      params: { label, field: "name" },
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
      params: { label: name, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("the same name in capitals with an accent, either way round", async () => {
    const suffix = randomUUID().slice(0, 6);
    const lower = `García birthday ${suffix}`;
    const upper = `GARCÍA BIRTHDAY ${suffix.toUpperCase()}`;
    for (const [taken, asked] of [
      [lower, upper],
      [upper, lower],
    ] as const) {
      const { table } = await LONG_TABLE();
      await rename(table.long!, taken);
      const before = await everything();

      expect(await refused(rename(table.bar!, asked))).toEqual({
        code: "table.label_taken",
        params: { label: asked, field: "name" },
      });
      expect(await everything()).toEqual(before);
      await rename(table.long!, null);
    }
  });

  it("a taken-off table's today's name", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Window");
    await rename(table.bar!, name);
    await inTx(v, (tx) => takeOffToday(tx, v.cfg, table.bar!));
    const before = await everything();

    expect(await refused(rename(table.long!, name))).toEqual({
      code: "table.label_taken",
      params: { label: name, field: "name" },
    });
    expect(await everything()).toEqual(before);
  });

  it("but not a stale name left on a still-joined part", async () => {
    const { table } = await LONG_TABLE();
    const name = suffixed("Stale");
    await inTx(v, (tx) =>
      tx.update(floorTodayTables).set({ name }).where(eq(floorTodayTables.tableId, table.c3!)),
    );

    await rename(table.bar!, name);

    expect((await todayRow(v, table.bar!))!.name).toBe(name);
  });
});

describe("nameToday ignores a stale name on a joined table off the map", () => {
  it("Long table, come apart into a group", async () => {
    const first = await LONG_TABLE();
    await pushBarOntoLong(first.table);
    const name = suffixed("Stale");
    await inTx(v, (tx) =>
      tx
        .update(floorTodayTables)
        .set({ name })
        .where(eq(floorTodayTables.tableId, first.table.long!)),
    );
    const { table } = await LONG_TABLE();

    await rename(table.bar!, name);

    expect((await todayRow(v, table.bar!))!.name).toBe(name);
  });
});

describe("nameToday refuses a table the map does not offer", () => {
  it("a table taken off", async () => {
    const { table } = await LONG_TABLE();
    await inTx(v, (tx) => takeOffToday(tx, v.cfg, table.bar!));
    const before = await everything();

    expect(await refused(rename(table.bar!, suffixed("Window")))).toEqual({
      code: "table.taken_off",
      params: { tableId: table.bar! },
    });
    expect(await everything()).toEqual(before);
  });

  it("a table still joined in a joined table", async () => {
    const { table } = await LONG_TABLE();
    const before = await everything();

    expect(await refused(rename(table.c3!, suffixed("Window")))).toEqual({
      code: "table.in_joined_table",
      params: { tableId: table.c3! },
    });
    expect(await everything()).toEqual(before);
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

describe("a reset clears today's name", () => {
  const REMOVALS = enabledTableRemovals(ALL_MODULES);
  const DAY = 24 * 60 * 60 * 1000;

  const nameOf = async (tableId: string) => (await todayRow(v, tableId))!.name;
  const resetRoom = (zoneId: string, now = new Date()) =>
    inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, now));
  const newDay = (now: Date) => inTx(v, (tx) => ensureToday(tx, v.cfg, REMOVALS, now));
  const finish = async (partyId: string) => {
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) => finishTable(tx, { partyId, ...command }));
  };
  const splitOffLong = (table: Record<string, string>, partIds: string[], seats: number) =>
    inTx(v, (tx) => splitJoinedTable(tx, v.cfg, { tableId: table.long!, partIds, seats }));
  const leftOn = (tableId: string, name: string) =>
    inTx(v, (tx) =>
      tx.update(floorTodayTables).set({ name }).where(eq(floorTodayTables.tableId, tableId)),
    );
  const splitRowsOf = async (joinedTableId: string) =>
    (
      await inTx(v, (tx) =>
        tx
          .select({ partId: floorTodaySplitParts.partTableId })
          .from(floorTodaySplitParts)
          .where(eq(floorTodaySplitParts.joinedTableId, joinedTableId)),
      )
    ).map((row) => row.partId);
  const joinRow = (joinId: string) =>
    inTx(v, (tx) => tx.select().from(floorTodayJoins).where(eq(floorTodayJoins.id, joinId)));

  it("Reset to saved plan clears a free table's name and moves the revision (reset clears)", async () => {
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
    const { table, zoneId } = await LONG_TABLE();
    await rename(table.bar!, suffixed("Window"));
    await pushBarOntoLong(table);
    await rename(table.bar!, suffixed("García birthday"));
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await resetRoom(zoneId);

    expect(await joinRow(joinId)).toEqual([]);
    for (const key of ["bar", "c3", "c4", "c5"]) {
      expect(await nameOf(table[key]!), key).toBeNull();
    }
  });

  it("a new business day clears a free table's name (reset clears)", async () => {
    const { table } = await LONG_TABLE();
    await rename(table.bar!, suffixed("Window"));

    await newDay(new Date(Date.now() + DAY));

    expect(await nameOf(table.bar!)).toBeNull();
  });

  it("Reset table clears the joined table's name and the name of a table it takes back (reset clears)", async () => {
    const { table } = await LONG_TABLE();
    await splitOffLong(table, [table.c5!], 6);
    await rename(table.c5!, suffixed("Corner"));
    await rename(table.long!, suffixed("Long window"));

    await inTx(v, (tx) =>
      resetTable(tx, v.cfg, REMOVALS, new Date(), {
        tableId: table.long!,
        partIds: [table.c5!],
        seats: null,
      }),
    );

    expect(await nameOf(table.c5!)).toBeNull();
    expect(await nameOf(table.long!)).toBeNull();
  });

  it("Split tables… on a group that puts Long table back clears its tables' names and ends the group (reset clears)", async () => {
    const { table } = await LONG_TABLE();
    await rename(table.long!, suffixed("Long window"));
    await pushBarOntoLong(table);
    await rename(table.bar!, suffixed("García birthday"));
    for (const key of ["c3", "c4", "c5"]) await leftOn(table[key]!, suffixed("Left"));
    const { joinId } = (await mergeOf(v, table.bar!))!;

    await inTx(v, (tx) =>
      splitOff(tx, v.cfg, REMOVALS, new Date(), {
        tableId: table.bar!,
        partIds: [table.bar!],
        seats: null,
      }),
    );

    expect(await joinRow(joinId)).toEqual([]);
    for (const key of ["long", "c3", "c4", "c5"]) {
      expect(await nameOf(table[key]!), key).toBeNull();
    }
  });

  it("a part the catch-up takes back into Long table loses its name, which is then free (reset clears)", async () => {
    const { table, zoneId } = await LONG_TABLE();
    const { partyId } = await seat(v, table.long!);
    await resetRoom(zoneId);
    await splitOffLong(table, [table.c5!], 6);
    const corner = suffixed("Corner");
    await rename(table.c5!, corner);

    await finish(partyId);
    await newDay(new Date());

    expect(await splitRowsOf(table.long!)).toEqual([]);
    expect(await nameOf(table.c5!)).toBeNull();
    await rename(table.bar!, corner);
    expect(await nameOf(table.bar!)).toBe(corner);
  });
});
