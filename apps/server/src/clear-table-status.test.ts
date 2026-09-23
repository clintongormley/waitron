// H2 receipt (Step 1): `git diff --stat main -- packages/core/src/record-sale.ts
// packages/fiscal-verifactu/src/backend.ts @waitron/verifactu apps/server/src/till-sale.ts` → no
// changes; `grep -nE 'status_id|statusId|table_service_statuses|tableServiceStatuses'` over those files
// → empty. The reset is a trigger + an openTab edit; the fiscal pay path is byte-unchanged.
import { randomUUID } from "node:crypto";
import {
  CORE_MIGRATIONS,
  asAppUser,
  diningTables,
  locations,
  nowIso,
  tableServiceStatuses,
  tills,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import "./errors.js";

// The core migration set alone: the trigger under test, its two tables and the working order are
// all core. `resetPerTest: false` — the venue, till and node seeded once in `beforeAll` are read by
// every case, and each case seeds its own tab.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  resetPerTest: false,
  timeoutMs: 60_000,
});

function asApp<T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

let tillId = "";
let nodeId = "";
let locationId = "";

async function statusOf(tableId: string): Promise<string | null> {
  const { rows } = await suite.db.execute<{ status_id: string | null }>(
    sql`select status_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.status_id;
}

beforeAll(async () => {
  await seedTenant(suite.db);
  // Inserted through the table definitions, the change `apps/server/src/testing/fiscal-fixtures.ts`
  // took: `locations.id`, `tills.id` and `tills.created_at` are `$defaultFn` generators on this
  // engine and a raw insert reaches none of them (all three columns are NOT NULL —
  // `packages/db/drizzle/0000_baseline.sql:2` and `:40`), and `invoice_locales` is a JSON array in
  // a text column, which is what refused the `array[...]` constructor that used to fill it
  // (`near "['es']": syntax error`).
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Loc", invoiceLocales: ["es"], operationDescription: "Hostelería" })
    .returning({ id: locations.id });
  locationId = location!.id;
  const [till] = await suite.db
    .insert(tills)
    .values({ locationId, name: "A1" })
    .returning({ id: tills.id });
  tillId = till!.id;
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
});

/** Seed a status + an open working order + N tables whose tab_id points at that order, each carrying the
 *  status. Returns { orderId, tableIds }. `orderSeq` keeps order_number unique. */
let orderSeq = 0;
async function seedJoinedTab(tableCount: number): Promise<{ orderId: string; tableIds: string[] }> {
  orderSeq += 1;
  return asApp(async (tx) => {
    // Through the table definitions for the same reason as the venue rows above — every `id` here,
    // plus `table_service_statuses.created_at`, `working_orders.opened_at` and
    // `dining_tables.created_at`, is a `$defaultFn` generator filling a NOT NULL column
    // (`packages/db/drizzle/0000_baseline.sql:517`, `:522`, `:114`, `:120`, `:161`, `:167`).
    const [status] = await tx
      .insert(tableServiceStatuses)
      .values({ label: `Bill ${randomUUID()}`, color: "#ef4444" })
      .returning({ id: tableServiceStatuses.id });
    const statusId = status!.id;
    const [order] = await tx
      .insert(workingOrders)
      .values({ tillId, nodeId, orderNumber: orderSeq, status: "open" })
      .returning({ id: workingOrders.id });
    const orderId = order!.id;
    const tableIds: string[] = [];
    for (let i = 0; i < tableCount; i += 1) {
      const [row] = await tx
        .insert(diningTables)
        .values({ locationId, label: `T-${randomUUID()}`, tabId: orderId, statusId })
        .returning({ id: diningTables.id });
      tableIds.push(row!.id);
    }
    return { orderId, tableIds };
  });
}

describe("working_orders_clear_table_status (reset-on-turnover)", () => {
  it("settling a tab that covers TWO joined tables clears status_id on BOTH", async () => {
    const { orderId, tableIds } = await seedJoinedTab(2);
    expect(await statusOf(tableIds[0]!)).not.toBeNull();
    expect(await statusOf(tableIds[1]!)).not.toBeNull();

    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${orderId}`,
      ),
    );
    expect(await statusOf(tableIds[0]!)).toBeNull();
    expect(await statusOf(tableIds[1]!)).toBeNull();
  });

  it("a tab that goes open→placed→settled ALSO has its table's status_id cleared (WHEN covers placed→terminal)", async () => {
    // placeOrder(tabId) → pay walks a tab open → placed → settled (placeOrder carries no guard that
    // the order is not a tab — a separate follow-up), so the reset-on-turnover WHEN must fire on
    // placed→terminal too, not only open→terminal. enforce_transition (0030) permits open→placed and
    // placed→settled, and the AFTER trigger's broadened WHEN clears the table on the settle.
    const { orderId, tableIds } = await seedJoinedTab(1);
    expect(await statusOf(tableIds[0]!)).not.toBeNull();

    // open → placed is NOT terminal, so the status is not cleared here (NEW.status not settled/abandoned).
    await asApp((tx) =>
      tx.execute(sql`update working_orders set status = 'placed' where id = ${orderId}`),
    );
    expect(await statusOf(tableIds[0]!)).not.toBeNull();

    // placed → settled IS terminal → the broadened WHEN fires and clears the table.
    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${orderId}`,
      ),
    );
    expect(await statusOf(tableIds[0]!)).toBeNull();
  });

  it("abandoning a tab clears its table's status too", async () => {
    const { orderId, tableIds } = await seedJoinedTab(1);
    await asApp((tx) =>
      tx.execute(sql`update working_orders set status = 'abandoned' where id = ${orderId}`),
    );
    expect(await statusOf(tableIds[0]!)).toBeNull();
  });

  it("a status on a FREE table is NOT cleared when an UNRELATED tab settles (needs-cleaning still shows)", async () => {
    // A free table (no tab) carrying a status.
    const { orderId } = await seedJoinedTab(1); // the tab that will settle
    const freeTable = await asApp(async (tx) => {
      const [status] = await tx
        .insert(tableServiceStatuses)
        .values({ label: `Clean ${randomUUID()}`, color: "#f59e0b" })
        .returning({ id: tableServiceStatuses.id });
      const [row] = await tx
        .insert(diningTables)
        .values({ locationId, label: `Free-${randomUUID()}`, statusId: status!.id })
        .returning({ id: diningTables.id });
      return row!.id;
    });
    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${orderId}`,
      ),
    );
    // The unrelated free table keeps its status — the trigger clears only tables whose tab_id = the order.
    expect(await statusOf(freeTable)).not.toBeNull();
  });
});
