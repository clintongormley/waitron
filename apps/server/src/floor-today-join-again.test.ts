import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorTodaySplitParts,
  floorTodayTables,
  joinedOutOfService,
  joinedTableApart,
  workingOrders,
} from "@waitron/db";
import type { AppError } from "@waitron/shared";
import { writeMerge } from "./floor-today-merges.js";
import { foodOnItsWay } from "./delivery-release.js";
import { moveToday, resetZone, seatsToday, takeOffToday } from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { splitJoinedTable } from "./floor-today-split.js";
import { joinAgain } from "./floor-today-join-again.js";
import {
  counterOrder,
  inTx,
  partyAt,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { giveKeptSize, mergeOf, plannedZone, todayRow } from "./testing/floor-today-venue.js";
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
const REMOVALS = enabledTableRemovals(ALL_MODULES);

/** Long table (10 seats, 6 × 2 at 10, 20) made of Counter 3 (2 × 2 kept), 4 (2 × 2 kept) and 5 (no kept size), and Bar placed. */
async function LONG_PLUS_BAR() {
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

const join = (tableId: string, partIds: string[], seats: number | null = null) =>
  inTx(v, (tx) => joinAgain(tx, v.cfg, REMOVALS, NOW, { tableId, partIds, seats }));

async function splitRows(): Promise<{ joinedTableId: string; partTableId: string }[]> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({
        joinedTableId: floorTodaySplitParts.joinedTableId,
        partTableId: floorTodaySplitParts.partTableId,
      })
      .from(floorTodaySplitParts),
  );
  return rows.sort((a, b) => a.partTableId.localeCompare(b.partTableId));
}

async function splitRowsOf(joinedTableId: string): Promise<string[]> {
  return (await splitRows())
    .filter((row) => row.joinedTableId === joinedTableId)
    .map((row) => row.partTableId)
    .sort();
}

async function setPlace(
  tableId: string,
  place: {
    x: number | null;
    y: number | null;
    width: number | null;
    height: number | null;
    shape: "rect" | null;
    rotation: number | null;
  },
): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(floorTodayTables).set(place).where(eq(floorTodayTables.tableId, tableId)),
  );
}

async function apart(tableId: string): Promise<number | null> {
  const rows = await v.db.all<{ id: string; named: number | null }>(
    sql`select dt.id, ${joinedTableApart(sql`dt.id`)} as named from dining_tables dt`,
  );
  return rows.find((row) => row.id === tableId)!.named;
}

async function out(tableId: string): Promise<number | null> {
  const rows = await v.db.all<{ id: string; named: number | null }>(
    sql`select dt.id, ${joinedOutOfService(sql`dt.id`)} as named from dining_tables dt`,
  );
  return rows.find((row) => row.id === tableId)!.named;
}

async function everything() {
  const today = await inTx(v, (tx) =>
    tx.select().from(floorTodayTables).orderBy(asc(floorTodayTables.id)),
  );
  return { today, split: await splitRows() };
}

async function refusalOf(work: Promise<unknown>): Promise<AppError | null> {
  return (await work.then(
    () => null,
    (thrown: unknown) => thrown,
  )) as AppError | null;
}

const UNPLACED = {
  x: null,
  y: null,
  width: null,
  height: null,
  shape: null,
  rotation: null,
};

type Tables = Record<string, string>;

/** Long table with Counter 5 split off at 6 seats. */
async function c5SplitOff(): Promise<Tables> {
  const { table } = await LONG_PLUS_BAR();
  await split(table.long!, [table.c5!], 6);
  return table;
}

/** Long table come apart: Counter 4 and 5 split off, no party, so Counter 3 is split off too. */
async function cameApart(): Promise<Tables> {
  const { table } = await LONG_PLUS_BAR();
  await split(table.long!, [table.c4!, table.c5!], null);
  return table;
}

describe("joining split-off tables again when every one is free", () => {
  it("puts Counter 5 back into Long table: Counter 5 leaves the map, Long table is whole at its saved size and seats", async () => {
    const table = await c5SplitOff();

    await join(table.long!, [table.c5!]);

    expect(await todayRow(v, table.c5!)).toMatchObject({
      ...UNPLACED,
      seats: 4,
      takenOff: false,
    });
    expect(await out(table.c5!)).toBe(1);
    expect(await todayRow(v, table.long!)).toMatchObject({
      x: 10,
      y: 20,
      width: 6,
      height: 2,
      seats: 10,
      takenOff: false,
    });
    expect(await splitRowsOf(table.long!)).toEqual([]);
  });

  it("gives a table taken back its own saved seats", async () => {
    const table = await c5SplitOff();
    await inTx(v, (tx) => seatsToday(tx, v.cfg, table.c5!, 6));

    await join(table.long!, [table.c5!]);

    expect(await todayRow(v, table.c5!)).toMatchObject({ seats: 4 });
  });

  it("keeps where staff moved Long table", async () => {
    const table = await c5SplitOff();
    await inTx(v, (tx) => moveToday(tx, v.cfg, table.long!, { x: 15, y: 25 }));

    await join(table.long!, [table.c5!]);

    expect(await todayRow(v, table.long!)).toMatchObject({ x: 15, y: 25, width: 6, height: 2 });
  });

  it("brings Long table back at its saved place once it has come apart", async () => {
    const table = await cameApart();

    await join(table.long!, [table.c3!, table.c4!, table.c5!]);

    expect(await todayRow(v, table.long!)).toMatchObject({
      x: 10,
      y: 20,
      width: 6,
      height: 2,
      seats: 10,
    });
    for (const id of [table.c3!, table.c4!, table.c5!]) expect(await out(id)).toBe(1);
    expect(await splitRowsOf(table.long!)).toEqual([]);
    expect(await apart(table.long!)).toBe(0);
  });

  it("brings Long table back on the map at its saved place when it was taken off, not where it stood", async () => {
    const table = await c5SplitOff();
    await inTx(v, (tx) => moveToday(tx, v.cfg, table.long!, { x: 15, y: 25 }));
    await inTx(v, (tx) => takeOffToday(tx, v.cfg, table.long!));

    await join(table.long!, [table.c5!]);

    expect(await todayRow(v, table.long!)).toMatchObject({
      x: 10,
      y: 20,
      width: 6,
      height: 2,
      takenOff: false,
      seats: 10,
    });
  });

  it.each<[string, (table: Tables) => Promise<void>]>([
    [
      "took off",
      async (table) => {
        await inTx(v, (tx) =>
          tx
            .update(floorTodayTables)
            .set({ takenOff: true })
            .where(eq(floorTodayTables.tableId, table.c5!)),
        );
      },
    ],
    ["made an unplaced spare", (table) => setPlace(table.c5!, UNPLACED)],
  ])("takes back a table split off that an older till %s", async (_name, setup) => {
    const table = await c5SplitOff();
    await setup(table);

    await join(table.long!, [table.c5!]);

    expect(await todayRow(v, table.c5!)).toMatchObject({ takenOff: false, x: null });
    expect(await out(table.c5!)).toBe(1);
  });

  it("leaves every other table as it was", async () => {
    const table = await c5SplitOff();
    const bar = await todayRow(v, table.bar!);

    await join(table.long!, [table.c5!]);

    expect(await todayRow(v, table.bar!)).toEqual(bar);
  });

  it.each<
    [
      string,
      () => Promise<{
        target: string;
        partIds: string[];
        seats?: number;
        params?: Record<string, unknown>;
      }>,
      string,
    ]
  >([
    [
      "a table that is not a joined table",
      async () => {
        const { table } = await LONG_PLUS_BAR();
        return { target: table.bar!, partIds: [table.c5!] };
      },
      "joined_table.not_found",
    ],
    [
      "a joined table with nothing split off",
      async () => {
        const { table } = await LONG_PLUS_BAR();
        return { target: table.long!, partIds: [table.c5!] };
      },
      "joined_table.nothing_to_join",
    ],
    [
      "a table split off that guests sit at",
      async () => {
        const table = await c5SplitOff();
        await seat(v, table.c5!);
        return { target: table.long!, partIds: [table.c5!] };
      },
      "joined_table.nothing_to_join",
    ],
    [
      "a table split off that needs clearing",
      async () => {
        const table = await c5SplitOff();
        await inTx(v, (tx) =>
          tx
            .update(diningTables)
            .set({ needsClearingSince: new Date().toISOString() })
            .where(eq(diningTables.id, table.c5!)),
        );
        return { target: table.long!, partIds: [table.c5!] };
      },
      "joined_table.nothing_to_join",
    ],
    [
      "a table split off that is pushed together with Bar",
      async () => {
        const table = await c5SplitOff();
        await inTx(v, (tx) =>
          writeMerge(tx, v.cfg, {
            movingId: table.c5!,
            targetId: table.bar!,
            side: "right",
            seats: 8,
            free: true,
          }),
        );
        return { target: table.long!, partIds: [table.c5!] };
      },
      "joined_table.nothing_to_join",
    ],
    [
      "a table split off that food is on its way to",
      async () => {
        const table = await c5SplitOff();
        const order = await counterOrder(v, "Paella");
        await inTx(v, (tx) =>
          tx
            .update(workingOrders)
            .set({ deliveryTableId: table.c5! })
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
        return { target: table.long!, partIds: [table.c5!] };
      },
      "joined_table.nothing_to_join",
    ],
    [
      "parts that are not the ones free",
      async () => {
        const table = await c5SplitOff();
        return { target: table.long!, partIds: [table.c4!] };
      },
      "joined_table.out_of_date",
    ],
    [
      "a table that came apart, one of its tables left out",
      async () => {
        const table = await cameApart();
        return { target: table.long!, partIds: [table.c4!, table.c5!] };
      },
      "joined_table.out_of_date",
    ],
    [
      "some staying apart and no seats",
      async () => {
        const table = await cameApart();
        await seat(v, table.c3!);
        return { target: table.long!, partIds: [table.c4!, table.c5!], params: {} };
      },
      "joined_table.seats_required",
    ],
    [
      "the guests' table named as coming back",
      async () => {
        const table = await cameApart();
        await seat(v, table.c3!);
        return { target: table.long!, partIds: [table.c3!, table.c4!, table.c5!], seats: 8 };
      },
      "joined_table.out_of_date",
    ],
  ])("refuses %s, writing nothing", async (_name, setup, code) => {
    const { target, partIds, seats, params } = await setup();
    const before = await everything();

    const error = await refusalOf(join(target, partIds, seats ?? null));

    expect(error?.code).toBe(code);
    expect(error?.params).toEqual(params ?? { tableId: target });
    expect(await everything()).toEqual(before);
  });

  it("a second Join again finds nothing to join", async () => {
    const table = await c5SplitOff();
    await join(table.long!, [table.c5!]);
    const before = await everything();

    const error = await refusalOf(join(table.long!, [table.c5!]));

    expect(error?.code).toBe("joined_table.nothing_to_join");
    expect(error?.params).toEqual({ tableId: table.long! });
    expect(await everything()).toEqual(before);
  });
});

/** Long table (8 seats, 8 × 2 at 10, 20) made of Counter 3, 4, 5 and 6, each 2 seats kept 2 × 2. */
async function LONG4() {
  const zone = await plannedZone(
    v,
    [
      { key: "c3", label: "Counter 3", seats: 2, place: null },
      { key: "c4", label: "Counter 4", seats: 2, place: null },
      { key: "c5", label: "Counter 5", seats: 2, place: null },
      { key: "c6", label: "Counter 6", seats: 2, place: null },
      {
        key: "long",
        label: "Long table",
        seats: 8,
        place: { x: 10, y: 20, width: 8, height: 2 },
        partKeys: ["c3", "c4", "c5", "c6"],
      },
    ],
    NOW,
  );
  for (const key of ["c3", "c4", "c5", "c6"]) {
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  }
  return zone;
}

describe("joining split-off tables again while some stay apart", () => {
  it("brings Long table back over Counter 4 and 5 while the guests passed to Counter 3 stay", async () => {
    const { table } = await LONG_PLUS_BAR();
    const { partyId } = await seat(v, table.long!);
    await split(table.long!, [table.c4!, table.c5!], null);
    const c3Before = await todayRow(v, table.c3!);

    await join(table.long!, [table.c4!, table.c5!], 8);

    expect(await todayRow(v, table.long!)).toMatchObject({
      x: 12,
      y: 20,
      width: 10,
      height: 2,
      seats: 8,
      takenOff: false,
    });
    expect(await apart(table.long!)).toBe(0);
    expect(await out(table.long!)).toBe(0);
    for (const id of [table.c4!, table.c5!]) {
      expect(await todayRow(v, id)).toMatchObject(UNPLACED);
      expect(await out(id)).toBe(1);
    }
    expect(await todayRow(v, table.c3!)).toEqual(c3Before);
    expect(await partyAt(v, table.c3!)).toBe(partyId);
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!]);
  });

  it("spans a table left apart between two that come back", async () => {
    const table = await cameApart();
    const { partyId } = await seat(v, table.c4!);
    const c4Before = await todayRow(v, table.c4!);

    await join(table.long!, [table.c3!, table.c5!], 8);

    expect(await todayRow(v, table.long!)).toMatchObject({
      x: 10,
      y: 20,
      width: 12,
      height: 2,
      seats: 8,
    });
    expect(await todayRow(v, table.c4!)).toEqual(c4Before);
    expect(await splitRowsOf(table.long!)).toEqual([table.c4!]);
    expect(await partyAt(v, table.c4!)).toBe(partyId);
  });

  it("brings back the tables free while Long table still stands", async () => {
    const { table } = await LONG4();
    await split(table.long!, [table.c6!], 6);
    expect(await todayRow(v, table.long!)).toMatchObject({ x: 10, y: 20, width: 6, height: 2 });
    await split(table.long!, [table.c5!], 4);
    expect(await todayRow(v, table.long!)).toMatchObject({ x: 10, y: 20, width: 4, height: 2 });
    expect(await todayRow(v, table.c5!)).toMatchObject({ x: 14, y: 20 });
    const { partyId } = await seat(v, table.c5!);
    await inTx(v, (tx) => moveToday(tx, v.cfg, table.long!, { x: 15, y: 25 }));
    const c5Before = await todayRow(v, table.c5!);

    await join(table.long!, [table.c6!], 8);

    expect(await todayRow(v, table.long!)).toMatchObject({
      x: 15,
      y: 25,
      width: 8,
      height: 2,
      seats: 8,
    });
    expect(await todayRow(v, table.c6!)).toMatchObject(UNPLACED);
    expect(await todayRow(v, table.c5!)).toEqual(c5Before);
    expect(c5Before).toMatchObject({ x: 14, y: 20 });
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
    expect(await partyAt(v, table.c5!)).toBe(partyId);
  });

  it("Join again after Reset to saved plan leaves the tables taken back joined and Long table in service", async () => {
    const { table, zoneId } = await LONG_PLUS_BAR();
    await seat(v, table.long!);
    await split(table.long!, [table.c4!, table.c5!], null);
    await inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW));

    await join(table.long!, [table.c4!, table.c5!], 8);

    expect(await out(table.c4!)).toBe(1);
    expect(await out(table.c5!)).toBe(1);
    expect(await apart(table.long!)).toBe(0);
    expect(await todayRow(v, table.long!)).toMatchObject({
      x: 12,
      y: 20,
      width: 10,
      height: 2,
      seats: 8,
    });
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!]);
  });

  it("keeps the guests and the merge at Long table", async () => {
    const { table } = await LONG_PLUS_BAR();
    await inTx(v, (tx) =>
      writeMerge(tx, v.cfg, {
        movingId: table.long!,
        targetId: table.bar!,
        side: "right",
        seats: 14,
        free: true,
      }),
    );
    const { partyId } = await seat(v, table.long!);
    await split(table.long!, [table.c5!], 6);
    const revision = await revisionOf(v, partyId);
    const merge = await mergeOf(v, table.long!);

    await join(table.long!, [table.c5!]);

    expect(await partyAt(v, table.long!)).toBe(partyId);
    expect(await revisionOf(v, partyId)).toBe(revision);
    expect(await mergeOf(v, table.long!)).toEqual(merge);
  });

  it("the second of two tills is refused once guests sit at a table it expected back", async () => {
    const table = await cameApart();
    await seat(v, table.c5!);
    const before = await everything();

    const error = await refusalOf(join(table.long!, [table.c3!, table.c4!, table.c5!]));

    expect(error?.code).toBe("joined_table.out_of_date");
    expect(error?.params).toEqual({ tableId: table.long! });
    expect(await everything()).toEqual(before);

    await join(table.long!, [table.c3!, table.c4!], 6);

    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
    expect(await todayRow(v, table.long!)).toMatchObject({ seats: 6 });
  });
});
