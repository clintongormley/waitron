import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * A received supplier invoice — a *factura recibida* — and its per-rate VAT breakdown, the input
 * (soportado / deducible) counterpart to the sales the POS issues. These are purely
 * commercial/accounting records: a factura recibida is issued by our SUPPLIER, not by us, so it gets
 * NO huella, NO `registros_facturacion` row, NO hash chain, and NO invoice number from our
 * `invoice_series` (spec §2, the fiscal boundary H2). Unlike the immutable `sales`/`registros` lane,
 * these are MUTABLE accounting records (fix a mis-keyed rate, correct a typo): the app role holds
 * UPDATE and DELETE, there is no append-only trigger and no chain.
 *
 * All identifiers are English (this package is scanned by the english-only guard); the Spanish fiscal
 * term for each concept is given in the doc comments. `tax` here is the *cuota* (the IVA soportado),
 * named `tax` for the same reason `sales.vat_breakdown` and `VatRateLine` do — `cuota` is the
 * fiscal module's declared vocabulary, forbidden here.
 */

/**
 * The VAT regime a received invoice's lines are treated under.
 * - `general` — *régimen general*: input VAT is deductible and reported on the 303.
 * - `equivalence_surcharge` — *recargo de equivalencia*: a retail regime where the trader CANNOT
 *   deduct input VAT and does not file the 303 for those activities (spec §9), so such an invoice is
 *   excluded from the deducible aggregate. WHICH of a deli's activities are RE is an asesor-fiscal
 *   call the code must never assume; the marker is the seam, not a decision.
 */
export const purchaseRegime = pgEnum("purchase_regime", ["general", "equivalence_surcharge"]);

/**
 * What a received-invoice VAT line was spent on, driving the 303 box split (spec §7):
 * - `ordinary` — *operaciones interiores corrientes* (casilla 28/29), the primary deli case.
 * - `capital` — *bienes de inversión* (casilla 30/31).
 */
export const purchaseVatKind = pgEnum("purchase_vat_kind", ["ordinary", "capital"]);

/**
 * The received-invoice header (mutable). One row per supplier invoice we have received and entered
 * into the libro registro de facturas recibidas.
 */
export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    // The supplier's own tax identity (NIF/CIF) and legal name — theirs, not ours; not validated as
    // one of our own identifiers.
    supplierTaxId: text("supplier_tax_id").notNull(),
    supplierName: text("supplier_name").notNull(),
    // THE SUPPLIER'S invoice number, never a number from our `invoice_series`.
    supplierInvoiceNumber: text("supplier_invoice_number").notNull(),
    // The supplier's *fecha de expedición*.
    issuedOn: date("issued_on").notNull(),
    // Our *fecha de recepción/registro* — this DRIVES the deduction period (spec §D3): input VAT is
    // deductible in the period the invoice is received.
    receivedOn: date("received_on").notNull(),
    // Gross total, tenant currency (single currency per tenant — no currency column, spec §D7).
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    regime: purchaseRegime("regime").notNull().default("general"),
    // The prorrata / partial-deductibility seam (spec §9): the percentage of the input VAT that is
    // deductible, 0–100, default 100 (fully deductible). The RULE that sets it below 100 is
    // asesor-driven and out of scope; this column is only the seam.
    deductibleProportion: numeric("deductible_proportion", { precision: 5, scale: 2 })
      .notNull()
      .default("100.00"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Composite target for the tenant-consistent FK from `purchase_invoice_vat` (mirrors
    // `sales_tenant_id_key`): a VAT line cannot point at an invoice belonging to another tenant.
    unique("purchase_invoices_tenant_id_key").on(t.tenantId, t.id),
    // Refuse entering the same supplier invoice twice — the libro-registro no-duplicate default. Keyed
    // on (tenant, supplier, supplier's number). Whether a supplier may legitimately reuse a number
    // across YEARS (making this per-year rather than forever) is an asesor-fiscal question flagged in
    // spec §9; the conservative forever-unique default is chosen here.
    unique("purchase_invoices_supplier_number_key").on(
      t.tenantId,
      t.supplierTaxId,
      t.supplierInvoiceNumber,
    ),
    // Supports the monthly deducible aggregate's `received_on` bucketing (mirrors
    // `sales_tenant_issued_idx`).
    index("purchase_invoices_tenant_received_idx").on(t.tenantId, t.receivedOn),
    check(
      "purchase_invoices_deductible_proportion_ck",
      sql`${t.deductibleProportion} >= 0 and ${t.deductibleProportion} <= 100`,
    ),
  ],
).enableRLS();

/**
 * The per-rate VAT desglose of a received invoice (mutable, one-to-many). Normalized rows rather than
 * a header jsonb so the deducible aggregate can `GROUP BY` in SQL exactly as the sales desglose does,
 * and so one invoice can mix rates and kinds.
 *
 * `tax` (the *cuota*) is stored explicitly rather than derived: the supplier's invoice is the source
 * of truth and may round per line differently, so we file what they charged — the same "sum the filed
 * cuotas, never re-round" exactness rule the sales/output side follows.
 */
export const purchaseInvoiceVat = pgTable(
  "purchase_invoice_vat",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Carried on every tenant-scoped table (the FORCE-RLS guard keys on it); tenant consistency with
    // the parent is enforced by the composite FK below, not a direct FK to `tenants` (mirrors
    // `sale_lines`).
    tenantId: uuid("tenant_id").notNull(),
    purchaseInvoiceId: uuid("purchase_invoice_id").notNull(),
    // The VAT percentage as stored, e.g. "21.00".
    rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
    // Taxable base (base imponible).
    base: numeric("base", { precision: 12, scale: 2 }).notNull(),
    // The VAT amount (cuota / IVA soportado) the supplier charged, filed verbatim.
    tax: numeric("tax", { precision: 12, scale: 2 }).notNull(),
    kind: purchaseVatKind("kind").notNull().default("ordinary"),
  },
  (t) => [
    // Tenant-consistent composite FK: a VAT line cannot reference an invoice of another tenant,
    // independently of whether RLS is in force on this connection (mirrors `sale_lines_sale_fk`).
    // Cascade: deleting an invoice removes its VAT lines.
    foreignKey({
      columns: [t.tenantId, t.purchaseInvoiceId],
      foreignColumns: [purchaseInvoices.tenantId, purchaseInvoices.id],
      name: "purchase_invoice_vat_invoice_fk",
    }).onDelete("cascade"),
    index("purchase_invoice_vat_invoice_idx").on(t.tenantId, t.purchaseInvoiceId),
    check("purchase_invoice_vat_rate_ck", sql`${t.rate} >= 0 and ${t.rate} <= 100`),
  ],
).enableRLS();
