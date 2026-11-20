import { sql } from "drizzle-orm";
import { foreignKey, index, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, newId, nowIso, table, tsString } from "./columns.js";
import { billPayments } from "./bill-payments.js";
import { workingOrders } from "./orders.js";
import { sales } from "./sales.js";

/**
 * An advance invoice issued against a bill before its own invoice, which the bill's invoice later
 * takes off. `bill_payment_id` is null for an advance paid on a booking.
 */
export const billAdvances = table(
  "bill_advances",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderId: id("working_order_id").notNull(),
    advanceSaleId: id("advance_sale_id").notNull(),
    billPaymentId: id("bill_payment_id"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "bill_advances_working_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.advanceSaleId],
      foreignColumns: [sales.id],
      name: "bill_advances_advance_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.billPaymentId],
      foreignColumns: [billPayments.id],
      name: "bill_advances_bill_payment_fk",
    }).onDelete("restrict"),
    index("bill_advances_working_order_idx").on(t.workingOrderId),
    unique("bill_advances_advance_sale_key").on(t.advanceSaleId),
    uniqueIndex("bill_advances_bill_payment_key")
      .on(t.billPaymentId)
      .where(sql`${t.billPaymentId} is not null`),
  ],
);
