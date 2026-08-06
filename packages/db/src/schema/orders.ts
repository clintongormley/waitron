import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./catalogue.js";
import { nodes } from "./nodes.js";
import { tenants, tills } from "./tenants.js";

/**
 * A pgEnum rather than a text CHECK, deliberately: unlike invoice_series.purpose
 * these three values are settled by the spec, and one declaration yields both
 * the TypeScript union and the database constraint.
 */
export const workingOrderStatus = pgEnum("working_order_status", ["open", "settled", "abandoned"]);

/**
 * A working order is MUTABLE — the deliberate opposite of `sales`. Lines are
 * added, amended and removed all evening, and the order may end in nothing at
 * all. Two tables, one transition between them (architecture §6): conflating
 * them means chaining drafts and rectifying records that were never sales.
 *
 * What replaces immutability here is a state machine the database enforces:
 * `settled` and `abandoned` are terminal, and only an `open` order may change.
 */
export const workingOrders = pgTable(
  "working_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      // See ./series.ts's identical comment: the two-argument `.references()`
      // form is what makes v8 track this thunk as its own never-invoked
      // function (drizzle-kit resolves it in a separate CLI process, never
      // during `vitest run`) — verified against this package's own coverage
      // thresholds. `v8 ignore` here keeps the explicit `onDelete` rather than
      // dropping it for coverage's sake.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    tillId: uuid("till_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tills.id, { onDelete: "restrict" }),
    // Nullable at the schema level, and stays that way — but now WRITTEN on the till park path:
    // `createOpenOrder` (apps/server/src/working-order.ts) always sets it to the till's node on every
    // parked AND walk-up order, so in practice a working order carries one. It stays nullable for
    // MATCH SIMPLE, not because nothing writes it (design §5): MATCH SIMPLE (the default) means a NULL
    // node_id skips the composite FK check below, leaving room for a future non-till writer to omit
    // it. Bare column: the FK is the tenant-consistent COMPOSITE (tenant_id, node_id) →
    // nodes(tenant_id, id) declared in extraConfig below (mirroring `working_order_lines_order_fk`),
    // so a set node_id must belong to THIS order's tenant, not merely exist somewhere in `nodes`. No
    // `.references()` here, so nothing for v8 to track.
    nodeId: uuid("node_id"),
    // The human-facing order number the counter parks against (park & retrieve, sub-project 7b):
    // allocated from working_order_counters per node, printed on the ticket, and typed back in to
    // retrieve the order at any register. NOT NULL — every working order gets one at open. No
    // UNIQUE here in this slice: the allocator (a later task) owns issuing distinct numbers per
    // node; this task lays the column the counter feeds.
    orderNumber: integer("order_number").notNull(),
    // An optional operator-supplied label ("table 4", "blue umbrella") shown beside the number in
    // the retrieve list. Nullable — most walk-up orders never get one.
    label: text("label"),
    status: workingOrderStatus("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    unique("working_orders_tenant_id_key").on(t.tenantId, t.id),
    index("working_orders_tenant_status_idx").on(t.tenantId, t.status),
    // Tenant-consistent composite FK to the owning node (Copilot #54): a working order cannot
    // point at a node belonging to another tenant, independently of whether RLS is in force on
    // this connection. Mirrors `working_order_lines_order_fk` here and `sales_node_fk`. MATCH
    // SIMPLE (the default) satisfies it while node_id is NULL, so the column stays nullable.
    foreignKey({
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
      name: "working_orders_node_fk",
    }),
    // Biconditional, not two one-way checks: a settled order always carries a
    // timestamp and a non-settled one never does.
    check(
      "working_orders_settled_at_ck",
      sql`(${t.status} = 'settled') = (${t.settledAt} is not null)`,
    ),
  ],
).enableRLS();

/**
 * Prices and descriptions are still snapshotted here, never read live from the catalogue
 * (architecture §6): `descriptions`, `unit_price` and `category` are frozen onto the line so a
 * later catalogue edit is a freshness problem, never a correctness one — and when the order is
 * FILED, the resulting `sale_lines` carry these snapshots and NO product reference at all, so a
 * completed record can never be reached back into.
 *
 * What this DRAFT line adds over that, for park & retrieve (sub-project 7b), is `product_id`: a
 * pricing INPUT, not a reference the record depends on. A parked draft is mutable and may be
 * retrieved and repriced, so it keeps a link back to the priced product it was built from; the
 * snapshot columns are what the till writes and reads, the FK is what lets a repricing re-resolve.
 * The composite (tenant_id, product_id) → products FK below keeps it tenant-consistent.
 *
 * `descriptions` is a locale→string map holding EXACTLY the venue's configured
 * locales (spec §9), checked by trigger against locations.invoice_locales.
 */
export const workingOrderLines = pgTable(
  "working_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workingOrderId: uuid("working_order_id").notNull(),
    lineNo: integer("line_no").notNull(),
    // The priced product this draft line was built from — the pricing input described above. NOT
    // NULL: every counter line comes from a product (there is no free-text line on this path). The
    // FK is the tenant-consistent COMPOSITE in extraConfig below, so this column carries no plain
    // single-column `.references()` of its own.
    productId: uuid("product_id").notNull(),
    descriptions: jsonb("descriptions").$type<Record<string, string>>().notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
    // GROSS (VAT-inclusive) line total = unit gross × quantity — the customer-facing number, so the
    // held-orders list `sum(line_total)` equals the basket total the operator saw. This DELIBERATELY
    // DIVERGES from the FILED `sale_lines.line_total` (sales.ts), which is the NET base the fiscal
    // record needs: a working order is a mutable counter DRAFT, not the fiscal record, so its money
    // column carries the gross the operator reads. `priceBasket` produces both — `grossLineTotals`
    // (this column, via `priceOrderLines`) and each line's net `lineTotal` (the filed `sale_lines`).
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
    // Snapshotted analytics label (architecture §6), NOT a category_id or a catalogue FK — the
    // value is frozen onto the line so a stale catalogue is a freshness problem, never a
    // correctness one, exactly as `descriptions` above is snapshotted rather than referenced.
    category: text("category"),
  },
  (t) => [
    // Composite FK: a line cannot point at an order belonging to another
    // tenant, independently of whether RLS is in force on this connection.
    foreignKey({
      columns: [t.tenantId, t.workingOrderId],
      foreignColumns: [workingOrders.tenantId, workingOrders.id],
      name: "working_order_lines_order_fk",
    }).onDelete("cascade"),
    // Tenant-consistent composite FK to the product this line prices against (park & retrieve): a
    // draft line cannot reference a product of another tenant, independently of RLS. onDelete
    // "restrict" mirrors the catalogue's own rule that a product is deactivated, never deleted
    // (catalogue.ts) — an in-flight draft must not lose the product under it.
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "working_order_lines_product_fk",
    }).onDelete("restrict"),
    unique("working_order_lines_line_no_key").on(t.workingOrderId, t.lineNo),
    index("working_order_lines_order_idx").on(t.workingOrderId),
    check("working_order_lines_quantity_ck", sql`${t.quantity} <> 0`),
    check("working_order_lines_vat_rate_ck", sql`${t.vatRate} >= 0 and ${t.vatRate} <= 100`),
    check("working_order_lines_line_no_ck", sql`${t.lineNo} >= 1`),
  ],
).enableRLS();
