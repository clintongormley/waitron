import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isPgError } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { diningTables } from "./dining-tables.js";
import { tableServiceStatuses } from "./table-service-statuses.js";
import { locations, tenants } from "./tenants.js";

// What this suite proves is the `dining_tables.status_id` FK itself.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ABSENT_STATUS = "99999999-9999-4999-8999-999999999999";

describe("table_service_statuses schema (the dining_tables.status_id FK)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeAll(async () => {
    await suite.db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // The Drizzle builder rather than raw SQL: `id` and `created_at` are `$defaultFn` columns applied
  // CLIENT-side, so a raw `insert` is refused NOT NULL.
  async function seedStatus(label: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(tableServiceStatuses)
        .values({ label, color: "#ef4444" })
        .returning({ id: tableServiceStatuses.id });
      return row!.id;
    });
  }

  it("dining_tables.status_id round-trips and enforces its FK", async () => {
    await suite.db.insert(locations).values({
      id: LOCATION_A,
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    const [table] = await inTx((tx) =>
      tx
        .insert(diningTables)
        .values({ locationId: LOCATION_A, label: "T-status" })
        .returning({ id: diningTables.id }),
    );
    const tableId = table!.id;
    const statusId = await seedStatus("Bill requested TS2");
    await inTx((tx) =>
      tx.update(diningTables).set({ statusId }).where(eq(diningTables.id, tableId)),
    );
    const [row] = await inTx((tx) =>
      tx
        .select({ statusId: diningTables.statusId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId)),
    );
    expect(row!.statusId).toBe(statusId);

    // The FK rejects a status_id that names no row at all.
    const eRandom = await captureError(() =>
      inTx((tx) =>
        tx
          .update(diningTables)
          .set({ statusId: ABSENT_STATUS })
          .where(eq(diningTables.id, tableId)),
      ),
    );
    expect(isPgError(eRandom, FOREIGN_KEY_VIOLATION)).toBe(true);

    // A deleted status is refused the same way: the reference must name a row that exists.
    const goneStatusId = await seedStatus("Deleted status");
    await suite.db.delete(tableServiceStatuses).where(eq(tableServiceStatuses.id, goneStatusId));
    const eGone = await captureError(() =>
      inTx((tx) =>
        tx.update(diningTables).set({ statusId: goneStatusId }).where(eq(diningTables.id, tableId)),
      ),
    );
    expect(isPgError(eGone, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
