import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, billPayments, invoiceSeries, sales, withTransaction } from "@waitron/db";
import { seedPerson, seedWorkingOrder as seedOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { carryProviderRows } from "./carry.js";
import { payments } from "./schema/payments.js";
import { seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const AT = "2026-07-22T10:00:00.000Z";

describe("carryProviderRows", () => {
  it("sends no update when no bill payment is named", async () => {
    await withTransaction(suite.db, async (tx) => {
      const update = vi.spyOn(tx, "update");
      await carryProviderRows(tx, {
        billPaymentIds: [],
        toWorkingOrderId: "00000000-0000-4000-8000-000000000001",
      });
      expect(update).not.toHaveBeenCalled();
    });
  });

  it("moves the named rows to the bill with no sale", async () => {
    const seeded = await seedWorkingOrder(suite.db);
    const printed = seeded.workingOrderId;
    const requestedBy = await seedPerson(suite.db, { displayName: "Cashier" });
    const [series] = await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: seeded.nodeId, code: "R" })
      .returning({ id: invoiceSeries.id });
    const [ticket] = await suite.db
      .insert(sales)
      .values({
        source: "device",
        deviceId: seeded.deviceId,
        nodeId: seeded.nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        workingOrderId: printed,
        issuedAt: AT,
        issuedOffsetMinutes: 60,
        total: 3000,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "fake",
        fiscalState: "not_applicable",
      })
      .returning({ id: sales.id });
    /** A received card payment on the printed bill and its provider row. */
    const card = async (ref: string, linked: boolean) => {
      const [bp] = await suite.db
        .insert(billPayments)
        .values({
          workingOrderId: printed,
          submissionId: ref,
          fingerprint: ref,
          kind: "contribution",
          method: "card",
          applied: 1000,
          state: "received",
          receivedAt: AT,
          requestedBy,
          source: "device",
          deviceId: seeded.deviceId,
        })
        .returning({ id: billPayments.id });
      const [row] = await suite.db
        .insert(payments)
        .values({
          workingOrderId: printed,
          billPaymentId: bp!.id,
          saleId: linked ? ticket!.id : null,
          source: "device",
          deviceId: seeded.deviceId,
          nodeId: seeded.nodeId,
          provider: "fake",
          paymentRef: ref,
          amount: 1000,
          state: "captured",
          settledAt: AT,
          createdAt: AT,
        })
        .returning({ id: payments.id });
      return { billPaymentId: bp!.id, rowId: row!.id };
    };
    const linked = await card("linked", true);
    const unlinked = await card("unlinked", false);
    const other = await card("other", true);
    await suite.db.execute(sql`update working_orders set status = 'placed' where id = ${printed}`);
    const reopened = (await seedOrder(suite.db, { source: "device", deviceId: seeded.deviceId }))
      .id;
    await suite.db.execute(
      sql`update working_orders set reopened_from = ${printed} where id = ${reopened}`,
    );
    await suite.db.execute(
      sql`update working_orders set status = 'abandoned' where id = ${printed}`,
    );
    const carried = [linked.billPaymentId, unlinked.billPaymentId];
    for (const id of carried) {
      await suite.db.execute(
        sql`update bill_payments set working_order_id = ${reopened} where id = ${id}`,
      );
    }

    await withTransaction(suite.db, (tx) =>
      carryProviderRows(tx, {
        billPaymentIds: carried,
        toWorkingOrderId: reopened,
      }),
    );

    const rows = await suite.db
      .select({ id: payments.id, workingOrderId: payments.workingOrderId, saleId: payments.saleId })
      .from(payments);
    expect(new Map(rows.map((row) => [row.id, row]))).toEqual(
      new Map([
        [linked.rowId, { id: linked.rowId, workingOrderId: reopened, saleId: null }],
        [unlinked.rowId, { id: unlinked.rowId, workingOrderId: reopened, saleId: null }],
        [other.rowId, { id: other.rowId, workingOrderId: printed, saleId: ticket!.id }],
      ]),
    );
  });
});
