import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Database, Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { locations, tenants, tills } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A = "aaaaaaaa-1111-4000-8000-000000000001";

class RollbackSignal extends Error {}
async function rollBackAfter(
  admin: Database,
  tenant: string,
  fn: (tx: Transaction) => Promise<void>,
): Promise<void> {
  await withTenant(admin, tenant, async (tx) => {
    await fn(tx);
    throw new RollbackSignal();
  }).catch((error: unknown) => {
    if (!(error instanceof RollbackSignal)) throw error;
  });
}

describe("table↔tab link columns (mutual composite FKs)", () => {
  const suite = useTemplateDb({ template: "core" });

  let nodeA = "";
  let orderSeq = 0;

  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  beforeAll(async () => {
    const admin = suite.admin;
    await admin
      .insert(tenants)
      .values({ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "T A" });
    await admin.insert(locations).values({
      id: LOCATION_A,
      tenantId: TENANT_A,
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await admin
      .insert(tills)
      .values({ id: TILL_A, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" });
    nodeA = await seedNode(admin, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  });

  /** Insert one active table as app_user; returns its id. */
  async function openTable(label: string): Promise<string> {
    return asApp(async (tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into dining_tables (tenant_id, location_id, label) values (${TENANT_A}, ${LOCATION_A}, ${label}) returning id`,
        )
        .then((r) => r.rows[0]!.id),
    );
  }

  /** Insert one open working order as app_user; returns its id. */
  async function openWo(): Promise<string> {
    orderSeq += 1;
    return asApp(async (tx) =>
      tx
        .execute<{ id: string }>(
          sql`
          insert into working_orders (tenant_id, till_id, node_id, order_number, status)
          values (${TENANT_A}, ${TILL_A}, ${nodeA}, ${orderSeq}, 'open') returning id`,
        )
        .then((r) => r.rows[0]!.id),
    );
  }

  it("the new columns are visible/writable to the non-owner app_user under the existing policies", async () => {
    // Differential: setting the tab_id back-pointer AND a delivery_table_id as app_user both succeed and
    // read back. Fails if the tables' existing grants did not already cover the added columns (they are
    // table-wide, so they do — the confirmation §2b calls for). Also proves each FK RESOLVES a valid ref.
    const tableId = await openTable("T-vis");
    const woId = await openWo();
    await asApp((tx) =>
      tx.execute(sql`update dining_tables set tab_id = ${woId} where id = ${tableId}`),
    );
    await asApp((tx) =>
      tx.execute(sql`update working_orders set delivery_table_id = ${tableId} where id = ${woId}`),
    );
    const back = await asApp((tx) =>
      tx
        .execute<{ tab_id: string | null; delivery_table_id: string | null }>(
          sql`
          select dt.tab_id, wo.delivery_table_id
          from dining_tables dt join working_orders wo on wo.id = ${woId}
          where dt.id = ${tableId}`,
        )
        .then((r) => r.rows[0]!),
    );
    expect(back.tab_id).toBe(woId);
    expect(back.delivery_table_id).toBe(tableId);
  });

  it("dining_tables_tab_fk rejects a tab_id that points at no working order — proven by deletion", async () => {
    const tableId = await openTable("T-tabfk");
    const e = await captureError(() =>
      asApp((tx) =>
        tx.execute(sql`update dining_tables set tab_id = ${randomUUID()} where id = ${tableId}`),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation

    // Prove-by-deletion: drop the FK in a rolled-back tx, and the same dangling pointer is accepted.
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`alter table dining_tables drop constraint dining_tables_tab_fk`);
      await tx.execute(sql`set local role app_user`);
      await tx.execute(
        sql`update dining_tables set tab_id = ${randomUUID()} where id = ${tableId}`,
      );
      // no throw — the FK was the guard.
    });
  });

  it("working_orders_delivery_table_fk rejects a delivery_table_id that points at no table — proven by deletion", async () => {
    const woId = await openWo();
    const e = await captureError(() =>
      asApp((tx) =>
        tx.execute(
          sql`update working_orders set delivery_table_id = ${randomUUID()} where id = ${woId}`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503");

    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(
        sql`alter table working_orders drop constraint working_orders_delivery_table_fk`,
      );
      await tx.execute(sql`set local role app_user`);
      await tx.execute(
        sql`update working_orders set delivery_table_id = ${randomUUID()} where id = ${woId}`,
      );
      // no throw — the FK was the guard.
    });
  });
});
