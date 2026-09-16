import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTransaction } from "../tenancy.js";
import { diningTables } from "./dining-tables.js";
import { locations, tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: the write and read-back below run as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. What is
// proven is the produced Drizzle export's column mapping (posX -> "pos_x") and the enum/smallint
// decoding of the four placement columns; `app_user`'s grants on the table are pinned by the
// privilege matrix (packages/fiscal-verifactu/src/privileges.expected.ts).
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("dining_tables placement columns", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    const admin = suite.admin;
    await admin
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Loc A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
  });

  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedTable(location: string, label: string): Promise<string> {
    return asApp(async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into dining_tables (location_id, label) values (${location}, ${label}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("exposes the four placement columns through the Drizzle export", async () => {
    const id = await seedTable(LOCATION_A, "T-placement");
    await asApp((tx) =>
      tx
        .update(diningTables)
        .set({ posX: 500, posY: 250, shape: "square", rotation: 15 })
        .where(eq(diningTables.id, id)),
    );
    const [row] = await asApp((tx) =>
      tx.select().from(diningTables).where(eq(diningTables.id, id)),
    );
    expect(row).toMatchObject({ posX: 500, posY: 250, shape: "square", rotation: 15 });
  });
});
