import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum, unique } from "drizzle-orm/pg-core";
import { day, id, label, money, rate, table, ts } from "./columns.js";

/**
 * A received supplier invoice — a `factura recibida` — and its per-rate VAT breakdown, the input
 * (soportado / deducible) counterpart to the sales the POS issues. These are purely
 * commercial/accounting records: a received invoice is issued by our SUPPLIER, not by us, so it gets
 * NO fiscal fingerprint, NO `registros_facturacion` row, NO hash chain, and NO invoice number from our
 * `invoice_series` (spec §2, the fiscal boundary H2). Unlike the immutable `sales`/`registros` lane,
 * these are MUTABLE accounting records (fix a mis-keyed rate, correct a typo): the app role holds
 * UPDATE and DELETE, there is no append-only trigger and no chain.
 *
 * All identifiers are English (this package is scanned by the english-only guard); the Spanish fiscal
 * term for each concept is given in the doc comments. `tax` here is the `cuota` (`IVA soportado`),
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
 * - `ordinary` — `operaciones interiores corrientes` (casilla 28/29), the primary deli case.
 * - `capital` — *bienes de inversión* (casilla 30/31).
 */
export const purchaseVatKind = pgEnum("purchase_vat_kind", ["ordinary", "capital"]);

/**
 * The received-invoice header (mutable). One row per supplier invoice we have received and entered
 * into the `libro registro de facturas recibidas`.
 */
export const purchaseInvoices = table(
  "purchase_invoices",
  {
    id: id("id").primaryKey().defaultRandom(),
    // The supplier's own tax identity (NIF/CIF) and legal name — theirs, not ours; not validated as
    // one of our own identifiers.
    supplierTaxId: label("supplier_tax_id").notNull(),
    supplierName: label("supplier_name").notNull(),
    // THE SUPPLIER'S invoice number, never a number from our `invoice_series`.
    supplierInvoiceNumber: label("supplier_invoice_number").notNull(),
    // The supplier's issue date.
    issuedOn: day("issued_on").notNull(),
    // Our receipt/registration date — this DRIVES the deduction period (spec §D3): input VAT is
    // deductible in the period the invoice is received.
    receivedOn: day("received_on").notNull(),
    // Gross total, in the venue's currency (one currency — no currency column, spec §D7).
    total: money("total").notNull(),
    regime: purchaseRegime("regime").notNull().default("general"),
    // The prorrata / partial-deductibility seam (spec §9): the share of the input VAT that is
    // deductible, in basis points — 0 to 10000, default 10000 (fully deductible). The RULE that
    // sets it below the whole is asesor-driven and out of scope; this column is only the seam.
    deductibleProportion: rate("deductible_proportion").notNull().default(10000),
    note: label("note"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Composite target for the FK from `purchase_invoice_vat` (mirrors
    // Refuse entering the same supplier invoice twice — the `libro-registro` no-duplicate default. Keyed
    // on (supplier, supplier's number). Whether a supplier may legitimately reuse a number
    // across YEARS (making this per-year rather than forever) is an asesor-fiscal question flagged in
    // spec §9; the conservative forever-unique default is chosen here.
    unique("purchase_invoices_supplier_number_key").on(t.supplierTaxId, t.supplierInvoiceNumber),
    // Supports the monthly deducible aggregate's `received_on` bucketing (mirrors
    // `sales_tenant_issued_idx`).
    index("purchase_invoices_tenant_received_idx").on(t.receivedOn),
    check(
      "purchase_invoices_deductible_proportion_ck",
      sql`${t.deductibleProportion} >= 0 and ${t.deductibleProportion} <= 10000`,
    ),
  ],
);

/**
 * The per-rate VAT breakdown of a received invoice (mutable, one-to-many). Normalized rows rather than
 * a header jsonb so the deducible aggregate can `GROUP BY` in SQL exactly as the sales breakdown does,
 * and so one invoice can mix rates and kinds.
 *
 * `tax` (the `cuota`) is stored explicitly rather than derived: the supplier's invoice is the source
 * of truth and may round per line differently, so we file what they charged — the same "sum the filed
 * VAT amounts, never re-round" exactness rule the sales/output side follows.
 */
export const purchaseInvoiceVat = table(
  "purchase_invoice_vat",
  {
    id: id("id").primaryKey().defaultRandom(),
    purchaseInvoiceId: id("purchase_invoice_id").notNull(),
    // The VAT rate, in basis points: 2100 is 21%.
    rate: rate("rate").notNull(),
    // Taxable base (base imponible).
    base: money("base").notNull(),
    // The VAT amount (`cuota` / `IVA soportado`) the supplier charged, filed verbatim.
    tax: money("tax").notNull(),
    kind: purchaseVatKind("kind").notNull().default("ordinary"),
  },
  (t) => [
    foreignKey({
      columns: [t.purchaseInvoiceId],
      foreignColumns: [purchaseInvoices.id],
      name: "purchase_invoice_vat_invoice_fk",
    }).onDelete("cascade"),
    index("purchase_invoice_vat_invoice_idx").on(t.purchaseInvoiceId),
    // 10000 basis points is 100%; see the twin on `working_order_lines` for why it was re-derived.
    check("purchase_invoice_vat_rate_ck", sql`${t.rate} >= 0 and ${t.rate} <= 10000`),
  ],
);
