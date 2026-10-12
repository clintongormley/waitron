import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  floorTodaySplitParts,
  floorTodayTables,
  joinedTableApart,
  workingOrders,
} from "@waitron/db";
import type { AppError } from "@waitron/shared";
import { writeMerge } from "./floor-today-merges.js";
import { foodOnItsWay } from "./delivery-release.js";
import { backToSaved, moveToday, takeOffToday } from "./floor-today-store.js";
import { splitJoinedTable } from "./floor-today-split.js";
import {
  counterOrder,
  inTx,
  pay,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  giveKeptSize,
  mergeOf,
  plannedZone,
  splitOffRow,
  todayRow,
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

async function everything() {
  const today = await inTx(v, (tx) =>
    tx.select().from(floorTodayTables).orderBy(asc(floorTodayTables.id)),
  );
  return { today, split: await splitRows() };
}

describe("splitting parts off a joined table", () => {
  it("splits Counter 5 off Long table: Counter 5 stands at its own size past Long table's right edge, and Long table covers Counter 3 and 4 with the seats asked", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c5!], 6);

    expect(await todayRow(v, table.c5!)).toMatchObject({
      x: 14,
      y: 17,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
      takenOff: false,
      seats: 4,
    });
    expect(await todayRow(v, table.long!)).toMatchObject({
      x: 10,
      y: 20,
      width: 4,
      height: 2,
      seats: 6,
    });
    expect(await splitRowsOf(table.long!)).toEqual([table.c5!]);
  });

  it("splits Counter 4 from between 3 and 5, and Long table still spans all three slots", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c4!], 6);

    expect(await todayRow(v, table.c4!)).toMatchObject({ x: 12, y: 20, width: 2, height: 2 });
    expect(await todayRow(v, table.long!)).toMatchObject({ x: 10, width: 12 });
    expect(await splitRowsOf(table.long!)).toEqual([table.c4!]);
  });

  it("keeps a part already split off where staff moved it at a later split", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c5!], 8);
    await inTx(v, (tx) => moveToday(tx, v.cfg, table.c5!, { x: 60, y: 60 }));
    const longAfterFirst = await todayRow(v, table.long!);

    await split(table.long!, [table.c4!], null);

    expect(await todayRow(v, table.c5!)).toMatchObject({ x: 60, y: 60 });
    expect(await todayRow(v, table.c4!)).toMatchObject({ x: 12, y: 20 });
    expect(await todayRow(v, table.c3!)).toMatchObject({ x: 10, y: 20 });
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
    expect(await todayRow(v, table.long!)).toEqual(longAfterFirst);
  });

  it("works a later split from where Long table stands now", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c5!], 8);
    await inTx(v, (tx) => moveToday(tx, v.cfg, table.long!, { x: 15, y: 25 }));

    await split(table.long!, [table.c4!], null);

    expect(await todayRow(v, table.c3!)).toMatchObject({ x: 15, y: 25 });
    expect(await todayRow(v, table.c4!)).toMatchObject({ x: 17, y: 25 });
  });

  it("lays out a later split from the slot of the first part still joined, once Counter 3 is split off", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c3!], 10);
    expect(await todayRow(v, table.long!)).toMatchObject({ x: 12, y: 20, width: 10 });

    await split(table.long!, [table.c5!], null);

    expect(await todayRow(v, table.c4!)).toMatchObject({ x: 12, y: 20 });
    expect(await todayRow(v, table.c5!)).toMatchObject({ x: 14, y: 17 });
  });

  it("lays out a part that kept a place on today's map from before", async () => {
    const { table } = await LONG_PLUS_BAR();
    await setPlace(table.c4!, {
      x: 70,
      y: 70,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
    });

    await split(table.long!, [table.c4!], 6);

    expect(await todayRow(v, table.c4!)).toMatchObject({ x: 12, y: 20, width: 2, height: 2 });
  });

  it("leaves Long table out of service once it is split down to one part", async () => {
    const { table } = await LONG_PLUS_BAR();
    const longBefore = await todayRow(v, table.long!);

    await split(table.long!, [table.c4!, table.c5!], null);

    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
    expect(await todayRow(v, table.long!)).toEqual(longBefore);
    expect(await apart(table.long!)).toBe(1);
    await expect(seat(v, table.long!)).rejects.toMatchObject({
      code: "table.in_joined_table",
      params: { tableId: table.long! },
    });
  });

  type Zone = Awaited<ReturnType<typeof LONG_PLUS_BAR>>;
  type Row = [
    string,
    (z: Zone) => Promise<void>,
    (z: Zone) => { tableId: string; partIds: string[]; seats: number | null },
    (z: Zone) => { code: string; params: Record<string, unknown> },
  ];
  const nothing = async () => {};
  const t = (z: Zone, key: string) => z.table[key]!;

  it.each<Row>([
    [
      "a table that is not a joined table",
      nothing,
      (z) => ({ tableId: t(z, "bar"), partIds: [t(z, "c5")], seats: 6 }),
      (z) => ({ code: "joined_table.not_found", params: { tableId: t(z, "bar") } }),
    ],
    [
      "Long table taken off today",
      (z) => inTx(v, (tx) => takeOffToday(tx, v.cfg, t(z, "long"))),
      (z) => ({ tableId: t(z, "long"), partIds: [t(z, "c5")], seats: 6 }),
      (z) => ({ code: "table.taken_off", params: { tableId: t(z, "long") } }),
    ],
    [
      "Long table with no place today",
      (z) =>
        setPlace(t(z, "long"), {
          x: null,
          y: null,
          width: null,
          height: null,
          shape: null,
          rotation: null,
        }),
      (z) => ({ tableId: t(z, "long"), partIds: [t(z, "c5")], seats: 6 }),
      (z) => ({ code: "table.not_on_today_plan", params: { tableId: t(z, "long") } }),
    ],
    [
      "a part already split off",
      (z) => split(t(z, "long"), [t(z, "c5")], 8),
      (z) => ({ tableId: t(z, "long"), partIds: [t(z, "c5")], seats: 6 }),
      (z) => ({
        code: "joined_table.part_invalid",
        params: { tableId: t(z, "c5"), field: "partIds" },
      }),
    ],
    [
      "a table that is no part of Long table",
      nothing,
      (z) => ({ tableId: t(z, "long"), partIds: [t(z, "bar")], seats: 6 }),
      (z) => ({
        code: "joined_table.part_invalid",
        params: { tableId: t(z, "bar"), field: "partIds" },
      }),
    ],
    [
      "every part still joined",
      nothing,
      (z) => ({
        tableId: t(z, "long"),
        partIds: [t(z, "c3"), t(z, "c4"), t(z, "c5")],
        seats: null,
      }),
      (z) => ({
        code: "joined_table.split_all",
        params: { tableId: t(z, "long"), field: "partIds" },
      }),
    ],
    [
      "two or more left with no seats",
      nothing,
      (z) => ({ tableId: t(z, "long"), partIds: [t(z, "c5")], seats: null }),
      () => ({ code: "joined_table.seats_required", params: {} }),
    ],
    [
      "Long table once it has come apart",
      async (z) => {
        await splitOffRow(v, t(z, "long"), t(z, "c4"));
        await splitOffRow(v, t(z, "long"), t(z, "c5"));
      },
      (z) => ({ tableId: t(z, "long"), partIds: [t(z, "c3")], seats: null }),
      (z) => ({ code: "table.in_joined_table", params: { tableId: t(z, "long") } }),
    ],
    [
      "down to one part while a party holds it",
      async (z) => {
        await seat(v, t(z, "long"));
      },
      (z) => ({ tableId: t(z, "long"), partIds: [t(z, "c4"), t(z, "c5")], seats: null }),
      (z) => ({ code: "tab.already_open", params: { tableId: t(z, "long") } }),
    ],
  ])("refuses %s, writing nothing", async (_name, setup, args, expected) => {
    const zone = await LONG_PLUS_BAR();
    await setup(zone);
    const before = await everything();
    const { tableId, partIds, seats } = args(zone);

    const error = (await split(tableId, partIds, seats).then(
      () => null,
      (thrown: unknown) => thrown,
    )) as AppError | null;

    expect(error).not.toBeNull();
    const want = expected(zone);
    expect(error!.code).toBe(want.code);
    expect(error!.params).toEqual(want.params);
    expect(await everything()).toEqual(before);
  });

  it("the second of two splits naming the same part is refused", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c5!], 6);
    const before = await everything();

    const error = (await split(table.long!, [table.c5!], 6).then(
      () => null,
      (thrown: unknown) => thrown,
    )) as AppError | null;

    expect(error?.code).toBe("joined_table.part_invalid");
    expect(error?.params).toEqual({ tableId: table.c5!, field: "partIds" });
    expect(await everything()).toEqual(before);
  });
});

async function refusalOf(work: Promise<unknown>): Promise<AppError | null> {
  return (await work.then(
    () => null,
    (thrown: unknown) => thrown,
  )) as AppError | null;
}

const mergeLongOntoBar = (table: Record<string, string>) =>
  inTx(v, (tx) =>
    writeMerge(tx, v.cfg, {
      movingId: table.long!,
      targetId: table.bar!,
      side: "right",
      seats: 14,
      free: true,
    }),
  );

describe("splitting a joined table down to one part", () => {
  it("a split down to one ends Long table's merge first, putting both tables back where they stood", async () => {
    const { table } = await LONG_PLUS_BAR();
    const barBefore = await todayRow(v, table.bar!);
    await mergeLongOntoBar(table);
    expect(await todayRow(v, table.long!)).not.toMatchObject({ x: 10, y: 20 });

    await split(table.long!, [table.c4!, table.c5!], null);

    expect(await mergeOf(v, table.long!)).toBeNull();
    expect(await mergeOf(v, table.bar!)).toBeNull();
    expect(await todayRow(v, table.long!)).toMatchObject({ x: 10, y: 20, rotation: 0 });
    expect(await todayRow(v, table.bar!)).toEqual(barBefore);
    expect(await todayRow(v, table.c3!)).toMatchObject({ x: 10, y: 20, width: 2, height: 2 });
    expect(await splitRowsOf(table.long!)).toEqual([table.c3!, table.c4!, table.c5!].sort());
    expect(await apart(table.long!)).toBe(1);
  });

  it("refuses a split down to one while a party holds Long table's merge", async () => {
    const { table } = await LONG_PLUS_BAR();
    await mergeLongOntoBar(table);
    await seat(v, table.long!);
    const before = { ...(await everything()), merge: await mergeOf(v, table.long!) };

    const error = await refusalOf(split(table.long!, [table.c4!, table.c5!], null));

    expect(error?.code).toBe("tab.already_open");
    expect(error?.params).toEqual({ tableId: [table.long!, table.bar!].sort()[0] });
    expect({ ...(await everything()), merge: await mergeOf(v, table.long!) }).toEqual(before);
  });

  it("splits parts off a merged Long table while two stay, leaving the merge as it is", async () => {
    const { table } = await LONG_PLUS_BAR();
    await mergeLongOntoBar(table);
    const mergeBefore = await mergeOf(v, table.long!);
    const longBefore = await todayRow(v, table.long!);

    await split(table.long!, [table.c5!], 6);

    expect(await mergeOf(v, table.long!)).toEqual(mergeBefore);
    expect(await todayRow(v, table.long!)).toMatchObject({
      x: longBefore!.x,
      y: longBefore!.y,
      width: 4,
      height: 2,
      seats: 6,
    });
  });

  it("refuses a split down to one while food is on its way to Long table", async () => {
    const { table } = await LONG_PLUS_BAR();
    const order = await counterOrder(v, "Paella");
    await inTx(v, (tx) =>
      tx
        .update(workingOrders)
        .set({ deliveryTableId: table.long! })
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
    const before = await everything();

    const error = await refusalOf(split(table.long!, [table.c4!, table.c5!], null));

    expect(error?.code).toBe("table.delivery_pending");
    expect(error?.params).toEqual({ tableId: table.long! });
    expect(await everything()).toEqual(before);
  });
});

describe("Back to its saved place on a joined table", () => {
  it("refuses Back to its saved place on Long table while a part is split off", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c5!], 6);
    const longBefore = await todayRow(v, table.long!);

    const error = await refusalOf(inTx(v, (tx) => backToSaved(tx, v.cfg, table.long!)));

    expect(error?.code).toBe("joined_table.parts_split_off");
    expect(error?.params).toEqual({ tableId: table.long! });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);

    await inTx(v, (tx) => moveToday(tx, v.cfg, table.bar!, { x: 60, y: 60 }));
    await inTx(v, (tx) => backToSaved(tx, v.cfg, table.bar!));
    expect(await todayRow(v, table.bar!)).toMatchObject({ x: 40, y: 0 });
  });
});
