import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { seedNode, seedVenue, seedWorkingOrder } from "../testing/seed.js";
import { venueLocationId } from "../venue.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { diningTables } from "./dining-tables.js";
import { floorZones } from "./floor-zones.js";
import { workingOrders } from "./orders.js";

// The proof by deletion switches off EVERY foreign key at once, so it separates "a foreign key
// refused this" from "a CHECK or a trigger did", not one foreign key from another;
// `pragma foreign_key_list` is read alongside to pin WHICH key covers the column.
let LOCATION_A: string;

/** Runs `body` with every foreign key switched off, restoring enforcement afterwards. The pragma
 * has no effect inside a transaction, so this runs on the handle rather than through
 * `withTransaction`. */
async function withForeignKeysOff(
  db: { run: (statement: ReturnType<typeof sql>) => unknown },
  body: () => Promise<void>,
): Promise<void> {
  db.run(sql`pragma foreign_keys = off`);
  try {
    await body();
  } finally {
    db.run(sql`pragma foreign_keys = on`);
  }
}

describe("an order's delivery table", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  let nodeA = "";
  let orderSeq = 0;

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  beforeAll(async () => {
    const db = suite.db;
    await seedVenue(db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    LOCATION_A = await venueLocationId(db);
    nodeA = await seedNode(db);
  });

  /** One active table. The Drizzle builder, since `id` and `created_at` are `$defaultFn` columns. */
  async function openTable(label: string): Promise<string> {
    return inTx(async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: LOCATION_A, name: label })
        .returning({ id: floorZones.id });
      const [row] = await tx
        .insert(diningTables)
        .values({ locationId: LOCATION_A, label, zoneId: zone!.id })
        .returning({ id: diningTables.id });
      return row!.id;
    });
  }

  /** One open working order. */
  async function openWo(): Promise<string> {
    orderSeq += 1;
    return inTx(async (tx) => {
      const row = await seedWorkingOrder(tx, {
        source: "dashboard",
        deviceId: null,
        nodeId: nodeA,
        orderNumber: orderSeq,
        status: "open",
      });
      return row!.id;
    });
  }

  it("working_orders.delivery_table_id round-trips a table's id", async () => {
    const tableId = await openTable("T-delivered");
    const woId = await openWo();
    await inTx((tx) =>
      tx.update(workingOrders).set({ deliveryTableId: tableId }).where(eq(workingOrders.id, woId)),
    );
    const [order] = await inTx((tx) =>
      tx
        .select({ deliveryTableId: workingOrders.deliveryTableId })
        .from(workingOrders)
        .where(eq(workingOrders.id, woId)),
    );
    expect(order!.deliveryTableId).toBe(tableId);
  });

  it("working_orders.delivery_table_id is covered by a foreign key at dining_tables.id, and that key is what refuses a dangling pointer", async () => {
    const woId = await openWo();
    const keys = suite.db.all<{ table: string; from: string; to: string }>(
      sql.raw(`select "table", "from", "to" from pragma_foreign_key_list('working_orders')`),
    );
    expect(keys.filter((key) => key.from === "delivery_table_id")).toEqual([
      { table: "dining_tables", from: "delivery_table_id", to: "id" },
    ]);

    const e = await captureError(() =>
      inTx((tx) =>
        tx
          .update(workingOrders)
          .set({ deliveryTableId: randomUUID() })
          .where(eq(workingOrders.id, woId)),
      ),
    );
    expect(isRefusal(e, FOREIGN_KEY_VIOLATION)).toBe(true);

    await withForeignKeysOff(suite.db, async () => {
      await inTx((tx) =>
        tx
          .update(workingOrders)
          .set({ deliveryTableId: randomUUID() })
          .where(eq(workingOrders.id, woId)),
      );
    });
    await inTx((tx) =>
      tx.update(workingOrders).set({ deliveryTableId: null }).where(eq(workingOrders.id, woId)),
    );
  });
});
