import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { floorZones } from "./floor-zones.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// cases retain the role switch so the reads and writes still exercise app_user grants.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";

describe("floor_zones schema (columns and the dining_tables.zone_id composite FK)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería'),
        (${LOCATION_B}, ${TENANT_B}, 'Loc B', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedZone(tenant: string, location: string, name: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into floor_zones (tenant_id, location_id, name) values (${tenant}, ${location}, ${name}) returning id`,
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

  it("dining_tables.zone_id is writable/readable by the non-owner app_user and enforces the tenant-consistent FK", async () => {
    // Seed a dining table (TS-1) and point its new zone_id at a floor_zones row, as app_user.
    const tableId = await asApp(TENANT_A, async (tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into dining_tables (tenant_id, location_id, label) values (${TENANT_A}, ${LOCATION_A}, 'T-zone') returning id`,
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

    // The FK rejects a zone_id that names no row at all (a random uuid) — 23503. Proves FK EXISTENCE;
    // a single-column FK would reject it identically, so this alone does not distinguish the composite
    // (tenant_id, zone_id) FK from a single-column one.
    const eRandom = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`update dining_tables set zone_id = '99999999-9999-4999-8999-999999999999' where id = ${tableId}`,
        ),
      ),
    );
    expect(pgErrorCode(eRandom)).toBe("23503"); // foreign_key_violation

    // The case a SINGLE-COLUMN FK would let through: a zone that genuinely EXISTS but belongs to
    // another tenant. B seeds a real zone (committed — `asApp` does not roll back), then A points its
    // dining_table at B's zone id. A single-column FK on zone_id alone would find B's row and PASS; the
    // composite FK requires a `floor_zones` row with (tenant_id = TENANT_A, id = B's id), which does not
    // exist (B's row carries tenant_id = TENANT_B), so it is a 23503. This is what makes the title
    // ("tenant-consistent FK") honest — it distinguishes composite from single-column.
    const foreignZoneId = await seedZone(TENANT_B, LOCATION_B, "B's zone");
    const eForeign = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update dining_tables set zone_id = ${foreignZoneId} where id = ${tableId}`),
      ),
    );
    expect(pgErrorCode(eForeign)).toBe("23503"); // (TENANT_A, B's id) has no match
  });

  it("working_order_lines.served_at is visible and writable by the non-owner app_user", async () => {
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`select served_at from working_order_lines where tenant_id = ${TENANT_A}`),
    );
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
