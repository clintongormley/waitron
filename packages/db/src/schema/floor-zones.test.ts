import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTransaction } from "../tenancy.js";
import { floorZones } from "./floor-zones.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// cases retain the role switch so the reads and writes still exercise app_user grants.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("floor_zones schema (columns and the dining_tables.zone_id composite FK)", () => {
  const suite = useTemplateDb({ template: "core", resetPerTest: false });

  beforeAll(async () => {
    await suite.admin
      .insert(tenants)
      .values([{ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await suite.admin.execute(sql`
      insert into locations (id, name, invoice_locales, operation_description) values (${LOCATION_A}, 'Loc A', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    void tenant;
    return withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedZone(tenant: string, location: string, name: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into floor_zones (location_id, name) values (${location}, ${name}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("maps display_order and name through the Drizzle export", async () => {
    const id = await seedZone(TENANT_A, LOCATION_A, "Comedor");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update floor_zones set display_order = 5 where id = ${id}`),
    );
    // Read back through the Drizzle `floorZones` export (not raw SQL) — exercises the produced table
    // export and its column mapping under the app role.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(floorZones)
        .where(sql`id = ${id}`),
    );
    expect(row!.displayOrder).toBe(5);
    expect(row!.name).toBe("Comedor");
  });

  it("dining_tables.zone_id is writable/readable by the non-owner app_user and its FK rejects an absent zone", async () => {
    // Seed a dining table (TS-1) and point its new zone_id at a floor_zones row, as app_user.
    const tableId = await asApp(TENANT_A, async (tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into dining_tables (location_id, label) values (${LOCATION_A}, 'T-zone') returning id`,
        )
        .then((r) => r.rows[0]!.id),
    );
    const zoneId = await seedZone(TENANT_A, LOCATION_A, "Salon");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update dining_tables set zone_id = ${zoneId} where id = ${tableId}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ zone_id: string | null }>(
          sql`select zone_id from dining_tables where id = ${tableId}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.zone_id).toBe(zoneId);

    // The FK rejects a zone_id that names no row at all (a random uuid) — 23503.
    const eRandom = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`update dining_tables set zone_id = '99999999-9999-4999-8999-999999999999' where id = ${tableId}`,
        ),
      ),
    );
    expect(pgErrorCode(eRandom)).toBe("23503"); // foreign_key_violation
  });

  it("working_order_lines.served_at is visible and writable by the non-owner app_user", async () => {
    await asApp(TENANT_A, (tx) => tx.execute(sql`select served_at from working_order_lines`));
    const updated = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ served_at: string | null }>(
          sql`update working_order_lines set served_at = now() where id = '99999999-9999-4999-8999-999999999999' returning served_at`,
        )
        .then((r) => r.rows),
    );
    expect(updated).toHaveLength(0); // no such line — but the column + UPDATE privilege both resolved
  });
});
