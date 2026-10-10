import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorPlans,
  floorPlanTables,
  floorResetTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodayTables,
  floorZones,
  partyTables,
  ticketItems,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { zoneSalePolicies, zoneServicePolicies } from "@waitron/venue-service";
import { catchUpZone, resetZone } from "./floor-today-store.js";
import { finishTable, leaveTables } from "./parties.js";
import { removeLiveTable, tableTied } from "./table-removal.js";
import {
  billRow,
  commandFor,
  counterOrder,
  inTx,
  join,
  partyRow,
  pay,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import { handOverOrder } from "./working-order.js";
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
const NONE: readonly TableRemoval[] = [];

/** A fresh table-service zone, so one case's master and today's plan never meet another's. */
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

/** A zone of fresh tables, each followed by a master table of its own name; reset once. */
async function plannedZone(...labels: string[]): Promise<{ zoneId: string; ids: string[] }> {
  const zoneId = await zone();
  const ids: string[] = [];
  for (const label of labels) ids.push(await v.table(label, zoneId));
  await inTx(v, async (tx) => {
    const [plan] = await tx
      .insert(floorPlans)
      .values({ zoneId, savedAt: NOW.toISOString() })
      .returning({ id: floorPlans.id });
    for (const [i, label] of labels.entries()) {
      const [row] = await tx
        .insert(floorPlanTables)
        .values({ planId: plan!.id, label, fixed: false })
        .returning({ id: floorPlanTables.id });
      await tx
        .update(diningTables)
        .set({ planTableId: row!.id, planned: true })
        .where(eq(diningTables.id, ids[i]!));
    }
  });
  await reset(zoneId);
  return { zoneId, ids };
}

async function deleteFromMaster(tableId: string): Promise<void> {
  await inTx(v, async (tx) => {
    const [table] = await tx
      .select({ planTableId: diningTables.planTableId })
      .from(diningTables)
      .where(eq(diningTables.id, tableId));
    const masterId = table!.planTableId!;
    await tx
      .update(diningTables)
      .set({ planTableId: null })
      .where(eq(diningTables.planTableId, masterId));
    await tx
      .update(floorResetTables)
      .set({ planTableId: null })
      .where(eq(floorResetTables.planTableId, masterId));
    await tx.delete(floorPlanTables).where(eq(floorPlanTables.id, masterId));
  });
}

async function renameInMaster(tableId: string, label: string): Promise<void> {
  const { planTableId } = await tableRow(v, tableId);
  await inTx(v, (tx) =>
    tx.update(floorPlanTables).set({ label }).where(eq(floorPlanTables.id, planTableId!)),
  );
}

async function tableExists(tableId: string): Promise<boolean> {
  const rows = await inTx(v, (tx) =>
    tx.select({ id: diningTables.id }).from(diningTables).where(eq(diningTables.id, tableId)),
  );
  return rows.length > 0;
}

async function resetRowOf(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorResetTables).where(eq(floorResetTables.tableId, tableId)),
  );
  return row;
}

async function todayRow(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorTodayTables).where(eq(floorTodayTables.tableId, tableId)),
  );
  return row;
}

async function finish(partyId: string): Promise<void> {
  const sent = await commandFor(v, partyId);
  await inTx(v, (tx) => finishTable(tx, { partyId, ...sent }));
}

/** A counter order of `dish` delivered to `tableId`, left open. */
async function delivery(tableId: string, dish = "Paella"): Promise<string> {
  const id = await counterOrder(v, dish);
  await inTx(v, (tx) =>
    tx.update(workingOrders).set({ deliveryTableId: tableId }).where(eq(workingOrders.id, id)),
  );
  return id;
}

/** Its items were all made on the spot, so no food is on its way. */
async function madeHereOnly(orderId: string): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(ticketItems).set({ madeHere: true }).where(eq(ticketItems.workingOrderId, orderId)),
  );
}

async function kitchenItemsOf(orderId: string): Promise<number> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(and(eq(ticketItems.workingOrderId, orderId), eq(ticketItems.madeHere, false))),
  );
  return rows.length;
}

/** A closed party's row naming the table, as parties closed before slice 1 kept them. */
async function strayPartyRow(partyId: string, tableId: string): Promise<void> {
  const at = NOW.toISOString();
  await inTx(v, (tx) =>
    tx.insert(partyTables).values({ partyId, tableId, joinedAt: at, leftAt: at }),
  );
}

const reset = (zoneId: string, removals: readonly TableRemoval[] = NONE) =>
  inTx(v, (tx) => resetZone(tx, v.cfg, removals, zoneId, NOW));
const catchUp = (zoneId: string, removals: readonly TableRemoval[] = NONE) =>
  inTx(v, (tx) => catchUpZone(tx, v.cfg, removals, zoneId, NOW));

describe("removing a live table the master no longer has", () => {
  it("removes a free table the master lost, keeping its name on the history", async () => {
    const {
      zoneId,
      ids: [t4],
    } = await plannedZone("T4");
    const { partyId } = await seat(v, t4!);
    await finish(partyId);
    const collected = await delivery(t4!);
    await pay(v, collected, "20.00");
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, collected));
    const uncollected = await delivery(t4!, "Agua");
    await pay(v, uncollected, "2.00");
    await madeHereOnly(uncollected);
    expect(await kitchenItemsOf(uncollected)).toBe(0);
    await deleteFromMaster(t4!);

    await reset(zoneId);

    expect(await tableExists(t4!)).toBe(false);
    expect(await resetRowOf(t4!)).toBeUndefined();
    expect(await todayRow(t4!)).toBeUndefined();
    expect(await billRow(v, collected)).toMatchObject({
      deliveryTableId: null,
      deliveryTableLabel: "T4",
    });
    expect(await billRow(v, uncollected)).toMatchObject({
      status: "settled",
      collectedAt: null,
      deliveryTableId: null,
      deliveryTableLabel: "T4",
    });
    expect((await partyRow(v, partyId)).tableNames).toEqual(["T4"]);
  });

  it("frees the name for a table created in the same catch-up", async () => {
    const {
      zoneId,
      ids: [t1, t2],
    } = await plannedZone("Free 1", "Free 2");
    await deleteFromMaster(t1!);
    await renameInMaster(t2!, "Free 1");

    await reset(zoneId);

    expect(await tableExists(t1!)).toBe(false);
    expect((await tableRow(v, t2!)).label).toBe("Free 1");
  });

  it.each([
    ["a party that moved away and is still open"],
    ["an unpaid order to it"],
    ["food still on its way to it"],
  ])("hides rather than removes a table tied by %s, and removes it once free", async (tie) => {
    const {
      zoneId,
      ids: [t1, t2],
    } = await plannedZone(`Tie 1 ${tie}`, `Tie 2 ${tie}`);
    let free: () => Promise<void>;
    if (tie.startsWith("a party")) {
      const { partyId } = await seat(v, t1!);
      await join(v, partyId, t2!);
      await inTx(v, (tx) => leaveTables(tx, [t1!]));
      free = () => finish(partyId);
    } else if (tie.startsWith("an unpaid")) {
      const order = await delivery(t1!, "Agua");
      free = async () => {
        await pay(v, order, "2.00");
        await madeHereOnly(order);
      };
    } else {
      const order = await delivery(t1!);
      await pay(v, order, "20.00");
      expect(await kitchenItemsOf(order)).toBeGreaterThan(0);
      free = () => inTx(v, (tx) => handOverOrder(tx, v.cfg, order));
    }
    await deleteFromMaster(t1!);

    await reset(zoneId);

    expect(await tableRow(v, t1!)).toMatchObject({ active: false });
    expect(await todayRow(t1!)).toBeUndefined();
    expect(await resetRowOf(t1!)).toMatchObject({ remove: true, pending: true });

    await free();
    await catchUp(zoneId);

    expect(await tableExists(t1!)).toBe(false);
  });

  it("asks each module to let go", async () => {
    const {
      zoneId,
      ids: [t1],
    } = await plannedZone("Let go 1");
    await deleteFromMaster(t1!);
    const released: string[] = [];
    const bookings: TableRemoval = {
      refuse: () => Promise.resolve(),
      release: (_tx, cfg, tableId, label) => {
        released.push(`${cfg.locationId}:${tableId}:${label}`);
        return Promise.resolve();
      },
    };

    await reset(zoneId, [bookings]);

    expect(released).toEqual([`${v.cfg.locationId}:${t1}:Let go 1`]);
    expect(await tableExists(t1!)).toBe(false);
  });

  it("leaves a table something unknown still names, hidden and pending, without failing", async () => {
    const {
      zoneId,
      ids: [t1],
    } = await plannedZone("Stray 1");
    const { partyId } = await seat(v, t1!);
    await finish(partyId);
    await strayPartyRow(partyId, t1!);
    await deleteFromMaster(t1!);

    await reset(zoneId);

    expect(await tableRow(v, t1!)).toMatchObject({ active: false });
    expect(await todayRow(t1!)).toBeUndefined();
    expect(await resetRowOf(t1!)).toMatchObject({ remove: true, pending: true });

    await inTx(v, (tx) => tx.delete(partyTables).where(eq(partyTables.tableId, t1!)));
    await catchUp(zoneId);

    expect(await tableExists(t1!)).toBe(false);
    expect(await resetRowOf(t1!)).toBeUndefined();
  });

  it("gives the last table of a merge its place back", async () => {
    const {
      zoneId,
      ids: [t1, t2],
    } = await plannedZone("Merged 1", "Merged 2");
    await inTx(v, async (tx) => {
      const [merge] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId, seats: 8 })
        .returning({ id: floorTodayJoins.id });
      await tx
        .update(floorTodayTables)
        .set({ x: 50, y: 50, width: 8, height: 8, shape: "rect", rotation: 0 })
        .where(eq(floorTodayTables.tableId, t2!));
      for (const tableId of [t1!, t2!]) {
        await tx
          .insert(floorTodayJoinTables)
          .values({ joinId: merge!.id, tableId, beforeX: 3, beforeY: 4, beforeRotation: 90 });
      }
    });
    await deleteFromMaster(t1!);

    await reset(zoneId);

    expect(await tableExists(t1!)).toBe(false);
    const merges = await inTx(v, (tx) =>
      tx.select().from(floorTodayJoins).where(eq(floorTodayJoins.zoneId, zoneId)),
    );
    expect(merges).toEqual([]);
  });
});

describe("removeLiveTable", () => {
  it("removes nothing when a module refuses to let go", async () => {
    const {
      ids: [t1],
    } = await plannedZone("Refused 1");
    const released: string[] = [];
    const bookings: TableRemoval = {
      refuse: (_tx, cfg, tableId, now) => {
        released.push(`refuse ${cfg.locationId} ${now.toISOString()}`);
        return Promise.reject(new AppError("table.booked", { tableId }));
      },
      release: () => {
        released.push("release");
        return Promise.resolve();
      },
    };
    const order = await delivery(t1!);

    const removed = await inTx(v, (tx) => removeLiveTable(tx, v.cfg, [bookings], t1!, NOW));

    expect(removed).toBe(false);
    expect(released).toEqual([`refuse ${v.cfg.locationId} ${NOW.toISOString()}`]);
    expect(await tableExists(t1!)).toBe(true);
    expect(await todayRow(t1!)).toBeDefined();
    expect(await resetRowOf(t1!)).toBeDefined();
    expect((await billRow(v, order)).deliveryTableId).toBe(t1);
  });

  it("does not swallow a module's failure that is not a refusal", async () => {
    const {
      ids: [t1],
    } = await plannedZone("Broken 1");
    const broken: TableRemoval = {
      refuse: () => Promise.reject(new Error("disk on fire")),
      release: () => Promise.resolve(),
    };

    await expect(inTx(v, (tx) => removeLiveTable(tx, v.cfg, [broken], t1!, NOW))).rejects.toThrow(
      "disk on fire",
    );
  });

  it("keeps a table outside every plan that something unknown still names", async () => {
    const t1 = await v.table("Unplanned 1", await zone());
    const { partyId } = await seat(v, t1);
    await finish(partyId);
    await strayPartyRow(partyId, t1);

    expect(await inTx(v, (tx) => removeLiveTable(tx, v.cfg, NONE, t1, NOW))).toBe(false);
    expect(await tableExists(t1)).toBe(true);
    expect(await resetRowOf(t1)).toBeUndefined();
  });

  it("does not swallow a refusal at the delete that is not a foreign key's", async () => {
    const {
      ids: [t1],
    } = await plannedZone("Guarded 1");

    await expect(
      withTransaction(v.db, async (tx) => {
        await tx.run(
          sql.raw(
            `create temp trigger guard_delete before delete on dining_tables begin select raise(abort, 'guarded'); end`,
          ),
        );
        return removeLiveTable(tx, v.cfg, NONE, t1!, NOW);
      }),
    ).rejects.toThrow();
    expect(await tableExists(t1!)).toBe(true);
  });
});

describe("tableTied", () => {
  it("is false for a table nothing ties", async () => {
    const t1 = await v.table("Untied 1", await zone());

    expect(await inTx(v, (tx) => tableTied(tx, t1))).toBe(false);
  });

  it("is true for a table an open party holds", async () => {
    const t1 = await v.table("Held 1", await zone());
    await seat(v, t1);

    expect(await inTx(v, (tx) => tableTied(tx, t1))).toBe(true);
  });

  it("is true for a placed order delivered to it", async () => {
    const t1 = await v.table("Placed 1", await zone());
    const order = await delivery(t1, "Agua");
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, order)),
    );

    expect(await inTx(v, (tx) => tableTied(tx, t1))).toBe(true);
  });
});
