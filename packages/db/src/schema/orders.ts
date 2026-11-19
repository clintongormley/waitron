import type { AllergenMap, OptionSnapshot, SaleLineClassification } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  flag,
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
import { menus, products } from "./menus.js";
import { devices } from "./devices.js";
import { diningTables } from "./dining-tables.js";
import { floorZones } from "./floor-zones.js";
import { kitchenCourses } from "./kitchen-courses.js";
import { kitchenStations } from "./kitchen-stations.js";
import { menuItems } from "./menu/menu.js";
import { menuVersions } from "./menu/publication.js";
import { nodes } from "./nodes.js";
import { orderGroups } from "./order-groups.js";
import { originChecks, sourceColumn } from "./origin.js";
import { persons } from "./identity/persons.js";
import { parties } from "./parties.js";
import { dining } from "./sale-rule-types.js";
import { departments } from "./venue-service/service.js";

const setMenuRole = enumType(["set_menu", "dish"]);

export const workingOrderStatus = enumType([
  "open",
  // placed: finalized — composition FROZEN (what a line may still change once the order leaves
  // open: `OPEN_PARENT_REFUSAL`'s comment, packages/db/src/trigger-refusals.ts)
  // and the fiscal issuance basis fixed. Not terminal: it still ends settled or abandoned.
  "placed",
  "settled",
  "abandoned",
]);

export type StagedInvoiceDelivery =
  | { medium: "receipt" }
  | { medium: "a4"; pagePrinterId: string; personId: string }
  | { medium: "email"; recipient: string; personId: string };

/**
 * A working order is MUTABLE — the deliberate opposite of `sales`. Lines are
 * added, amended and removed all evening, and the order may end in nothing at
 * all. Two tables, one transition between them: conflating them means chaining
 * drafts and rectifying records that were never sales.
 *
 * The transition trigger pins every column except party, bill number, bill name and editor
 * on a settled bill; its separate handover branch only adds the first collection stamp.
 * Each exception names the columns it holds unchanged, including newly added columns.
 *
 * `dining` is fixed earlier still, while the order is open: once a line has been
 * sent or has a kitchen ticket item, a payment attempt has started, a payment is
 * pending or received, or a sale exists (`working_orders_dining_fixed`;
 * `orderDiningLocked` asks the same question).
 */
export const workingOrders = table(
  "working_orders",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    source: sourceColumn("source").notNull(),
    /* v8 ignore start */
    deviceId: id("device_id").references(() => devices.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    // Nullable although `createOpenOrder` always sets it: a NULL node_id skips the FK check below,
    // leaving room for a future writer with no node to omit it.
    nodeId: id("node_id"),
    // Unique within this copy of the venue; allocated above the highest stored bill.
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
    // The delivery table's name, kept once the order lets go of a removed table.
    deliveryTableLabel: label("delivery_table_label"),
    collectedAt: tsString("collected_at"),
    revision: count("revision").notNull().default(0),
    // The invoice-type insert/update triggers enforce this union.
    invoiceType: label("invoice_type").$type<"F1" | "F2">().notNull().default("F2"),
    recipientTaxId: label("recipient_tax_id"),
    recipientLegalName: label("recipient_legal_name"),
    recipientAddress: label("recipient_address"),
    recipientCountryCode: label("recipient_country_code"),
    // Both null for a domestic tax number; otherwise the document kind and issuer.
    recipientIdentifierType: label("recipient_identifier_type"),
    recipientIdentifierCountryCode: label("recipient_identifier_country_code"),
    // Null means no explicit delivery choice has been staged.
    invoiceDelivery: json<StagedInvoiceDelivery>("invoice_delivery"),
    // Null means the venue's receipt language.
    receiptLocale: label("receipt_locale"),
    paymentAttemptAt: tsString("payment_attempt_at"),
    // The seated party this bill belongs to; a counter order has none.
    partyId: id("party_id"),
    billNumber: count("bill_number"),
    billName: label("bill_name"),
    editorId: id("editor_id").references(() => persons.id),
    editorVersion: count("editor_version").notNull().default(0),
    // Eaten here or taken away. No default: whoever opens an order decides it.
    dining: dining("dining").notNull(),
    zoneId: id("zone_id"),
    departmentId: id("department_id"),
    serviceMode: label("service_mode").$type<"table_tab" | "prepay" | "ticket_then_pay">(),
  },
  (t) => [
    uniqueIndex("working_orders_party_bill_number_key")
      .on(t.partyId, t.billNumber)
      .where(sql`${t.billNumber} is not null`),
    check(
      "working_orders_bill_number_ck",
      sql`${t.billNumber} is null or (${t.partyId} is not null and typeof(${t.billNumber}) = 'integer' and ${t.billNumber} >= 1)`,
    ),
    check(
      "working_orders_bill_name_ck",
      sql`${t.billName} is null or (length(${t.billName}) between 1 and 40 and ${t.billName} = trim(${t.billName}))`,
    ),
    check("working_orders_editor_version_ck", sql`${t.editorVersion} >= 0`),
    uniqueIndex("working_orders_order_number_key").on(t.orderNumber),
    index("working_orders_uncollected_idx")
      .on(t.id)
      .where(sql`${t.collectedAt} is null and ${t.status} <> 'abandoned'`),
    index("working_orders_status_idx").on(t.status),
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
    check("working_orders_dining_ck", enumCheck(t.dining)),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "working_orders_zone_fk",
    }),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "working_orders_department_fk",
    }),
    check(
      "working_orders_service_mode_ck",
      sql`${t.serviceMode} is null or ${t.serviceMode} in ('table_tab','prepay','ticket_then_pay')`,
    ),
    check(
      "working_orders_service_context_ck",
      sql`(${t.zoneId} is null and ${t.departmentId} is null and ${t.serviceMode} is null)
        or (${t.zoneId} is not null and ${t.departmentId} is not null and ${t.serviceMode} is not null)`,
    ),
    ...originChecks("working_orders", t.source, t.deviceId),
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
 * when a line is added, never read live from the menu, so a later menu edit to any of them
 * is a freshness problem, never a correctness one. The filed `sale_lines` carry the line's gross total,
 * descriptions and classification, and the percentage the class had on the day of issue, naming a
 * product only as a value, never a key.
 *
 * The line-add snapshot IS the filed gross: a retrieved order is FILED from the locked gross unit
 * price without a re-price (grossLockedLines, @waitron/menu), at its class's rate on the day the
 * invoice is issued.
 *
 * `descriptions` is a locale→string map holding exactly the venue's invoice locales as they
 * were when the line was written or last moved, checked by trigger against
 * settings.venue.invoiceLocales; every key holds the text of the venue's default content language at the
 * time the line was written, or another stored language's where the default had none.
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
    // Keyed and filled like `descriptions`, and checked by trigger the same way.
    variantDescriptions: json<Record<string, string>>("variant_descriptions"),
    variantKitchenName: label("variant_kitchen_name"),
    kitchenName: label("kitchen_name"),
    descriptions: json<Record<string, string>>("descriptions").notNull(),
    // The diner's answers to this dish's OPTIONS lists, copied by value — no id points back at a
    // list or a label, so editing or deleting a list cannot rewrite a saved order. EXTRAS are not
    // here: a pick becomes its own child line.
    optionSnapshots: json<OptionSnapshot[]>("option_snapshots").notNull().default([]),
    // The printed unit label (the unit's abbreviation), frozen at add-time as one entry under the
    // default content language of that time — presentation only.
    unitName: json<Record<string, string>>("unit_name"),
    unitPrecision: count("unit_precision"),
    quantity: quantity("quantity").notNull(),
    priceQuantity: quantity("price_quantity").notNull().default(1000),
    // The GROSS (VAT-inclusive) unit price LOCKED at add time — the authoritative input the FILED
    // sale_lines are rebuilt from. Stored rather than recovered as `line_total ÷ quantity`, which
    // DRIFTS for a weighed line (9.99/kg × 0.333 → 3.33 stored, 3.33 ÷ 0.333 = 10.00 ≠ 9.99).
    unitPriceGross: money("unit_price_gross").notNull(),
    // The class the line takes when its order is eaten here, frozen by the published menu version
    // when the line was added; `takeaway_vat_class` is the one it takes when taken away. The rate
    // either carries is looked up on the day the invoice is issued, so no rate is stored here.
    vatClass: label("vat_class").notNull(),
    // Already resolved: a product with no takeaway class of its own stores its served class here.
    // The order's `dining` picks which of the two classes applies.
    takeawayVatClass: label("takeaway_vat_class").notNull(),
    // GROSS (VAT-inclusive) line total — the customer-facing number, so the held-orders list
    // `sum(line_total)` equals the basket total the operator saw. This DELIBERATELY DIVERGES from
    // the FILED `sale_lines.line_total`, which is the NET base.
    lineTotal: money("line_total").notNull(),
    // Snapshotted analytics label, NOT a category_id or a menu FK.
    category: label("category"),
    // Set only once the whole line is served; `served_quantity` counts a part served before that.
    servedAt: tsString("served_at"),
    servedQuantity: quantity("served_quantity").notNull().default(0),
    // The kitchen course this line was rung under.
    courseId: id("course_id"),
    makeAtStationId: id("make_at_station_id"),
    // The dish line an extras pick belongs to; a top-level line leaves it NULL.
    parentLineId: id("parent_line_id"),
    note: label("note"),
    sentAt: tsString("sent_at"),
    // On a child extras line, the list the pick was taken from. No key: a list can be deleted while
    // an order that took from it is open, and `validateExtraSelections` is what established that
    // the list existed.
    extraListId: id("extra_list_id"),
    // The product's reporting chain when the line was added; issuance copies it onto
    // `sale_lines.classification`.
    classification: json<SaleLineClassification>("classification"),
    // The party's group the line is released with; an extras child carries its dish's. Null on a
    // bill with no party.
    groupId: id("group_id"),
    // Whose sale the line counts as.
    creditedTo: id("credited_to"),
    // The unit price the line had when an adjustment first touched it, never changed after; null
    // on a line no adjustment has touched. Filing reads `unit_price_gross`, never this.
    listUnitPriceGross: money("list_unit_price_gross"),
    menuItemId: id("menu_item_id"),
    menuId: id("menu_id"),
    menuName: label("menu_name"),
    menuVersionId: id("menu_version_id"),
    // The offer's original department can differ from the bill's after a move.
    offerDepartmentId: id("offer_department_id"),
    departmentName: label("department_name"),
    unitId: id("unit_id"),
    soldInEach: flag("sold_in_each"),
    hardwareUnit: label("hardware_unit"),
    allergens: json<AllergenMap>("allergens"),
    diet: json<unknown>("diet"),
    dietOverride: json<unknown>("diet_override"),
    latePeriodName: label("late_period_name"),
    lateConfirmedBy: id("late_confirmed_by"),
    sentNutrition: json<{ allergens: AllergenMap | null; dietaryDeclarations: string[] }>(
      "sent_nutrition",
    ),
    offerUnitName: json<Record<string, string>>("offer_unit_name"),
    offerUnitPrecision: count("offer_unit_precision"),
    offerVatClass: label("offer_vat_class"),
    offerCategoryName: label("offer_category_name"),
    cohortId: id("cohort_id"),
    cohortOrdinal: count("cohort_ordinal"),
    wholePortion: flag("whole_portion"),
    setMenuRole: setMenuRole("set_menu_role"),
    setMenuId: id("set_menu_id"),
    setMenuVersionId: id("set_menu_version_id"),
    setMenuLineId: id("set_menu_line_id"),
    setMenuPlace: count("set_menu_place"),
    // Placement establishes the course, which can later be deleted from the menu.
    setMenuCountsAsCourseId: id("set_menu_counts_as_course_id"),
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
      columns: [t.makeAtStationId],
      foreignColumns: [kitchenStations.id],
      name: "working_order_lines_make_at_station_fk",
    }),
    foreignKey({
      columns: [t.parentLineId],
      foreignColumns: [t.id],
      name: "working_order_lines_parent_fk",
    }),
    index("working_order_lines_parent_idx").on(t.parentLineId),
    unique("working_order_lines_line_no_key").on(t.workingOrderId, t.lineNo),
    check(
      "working_order_lines_unit_precision_ck",
      sql`${t.unitPrecision} is null or ${t.unitPrecision} between 0 and 3`,
    ),
    index("working_order_lines_order_idx").on(t.workingOrderId),
    index("working_order_lines_course_idx").on(t.courseId),
    check("working_order_lines_quantity_ck", sql`${t.quantity} <> 0`),
    check("working_order_lines_price_quantity_ck", sql`${t.priceQuantity} > 0`),
    check(
      "working_order_lines_vat_class_ck",
      sql`${t.vatClass} in ('general','reduced','super_reduced','zero')`,
    ),
    check(
      "working_order_lines_takeaway_vat_class_ck",
      sql`${t.takeawayVatClass} in ('general','reduced','super_reduced','zero')`,
    ),
    check("working_order_lines_line_no_ck", sql`${t.lineNo} >= 1`),
    foreignKey({
      columns: [t.menuItemId],
      foreignColumns: [menuItems.id],
      name: "working_order_lines_menu_item_fk",
    }),
    foreignKey({
      columns: [t.menuVersionId],
      foreignColumns: [menuVersions.id],
      name: "working_order_lines_menu_version_fk",
    }),
    foreignKey({
      columns: [t.lateConfirmedBy],
      foreignColumns: [persons.id],
      name: "working_order_lines_late_confirmed_by_fk",
    }),
    foreignKey({
      columns: [t.creditedTo],
      foreignColumns: [persons.id],
      name: "working_order_lines_credited_to_fk",
    }),
    foreignKey({
      columns: [t.setMenuId],
      foreignColumns: [menus.id],
      name: "working_order_lines_set_menu_fk",
    }),
    foreignKey({
      columns: [t.setMenuVersionId],
      foreignColumns: [menuVersions.id],
      name: "working_order_lines_set_menu_version_fk",
    }),
    foreignKey({
      columns: [t.setMenuLineId],
      foreignColumns: [t.id],
      name: "working_order_lines_set_menu_line_fk",
    }).onDelete("set null"),
    index("working_order_lines_set_menu_line_idx")
      .on(t.setMenuLineId)
      .where(sql`${t.setMenuLineId} is not null`),
    check("working_order_lines_set_menu_role_ck", enumCheck(t.setMenuRole)),
    check(
      "working_order_lines_set_menu_ck",
      sql`(${t.setMenuRole} is null
          and ${t.setMenuId} is null and ${t.setMenuVersionId} is null
          and ${t.setMenuLineId} is null and ${t.setMenuPlace} is null
          and ${t.setMenuCountsAsCourseId} is null)
        or (${t.setMenuRole} is 'set_menu'
          and ${t.setMenuId} is not null and ${t.setMenuVersionId} is not null
          and ${t.productId} is null and ${t.menuItemId} is null and ${t.parentLineId} is null
          and ${t.courseId} is null and ${t.groupId} is null and ${t.cohortId} is null
          and ${t.setMenuLineId} is null and ${t.setMenuPlace} is null
          and ${t.setMenuCountsAsCourseId} is null)
        or (${t.setMenuRole} is 'dish'
          and ${t.setMenuId} is not null and ${t.menuItemId} is not null
          and ${t.setMenuPlace} is not null and ${t.setMenuCountsAsCourseId} is not null
          and ${t.parentLineId} is null and ${t.setMenuVersionId} is null)`,
    ),
    uniqueIndex("working_order_lines_cohort_ordinal_key").on(t.cohortId, t.cohortOrdinal),
    check(
      "working_order_lines_cohort_ck",
      sql`(${t.cohortId} is null and ${t.cohortOrdinal} is null and ${t.wholePortion} is null)
        or (${t.cohortId} is not null and ${t.cohortOrdinal} is not null
          and ${t.cohortOrdinal} >= 1 and ${t.wholePortion} is not null
          and ${t.parentLineId} is null)`,
    ),
    check(
      "working_order_lines_hardware_unit_ck",
      sql`${t.hardwareUnit} is null or ${t.hardwareUnit} in ('kg','g','mg')`,
    ),
    check(
      "working_order_lines_offer_unit_precision_ck",
      sql`${t.offerUnitPrecision} between 0 and 3`,
    ),
    check(
      "working_order_lines_offer_vat_class_ck",
      sql`${t.offerVatClass} in ('general','reduced','super_reduced','zero')`,
    ),
    check(
      "working_order_lines_context_ck",
      sql`(${t.menuId} is null) = (${t.menuItemId} is null)
        and (${t.menuName} is null) = (${t.menuItemId} is null)
        and (${t.offerDepartmentId} is null) = (${t.menuItemId} is null)
        and (${t.departmentName} is null) = (${t.menuItemId} is null)
        and (${t.unitId} is null) = (${t.menuItemId} is null)
        and (${t.soldInEach} is null) = (${t.menuItemId} is null)
        and (${t.offerUnitName} is null) = (${t.menuItemId} is null)
        and (${t.offerUnitPrecision} is null) = (${t.menuItemId} is null)
        and (${t.offerVatClass} is null) = (${t.menuItemId} is null)
        and (${t.offerCategoryName} is null) = (${t.menuItemId} is null)`,
    ),
  ],
);
