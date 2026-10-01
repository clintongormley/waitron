import { foreignKey, unique } from "drizzle-orm/sqlite-core";
import { id, label, money, newId, nowIso, table, tsString } from "./columns.js";
import { workingOrders } from "./orders.js";
import { parties } from "./parties.js";
import { sales } from "./sales.js";
import { tills } from "./tenants.js";

/**
 * A bill whose party left without paying it: the invoice it is owed against and the amount that
 * invoice still owed when the party left. Append-only, and one row per bill.
 *
 * `recorded_by` and `authorized_by` are plain person ids with no key, as on `bill_payment_refunds`:
 * `persons` is in @waitron/identity's migration set.
 */
export const unpaidDepartures = table(
  "unpaid_departures",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    partyId: id("party_id").notNull(),
    workingOrderId: id("working_order_id").notNull(),
    saleId: id("sale_id").notNull(),
    amount: money("amount").notNull(),
    reason: label("reason").notNull(),
    recordedBy: id("recorded_by").notNull(),
    authorizedBy: id("authorized_by").notNull(),
    tillId: id("till_id").notNull(),
    recordedAt: tsString("recorded_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.partyId],
      foreignColumns: [parties.id],
      name: "unpaid_departures_party_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "unpaid_departures_working_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "unpaid_departures_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tillId],
      foreignColumns: [tills.id],
      name: "unpaid_departures_till_fk",
    }),
    unique("unpaid_departures_working_order_key").on(t.workingOrderId),
  ],
);
