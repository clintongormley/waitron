// Real PostgreSQL: exercises reads/writes or triggers after SET ROLE app_user.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTransaction } from "../tenancy.js";
import { tenants } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

describe("table_service_statuses schema (the dining_tables.status_id composite FK)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    void tenant;
    return withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedStatus(tenant: string, label: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into table_service_statuses (label, color) values (${label}, '#ef4444') returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("dining_tables.status_id is writable/readable by the non-owner app_user and enforces the tenant-consistent FK", async () => {
    // Seed a location + a dining table (TS-1) as the owner, then set + read status_id as app_user.
    const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
    await suite.admin.execute(sql`
      insert into locations (id, name, invoice_locales, operation_description) values (${LOCATION_A}, 'Loc A', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    const tableId = await asApp(TENANT_A, async (tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into dining_tables (location_id, label) values (${LOCATION_A}, 'T-status') returning id`,
        )
        .then((r) => r.rows[0]!.id),
    );
    const statusId = await seedStatus(TENANT_A, "Bill requested TS2");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update dining_tables set status_id = ${statusId} where id = ${tableId}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ status_id: string | null }>(
          sql`select status_id from dining_tables where id = ${tableId}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.status_id).toBe(statusId);

    // The FK rejects a status_id that names no row at all (a random uuid) — 23503.
    const eRandom = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`update dining_tables set status_id = '99999999-9999-4999-8999-999999999999' where id = ${tableId}`,
        ),
      ),
    );
    expect(pgErrorCode(eRandom)).toBe("23503"); // foreign_key_violation

    // A deleted status is refused the same way: the reference must name a row that exists.
    const goneStatusId = await seedStatus(TENANT_A, "Deleted status");
    await suite.admin.execute(sql`delete from table_service_statuses where id = ${goneStatusId}`);
    const eGone = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update dining_tables set status_id = ${goneStatusId} where id = ${tableId}`),
      ),
    );
    expect(pgErrorCode(eGone)).toBe("23503"); // foreign_key_violation
  });
});
