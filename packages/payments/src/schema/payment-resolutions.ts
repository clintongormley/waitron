import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  enumCheck,
  enumType,
  flag,
  id,
  label,
  newId,
  table,
  tsString,
  workingOrders,
} from "@waitron/db";
import { payments } from "./payments.js";

/** Only a resolution that changed the payment is recorded; one that left it untouched writes
 * nothing. */
export const paymentResolutionOutcome = enumType(["captured", "failed"]);

/**
 * One row per `attempting` payment a manager resolved after nothing was left driving it. Declared
 * `appendOnly()` in `../classification.ts`.
 */
export const paymentResolutions = table(
  "payment_resolutions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    paymentId: id("payment_id").notNull(),
    workingOrderId: id("working_order_id").notNull(),
    // No foreign key: `persons` is in @waitron/identity's migration set, which this set does not
    // require. The resolve route takes the id from `authorizeManager`, which read it through a
    // join to `persons` in an earlier transaction.
    personId: id("person_id").notNull(),
    outcome: paymentResolutionOutcome("outcome").notNull(),
    /** The provider's payment is cancelled, so the working order's next card payment needs a
     * fresh processor idempotency key (`countProviderCancelledResolutions`). */
    cancelledAtProvider: flag("cancelled_at_provider").notNull(),
    /** The processor's own status string when the resolution read one; null when it did not. */
    providerStatus: label("provider_status"),
    resolvedAt: tsString("resolved_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.paymentId],
      foreignColumns: [payments.id],
      name: "payment_resolutions_payment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "payment_resolutions_working_order_fk",
    }).onDelete("restrict"),
    uniqueIndex("payment_resolutions_payment_key").on(t.paymentId),
    index("payment_resolutions_working_order_idx").on(t.workingOrderId),
    check("payment_resolutions_outcome_ck", enumCheck(t.outcome)),
    check(
      "payment_resolutions_cancelled_ck",
      sql`${t.cancelledAtProvider} = 0 or ${t.outcome} = 'failed'`,
    ),
  ],
);
