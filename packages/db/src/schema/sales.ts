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
import { invoiceSeries } from "./series.js";
import { tenants, tills } from "./tenants.js";

/**
 * The classification of a sale AT ISSUANCE, written once and never updated.
 *
 * Emphatically NOT submission state. `sent`, `acked`, `rejected` and a retry
 * counter all mutate for hours after the sale commits, and this table cannot
 * be updated at all — they live on `envios` (Task 12), which spec §3 created
 * for exactly that reason. The till reads them through
 * FiscalBackend.pendingCount, never by joining to a module table.
 *
 * `not_applicable` is not a placeholder: a deployment in a regime with no
 * record-keeping obligation issues sales that are complete and correct with
 * nothing to record.
 *
 * `fiscal_backend` beside it is free text, not an enum: packages/db must not
 * enumerate the regimes it may one day serve, and the module owns that
 * vocabulary.
 */
export const fiscalState = pgEnum("fiscal_state", ["recorded", "not_applicable"]);

export const tenderMethod = pgEnum("tender_method", [
  "cash",
  "card",
  "voucher",
  "transfer",
  "other",
]);

/**
 * The immutable commercial record of a completed sale — written once, when the
 * LAST tender settles (spec §4), and never edited. The deliberate opposite of
 * working_orders.
 *
 * total       — taxable base plus VAT; the figure the fiscal record reports.
 * tip_amount  — non-taxable, in no fiscal record at all.
 * amount_charged — what hit the payment instruments; reconciles against the
 *                  acquirer. Three distinct numbers, held together by CHECK.
 *
 * locale and invoice_locales are snapshotted as at issuance (spec §9), so a
 * receipt reprinted a year later reads identically to the one the customer
 * took, and a rectificativa inherits the original list.
 *
 * fiscal_backend and fiscal_state are strictly redundant with the module's own
 * tables and justified anyway (spec §6): they keep the foreign key pointing
 * module→core, and let a Z-report answer "what was sold, and is it on the
 * legal record?" with no cross-boundary join per row.
 *
 * EVERY column here is written once, fiscal_state included. There is no
 * exemption from immutability anywhere in this table — the app role has no
 * UPDATE on it at all. Submission progress is not here; it is on envios.
 */
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // See ./series.ts's identical comment: the two-argument `.references()`
    // form (with `onDelete`) is what makes v8 track this thunk as its own
    // never-invoked function — drizzle-kit resolves it in a separate CLI
    // process, never during `vitest run`. `v8 ignore` here keeps the explicit
    // `onDelete` rather than dropping it for coverage's sake.
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    tillId: uuid("till_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tills.id, { onDelete: "restrict" }),
    seriesId: uuid("series_id")
      .notNull()
      /* v8 ignore next */
      .references(() => invoiceSeries.id, { onDelete: "restrict" }),
    invoiceNumber: integer("invoice_number").notNull(),
    // mode: "string" rather than "date" — a JS Date normalises through the host
    // timezone the moment anything formats it, and nothing formatted is ever
    // stored. The offset travels in its own column.
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }).notNull(),
    issuedOffsetMinutes: integer("issued_offset_minutes").notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    tipAmount: numeric("tip_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    amountCharged: numeric("amount_charged", { precision: 12, scale: 2 }).notNull(),
    locale: text("locale").notNull(),
    invoiceLocales: text("invoice_locales").array().notNull(),
    fiscalBackend: text("fiscal_backend").notNull(),
    fiscalState: fiscalState("fiscal_state").notNull(),
  },
  (t) => [
    unique("sales_series_invoice_number_key").on(t.tenantId, t.seriesId, t.invoiceNumber),
    // Composite target for tenant-consistent foreign keys from sale_lines and
    // tenders: a child row cannot point at a sale belonging to another tenant.
    unique("sales_tenant_id_key").on(t.tenantId, t.id),
    index("sales_tenant_issued_idx").on(t.tenantId, t.issuedAt),
    index("sales_fiscal_state_idx").on(t.tenantId, t.fiscalState),
    check("sales_amount_charged_ck", sql`${t.amountCharged} = ${t.total} + ${t.tipAmount}`),
    check("sales_tip_amount_ck", sql`${t.tipAmount} >= 0`),
    check("sales_total_ck", sql`${t.total} >= 0`),
    check("sales_invoice_number_ck", sql`${t.invoiceNumber} >= 1`),
    check("sales_invoice_locales_ck", sql`array_length(${t.invoiceLocales}, 1) between 1 and 2`),
    check("sales_locale_member_ck", sql`${t.locale} = any(${t.invoiceLocales})`),
    check("sales_issued_offset_ck", sql`${t.issuedOffsetMinutes} between -840 and 840`),
  ],
).enableRLS();

/** Snapshotted values, never catalogue references (architecture §6). */
export const saleLines = pgTable(
  "sale_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    lineNo: integer("line_no").notNull(),
    descriptions: jsonb("descriptions").$type<Record<string, string>>().notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    // Composite FK: a line cannot point at a sale belonging to another tenant,
    // independently of whether RLS is in force on this connection.
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "sale_lines_sale_fk",
    }).onDelete("restrict"),
    unique("sale_lines_line_no_key").on(t.saleId, t.lineNo),
    index("sale_lines_sale_idx").on(t.saleId),
    check("sale_lines_quantity_ck", sql`${t.quantity} <> 0`),
    check("sale_lines_vat_rate_ck", sql`${t.vatRate} >= 0 and ${t.vatRate} <= 100`),
    check("sale_lines_line_no_ck", sql`${t.lineNo} >= 1`),
  ],
).enableRLS();

/**
 * One row per payment against one invoice. Split tender is several rows; the
 * sale exists only once they sum to amount_charged, checked at COMMIT by a
 * deferred constraint trigger.
 */
export const tenders = pgTable(
  "tenders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    method: tenderMethod("method").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "tenders_sale_fk",
    }).onDelete("restrict"),
    index("tenders_sale_idx").on(t.saleId),
    check("tenders_amount_ck", sql`${t.amount} <> 0`),
  ],
).enableRLS();
