import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { diningTables } from "./dining-tables.js";
import { locations, tenants } from "./tenants.js";

// What is proven is the produced Drizzle export's column mapping (posX -> "pos_x") and the decoding
// of the four placement columns.
//
// LOSS, from the storage swap: this suite used to run its write and read-back as the non-owner
// `app_user` on a real PostgreSQL, so it also established that the deployment role held the grants
// the columns needed. SQLite has no roles and no grants, so nothing here says anything about who
// may write — that question does not exist on this engine (`packages/db/src/testing/roles.ts`).
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("dining_tables placement columns", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeAll(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await db.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Loc A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Through the Drizzle builder rather than raw SQL: `dining_tables.id` takes its value from a
  // `$defaultFn` that Drizzle applies CLIENT-side, so a raw `insert` never reaches it and the row
  // is refused `NOT NULL constraint failed: dining_tables.id`.
  async function seedTable(location: string, label: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(diningTables)
        .values({ locationId: location, label })
        .returning({ id: diningTables.id });
      return row!.id;
    });
  }

  it("exposes the four placement columns through the Drizzle export", async () => {
    const id = await seedTable(LOCATION_A, "T-placement");
    await inTx((tx) =>
      tx
        .update(diningTables)
        .set({ posX: 500, posY: 250, shape: "square", rotation: 15 })
        .where(eq(diningTables.id, id)),
    );
    const [row] = await inTx((tx) => tx.select().from(diningTables).where(eq(diningTables.id, id)));
    expect(row).toMatchObject({ posX: 500, posY: 250, shape: "square", rotation: 15 });
  });
});
