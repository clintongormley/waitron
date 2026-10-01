import type { OptionSnapshot, SaleLineClassification } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  json,
  label,
  money,
  newId,
  nowIso,
  quantity,
  table,
  tsString,
} from "./columns.js";
import { products } from "./catalogue.js";
import { diningTables } from "./dining-tables.js";
import { kitchenCourses } from "./kitchen-courses.js";
import { nodes } from "./nodes.js";
import { orderGroups } from "./order-groups.js";
import { tills } from "./tenants.js";
import { parties } from "./parties.js";

export const workingOrderStatus = enumType([
  "open",
  // placed: finalized — composition FROZEN (what a line may still change once the order leaves
  // open: `OPEN_PARENT_REFUSAL`'s comment, packages/db/src/trigger-refusals.ts)
  // and the fiscal issuance basis fixed. Not terminal: it still ends settled or abandoned.
  "placed",
  "settled",
  "abandoned",
]);

/**
 * A working order is MUTABLE — the deliberate opposite of `sales`. Lines are
 * added, amended and removed all evening, and the order may end in nothing at
 * all. Two tables, one transition between them: conflating them means chaining
 * drafts and rectifying records that were never sales.
 *
 * What replaces immutability here is a state machine the database enforces
 * (`working_orders_enforce_transition`): an `open` order may change freely or
 * advance to any next state; a `placed` order may be settled or abandoned, or
 * stay placed changing only its `party_id`, `delivery_table_id` and `revision`;
 * `settled` and `abandoned` are terminal, save the handover stamp on a settled
 * order.
 *
 * Each of those two exceptions lists every column of this table it holds
 * unchanged, so a column added here goes into both lists too, by a migration
 * that re-creates the trigger from the latest text,
 * `drizzle/0042_placed_bill_moves.sql`.
 */
export const workingOrders = table(
  "working_orders",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tillId: id("till_id")
      .notNull()
      /* v8 ignore start */
      .references(() => tills.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    // Nullable although `createOpenOrder` always sets it: a NULL node_id skips the FK check below,
    // leaving room for a future non-till writer to omit it.
    nodeId: id("node_id"),
    // The human-facing order number: allocated per node from working_order_counters, printed on
    // the ticket, and typed back in to retrieve the order at any register. No UNIQUE here: the
    // allocator (`allocateOrderNumber`) owns issuing distinct numbers per node.
    orderNumber: count("order_number").notNull(),
    // Optional operator label before issuance; filing freezes the table grouping here for receipts.
    // Walk-up orders without a label or table keep NULL.
    label: label("label"),
    status: workingOrderStatus("status").notNull().default("open"),
    openedAt: tsString("opened_at").notNull().$defaultFn(nowIso),
    settledAt: tsString("settled_at"),
    // Set ⇒ this counter order is delivered to that table; a party's bill names its party instead.
    /* v8 ignore start */
    deliveryTableId: id("delivery_table_id").references(() => diningTables.id),
    /* v8 ignore stop */
    collectedAt: tsString("collected_at"),
    revision: count("revision").notNull().default(0),
    paymentAttemptAt: tsString("payment_attempt_at"),
    // The seated party this bill belongs to; a counter order has none.
    partyId: id("party_id"),
  },
  (t) => [
    index("working_orders_tenant_status_idx").on(t.status),
    index("working_orders_opened_at_idx").on(t.openedAt),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "working_orders_node_fk",
    }),
    foreignKey({
      columns: [t.partyId],
      foreignColumns: [parties.id],
      name: "working_orders_party_fk",
    }),
    index("working_orders_party_idx").on(t.partyId),
    check("working_orders_status_ck", enumCheck(t.status)),
    // Biconditional, not two one-way checks: a settled order always carries a
    // timestamp and a non-settled one never does.
    check(
      "working_orders_settled_at_ck",
      sql`(${t.status} = 'settled') = (${t.settledAt} is not null)`,
    ),
  ],
);

/**
 * Gross prices, VAT classes, descriptions and the reporting classification are snapshotted here
 * when a line is added, never read live from the catalogue, so a later catalogue edit to any of them
 * is a freshness problem, never a correctness one. The filed `sale_lines` carry the line's gross total,
 * descriptions and classification, and the percentage the class had on the day of issue, naming a
 * product only as a value, never a key.
 *
 * The line-add snapshot IS the filed gross: a retrieved order is FILED from the locked gross unit
 * price without a re-price (grossLockedLines, @waitron/catalogue), at its class's rate on the day the
 * invoice is issued.
 *
 * `descriptions` is a locale→string map holding EXACTLY the venue's configured
 * locales, checked by trigger against locations.invoice_locales.
 */
export const workingOrderLines = table(
  "working_order_lines",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderId: id("working_order_id").notNull(),
    lineNo: count("line_no").notNull(),
    // Frozen staff-facing product name (products.name at add time).
    name: label("name").notNull(),
    // The priced product this draft line was built from: on a top-level line the chosen variant
    // when one was chosen, else the product itself; on a CHILD EXTRA line (parent_line_id set) the
    // PICKED product.
    productId: id("product_id"),
    variantName: label("variant_name"),
    // Holds EXACTLY the venue's configured invoice locales, checked by trigger like `descriptions`.
    // Null = the variant has no customer name.
    variantDescriptions: json<Record<string, string>>("variant_descriptions"),
    variantKitchenName: label("variant_kitchen_name"),
    kitchenName: label("kitchen_name"),
    descriptions: json<Record<string, string>>("descriptions").notNull(),
    // The diner's answers to this dish's OPTIONS lists, copied by value — no id points back at a
    // list or a label, so editing or deleting a list cannot rewrite a saved order. EXTRAS are not
    // here: a pick becomes its own child line.
    optionSnapshots: json<OptionSnapshot[]>("option_snapshots").notNull().default([]),
    // The printed unit label (the unit's abbreviation), frozen at add-time — presentation only.
    unitName: json<Record<string, string>>("unit_name"),
    unitPrecision: count("unit_precision"),
    quantity: quantity("quantity").notNull(),
    // The GROSS (VAT-inclusive) unit price LOCKED at add time — the authoritative input the FILED
    // sale_lines are rebuilt from. Stored rather than recovered as `line_total ÷ quantity`, which
    // DRIFTS for a weighed line (9.99/kg × 0.333 → 3.33 stored, 3.33 ÷ 0.333 = 10.00 ≠ 9.99).
    unitPriceGross: money("unit_price_gross").notNull(),
    // The class the published menu version froze, taken when the line was added. The rate it
    // carries is looked up on the day the invoice is issued, so no rate is stored here.
    vatClass: label("vat_class").notNull(),
    // GROSS (VAT-inclusive) line total — the customer-facing number, so the held-orders list
    // `sum(line_total)` equals the basket total the operator saw. This DELIBERATELY DIVERGES from
    // the FILED `sale_lines.line_total`, which is the NET base.
    lineTotal: money("line_total").notNull(),
    // Snapshotted analytics label, NOT a category_id or a catalogue FK.
    category: label("category"),
    // Set only once the whole line is served; `served_quantity` counts a part served before that.
    servedAt: tsString("served_at"),
    servedQuantity: quantity("served_quantity").notNull().default(0),
    // The kitchen course this line was rung under. No course means the line fires earliest.
    courseId: id("course_id"),
    // The dish line an extras pick belongs to; a top-level line leaves it NULL.
    parentLineId: id("parent_line_id"),
    note: label("note"),
    sentAt: tsString("sent_at"),
    // On a child extras line, the list the pick was taken from. No key: a list can be deleted while
    // an order that took from it is open, and `validateExtraSelections` is what established that
    // the list existed.
    extraListId: id("extra_list_id"),
    // The product's reporting chain and labels when the line was added; issuance copies it onto
    // `sale_lines.classification`.
    classification: json<SaleLineClassification>("classification"),
    // The party's group the line is released with; an extras child carries its dish's. Null on a
    // bill with no party.
    groupId: id("group_id"),
    // Whose sale the line counts as. A plain person id with no key: `persons` is in
    // @waitron/identity's migration set, not the core one.
    creditedTo: id("credited_to"),
    // The unit price the line had when an adjustment first touched it, never changed after; null
    // on a line no adjustment has touched. Filing reads `unit_price_gross`, never this.
    listUnitPriceGross: money("list_unit_price_gross"),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "working_order_lines_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.groupId],
      foreignColumns: [orderGroups.id],
      name: "working_order_lines_group_fk",
    }),
    index("working_order_lines_group_idx").on(t.groupId),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "working_order_lines_product_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.courseId],
      foreignColumns: [kitchenCourses.id],
      name: "working_order_lines_course_fk",
    }),
    foreignKey({
      columns: [t.parentLineId],
      foreignColumns: [t.id],
      name: "working_order_lines_parent_fk",
    }),
    unique("working_order_lines_line_no_key").on(t.workingOrderId, t.lineNo),
    check(
      "working_order_lines_unit_precision_ck",
      sql`${t.unitPrecision} is null or ${t.unitPrecision} between 0 and 3`,
    ),
    index("working_order_lines_order_idx").on(t.workingOrderId),
    check("working_order_lines_quantity_ck", sql`${t.quantity} <> 0`),
    check(
      "working_order_lines_vat_class_ck",
      sql`${t.vatClass} in ('general','reduced','super_reduced','zero')`,
    ),
    check("working_order_lines_line_no_ck", sql`${t.lineNo} >= 1`),
  ],
);
