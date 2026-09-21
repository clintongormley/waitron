// H2 receipt (Step 1): `git diff --stat main -- packages/core/src/record-sale.ts
// packages/fiscal-verifactu/src/backend.ts @waitron/verifactu apps/server/src/till-sale.ts` → no
// changes; `grep -nE 'status_id|statusId|table_service_statuses|tableServiceStatuses'` over those files
// → empty. The reset is a trigger + an openTab edit; the fiscal pay path is byte-unchanged.
import { randomUUID } from "node:crypto";
import { asAppUser, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import "./errors.js";

// A clone of the CORE-only template. The AFTER-UPDATE trigger fires under the non-superuser
// app_user, whose UPDATE on `dining_tables` PGlite's superuser connection would hold regardless, so
// this needs the real cluster the shared container provides; a Docker-absent run fails at the package
// globalSetup, not here.
const suite = useTemplateDb({ template: "core", resetPerTest: false });

function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.admin, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

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
  await seedTenant(suite.admin);
  const loc = await suite.admin.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description)
    values ('Loc', array['es'], 'Hostelería') returning id`);
  locationId = loc.rows[0]!.id;
  const till = await suite.admin.execute<{ id: string }>(sql`
    insert into tills (location_id, name) values (${locationId}, 'A1') returning id`);
  tillId = till.rows[0]!.id;
  nodeId = await seedNode(suite.admin, brandLocationId(locationId));
});

/** Seed a status + an open working order + N tables whose tab_id points at that order, each carrying the
 *  status. Returns { orderId, tableIds }. `orderSeq` keeps order_number unique. */
let orderSeq = 0;
async function seedJoinedTab(tableCount: number): Promise<{ orderId: string; tableIds: string[] }> {
  orderSeq += 1;
  return asApp(async (tx) => {
    const statusId = (
      await tx.execute<{ id: string }>(
        sql`insert into table_service_statuses (label, color) values (${"Bill " + randomUUID()}, '#ef4444') returning id`,
      )
    ).rows[0]!.id;
    const orderId = (
      await tx.execute<{ id: string }>(sql`
        insert into working_orders (till_id, node_id, order_number, status)
        values (${tillId}, ${nodeId}, ${orderSeq}, 'open') returning id`)
    ).rows[0]!.id;
    const tableIds: string[] = [];
    for (let i = 0; i < tableCount; i += 1) {
      const t = (
        await tx.execute<{ id: string }>(sql`
          insert into dining_tables (location_id, label, tab_id, status_id)
          values (${locationId}, ${"T-" + randomUUID()}, ${orderId}, ${statusId}) returning id`)
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

    await asApp((tx) =>
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
    await asApp((tx) =>
      tx.execute(sql`update working_orders set status = 'placed' where id = ${orderId}`),
    );
    expect(await statusOf(tableIds[0]!)).not.toBeNull();

    // placed → settled IS terminal → the broadened WHEN fires and clears the table.
    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${orderId}`,
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
      const statusId = (
        await tx.execute<{ id: string }>(
          sql`insert into table_service_statuses (label, color) values (${"Clean " + randomUUID()}, '#f59e0b') returning id`,
        )
      ).rows[0]!.id;
      return (
        await tx.execute<{ id: string }>(sql`
          insert into dining_tables (location_id, label, status_id)
          values (${locationId}, ${"Free-" + randomUUID()}, ${statusId}) returning id`)
      ).rows[0]!.id;
    });
    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${orderId}`,
      ),
    );
    // The unrelated free table keeps its status — the trigger clears only tables whose tab_id = the order.
    expect(await statusOf(freeTable)).not.toBeNull();
  });
});
