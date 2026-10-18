import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { BOOKINGS_TABLE_REMOVAL, bookings } from "@waitron/bookings";
import {
  diningTables,
  floorPlanPlacements,
  floorPlanSets,
  floorPlans,
  floorPlanTableParts,
  floorPlanTableSizes,
  floorPlanTables,
  floorResetTableParts,
  floorResetTables,
  floorTodayTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayZones,
  floorZones,
  locations,
  parties,
  partyTables,
  workingOrders,
  ticketItems,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { floorDeletionFor } from "./floor-delete.js";
import { splitJoinedTable } from "./floor-today-split.js";
import { leaveTables, finishTable } from "./parties.js";
import {
  setupPartyVenue,
  inTx,
  seat,
  join,
  commandFor,
  counterOrder,
  billRow,
  pay,
  OPERATOR,
  type PartyVenue,
} from "./testing/party-venue.js";
import { giveKeptSize, plannedZone } from "./testing/floor-today-venue.js";
import { handOverOrder, placeOrder } from "./working-order.js";

let v: PartyVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});
const NOW = new Date("2026-10-11T12:00:00Z");
const seatFor = () => floorDeletionFor(v.cfg, [BOOKINGS_TABLE_REMOVAL]);

async function zone(name: string, locationId = v.cfg.locationId as string) {
  const id = randomUUID();
  await inTx(v, (tx) => tx.insert(floorZones).values({ id, locationId, name: `${name} ${id}` }));
  return id;
}
async function impact(zoneIds: string[]) {
  return inTx(v, (tx) => seatFor().readImpact(tx, zoneIds, NOW));
}
async function delivery(tableId: string, name: string) {
  const id = await counterOrder(v, "Paella");
  await inTx(v, (tx) =>
    tx
      .update(workingOrders)
      .set({ deliveryTableId: tableId, label: name })
      .where(eq(workingOrders.id, id)),
  );
  return id;
}
async function finish(partyId: string) {
  const command = await commandFor(v, partyId);
  await inTx(v, (tx) => finishTable(tx, { partyId, ...command }));
}

const floorRows = {
  diningTables,
  floorPlans,
  floorPlanTables,
  floorPlanTableParts,
  floorPlanTableSizes,
  floorResetTableParts,
  floorResetTables,
  floorTodayTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayZones,
};
async function snapshot(tx: Transaction) {
  const result: Record<string, unknown[]> = {};
  for (const [key, table] of Object.entries(floorRows))
    result[key] = await tx.select().from(table).orderBy(table.id);
  result.zones = await tx.select().from(floorZones).orderBy(floorZones.id);
  result.locations = await tx.select().from(locations).orderBy(locations.id);
  result.tickets = await tx.select().from(ticketItems).orderBy(ticketItems.id);
  result.bookings = await tx.select().from(bookings).orderBy(bookings.id);
  result.orders = await tx.select().from(workingOrders).orderBy(workingOrders.id);
  result.parties = await tx.select().from(parties).orderBy(parties.id);
  result.partyTables = await tx.select().from(partyTables).orderBy(partyTables.id);
  return result;
}

async function planned(z: string, prefix: string, locationId = v.cfg.locationId as string) {
  return inTx(v, async (tx) => {
    const [set] = await tx.insert(floorPlanSets).values({ locationId }).returning();
    const [plan] = await tx
      .insert(floorPlans)
      .values({ zoneId: z, setId: set!.id, savedAt: NOW.toISOString() })
      .returning();
    const masters = await tx
      .insert(floorPlanTables)
      .values(
        ["C", "A", "B"].map((label) => ({
          zoneId: z,
          label: `${prefix} saved ${label}`,
        })),
      )
      .returning();
    const live = await tx
      .insert(diningTables)
      .values(
        masters.map((master, i) => ({
          locationId,
          zoneId: z,
          label: `${prefix} live ${["C", "A", "B"][i]}`,
          planTableId: master.id,
        })),
      )
      .returning();
    const resets = await tx
      .insert(floorResetTables)
      .values(
        live.map((table, i) => ({
          zoneId: z,
          tableId: table.id,
          label: `${prefix} reset ${i}`,
          planTableId: masters[i]!.id,
        })),
      )
      .returning();
    const [pending] = await tx
      .insert(floorResetTables)
      .values({ zoneId: z, label: `${prefix} pending`, pending: true, planTableId: masters[0]!.id })
      .returning();
    const today = await tx
      .insert(floorTodayTables)
      .values(live.map((table) => ({ tableId: table.id })))
      .returning();
    const [todayJoin] = await tx
      .insert(floorTodayJoins)
      .values({ zoneId: z, seats: 12 })
      .returning();
    const todayMembers = await tx
      .insert(floorTodayJoinTables)
      .values(
        live.map((table) => ({
          joinId: todayJoin!.id,
          tableId: table.id,
          beforeX: 3,
          beforeY: 4,
          beforeRotation: 90,
        })),
      )
      .returning();
    const [todayZone] = await tx
      .insert(floorTodayZones)
      .values({ zoneId: z, businessDay: "2026-10-11", revision: 7 })
      .returning();
    const [noToday] = await tx
      .insert(diningTables)
      .values({ locationId, zoneId: z, label: `${prefix} no today` })
      .returning();
    return {
      plan: plan!,
      masters,
      live,
      resets,
      pending: pending!,
      today,
      todayJoin: todayJoin!,
      todayMembers,
      todayZone: todayZone!,
      noToday: noToday!,
    };
  });
}

function targets(rows: { id: string; label: string }[]) {
  return [...rows]
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map((row) => ({ id: row.id, name: row.label }));
}

describe("floor hierarchy deletion", () => {
  it("earlier table of an open party still refuses hierarchy deletion", async () => {
    const first = await v.table("Earlier A");
    const other = await v.table("Earlier B");
    const { partyId } = await seat(v, first);
    await inTx(v, (tx) =>
      tx.update(parties).set({ name: "Ana's party" }).where(eq(parties.id, partyId)),
    );
    await join(v, partyId, other);
    await inTx(v, (tx) => leaveTables(tx, [first]));
    await inTx(v, (tx) => tx.delete(floorTodayTables).where(eq(floorTodayTables.tableId, first)));
    const before = await inTx(v, snapshot);
    const result = await impact([v.tables.zoneId]);
    expect(result.refusals).toEqual(
      [first, other].map((tableId, i) => ({
        code: "zone.table_in_use",
        params: { zoneId: v.tables.zoneId, tableId, tableName: ["Earlier A", "Earlier B"][i] },
        targets: [{ id: partyId, name: "Ana's party" }],
      })),
    );
    expect(await inTx(v, snapshot)).toEqual(before);
    await expect(
      inTx(v, (tx) => seatFor().clear(tx, [v.tables.zoneId], NOW)),
    ).rejects.toMatchObject({ code: "zone.table_in_use" });
    await finish(partyId);
    expect((await impact([v.tables.zoneId])).refusals).toEqual([]);
  });

  it("unsettled or uncollected food delivery refuses with every named order", async () => {
    const z = await zone("Delivery");
    const table = await v.table("Delivery table", z);
    const open = await delivery(table, "A open");
    const placed = await delivery(table, "B placed");
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, placed)),
    );
    const food = await delivery(table, "C food");
    await pay(v, food, "20.00");
    const collected = await delivery(table, "D collected");
    await pay(v, collected, "20.00");
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, collected));
    const abandoned = await delivery(table, "E abandoned");
    await placeOrder({ db: v.db, backend: v.backend, clock: v.clock }, v.cfg, abandoned, OPERATOR);
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, abandoned)),
    );
    const made = await delivery(table, "F made here");
    await pay(v, made, "20.00");
    await inTx(v, (tx) =>
      tx.update(ticketItems).set({ madeHere: true }).where(eq(ticketItems.workingOrderId, made)),
    );
    const before = await inTx(v, snapshot);
    expect((await impact([z])).refusals).toEqual(
      [open, placed, food].map((id, i) => ({
        code: "table.delivery_in_progress",
        params: { tableId: table, workingOrderId: id },
        targets: [{ id, name: ["A open", "B placed", "Delivery table"][i] }],
      })),
    );
    expect(await inTx(v, snapshot)).toEqual(before);
    await expect(inTx(v, (tx) => seatFor().clear(tx, [z], NOW))).rejects.toMatchObject({
      code: "table.delivery_in_progress",
    });
    await inTx(v, async (tx) => {
      await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, open));
      await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, placed));
      await handOverOrder(tx, v.cfg, food);
    });
    expect((await impact([z])).refusals).toEqual([]);
    const oldOrders = await inTx(v, (tx) =>
      tx.select().from(workingOrders).orderBy(workingOrders.id),
    );
    await inTx(v, (tx) => seatFor().clear(tx, [z], NOW));
    const newOrders = await inTx(v, (tx) =>
      tx.select().from(workingOrders).orderBy(workingOrders.id),
    );
    expect(newOrders).toEqual(
      oldOrders.map((row) =>
        row.deliveryTableId === table
          ? { ...row, deliveryTableId: null, deliveryTableLabel: "Delivery table" }
          : row,
      ),
    );
  });

  it("collects party, order and enabled booking blockers together", async () => {
    const z = await zone("Combined");
    const table = await v.table("Combined table", z);
    const party = randomUUID();
    await inTx(v, async (tx) => {
      await tx.insert(parties).values({ id: party, openedBy: randomUUID(), name: "Party" });
      await tx
        .insert(partyTables)
        .values({ partyId: party, tableId: table, leftAt: NOW.toISOString() });
    });
    const order = await delivery(table, "Order");
    const booking = randomUUID();
    await inTx(v, (tx) =>
      tx.insert(bookings).values({
        id: booking,
        locationId: v.cfg.locationId,
        tableId: table,
        bookingDate: "2026-01-01",
        bookingTime: "19:00:00",
        partySize: 2,
        contactName: "Ada",
        createdBy: randomUUID(),
        status: "seated",
      }),
    );
    expect((await impact([z])).refusals).toEqual([
      {
        code: "zone.table_in_use",
        params: { zoneId: z, tableId: table, tableName: "Combined table" },
        targets: [{ id: party, name: "Party" }],
      },
      {
        code: "table.delivery_in_progress",
        params: { tableId: table, workingOrderId: order },
        targets: [{ id: order, name: "Order" }],
      },
      {
        code: "table.booked",
        params: { tableId: table, date: "2026-01-01", time: "19:00" },
        targets: [{ id: booking, name: "Ada · 2026-01-01 19:00" }],
      },
    ]);
  });

  it("cleans a no-today table, null-live reset target, and every three-member join", async () => {
    const z = await zone("Cleanup");
    const own = await planned(z, "Delete");
    const otherZone = await zone("Keep");
    const other = await planned(otherZone, "Keep");
    const [otherLocation] = await inTx(v, (tx) =>
      tx
        .insert(locations)
        .values({ name: "Other", invoiceLocales: ["en"], operationDescription: "Test" })
        .returning(),
    );
    const foreignZone = await zone("Foreign", otherLocation!.id);
    await planned(foreignZone, "Foreign", otherLocation!.id);
    await inTx(v, async (tx) => {
      await tx
        .update(diningTables)
        .set({ planTableId: own.masters[0]!.id })
        .where(eq(diningTables.id, other.noToday.id));
      await tx
        .update(floorResetTables)
        .set({ planTableId: own.masters[1]!.id })
        .where(eq(floorResetTables.id, other.pending.id));
    });
    const order = await delivery(own.noToday.id, "Finished delivery");
    await pay(v, order, "20.00");
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, order));
    const booking = randomUUID();
    await inTx(v, (tx) =>
      tx.insert(bookings).values({
        id: booking,
        locationId: v.cfg.locationId,
        tableId: own.noToday.id,
        bookingDate: "2026-01-01",
        bookingTime: "19:00:00",
        partySize: 2,
        contactName: "Old guest",
        createdBy: randomUUID(),
        status: "completed",
      }),
    );
    const before = await inTx(v, snapshot);
    const input = [foreignZone, z, z];
    const result = await impact(input);
    expect(result).toEqual({
      refusals: [],
      removes: [
        { key: "tables", count: 4, targets: targets([...own.live, own.noToday]) },
        { key: "saved_tables", count: 3, targets: targets(own.masters) },
        {
          key: "today_joins",
          count: 1,
          targets: [{ id: own.todayJoin.id, name: "Delete live A, Delete live B, Delete live C" }],
        },
        { key: "reset_targets", count: 4, targets: targets([...own.resets, own.pending]) },
      ],
    });
    expect(await inTx(v, snapshot)).toEqual(before);
    await expect(inTx(v, (tx) => seatFor().clear(tx, input, NOW))).resolves.toBeUndefined();
    const after = await inTx(v, snapshot);
    const removed: Record<string, { id: string }[]> = {
      diningTables: [...own.live, own.noToday],
      floorPlans: [own.plan],
      floorPlanTables: own.masters,
      floorResetTables: [...own.resets, own.pending],
      floorTodayTables: own.today,
      floorTodayJoins: [own.todayJoin],
      floorTodayJoinTables: own.todayMembers,
      floorTodayZones: [own.todayZone],
    };
    for (const [key, rows] of Object.entries(removed)) {
      const ids = new Set(rows.map((row) => row.id));
      const expected = (before[key] as { id: string }[])
        .filter((row) => !ids.has(row.id))
        .map((row) => {
          if (key === "diningTables" && row.id === other.noToday.id)
            return { ...row, planTableId: null };
          if (key === "floorResetTables" && row.id === other.pending.id)
            return { ...row, planTableId: null };
          return row;
        });
      expect(after[key], key).toEqual(expected);
    }
    expect(after.bookings).toEqual(
      (before.bookings as { id: string }[]).map((row) =>
        row.id === booking ? { ...row, tableId: null, tableLabel: "Delete no today" } : row,
      ),
    );
    expect(after.orders).toEqual(
      (before.orders as { id: string }[]).map((row) =>
        row.id === order
          ? { ...row, deliveryTableId: null, deliveryTableLabel: "Delete no today" }
          : row,
      ),
    );
    expect(after.zones).toEqual(before.zones);
    expect(after.locations).toEqual(before.locations);
    expect(after.tickets).toEqual(before.tickets);
    expect(after.parties).toEqual(before.parties);
    expect(after.partyTables).toEqual(before.partyTables);
    expect(await impact([z])).toEqual({ refusals: [], removes: [] });
    await inTx(v, (tx) => seatFor().clear(tx, [z], NOW));
    expect(await inTx(v, snapshot)).toEqual(after);
  });

  it("unknown incoming table reference rolls back all cleanup", async () => {
    const z = await zone("Unknown");
    const own = await planned(z, "Rollback");
    const order = await delivery(own.noToday.id, "Rollback terminal");
    await pay(v, order, "20.00");
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, order));
    await inTx(v, async (tx) => {
      await tx.run(
        sql`create table task3_external_reference (id text primary key, table_id text not null references dining_tables(id))`,
      );
      await tx.run(
        sql`insert into task3_external_reference values ('independent', ${own.noToday.id})`,
      );
    });
    const bookingId = randomUUID();
    await inTx(v, (tx) =>
      tx.insert(bookings).values({
        id: bookingId,
        locationId: v.cfg.locationId,
        tableId: own.live[1]!.id,
        bookingDate: "2026-01-01",
        bookingTime: "19:00:00",
        partySize: 2,
        contactName: "Rollback guest",
        createdBy: randomUUID(),
        status: "completed",
      }),
    );
    const before = await inTx(v, snapshot);
    expect((await impact([z])).refusals).toEqual([]);
    await expect(
      inTx(v, async (tx) => {
        await tx
          .update(floorZones)
          .set({ name: "Caller write before refusal" })
          .where(eq(floorZones.id, z));
        await seatFor().clear(tx, [z], NOW);
      }),
    ).rejects.toMatchObject({
      code: "zone.table_in_use",
      params: { zoneId: z, tableId: own.noToday.id, tableName: "Rollback no today" },
    });
    expect(await inTx(v, snapshot)).toEqual(before);
    expect(await billRow(v, order)).toMatchObject({
      deliveryTableId: own.noToday.id,
      deliveryTableLabel: null,
    });
    await inTx(v, async (tx) => {
      await tx.run(sql`delete from task3_external_reference`);
      await seatFor().clear(tx, [z], NOW);
    });
    expect((await impact([z])).removes).toEqual([]);
    await inTx(v, async (tx) => {
      await tx.run(sql`drop table task3_external_reference`);
    });
  });

  it("clears an explicitly requested inactive descendant's floor tables and plan", async () => {
    const z = await zone("Retired child");
    const own = await planned(z, "Retired child");
    await inTx(v, (tx) => tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, z)));
    const read = await impact([z]);
    expect(read.removes).toContainEqual({
      key: "tables",
      count: 4,
      targets: targets([...own.live, own.noToday]),
    });
    expect(read.removes).toContainEqual({
      key: "saved_tables",
      count: 3,
      targets: targets(own.masters),
    });
    await inTx(v, (tx) => seatFor().clear(tx, [z], NOW));
    expect(
      await inTx(v, (tx) => tx.select().from(diningTables).where(eq(diningTables.zoneId, z))),
    ).toEqual([]);
    expect(
      await inTx(v, (tx) => tx.select().from(floorPlans).where(eq(floorPlans.zoneId, z))),
    ).toEqual([]);
  });

  it("clears a zone whose saved plan keeps a table's size", async () => {
    const { zoneId, master } = await plannedZone(
      v,
      [
        { key: "bar", label: "Bar", seats: 4 },
        { key: "c3", label: "Counter 3", seats: 2, place: null },
      ],
      NOW,
    );
    await giveKeptSize(v, master.c3!, { width: 2, height: 2 });
    const masterIds = Object.values(master);
    await inTx(v, (tx) => seatFor().clear(tx, [zoneId], NOW));
    expect(
      await inTx(v, (tx) =>
        tx
          .select()
          .from(floorPlanTableSizes)
          .where(inArray(floorPlanTableSizes.planTableId, masterIds)),
      ),
    ).toEqual([]);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(floorPlanTables).where(inArray(floorPlanTables.id, masterIds)),
      ),
    ).toEqual([]);
    expect(
      await inTx(v, (tx) => tx.select().from(floorPlans).where(eq(floorPlans.zoneId, zoneId))),
    ).toEqual([]);
    expect(
      await inTx(v, (tx) => tx.select().from(diningTables).where(eq(diningTables.zoneId, zoneId))),
    ).toEqual([]);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(floorResetTables).where(eq(floorResetTables.zoneId, zoneId)),
      ),
    ).toEqual([]);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId)),
      ),
    ).toEqual([]);
  });

  it("deleting a zone removes its placements", async () => {
    const { zoneId } = await plannedZone(
      v,
      [
        { key: "bar", label: "Bar", seats: 4 },
        { key: "t2", label: "T2", seats: 2, place: { x: 20, y: 0 } },
      ],
      NOW,
    );
    const [plan] = await inTx(v, (tx) =>
      tx.select({ id: floorPlans.id }).from(floorPlans).where(eq(floorPlans.zoneId, zoneId)),
    );
    const placementsOf = () =>
      inTx(v, (tx) =>
        tx.select().from(floorPlanPlacements).where(eq(floorPlanPlacements.planId, plan!.id)),
      );
    expect(await placementsOf()).toHaveLength(2);
    await inTx(v, (tx) => seatFor().clear(tx, [zoneId], NOW));
    expect(await placementsOf()).toEqual([]);
  });

  it("clears a zone whose saved plan holds Long table made of three tables", async () => {
    const { zoneId, master } = await plannedZone(
      v,
      [
        { key: "c3", label: "Counter 3", seats: 2, place: null },
        { key: "c4", label: "Counter 4", seats: 6, place: null },
        { key: "c5", label: "Counter 5", seats: 4, place: null },
        { key: "long", label: "Long table", seats: 10, partKeys: ["c3", "c4", "c5"] },
      ],
      NOW,
    );
    const masterIds = Object.values(master);
    const partsOf = () =>
      inTx(v, (tx) =>
        tx
          .select()
          .from(floorPlanTableParts)
          .where(inArray(floorPlanTableParts.joinedTableId, masterIds)),
      );
    const copiedOf = () =>
      inTx(v, (tx) =>
        tx
          .select({ id: floorResetTableParts.id })
          .from(floorResetTableParts)
          .innerJoin(
            floorResetTables,
            eq(floorResetTables.id, floorResetTableParts.joinedResetTableId),
          )
          .where(eq(floorResetTables.zoneId, zoneId)),
      );
    expect(await partsOf()).toHaveLength(3);
    expect(await copiedOf()).toHaveLength(3);
    await inTx(v, (tx) => seatFor().clear(tx, [zoneId], NOW));
    expect(await partsOf()).toEqual([]);
    expect(await inTx(v, (tx) => tx.select().from(floorResetTableParts))).toEqual([]);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(floorPlanTables).where(inArray(floorPlanTables.id, masterIds)),
      ),
    ).toEqual([]);
    expect(
      await inTx(v, (tx) => tx.select().from(floorPlans).where(eq(floorPlans.zoneId, zoneId))),
    ).toEqual([]);
    expect(
      await inTx(v, (tx) => tx.select().from(diningTables).where(eq(diningTables.zoneId, zoneId))),
    ).toEqual([]);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(floorResetTables).where(eq(floorResetTables.zoneId, zoneId)),
      ),
    ).toEqual([]);
  });

  it("clears a zone whose Long table was split today", async () => {
    const { zoneId, table } = await plannedZone(
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
      ],
      NOW,
    );
    await inTx(v, (tx) =>
      splitJoinedTable(tx, v.cfg, { tableId: table.long!, partIds: [table.c5!], seats: 6 }),
    );
    expect(await inTx(v, (tx) => tx.select().from(floorTodaySplitParts))).not.toEqual([]);
    await inTx(v, (tx) => seatFor().clear(tx, [zoneId], NOW));
    expect(await inTx(v, (tx) => tx.select().from(floorTodaySplitParts))).toEqual([]);
    expect(
      await inTx(v, (tx) => tx.select().from(diningTables).where(eq(diningTables.zoneId, zoneId))),
    ).toEqual([]);
  });

  it("empty and foreign zone selections do not change or create floor state", async () => {
    const [loc] = await inTx(v, (tx) =>
      tx
        .insert(locations)
        .values({ name: "Foreign empty", invoiceLocales: ["en"], operationDescription: "Test" })
        .returning(),
    );
    const z = await zone("Foreign empty", loc!.id);
    await planned(z, "Foreign empty", loc!.id);
    const before = await inTx(v, snapshot);
    expect(await impact([])).toEqual({ refusals: [], removes: [] });
    expect(await impact([z, randomUUID()])).toEqual({ refusals: [], removes: [] });
    await inTx(v, (tx) => seatFor().clear(tx, [z], NOW));
    await inTx(v, (tx) => seatFor().clear(tx, [], NOW));
    expect(await inTx(v, snapshot)).toEqual(before);
  });
});
