import type { OptionSnapshot } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum, unique } from "drizzle-orm/pg-core";
import { count, id, json, label, money, quantity, rate, table, tsString } from "./columns.js";
import { products } from "./catalogue.js";
import { nodes } from "./nodes.js";
import { tills } from "./tenants.js";

/**
 * A pgEnum rather than a text CHECK, deliberately: unlike invoice_series.purpose
 * these four values are settled by the spec, and one declaration yields both
 * the TypeScript union and the database constraint.
 */
export const workingOrderStatus = pgEnum("working_order_status", [
  "open",
  // placed (7c): the order is finalized — composition FROZEN (require_open_parent already rejects
  // line writes on a non-open parent) and the fiscal issuance basis fixed. A NON-terminal state
  // between open and settled: open → placed → settled|abandoned. Only Modes I/T ever visit it;
  // a Mode-P walk-up goes open → settled in one instant and never enters placed (design §3, §5).
  "placed",
  "settled",
  "abandoned",
]);

/**
 * How a meat dish is cooked (KDS-only, spec §3). A pgEnum rather than a text CHECK, deliberately —
 * the same rationale as `working_order_status` above: these five values are settled by the spec, and
 * one declaration yields both the TypeScript union and the database constraint. Optional even on a
 * meat line: a stewed/minced dish leaves it NULL.
 */
export const doneness = pgEnum("doneness", [
  "rare",
  "medium_rare",
  "medium",
  "medium_well",
  "well_done",
]);

/**
 * The `doneness` enum's values as a runtime tuple, plus its narrowed type — for server-side validation
 * of a per-line `doneness` (spec §3). NON-FISCAL, like the column itself. `DONENESS.includes(value)` is
 * the membership check the ring-time line parser (`priceOrderLines`) runs before persisting; `Doneness`
 * types every param that carries one.
 */
export const DONENESS = doneness.enumValues;
export type Doneness = (typeof DONENESS)[number];

/**
 * A working order is MUTABLE — the deliberate opposite of `sales`. Lines are
 * added, amended and removed all evening, and the order may end in nothing at
 * all. Two tables, one transition between them (architecture §6): conflating
 * them means chaining drafts and rectifying records that were never sales.
 *
 * What replaces immutability here is a state machine the database enforces
 * (`working_orders_enforce_transition`, rewritten in 0030 for 7c): `settled`
 * and `abandoned` are terminal; an `open` order may change freely or advance to
 * any next state; a `placed` order — finalized, its composition frozen — may
 * only be settled (collect) or abandoned (cancel). So open → placed →
 * settled|abandoned, with a Mode-P walk-up going open → settled directly and
 * never entering placed (design §3, §5).
 */
export const workingOrders = table(
  "working_orders",
  {
    id: id("id").primaryKey().defaultRandom(),
    tillId: id("till_id")
      .notNull()
      /* v8 ignore start */
      .references(() => tills.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    // Nullable at the schema level, and stays that way — but now WRITTEN on the till park path:
    // `createOpenOrder` (apps/server/src/working-order.ts) always sets it to the till's node on every
    // parked AND walk-up order, so in practice a working order carries one. It stays nullable for
    // MATCH SIMPLE, not because nothing writes it (design §5): MATCH SIMPLE (the default) means a NULL
    // node_id skips the FK check below, leaving room for a future non-till writer to omit
    // it. Bare column: the FK is the (node_id) →
    // nodes(id) declared in extraConfig below (mirroring `working_order_lines_order_fk`),
    // `.references()` here, so nothing for v8 to track.
    nodeId: id("node_id"),
    // The human-facing order number the counter parks against (park & retrieve, sub-project 7b):
    // allocated from working_order_counters per node, printed on the ticket, and typed back in to
    // retrieve the order at any register. NOT NULL — every working order gets one at open. No
    // UNIQUE here in this slice: the allocator (a later task) owns issuing distinct numbers per
    // node; this task lays the column the counter feeds.
    orderNumber: count("order_number").notNull(),
    // Optional operator label before issuance; filing freezes the table grouping here for receipts.
    // Walk-up orders without a label or table keep NULL.
    label: label("label"),
    status: workingOrderStatus("status").notNull().default("open"),
    openedAt: tsString("opened_at").notNull().defaultNow(),
    settledAt: tsString("settled_at"),
    // Set ⇒ this (counter) order is DELIVERED TO that table, not a tab (design §2b). Nullable; a tab is
    // the reverse link (`dining_tables.tab_id` points at the order), so `working_orders` carries NO
    // tab-membership column — only this delivery link. BARE column: its FK
    // (delivery_table_id) → dining_tables(id) is hand-written in the mutual-FK
    // migration (the schema-module import cycle a `foreignKey()` here would close — see dining-tables.ts).
    deliveryTableId: id("delivery_table_id"),
    collectedAt: tsString("collected_at"),
  },
  (t) => [
    index("working_orders_tenant_status_idx").on(t.status),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "working_orders_node_fk",
    }),
    // Biconditional, not two one-way checks: a settled order always carries a
    // timestamp and a non-settled one never does.
    check(
      "working_orders_settled_at_ck",
      sql`(${t.status} = 'settled') = (${t.settledAt} is not null)`,
    ),
  ],
);

/**
 * Prices and descriptions are still snapshotted here, never read live from the catalogue
 * (architecture §6): `descriptions`, `unit_price` and `category` are frozen onto the line so a
 * later catalogue edit is a freshness problem, never a correctness one — and when the order is
 * FILED, the resulting `sale_lines` carry these snapshots and NO product reference at all, so a
 * completed record can never be reached back into.
 *
 * The line-add snapshot IS the filed price (7c): `unit_price_gross` below locks the gross unit at
 * add time, and a retrieved order is FILED from these locked columns without a re-price
 * (priceLockedLines, @waitron/catalogue). `product_id` is therefore a pricing INPUT only for a NEW
 * or WEIGHED line being (re)priced at add time — NOT a handle for re-pricing an existing line,
 * whose price is already fixed on it. A parked draft keeps the link back to the product it was
 * built from so a fresh line can resolve one; the snapshot columns are what the till writes, reads
 * and files. The (product_id) → products FK below keeps the link referential.
 *
 * `descriptions` is a locale→string map holding EXACTLY the venue's configured
 * locales (spec §9), checked by trigger against locations.invoice_locales.
 */
export const workingOrderLines = table(
  "working_order_lines",
  {
    id: id("id").primaryKey().defaultRandom(),
    workingOrderId: id("working_order_id").notNull(),
    lineNo: count("line_no").notNull(),
    // Frozen staff-facing product name (products.name at add time) — snapshotted, never read live.
    name: label("name").notNull(),
    // The priced product this draft line was built from — the pricing input described above. A
    // CHILD EXTRA line (parent_line_id set) carries the PICKED product here, which is what the
    // kitchen cooks and the diner is charged for; its price and its three names are still
    // snapshotted onto the line by value, so deleting the list that offered it cannot rewrite the
    // order. NULLABLE all the same: a child line whose product has gone is still a line, and the
    // FK is declared in extraConfig below (null-permissive under MATCH SIMPLE), so this column
    // carries no `.references()` of its own.
    productId: id("product_id"),
    variantId: id("variant_id"),
    // Frozen variant staff name — plain text; null when the line names no variant.
    variantName: label("variant_name"),
    // Variant customer text holding EXACTLY the venue's configured invoice locales (spec §9), checked
    // by the working_order_lines_check_variant_locales trigger against locations.invoice_locales,
    // mirroring `descriptions`. Null = the variant has no customer name.
    variantDescriptions: json<Record<string, string>>("variant_descriptions"),
    // Frozen variant kitchen name.
    variantKitchenName: label("variant_kitchen_name"),
    kitchenName: label("kitchen_name"),
    descriptions: json<Record<string, string>>("descriptions").notNull(),
    // The diner's answers to this dish's OPTIONS lists, each frozen as the list's three names and
    // the chosen label's three names — no id points back at either, so editing or deleting a list
    // cannot rewrite a saved order (spec §2.3). EXTRAS are not here: a pick becomes its own child
    // line, carrying its product.
    optionSnapshots: json<OptionSnapshot[]>("option_snapshots").notNull().default([]),
    // Holds the printed unit label (the unit's abbreviation), frozen at add-time — presentation only, not part of the fiscal hash.
    unitName: json<Record<string, string>>("unit_name"),
    unitPrecision: count("unit_precision"),
    quantity: quantity("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    // The GROSS (VAT-inclusive) unit price LOCKED at add time (line-add snapshot, 7c). `unit_price`
    // above is the NET unit (informational); this is the GROSS unit the line was priced from — the
    // authoritative input the FILED sale_lines are rebuilt from without a re-price (priceLockedLines,
    // @waitron/catalogue). Stored rather than recovered as `line_total ÷ quantity` because that
    // division is exact for `each` lines but DRIFTS for a weighed line (9.99/kg × 0.333 → 3.33 stored,
    // 3.33 ÷ 0.333 = 10.00 ≠ 9.99), and a weighed line is priced at weigh = add time (design §2,
    // Decision 1). Keeps the gross/net draft divergence intact: net unit here, gross line total in
    // `line_total`, gross UNIT here.
    unitPriceGross: money("unit_price_gross").notNull(),
    vatRate: rate("vat_rate").notNull(),
    // GROSS (VAT-inclusive) line total = unit gross × quantity — the customer-facing number, so the
    // held-orders list `sum(line_total)` equals the basket total the operator saw. This DELIBERATELY
    // DIVERGES from the FILED `sale_lines.line_total` (sales.ts), which is the NET base the fiscal
    // record needs: a working order is a mutable counter DRAFT, not the fiscal record, so its money
    // column carries the gross the operator reads. The FILED line of a retrieved order now derives
    // from the locked snapshot columns above (`unit_price_gross` × `quantity`) via priceLockedLines,
    // NOT from a re-price — the gross/net divergence stays: gross unit and gross line total here,
    // the net base rebuilt for the filed `sale_lines`.
    lineTotal: money("line_total").notNull(),
    // Snapshotted analytics label (architecture §6), NOT a category_id or a catalogue FK — the
    // value is frozen onto the line so a stale catalogue is a freshness problem, never a
    // correctness one, exactly as `descriptions` above is snapshotted rather than referenced.
    category: label("category"),
    servedAt: tsString("served_at"),
    courseId: id("course_id"),
    parentLineId: id("parent_line_id"),
    note: label("note"),
    doneness: doneness("doneness"),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "working_order_lines_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "working_order_lines_product_fk",
    }).onDelete("restrict"),
    unique("working_order_lines_line_no_key").on(t.workingOrderId, t.lineNo),
    check(
      "working_order_lines_unit_precision_ck",
      sql`${t.unitPrecision} is null or ${t.unitPrecision} between 0 and 3`,
    ),
    index("working_order_lines_order_idx").on(t.workingOrderId),
    check("working_order_lines_quantity_ck", sql`${t.quantity} <> 0`),
    check("working_order_lines_vat_rate_ck", sql`${t.vatRate} >= 0 and ${t.vatRate} <= 100`),
    check("working_order_lines_line_no_ck", sql`${t.lineNo} >= 1`),
  ],
);
