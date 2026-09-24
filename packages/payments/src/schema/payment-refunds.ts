import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, label, money, newId, nowIso, table, tsString } from "@waitron/db";
import { payments } from "./payments.js";

export const paymentRefundState = enumType(["succeeded", "failed"]);

/**
 * One row per refund attempt, never a mutation of the capture; whether the whole capture has been
 * returned is on `payments.state` (`refunded` / `partially_refunded`).
 */
export const paymentRefunds = table(
  "payment_refunds",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    paymentId: id("payment_id").notNull(),
    provider: label("provider").notNull(),
    paymentRef: label("payment_ref").notNull(),
    amount: money("amount").notNull(),
    state: paymentRefundState("state").notNull(),
    authorizedBy: id("authorized_by"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.paymentId],
      foreignColumns: [payments.id],
      name: "payment_refunds_payment_fk",
    }).onDelete("restrict"),
    index("payment_refunds_payment_idx").on(t.paymentId),
    check("payment_refunds_amount_ck", sql`${t.amount} > 0`),
    check("payment_refunds_state_ck", enumCheck(t.state)),
  ],
);
