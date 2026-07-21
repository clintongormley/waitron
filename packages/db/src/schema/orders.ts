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
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
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
    status: workingOrderStatus("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    unique("working_orders_tenant_id_key").on(t.tenantId, t.id),
    index("working_orders_tenant_status_idx").on(t.tenantId, t.status),
    // Biconditional, not two one-way checks: a settled order always carries a
    // timestamp and a non-settled one never does.
    check(
      "working_orders_settled_at_ck",
      sql`(${t.status} = 'settled') = (${t.settledAt} is not null)`,
    ),
  ],
).enableRLS();

/**
 * Snapshotted values, never catalogue references (architecture §6). There is
 * deliberately no product or menu-item column: a stale catalogue is then not a
 * correctness problem, only a freshness one.
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
    descriptions: jsonb("descriptions").$type<Record<string, string>>().notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    // Composite FK: a line cannot point at an order belonging to another
    // tenant, independently of whether RLS is in force on this connection.
    foreignKey({
      columns: [t.tenantId, t.workingOrderId],
      foreignColumns: [workingOrders.tenantId, workingOrders.id],
      name: "working_order_lines_order_fk",
    }).onDelete("cascade"),
    unique("working_order_lines_line_no_key").on(t.workingOrderId, t.lineNo),
    index("working_order_lines_order_idx").on(t.workingOrderId),
    check("working_order_lines_quantity_ck", sql`${t.quantity} <> 0`),
    check("working_order_lines_vat_rate_ck", sql`${t.vatRate} >= 0 and ${t.vatRate} <= 100`),
    check("working_order_lines_line_no_ck", sql`${t.lineNo} >= 1`),
  ],
).enableRLS();
