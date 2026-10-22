import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  day,
  enumCheck,
  enumType,
  id,
  label,
  money,
  newId,
  now,
  rate,
  table,
  ts,
} from "./columns.js";

// Keep the regime explicit; do not infer it from a venue's activities.
export const purchaseRegime = enumType(["general", "equivalence_surcharge"]);

export const purchaseVatKind = enumType(["ordinary", "capital"]);

export const purchaseInvoices = table(
  "purchase_invoices",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // The supplier's own tax identity (NIF/CIF) and legal name — theirs, not ours; not validated as
    // one of our own identifiers.
    supplierTaxId: label("supplier_tax_id").notNull(),
    supplierName: label("supplier_name").notNull(),
    // THE SUPPLIER'S invoice number, never a number from our `invoice_series`.
    supplierInvoiceNumber: label("supplier_invoice_number").notNull(),
    // The supplier's issue date.
    issuedOn: day("issued_on").notNull(),
    // Our receipt/registration date — this DRIVES the deduction period: input VAT is deductible in
    // the period the invoice is received.
    receivedOn: day("received_on").notNull(),
    // Gross total, in the venue's currency (one currency — no currency column).
    total: money("total").notNull(),
    regime: purchaseRegime("regime").notNull().default("general"),
    // The partial-deductibility seam: the share of the input VAT that is deductible, in
    // basis points — 0 to 10000, default 10000 (fully deductible). The RULE that sets it below the
    // whole is tax-adviser-driven and out of scope; this column is only the seam.
    deductibleProportion: rate("deductible_proportion").notNull().default(10000),
    note: label("note"),
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    // Remove this expression index before generating a table rebuild; restore it in a separate
    // generation (docs/developers/conventions-data.md, expression-index rebuild limitation).
    uniqueIndex("purchase_invoices_supplier_number_key").on(
      t.supplierTaxId,
      t.supplierInvoiceNumber,
      sql`cast(${t.issuedOn} as integer)`,
    ),
    // Supports the monthly deducible aggregate's `received_on` bucketing.
    index("purchase_invoices_tenant_received_idx").on(t.receivedOn),
    check("purchase_invoices_regime_ck", enumCheck(t.regime)),
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
 * `tax` is stored explicitly rather than derived: the supplier's invoice is the source
 * of truth and may round per line differently, so we file what they charged — the same "sum the filed
 * VAT amounts, never re-round" exactness rule the sales/output side follows.
 */
export const purchaseInvoiceVat = table(
  "purchase_invoice_vat",
  {
    id: id("id").primaryKey().$defaultFn(newId),
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
    // 10000 basis points is 100%.
    check("purchase_invoice_vat_rate_ck", sql`${t.rate} >= 0 and ${t.rate} <= 10000`),
    check("purchase_invoice_vat_kind_ck", enumCheck(t.kind)),
  ],
);
