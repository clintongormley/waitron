import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorTodayTables, workingOrders } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { readZonePlan, saveZonePlan, type ZonePlanSave } from "./floor-plan.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { writeMerge } from "./floor-today-merges.js";
import { placeSpareToday, resetZone } from "./floor-today-store.js";
import { moveBill } from "./move-bill.js";
import { moveGuests } from "./table-actions.js";
import { createOpenOrder } from "./working-order.js";
import {
  activeTablesOf,
  billRow,
  commandFor,
  counterOrder,
  inTx,
  join,
  OPERATOR,
  partyAt,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { mergeOf, plannedZone, splitOffRow, todayRow } from "./testing/floor-today-venue.js";
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
const REMOVALS: readonly TableRemoval[] = enabledTableRemovals(ALL_MODULES);

/** Counter 3 (2 seats), 4 (6) and 5 (4) off the plan, Long table (10) placed and made of them, and Bar placed. */
const LONG_AND_BAR = () =>
  plannedZone(
    v,
    [
      { key: "c3", label: "Counter 3", seats: 2, place: null },
      { key: "c4", label: "Counter 4", seats: 6, place: null },
      { key: "c5", label: "Counter 5", seats: 4, place: null },
      {
        key: "long",
        label: "Long table",
        seats: 10,
        place: { x: 0, y: 0 },
        partKeys: ["c3", "c4", "c5"],
      },
      { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0 } },
    ],
    NOW,
  );

const inJoinedTable = (tableId: string) => ({
  code: "table.in_joined_table",
  params: { tableId },
});

describe("a part still in a joined table", () => {
  it("refuses seating a party at Counter 4", async () => {
    const { table } = await LONG_AND_BAR();
    await expect(seat(v, table.c4!)).rejects.toMatchObject(inJoinedTable(table.c4!));
    expect(await partyAt(v, table.c4!)).toBeNull();
  });

  it("refuses joining Counter 5 to a party at Bar", async () => {
    const { table } = await LONG_AND_BAR();
    const { partyId } = await seat(v, table.bar!);
    await expect(join(v, partyId, table.c5!)).rejects.toMatchObject(inJoinedTable(table.c5!));
    expect(await activeTablesOf(v, partyId)).toEqual([table.bar!]);
  });

  it("refuses moving guests to Counter 3", async () => {
    const { table } = await LONG_AND_BAR();
    const { partyId } = await seat(v, table.bar!);
    const sent = await commandFor(v, partyId);
    await expect(
      inTx(v, (tx) =>
        moveGuests(tx, v.cfg, partyId, table.c3!, { ...sent, bills: "merge", otherPartyId: null }),
      ),
    ).rejects.toMatchObject(inJoinedTable(table.c3!));
    expect(await activeTablesOf(v, partyId)).toEqual([table.bar!]);
    expect(await partyAt(v, table.c3!)).toBeNull();
  });

  it("refuses moving a bill to Counter 3", async () => {
    const { table } = await LONG_AND_BAR();
    const orderId = await counterOrder(v, "Flan");
    await expect(
      inTx(v, (tx) =>
        moveBill(
          tx,
          v.cfg,
          orderId,
          { tableId: table.c3! },
          { bills: "merge", operatorId: OPERATOR },
        ),
      ),
    ).rejects.toMatchObject(inJoinedTable(table.c3!));
    expect((await billRow(v, orderId)).partyId).toBeNull();
    expect(await partyAt(v, table.c3!)).toBeNull();
  });

  it("refuses putting Counter 4 on today's map", async () => {
    const { table } = await LONG_AND_BAR();
    await expect(
      inTx(v, (tx) => placeSpareToday(tx, v.cfg, table.c4!, { x: 1, y: 1 })),
    ).rejects.toMatchObject(inJoinedTable(table.c4!));
    expect((await todayRow(v, table.c4!))?.x).toBeNull();
  });

  it("refuses merging Bar with Counter 5 first as not on today's plan", async () => {
    const { table } = await LONG_AND_BAR();
    await expect(
      inTx(v, (tx) =>
        writeMerge(tx, v.cfg, {
          movingId: table.bar!,
          targetId: table.c5!,
          side: "right",
          seats: 8,
          free: true,
        }),
      ),
    ).rejects.toMatchObject({
      code: "table.not_on_today_plan",
      params: { tableId: table.c5! },
    });
    expect(await mergeOf(v, table.bar!)).toBeNull();
  });

  it("refuses merging Bar with Counter 5 when Counter 5 has a place today", async () => {
    const { table } = await LONG_AND_BAR();
    await inTx(v, (tx) =>
      tx
        .update(floorTodayTables)
        .set({ x: 80, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 })
        .where(eq(floorTodayTables.tableId, table.c5!)),
    );
    await expect(
      inTx(v, (tx) =>
        writeMerge(tx, v.cfg, {
          movingId: table.bar!,
          targetId: table.c5!,
          side: "right",
          seats: 8,
          free: true,
        }),
      ),
    ).rejects.toMatchObject(inJoinedTable(table.c5!));
    expect(await mergeOf(v, table.bar!)).toBeNull();
  });

  it("refuses an order delivered to Counter 3", async () => {
    const { table } = await LONG_AND_BAR();
    const id = randomUUID();
    await expect(
      inTx(v, (tx) =>
        createOpenOrder(
          tx,
          v.cfg,
          id,
          [{ menuItemId: v.counterItem("Flan"), quantity: "1" }],
          null,
          {
            deliveryTableId: table.c3!,
            zoneId: v.counter.zoneId,
          },
        ),
      ),
    ).rejects.toMatchObject(inJoinedTable(table.c3!));
    const written = await inTx(v, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, id)),
    );
    expect(written).toEqual([]);
  });

  it("seats a party at Long table, and at Counter 3 once Long table is deleted and the zone reset", async () => {
    const { zoneId, table, master } = await LONG_AND_BAR();
    const atLong = await seat(v, table.long!);
    expect(await partyAt(v, table.long!)).toBe(atLong.partyId);

    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, zoneId));
    const tables: ZonePlanSave["tables"] = plan.tables
      .filter((entry) => entry.id !== master.long)
      .map((entry) => ({
        id: entry.id,
        key: entry.id,
        label: entry.label,
        seats: entry.seats,
        fixed: entry.fixed,
        placement: entry.placement,
        partKeys: [],
      }));
    await inTx(v, (tx) =>
      saveZonePlan(tx, v.cfg, REMOVALS, zoneId, { revision: plan.revision, tables }, NOW),
    );
    await inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW));

    const atCounter = await seat(v, table.c3!);
    expect(await partyAt(v, table.c3!)).toBe(atCounter.partyId);
  });
});

describe("a joined table come apart", () => {
  it("seats a party at Counter 4 once it is split off", async () => {
    const { table } = await LONG_AND_BAR();
    await splitOffRow(v, table.long!, table.c4!);
    const { partyId } = await seat(v, table.c4!);
    expect(await partyAt(v, table.c4!)).toBe(partyId);
  });

  it("refuses seating a party at Long table once two of its three parts are split off", async () => {
    const { table } = await LONG_AND_BAR();
    await splitOffRow(v, table.long!, table.c4!);
    await splitOffRow(v, table.long!, table.c5!);
    await expect(seat(v, table.long!)).rejects.toMatchObject(inJoinedTable(table.long!));
    expect(await partyAt(v, table.long!)).toBeNull();
  });

  it("refuses joining Long table to a party at Bar once it has come apart", async () => {
    const { table } = await LONG_AND_BAR();
    await splitOffRow(v, table.long!, table.c4!);
    await splitOffRow(v, table.long!, table.c5!);
    const { partyId } = await seat(v, table.bar!);
    await expect(join(v, partyId, table.long!)).rejects.toMatchObject(inJoinedTable(table.long!));
    expect(await activeTablesOf(v, partyId)).toEqual([table.bar!]);
  });

  it("refuses merging Bar with Long table once it has come apart", async () => {
    const { table } = await LONG_AND_BAR();
    await splitOffRow(v, table.long!, table.c4!);
    await splitOffRow(v, table.long!, table.c5!);
    await expect(
      inTx(v, (tx) =>
        writeMerge(tx, v.cfg, {
          movingId: table.bar!,
          targetId: table.long!,
          side: "right",
          seats: 14,
          free: true,
        }),
      ),
    ).rejects.toMatchObject(inJoinedTable(table.long!));
    expect(await mergeOf(v, table.bar!)).toBeNull();
    expect(await mergeOf(v, table.long!)).toBeNull();
  });

  it("refuses an order delivered to Long table once it has come apart", async () => {
    const { table } = await LONG_AND_BAR();
    await splitOffRow(v, table.long!, table.c4!);
    await splitOffRow(v, table.long!, table.c5!);
    const id = randomUUID();
    await expect(
      inTx(v, (tx) =>
        createOpenOrder(
          tx,
          v.cfg,
          id,
          [{ menuItemId: v.counterItem("Flan"), quantity: "1" }],
          null,
          {
            deliveryTableId: table.long!,
            zoneId: v.counter.zoneId,
          },
        ),
      ),
    ).rejects.toMatchObject(inJoinedTable(table.long!));
    const written = await inTx(v, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, id)),
    );
    expect(written).toEqual([]);
  });

  it("Long table is out of service while two of its parts still hold parties from before the reset", async () => {
    const { zoneId, table, master, revision } = await plannedZone(
      v,
      [
        { key: "c3", label: "Counter 3", seats: 2, place: { x: 0, y: 0 } },
        { key: "c4", label: "Counter 4", seats: 6, place: { x: 20, y: 0 } },
        { key: "c5", label: "Counter 5", seats: 4, place: { x: 40, y: 0 } },
      ],
      NOW,
    );
    await seat(v, table.c3!);
    await seat(v, table.c4!);
    const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, zoneId));
    const tables: ZonePlanSave["tables"] = plan.tables.map((entry) => ({
      id: entry.id,
      key: entry.id,
      label: entry.label,
      seats: entry.seats,
      fixed: entry.fixed,
      placement: null,
      partKeys: [],
    }));
    tables.push({
      key: "long",
      label: `Long table ${randomUUID().slice(0, 6)}`,
      seats: 10,
      fixed: false,
      placement: { x: 0, y: 20, width: 6, height: 2, shape: "rect", rotation: 0 },
      partKeys: [master.c3!, master.c4!, master.c5!],
    });
    const { ids } = await inTx(v, (tx) =>
      saveZonePlan(tx, v.cfg, REMOVALS, zoneId, { revision, tables }, NOW),
    );
    await inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, NOW));
    const after = await inTx(v, (tx) => readZonePlan(tx, v.cfg, zoneId));
    const long = after.tables.find((entry) => entry.id === ids.long)!.liveTableId!;

    await expect(seat(v, long)).rejects.toMatchObject(inJoinedTable(long));
    expect(await partyAt(v, long)).toBeNull();
  });
});
