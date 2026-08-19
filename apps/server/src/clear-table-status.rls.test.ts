// H2 receipt (Step 1): `git diff --stat main -- packages/core/src/record-sale.ts
// packages/fiscal-verifactu/src/backend.ts packages/verifactu/ apps/server/src/till-sale.ts` → no
// changes; `grep -nE 'status_id|statusId|table_service_statuses|tableServiceStatuses'` over those files
// → empty. The reset is a trigger + an openTab edit; the fiscal pay path is byte-unchanged.
import { randomUUID } from "node:crypto";
import { asAppUser, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "@waitron/db/testing/postgres.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import "./errors.js";

const suite = useRealPostgres({
  start: () =>
    startMigratedPostgres({
      dockerRequired:
        "The clear-table-status trigger suite requires Docker: the AFTER-UPDATE trigger runs as the " +
        "non-superuser app_user and its same-tenant UPDATE under RLS is a false pass on PGlite.",
      migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    }),
  timeoutMs: 120_000,
});

function asApp<T>(tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

let tenantId = "";
let tillId = "";
let nodeId = "";
let locationId = "";

async function statusOf(tableId: string): Promise<string | null> {
  const { rows } = await suite.admin.execute<{ status_id: string | null }>(
    sql`select status_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.status_id;
}

beforeAll(async () => {
  tenantId = await seedTenant(suite.admin);
  const loc = await suite.admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Loc', array['es'], 'Hostelería') returning id`);
  locationId = loc.rows[0]!.id;
  const till = await suite.admin.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'A1') returning id`);
  tillId = till.rows[0]!.id;
  nodeId = await seedNode(suite.admin, brandTenantId(tenantId), brandLocationId(locationId));
});

/** Seed a status + an open working order + N tables whose tab_id points at that order, each carrying the
 *  status. Returns { orderId, tableIds }. `orderSeq` keeps order_number unique. */
let orderSeq = 0;
async function seedJoinedTab(tableCount: number): Promise<{ orderId: string; tableIds: string[] }> {
  orderSeq += 1;
  return asApp(tenantId, async (tx) => {
    const statusId = (
      await tx.execute<{ id: string }>(
        sql`insert into table_service_statuses (tenant_id, label, color) values (${tenantId}, ${"Bill " + randomUUID()}, '#ef4444') returning id`,
      )
    ).rows[0]!.id;
    const orderId = (
      await tx.execute<{ id: string }>(sql`
        insert into working_orders (tenant_id, till_id, node_id, order_number, status)
        values (${tenantId}, ${tillId}, ${nodeId}, ${orderSeq}, 'open') returning id`)
    ).rows[0]!.id;
    const tableIds: string[] = [];
    for (let i = 0; i < tableCount; i += 1) {
      const t = (
        await tx.execute<{ id: string }>(sql`
          insert into dining_tables (tenant_id, location_id, label, tab_id, status_id)
          values (${tenantId}, ${locationId}, ${"T-" + randomUUID()}, ${orderId}, ${statusId}) returning id`)
      ).rows[0]!.id;
      tableIds.push(t);
    }
    return { orderId, tableIds };
  });
}

describe("working_orders_clear_table_status (reset-on-turnover)", () => {
  it("settling a tab that covers TWO joined tables clears status_id on BOTH", async () => {
    const { orderId, tableIds } = await seedJoinedTab(2);
    expect(await statusOf(tableIds[0]!)).not.toBeNull();
    expect(await statusOf(tableIds[1]!)).not.toBeNull();

    await asApp(tenantId, (tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${orderId}`,
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
    await asApp(tenantId, (tx) =>
      tx.execute(sql`update working_orders set status = 'placed' where id = ${orderId}`),
    );
    expect(await statusOf(tableIds[0]!)).not.toBeNull();

    // placed → settled IS terminal → the broadened WHEN fires and clears the table.
    await asApp(tenantId, (tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${orderId}`,
      ),
    );
    expect(await statusOf(tableIds[0]!)).toBeNull();
  });

  it("abandoning a tab clears its table's status too", async () => {
    const { orderId, tableIds } = await seedJoinedTab(1);
    await asApp(tenantId, (tx) =>
      tx.execute(sql`update working_orders set status = 'abandoned' where id = ${orderId}`),
    );
    expect(await statusOf(tableIds[0]!)).toBeNull();
  });

  it("a status on a FREE table is NOT cleared when an UNRELATED tab settles (needs-cleaning still shows)", async () => {
    // A free table (no tab) carrying a status.
    const { orderId } = await seedJoinedTab(1); // the tab that will settle
    const freeTable = await asApp(tenantId, async (tx) => {
      const statusId = (
        await tx.execute<{ id: string }>(
          sql`insert into table_service_statuses (tenant_id, label, color) values (${tenantId}, ${"Clean " + randomUUID()}, '#f59e0b') returning id`,
        )
      ).rows[0]!.id;
      return (
        await tx.execute<{ id: string }>(sql`
          insert into dining_tables (tenant_id, location_id, label, status_id)
          values (${tenantId}, ${locationId}, ${"Free-" + randomUUID()}, ${statusId}) returning id`)
      ).rows[0]!.id;
    });
    await asApp(tenantId, (tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${orderId}`,
      ),
    );
    // The unrelated free table keeps its status — the trigger clears only tables whose tab_id = the order.
    expect(await statusOf(freeTable)).not.toBeNull();
  });
});
