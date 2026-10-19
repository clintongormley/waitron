import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, label, money, newId, table, tsString } from "@waitron/db";
import { payments } from "./payments.js";

export const paymentHoldOutcome = enumType(["refunded_at_provider", "kept"]);

/** One row per held payment. Declared `appendOnly()` in `../classification.ts`. */
export const paymentHolds = table(
  "payment_holds",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    paymentId: id("payment_id").notNull(),
    /** The provider's figure, in whole cents (`decimalToCents`). */
    providerAmount: money("provider_amount").notNull(),
    foundAt: tsString("found_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.paymentId],
      foreignColumns: [payments.id],
      name: "payment_holds_payment_fk",
    }).onDelete("restrict"),
    uniqueIndex("payment_holds_payment_key").on(t.paymentId),
    check("payment_holds_provider_amount_ck", sql`${t.providerAmount} > 0`),
  ],
);

/** One row per recorded outcome of a hold. Declared `appendOnly()` in `../classification.ts`. */
export const paymentHoldOutcomes = table(
  "payment_hold_outcomes",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    holdId: id("hold_id").notNull(),
    outcome: paymentHoldOutcome("outcome").notNull(),
    note: label("note"),
    // No foreign key: `persons` is in @waitron/identity's migration set, which this set does not
    // require.
    personId: id("person_id").notNull(),
    recordedAt: tsString("recorded_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.holdId],
      foreignColumns: [paymentHolds.id],
      name: "payment_hold_outcomes_hold_fk",
    }).onDelete("restrict"),
    uniqueIndex("payment_hold_outcomes_hold_key").on(t.holdId),
    check("payment_hold_outcomes_outcome_ck", enumCheck(t.outcome)),
    check("payment_hold_outcomes_note_ck", sql`${t.note} is null or length(trim(${t.note})) > 0`),
  ],
);
