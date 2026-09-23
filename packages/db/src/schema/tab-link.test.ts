import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isPgError } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { diningTables } from "./dining-tables.js";
import { workingOrders } from "./orders.js";
import { locations, tenants, tills } from "./tenants.js";

// LOSS, from the storage swap: the two columns' visibility to the non-owner `app_user` was half of
// what this suite asserted, and SQLite has no roles and no grants. What is left is the two mutual
// foreign keys.
//
// SECOND LOSS, at the two proofs-by-deletion. On PostgreSQL each dropped ITS OWN named constraint
// (`dining_tables_tab_fk`, `working_orders_delivery_table_fk`) inside a rolled-back transaction, so
// the proof was about that one key. SQLite has no `ALTER TABLE … DROP CONSTRAINT` and stores no
// name for a foreign key at all, so the deletion available here is `pragma foreign_keys = off`,
// which switches off EVERY foreign key at once. That still separates "a foreign key refused this"
// from "a CHECK or a trigger did", which is the discrimination the proof was for; it no longer
// separates one foreign key from another. `pragma foreign_key_list` is read alongside it to pin
// WHICH key covers the column, which is the half the pragma cannot show.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A = "aaaaaaaa-1111-4000-8000-000000000001";

/** Runs `body` with every foreign key switched off, restoring enforcement afterwards. The pragma
 * is refused inside a transaction, so this runs on the handle rather than through
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

describe("table↔tab link columns (mutual FKs)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  let nodeA = "";
  let orderSeq = 0;

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  beforeAll(async () => {
    const db = suite.db;
    await db.insert(tenants).values({ id: 1, country: "ES", taxId: "B00000000", legalName: "T A" });
    await db.insert(locations).values({
      id: LOCATION_A,
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await db.insert(tills).values({ id: TILL_A, locationId: LOCATION_A, name: "A1" });
    nodeA = await seedNode(db, brandLocationId(LOCATION_A));
  });

  /** One active table. The Drizzle builder, since `id` and `created_at` are `$defaultFn` columns. */
  async function openTable(label: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(diningTables)
        .values({ locationId: LOCATION_A, label })
        .returning({ id: diningTables.id });
      return row!.id;
    });
  }

  /** One open working order. */
  async function openWo(): Promise<string> {
    orderSeq += 1;
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(workingOrders)
        .values({ tillId: TILL_A, nodeId: nodeA, orderNumber: orderSeq, status: "open" })
        .returning({ id: workingOrders.id });
      return row!.id;
    });
  }

  it("the two link columns round-trip and each FK resolves a valid reference", async () => {
    const tableId = await openTable("T-vis");
    const woId = await openWo();
    await inTx((tx) =>
      tx.update(diningTables).set({ tabId: woId }).where(eq(diningTables.id, tableId)),
    );
    await inTx((tx) =>
      tx.update(workingOrders).set({ deliveryTableId: tableId }).where(eq(workingOrders.id, woId)),
    );
    const [table] = await inTx((tx) =>
      tx
        .select({ tabId: diningTables.tabId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId)),
    );
    const [order] = await inTx((tx) =>
      tx
        .select({ deliveryTableId: workingOrders.deliveryTableId })
        .from(workingOrders)
        .where(eq(workingOrders.id, woId)),
    );
    expect(table!.tabId).toBe(woId);
    expect(order!.deliveryTableId).toBe(tableId);
  });

  it("dining_tables.tab_id is covered by a foreign key at working_orders.id, and that key is what refuses a dangling pointer", async () => {
    const tableId = await openTable("T-tabfk");
    const keys = suite.db.all<{ table: string; from: string; to: string }>(
      sql.raw(`select "table", "from", "to" from pragma_foreign_key_list('dining_tables')`),
    );
    expect(keys.filter((key) => key.from === "tab_id")).toEqual([
      { table: "working_orders", from: "tab_id", to: "id" },
    ]);

    const e = await captureError(() =>
      inTx((tx) =>
        tx.update(diningTables).set({ tabId: randomUUID() }).where(eq(diningTables.id, tableId)),
      ),
    );
    expect(isPgError(e, FOREIGN_KEY_VIOLATION)).toBe(true);

    // Proof by deletion: with foreign keys off, the same dangling pointer is accepted.
    await withForeignKeysOff(suite.db, async () => {
      await inTx((tx) =>
        tx.update(diningTables).set({ tabId: randomUUID() }).where(eq(diningTables.id, tableId)),
      );
    });
    // Put the row back to a value the restored key accepts, so it does not outlive this case.
    await inTx((tx) =>
      tx.update(diningTables).set({ tabId: null }).where(eq(diningTables.id, tableId)),
    );
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
    expect(isPgError(e, FOREIGN_KEY_VIOLATION)).toBe(true);

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
