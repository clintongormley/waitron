import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { payments } from "./payments.js";

/** One refund movement's outcome. 4a: `succeeded` (money returned) or `failed`. */
export const paymentRefundState = pgEnum("payment_refund_state", ["succeeded", "failed"]);

/**
 * One row per refund — a distinct money movement referencing the original capture, never a
 * mutation of it. The aggregate (has the whole capture been returned, or only part?) is reflected
 * on `payments.state` (`refunded` / `partially_refunded`); this table is the itemised trail.
 */
export const paymentRefunds = pgTable(
  "payment_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    provider: text("provider").notNull(),
    paymentRef: text("payment_ref").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    state: paymentRefundState("state").notNull(),
    /** The person who authorised this refund at the till (#7), NULL for automated (reconcile/manual)
     * refunds. Plain uuid, no FK — the sale_voids.voided_by precedent. */
    authorizedBy: uuid("authorized_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
      name: "payment_refunds_payment_fk",
    }).onDelete("restrict"),
    index("payment_refunds_payment_idx").on(t.paymentId),
    check("payment_refunds_amount_ck", sql`${t.amount} > 0`),
  ],
).enableRLS();
