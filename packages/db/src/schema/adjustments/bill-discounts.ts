import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  json,
  label,
  money,
  newId,
  rate,
  table,
  tsString,
} from "../columns.js";
import { persons } from "../identity/persons.js";
import { menus } from "../menus.js";
import { workingOrderLines, workingOrders } from "../orders.js";
import type { AdjustmentPolicySnapshot } from "@waitron/shared";

const billDiscountAction = enumType(["comp", "discount_percent", "discount_amount"]);
const billDiscountOrigin = enumType(["given", "bill_share"]);

/**
 * A comp or discount given on an open bill and not yet written into its prices. A dish's or an
 * extra's row names only its line, so moving the line moves it; a bill's or a set menu's names the
 * bill. Cleared when the bill is abandoned (`packages/db/triggers/core.sql`).
 */
export const billDiscounts = table(
  "bill_discounts",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderId: id("working_order_id"),
    lineId: id("line_id"),
    setMenuLineId: id("set_menu_line_id"),
    setMenuId: id("set_menu_id"),
    setMenuName: label("set_menu_name"),
    action: billDiscountAction("action").notNull(),
    percentBp: rate("percent_bp"),
    amount: money("amount"),
    origin: billDiscountOrigin("origin").notNull(),
    sharedFrom: id("shared_from"),
    sharedFromBillName: label("shared_from_bill_name"),
    sharedFromPercentBp: rate("shared_from_percent_bp"),
    // No foreign key: it only groups the portions of one till row.
    givenTogether: id("given_together").notNull(),
    position: count("position").notNull(),
    // No foreign key, as on `adjustments.reason_id`: a reason can be deleted while the bill is open.
    reasonId: id("reason_id").notNull(),
    reasonName: label("reason_name").notNull(),
    policySnapshot: json<AdjustmentPolicySnapshot>("policy_snapshot").notNull(),
    requestedBy: id("requested_by").notNull(),
    approvedBy: id("approved_by"),
    note: label("note"),
    givenAt: tsString("given_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "bill_discounts_working_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.lineId],
      foreignColumns: [workingOrderLines.id],
      name: "bill_discounts_line_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.setMenuLineId],
      foreignColumns: [workingOrderLines.id],
      name: "bill_discounts_set_menu_line_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.setMenuId],
      foreignColumns: [menus.id],
      name: "bill_discounts_set_menu_fk",
    }),
    foreignKey({
      columns: [t.sharedFrom],
      foreignColumns: [t.id],
      name: "bill_discounts_shared_from_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.requestedBy],
      foreignColumns: [persons.id],
      name: "bill_discounts_requested_by_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.approvedBy],
      foreignColumns: [persons.id],
      name: "bill_discounts_approved_by_fk",
    }).onDelete("restrict"),
    index("bill_discounts_working_order_idx").on(t.workingOrderId),
    index("bill_discounts_line_idx").on(t.lineId),
    index("bill_discounts_set_menu_line_idx").on(t.setMenuLineId),
    index("bill_discounts_set_menu_idx").on(t.setMenuId),
    index("bill_discounts_shared_from_idx").on(t.sharedFrom),
    index("bill_discounts_requested_by_idx").on(t.requestedBy),
    index("bill_discounts_approved_by_idx").on(t.approvedBy),
    check("bill_discounts_action_ck", enumCheck(t.action)),
    check("bill_discounts_origin_ck", enumCheck(t.origin)),
    check("bill_discounts_reason_name_ck", sql`length(trim(${t.reasonName})) > 0`),
    check(
      "bill_discounts_position_ck",
      sql`typeof(${t.position}) = 'integer' and ${t.position} >= 0`,
    ),
    // A set menu's row keeps its menu's id and name once the grouping deleted its line.
    check(
      "bill_discounts_target_ck",
      sql`(${t.lineId} is not null and ${t.workingOrderId} is null
          and ${t.setMenuLineId} is null and ${t.setMenuId} is null and ${t.setMenuName} is null)
        or (${t.lineId} is null and ${t.workingOrderId} is not null
          and ${t.setMenuLineId} is null and ${t.setMenuId} is null and ${t.setMenuName} is null)
        or (${t.lineId} is null and ${t.workingOrderId} is not null
          and ${t.setMenuId} is not null and ${t.setMenuName} is not null)`,
    ),
    check(
      "bill_discounts_value_ck",
      sql`(${t.action} = 'comp' and ${t.percentBp} is null and ${t.amount} is null)
        or (${t.action} = 'discount_percent' and ${t.amount} is null
          and typeof(${t.percentBp}) = 'integer' and ${t.percentBp} between 1 and 10000)
        or (${t.action} = 'discount_amount' and ${t.percentBp} is null
          and typeof(${t.amount}) = 'integer' and ${t.amount} > 0)`,
    ),
    check(
      "bill_discounts_bill_level_ck",
      sql`${t.lineId} is not null or ${t.setMenuId} is not null
        or ${t.action} in ('discount_percent', 'discount_amount')`,
    ),
    check(
      "bill_discounts_shared_from_ck",
      sql`(${t.origin} = 'given'
          and ${t.sharedFromBillName} is null and ${t.sharedFromPercentBp} is null)
        or (${t.origin} = 'bill_share' and ${t.sharedFromBillName} is not null
          and (${t.sharedFromPercentBp} is null
            or (typeof(${t.sharedFromPercentBp}) = 'integer'
              and ${t.sharedFromPercentBp} between 1 and 10000)))`,
    ),
    check(
      "bill_discounts_share_ck",
      sql`${t.origin} = 'given' or (${t.lineId} is not null and ${t.action} = 'discount_amount')`,
    ),
  ],
);
