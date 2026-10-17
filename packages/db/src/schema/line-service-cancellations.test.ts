import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { checkFailed } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { isRefusal } from "../unique-violation.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations } from "./tenants.js";

const ACTOR = "cccccccc-2222-4000-8000-000000000001";
const AT = "2026-10-17T10:00:00.000Z";

describe("charged service cancellations", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  async function fixture() {
    return withTransaction(suite.db, async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({
          name: "Dining room",
          invoiceLocales: ["en"],
          operationDescription: "Restaurant",
        })
        .returning();
      const [bill] = await tx
        .insert(workingOrders)
        .values({
          source: "dashboard",
          locationId: location!.id,
          orderNumber: 1,
        })
        .returning();
      const [line] = await tx
        .insert(workingOrderLines)
        .values({
          workingOrderId: bill!.id,
          lineNo: 1,
          name: "Recorded dish",
          descriptions: { en: "Recorded dish" },
          quantity: 3000,
          priceQuantity: 1000,
          unitPriceGross: 750,
          vatClass: "reduced",
          lineTotal: 2250,
        })
        .returning();
      return { bill: bill!, line: line! };
    });
  }

  function record(lineId: string, quantity = 2000, started = false) {
    return withTransaction(suite.db, (tx) =>
      tx.execute(sql`
      insert into line_service_cancellations (line_id, quantity, cancelled_at, was_started, actor_id)
      values (${lineId}, ${quantity}, ${AT}, ${started ? 1 : 0}, ${ACTOR}) returning *
    `),
    );
  }

  it("stores cancelled service separately from the full bill charge", async () => {
    const tables = await suite.db.execute(sql`
      select name from sqlite_master where type = 'table' and name = 'line_service_cancellations'
    `);
    expect(tables.rows).toEqual([{ name: "line_service_cancellations" }]);
    const { bill, line } = await fixture();
    await expect(record(line.id, 2000, true)).resolves.toMatchObject({
      rows: [
        {
          line_id: line.id,
          quantity: 2000,
          cancelled_at: AT,
          was_started: 1,
          actor_id: ACTOR,
        },
      ],
    });
    expect(
      await suite.db.select().from(workingOrders).where(eq(workingOrders.id, bill.id)),
    ).toEqual([bill]);
    expect(
      await suite.db.select().from(workingOrderLines).where(eq(workingOrderLines.id, line.id)),
    ).toEqual([line]);
  });

  it.each([0, -1000])("refuses nonpositive cancellation quantity %s", async (quantity) => {
    const { line } = await fixture();
    const error = await captureError(() => record(line.id, quantity));
    expect(checkFailed(error, "line_service_cancellations_quantity_ck")).toBe(true);
  });

  it("refuses a cancellation without its bill line", async () => {
    const error = await captureError(() => record(randomUUID()));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("keeps one cumulative record per line", async () => {
    const { line } = await fixture();
    await record(line.id);
    const error = await captureError(() => record(line.id, 1000));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(
      (
        await suite.db.execute(
          sql`select quantity from line_service_cancellations where line_id = ${line.id}`,
        )
      ).rows,
    ).toEqual([{ quantity: 2000 }]);
  });

  it("removes service state when its unfiled bill line is deleted", async () => {
    const { line } = await fixture();
    await record(line.id);
    await withTransaction(suite.db, (tx) =>
      tx.delete(workingOrderLines).where(eq(workingOrderLines.id, line.id)),
    );
    expect(
      (
        await suite.db.execute(
          sql`select * from line_service_cancellations where line_id = ${line.id}`,
        )
      ).rows,
    ).toEqual([]);
  });
});
