import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { diningTables } from "./dining-tables.js";
import { locations, tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: the write and read-back below run as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. What is
// proven is the produced Drizzle export's column mapping (posX -> "pos_x") and the enum/smallint
// decoding of the four placement columns; `app_user`'s grants on the table are pinned by the
// privilege matrix (packages/fiscal-verifactu/src/privileges.expected.ts).
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("dining_tables placement columns", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    const admin = suite.admin;
    await admin
      .insert(tenants)
      .values([{ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        tenantId: TENANT_A,
        name: "Loc A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedTable(tenant: string, location: string, label: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into dining_tables (tenant_id, location_id, label) values (${tenant}, ${location}, ${label}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("exposes the four placement columns through the Drizzle export", async () => {
    const id = await seedTable(TENANT_A, LOCATION_A, "T-placement");
    await asApp(TENANT_A, (tx) =>
      tx
        .update(diningTables)
        .set({ posX: 500, posY: 250, shape: "square", rotation: 15 })
        .where(eq(diningTables.id, id)),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx.select().from(diningTables).where(eq(diningTables.id, id)),
    );
    expect(row).toMatchObject({ posX: 500, posY: 250, shape: "square", rotation: 15 });
  });
});
