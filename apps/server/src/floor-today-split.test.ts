import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { randomUUID } from "node:crypto";
import {
  diningTables,
  floorTodaySplitParts,
  floorTodayTables,
  joinedTableApart,
  tableServiceStatuses,
  workingOrders,
} from "@waitron/db";
import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";
import type { AppError } from "@waitron/shared";
import { writeMerge } from "./floor-today-merges.js";
import { foodOnItsWay } from "./delivery-release.js";
import {
  backToSaved,
  moveToday,
  putBackToday,
  resetZone,
  takeOffToday,
} from "./floor-today-store.js";
import { readLayout, saveLayout, type ZonePlanSave } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { partsOf } from "./floor-today-parts.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { splitJoinedTable } from "./floor-today-split.js";
import { finishTable } from "./parties.js";
import { joinTables } from "./table-actions.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  commandFor,
  counterOrder,
  inTx,
  order,
  partyAt,
  partyRow,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  giveKeptSize,
  plannedZone,
  setsDepartment,
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

  it("splits Counter 5 at the size the saved plan places it at, once the owner has taken it out of Long table there and placed it", async () => {
    const { zoneId, table, master } = await LONG_PLUS_BAR();
    await inTx(v, async (tx) => {
      const plan = await readLayout(tx, v.cfg, await defaultLayout(tx, v.cfg, zoneId));
      const tables = plan.tables.map((t) => ({
        id: t.id,
        key: t.id,
        label: t.label,
        seats: t.seats,
        fixed: t.fixed,
        placement:
          t.id === master.c5
            ? { x: 50, y: 50, width: 3, height: 4, shape: "rect" as const, rotation: 0 }
            : t.placement,
        partKeys: t.partIds.filter((id) => id !== master.c5),
      }));
      await saveLayout(
        tx,
        v.cfg,
        enabledTableRemovals(ALL_MODULES),
        await defaultLayout(tx, v.cfg, zoneId),
        { revision: plan.revision, tables },
        NOW,
      );
    });

    await split(table.long!, [table.c5!], 6);

    expect(await todayRow(v, table.c5!)).toMatchObject({ x: 14, y: 19, width: 3, height: 4 });
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
      "Long table itself as a part",
      nothing,
      (z) => ({ tableId: t(z, "long"), partIds: [t(z, "long")], seats: 6 }),
      (z) => ({
        code: "joined_table.part_invalid",
        params: { tableId: t(z, "long"), field: "partIds" },
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

describe("splitting a joined table down to one part", () => {
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

    const error = await refusalOf(
      inTx(v, (tx) => backToSaved(tx, v.cfg, [], table.long!, new Date())),
    );

    expect(error?.code).toBe("joined_table.parts_split_off");
    expect(error?.params).toEqual({ tableId: table.long! });
    expect(await todayRow(v, table.long!)).toEqual(longBefore);

    await inTx(v, (tx) => moveToday(tx, v.cfg, table.bar!, { x: 60, y: 60 }));
    await inTx(v, (tx) => backToSaved(tx, v.cfg, [], table.bar!, new Date()));
    expect(await todayRow(v, table.bar!)).toMatchObject({ x: 40, y: 0 });
  });
});

describe("guests at a joined table that is split", () => {
  function noticesOn(billIds: string[]) {
    return v.db.all<{
      working_order_id: string;
      kind: string;
      line_name: string;
      moved_to: string;
    }>(
      sql`
        select working_order_id, kind, line_name, moved_to from kitchen_notices
        where working_order_id in (${sql.join(
          billIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        order by rowid`,
    );
  }

  async function withClearing<T>(fn: () => Promise<T>): Promise<T> {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, true));
    try {
      return await fn();
    } finally {
      await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));
    }
  }

  it("the guests and their bills stay at Long table while two parts remain", async () => {
    const { table } = await LONG_PLUS_BAR();
    const guests = await seat(v, table.long!);
    await order(v, guests.tabId, "Burger");
    const revision = await revisionOf(v, guests.partyId);

    await split(table.long!, [table.c5!], 6);

    expect(await partyAt(v, table.long!)).toBe(guests.partyId);
    expect(await revisionOf(v, guests.partyId)).toBe(revision);
    expect((await billRow(v, guests.tabId)).partyId).toBe(guests.partyId);
  });

  it("tells the kitchen nothing while two parts remain: the guests keep Long table and its name, so no table or name is lost (A650 §3 row 11')", async () => {
    const { table } = await LONG_PLUS_BAR();
    const guests = await seat(v, table.long!);
    await order(v, guests.tabId, "Burger");

    await split(table.long!, [table.c5!], 6);

    expect(noticesOn([guests.tabId])).toEqual([]);
  });

  it("a split down to one passes the guests to the part left, and Long table needs no clearing", async () => {
    await withClearing(async () => {
      const { table } = await LONG_PLUS_BAR();
      const guests = await seat(v, table.long!);
      await order(v, guests.tabId, "Burger");
      const revision = await revisionOf(v, guests.partyId);

      await split(table.long!, [table.c4!, table.c5!], null);

      expect(await partyAt(v, table.c3!)).toBe(guests.partyId);
      expect(await partyAt(v, table.long!)).toBeNull();
      expect((await tableRow(v, table.long!)).needsClearingSince).toBeNull();
      expect(await revisionOf(v, guests.partyId)).toBe(revision + 1);
      expect((await billRow(v, guests.tabId)).partyId).toBe(guests.partyId);
    });
  });

  it("keeps every other table the guests hold", async () => {
    const { table } = await LONG_PLUS_BAR();
    const guests = await seat(v, table.long!);
    const joining = {
      bills: "merge" as const,
      expectedPartyRevision: await revisionOf(v, guests.partyId),
      operatorId: OPERATOR,
    };
    await inTx(v, (tx) => joinTables(tx, v.cfg, guests.partyId, table.bar!, joining));

    await split(table.long!, [table.c4!, table.c5!], null);

    expect((await activeTablesOf(v, guests.partyId)).sort()).toEqual(
      [table.bar!, table.c3!].sort(),
    );
  });

  it("tells the kitchen the guests' new table", async () => {
    const { table } = await LONG_PLUS_BAR();
    const guests = await seat(v, table.long!);
    await order(v, guests.tabId, "Burger");

    await split(table.long!, [table.c4!, table.c5!], null);

    expect(await noticesOn([guests.tabId])).toEqual([
      {
        working_order_id: guests.tabId,
        kind: "moved",
        line_name: "BURG",
        moved_to: (await tableRow(v, table.c3!)).label,
      },
    ]);
  });

  it("clears a stale needs-clearing mark on the part the guests pass to", async () => {
    const { table } = await LONG_PLUS_BAR();
    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set({ needsClearingSince: new Date().toISOString() })
        .where(eq(diningTables.id, table.c3!)),
    );
    const guests = await seat(v, table.long!);

    await split(table.long!, [table.c4!, table.c5!], null);

    expect(await partyAt(v, table.c3!)).toBe(guests.partyId);
    expect((await tableRow(v, table.c3!)).needsClearingSince).toBeNull();
  });

  it("leaves the last part's manual status as it is", async () => {
    const { table } = await LONG_PLUS_BAR();
    const statusId = await inTx(v, async (tx) => {
      const [status] = await tx
        .insert(tableServiceStatuses)
        .values({ label: `Postre ${randomUUID()}`, color: "#ef4444" })
        .returning({ id: tableServiceStatuses.id });
      await tx
        .update(diningTables)
        .set({ statusId: status!.id })
        .where(eq(diningTables.id, table.c3!));
      return status!.id;
    });
    const guests = await seat(v, table.long!);

    await split(table.long!, [table.c4!, table.c5!], null);

    expect(await partyAt(v, table.c3!)).toBe(guests.partyId);
    expect((await tableRow(v, table.c3!)).statusId).toBe(statusId);
  });

  it("an old read of the guests is refused after the split", async () => {
    const { table } = await LONG_PLUS_BAR();
    const guests = await seat(v, table.long!);
    const stale = await commandFor(v, guests.partyId);

    await split(table.long!, [table.c4!, table.c5!], null);
    const before = {
      party: await partyRow(v, guests.partyId),
      tables: await activeTablesOf(v, guests.partyId),
    };

    const error = await refusalOf(
      inTx(v, (tx) => finishTable(tx, { partyId: guests.partyId, ...stale })),
    );

    expect(error?.code).toBe("party.out_of_date");
    expect(error?.params).toEqual({
      partyId: guests.partyId,
      revision: stale.expectedPartyRevision + 1,
    });
    expect({
      party: await partyRow(v, guests.partyId),
      tables: await activeTablesOf(v, guests.partyId),
    }).toEqual(before);
  });
});

describe("taking a joined table's tables off for today", () => {
  const takeOff = (tableId: string) => inTx(v, (tx) => takeOffToday(tx, v.cfg, tableId));

  it("refuses a part still joined to Long table, writing nothing", async () => {
    const { table } = await LONG_PLUS_BAR();
    const before = await everything();

    const error = await refusalOf(takeOff(table.c4!));

    expect(error?.code).toBe("table.in_joined_table");
    expect(error?.params).toEqual({ tableId: table.c4! });
    expect(await everything()).toEqual(before);
  });

  it("refuses Long table once it has come apart, writing nothing", async () => {
    const { table } = await LONG_PLUS_BAR();
    await splitOffRow(v, table.long!, table.c4!);
    await splitOffRow(v, table.long!, table.c5!);
    const before = await everything();

    const error = await refusalOf(takeOff(table.long!));

    expect(error?.code).toBe("table.in_joined_table");
    expect(error?.params).toEqual({ tableId: table.long! });
    expect(await everything()).toEqual(before);
  });

  it("refuses Take off on a part split off Long table, writing nothing", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c5!], 6);
    const before = await everything();

    const error = await refusalOf(takeOff(table.c5!));

    expect(error?.code).toBe("table.split_off");
    expect(error?.params).toEqual({ tableId: table.c5! });
    expect(await everything()).toEqual(before);
  });

  it("refuses Back to its saved place on a part split off Long table, writing nothing", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c5!], 6);
    const before = await everything();

    const error = await refusalOf(
      inTx(v, (tx) => backToSaved(tx, v.cfg, [], table.c5!, new Date())),
    );

    expect(error?.code).toBe("table.split_off");
    expect(error?.params).toEqual({ tableId: table.c5! });
    expect(await everything()).toEqual(before);
  });

  it("answers table.merged first to Take off on a part split off that is pushed together with Bar", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c5!], 6);
    await inTx(v, (tx) =>
      writeMerge(tx, v.cfg, {
        movingId: table.c5!,
        targetId: table.bar!,
        side: "right",
        seats: 10,
        free: true,
      }),
    );
    const before = await everything();

    const error = await refusalOf(takeOff(table.c5!));

    expect(error?.code).toBe("table.merged");
    expect(error?.params).toEqual({ tableId: table.c5! });
    expect(await everything()).toEqual(before);
  });

  it("puts back a part split off that an older till took off", async () => {
    const { table } = await LONG_PLUS_BAR();
    await split(table.long!, [table.c5!], 6);
    await inTx(v, (tx) =>
      tx
        .update(floorTodayTables)
        .set({ takenOff: true })
        .where(eq(floorTodayTables.tableId, table.c5!)),
    );

    await inTx(v, (tx) => putBackToday(tx, v.cfg, table.c5!));

    expect((await todayRow(v, table.c5!))?.takenOff).toBe(false);
  });

  it("takes off Long table whole", async () => {
    const { table } = await LONG_PLUS_BAR();

    await takeOff(table.long!);

    expect((await todayRow(v, table.long!))?.takenOff).toBe(true);
  });
});

describe("a part's size in today's split", () => {
  it("a part's size comes from the recorded layout", async () => {
    const d = await setsDepartment(v, new Date("2026-10-09T06:00:00Z"));
    const label = (base: string) => `${base} ${randomUUID().slice(0, 6)}`;
    const removals = enabledTableRemovals(ALL_MODULES);
    const save = async (setId: string, tables: ZonePlanSave["tables"]) => {
      const plan = await inTx(v, (tx) => readLayout(tx, v.cfg, { setId, zoneId: d.zoneId }));
      return inTx(v, (tx) =>
        saveLayout(
          tx,
          v.cfg,
          removals,
          { setId, zoneId: d.zoneId },
          { revision: plan.revision, tables },
          NOW,
        ),
      );
    };
    const joinedAt = { x: 10, y: 20, width: 6, height: 2, shape: "rect" as const, rotation: 0 };
    const entries = (ids: Record<string, string> = {}) =>
      (
        [
          ["c4", label("4"), null, []],
          ["c5", label("5"), null, []],
          ["long", label("4+5"), joinedAt, ["c4", "c5"]],
        ] as const
      ).map(([key, name, placement, partKeys]) => ({
        ...(ids[key] === undefined ? {} : { id: ids[key] }),
        key: ids[key] ?? key,
        label: name,
        seats: 4,
        fixed: false,
        placement,
        partKeys: partKeys.map((k) => ids[k] ?? k),
      }));
    const { ids } = await save(d.standard, entries());
    const standard = await inTx(v, (tx) =>
      readLayout(tx, v.cfg, { setId: d.standard, zoneId: d.zoneId }),
    );
    await save(
      d.dinner,
      standard.tables.map((t) => ({
        id: t.id,
        key: t.id,
        label: t.label,
        seats: t.seats,
        fixed: t.fixed,
        placement: t.id === ids.long ? joinedAt : null,
        partKeys: t.partIds,
      })),
    );
    await giveKeptSize(v, ids.c4!, { width: 8, height: 8 }, d.standard);
    await giveKeptSize(v, ids.c4!, { width: 12, height: 6 }, d.dinner);
    await inTx(v, (tx) =>
      resetZone(tx, v.cfg, removals, d.zoneId, NOW, { setId: d.dinner, occurrence: null }),
    );
    const live = async (masterId: string) =>
      (
        await inTx(v, (tx) =>
          tx
            .select({ id: diningTables.id })
            .from(diningTables)
            .where(eq(diningTables.planTableId, masterId)),
        )
      )[0]!.id;
    const long = await live(ids.long!);
    const c4 = await live(ids.c4!);

    const parts = await inTx(v, (tx) => partsOf(tx, long));
    await split(long, [c4], null);

    expect(parts.map((part) => part.tableId).sort()).toEqual([c4, await live(ids.c5!)].sort());
    expect(await todayRow(v, c4)).toMatchObject({ width: 12, height: 6 });
  });
});
