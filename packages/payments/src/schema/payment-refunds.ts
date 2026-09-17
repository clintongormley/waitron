import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum } from "drizzle-orm/pg-core";
import { id, label, money, table, tsString } from "@waitron/db";
import { payments } from "./payments.js";

/** One refund movement's outcome. 4a: `succeeded` (money returned) or `failed`. */
export const paymentRefundState = pgEnum("payment_refund_state", ["succeeded", "failed"]);

/**
 * One row per refund — a distinct money movement referencing the original capture, never a
 * mutation of it. The aggregate (has the whole capture been returned, or only part?) is reflected
 * on `payments.state` (`refunded` / `partially_refunded`); this table is the itemised trail.
 */
export const paymentRefunds = table(
  "payment_refunds",
  {
    id: id("id").primaryKey().defaultRandom(),
    paymentId: id("payment_id").notNull(),
    provider: label("provider").notNull(),
    paymentRef: label("payment_ref").notNull(),
    amount: money("amount").notNull(),
    state: paymentRefundState("state").notNull(),
    /** The person who authorised this refund at the till (#7), NULL for automated (reconcile/manual)
     * refunds. Plain uuid, no FK — the sale_voids.voided_by precedent. */
    authorizedBy: id("authorized_by"),
    createdAt: tsString("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.paymentId],
      foreignColumns: [payments.id],
      name: "payment_refunds_payment_fk",
    }).onDelete("restrict"),
    index("payment_refunds_payment_idx").on(t.paymentId),
    check("payment_refunds_amount_ck", sql`${t.amount} > 0`),
  ],
);
