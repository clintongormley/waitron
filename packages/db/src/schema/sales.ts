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
  labelList,
  money,
  newId,
  quantity,
  rate,
  table,
  tsString,
} from "./columns.js";
import { nodes } from "./nodes.js";
import { workingOrders } from "./orders.js";
import { invoiceSeries } from "./series.js";
import { tills } from "./tenants.js";

/**
 * The classification of a sale AT ISSUANCE, written once and never updated.
 *
 * NOT submission state: that mutates long after the sale commits, so it lives in
 * the fiscal module's own tables and the till reads it through
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
export const fiscalState = enumType(["recorded", "not_applicable"]);

export const tenderMethod = enumType(["cash", "card", "voucher", "transfer", "other"]);

/**
 * The immutable commercial record of a completed sale — written once, at
 * issuance, and never edited. The deliberate opposite of working_orders.
 *
 * total — taxable base plus VAT. Tips live on `tenders.tip_amount` and the
 * amount charged is derived, never stored: the sale carries no payment fact
 * that would be unknown at issuance, which is what lets an invoice be issued
 * before payment settles.
 *
 * locale and invoice_locales retain the language choices at issuance; a corrective invoice
 * inherits that list. Optional receipt trim is rendered from the current layout.
 *
 * fiscal_backend and fiscal_state are strictly redundant with the module's own
 * tables and justified anyway: they keep the foreign key pointing
 * module→core, and let a Z-report answer "what was sold, and is it on the
 * legal record?" with no cross-boundary join per row.
 *
 * EVERY column here is written once, fiscal_state included. There is no
 * exemption from immutability anywhere in this table.
 */
export const sales = table(
  "sales",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tillId: id("till_id")
      .notNull()
      /* v8 ignore start */
      .references(() => tills.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    seriesId: id("series_id")
      .notNull()
      /* v8 ignore start */
      .references(() => invoiceSeries.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    // Which node processed and chained this sale; `till_id` is where it rang.
    nodeId: id("node_id").notNull(),
    invoiceNumber: count("invoice_number").notNull(),
    // tsString rather than ts — a JS Date takes on the host timezone as soon as
    // something formats it in local time. The offset travels in its own column.
    issuedAt: tsString("issued_at").notNull(),
    issuedOffsetMinutes: count("issued_offset_minutes").notNull(),
    total: money("total").notNull(),
    // The filed per-rate VAT breakdown — the SAME value handed to the fiscal record, stored here
    // queryably so reporting never re-derives a breakdown that could disagree with what was filed.
    vatBreakdown: json<{ rate: string; base: string; tax: string }[]>("vat_breakdown").notNull(),
    locale: label("locale").notNull(),
    invoiceLocales: labelList("invoice_locales").notNull(),
    fiscalBackend: label("fiscal_backend").notNull(),
    fiscalState: fiscalState("fiscal_state").notNull(),
    // Set on a corrective invoice, NULL on an ordinary sale. Kept here so a Z-report, receipt or
    // till can answer "is this a correction, and of what?" with no cross-boundary join.
    correctsSaleId: id("corrects_sale_id"),
    // The recipient of a full invoice, NULL when the sale names none. Kept here as well as in the
    // fiscal record because it is a reprint/Z-report fact. Mirrors `Counterparty`
    // (packages/fiscal/src/backend.ts).
    counterpartyTaxId: label("counterparty_tax_id"),
    counterpartyLegalName: label("counterparty_legal_name"),
    counterpartyCountryCode: label("counterparty_country_code"),
    // The person who AUTHORISED this row's creation, recorded on privileged writes and NULL on an
    // ordinary sale. Plain uuid, no FK: `persons` is in @waitron/identity's migration set, not the
    // core one.
    authorizedBy: id("authorized_by"),
    // The operator who rang this sale, from their open session. Plain uuid, no FK, as above.
    operatorId: id("operator_id"),
    // The parked working order this sale was FILED from, or NULL for a walk-up sale rung with no
    // draft. This is the SALE-IDEMPOTENCY KEY: `sales_working_order_id_key` below makes it unique,
    // so a retrieved order submitted twice (double-tap, two registers racing) files exactly one
    // sale rather than minting a second invoice number for the same order.
    workingOrderId: id("working_order_id"),
  },
  (t) => [
    unique("sales_series_invoice_number_key").on(t.seriesId, t.invoiceNumber),
    index("sales_tenant_issued_idx").on(t.issuedAt),
    index("sales_fiscal_state_idx").on(t.fiscalState),
    // NOT unique: a sale may be corrected more than once by successive corrective invoices.
    foreignKey({
      columns: [t.correctsSaleId],
      foreignColumns: [t.id],
      name: "sales_corrects_fk",
    }).onDelete("restrict"),
    index("sales_corrects_idx").on(t.correctsSaleId),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "sales_node_fk",
    }).onDelete("restrict"),
    // onDelete "restrict": the settled draft is not deleted out from under its sale.
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "sales_working_order_fk",
    }).onDelete("restrict"),
    // At most one sale per working order. NULLs are distinct in a UNIQUE, so walk-up sales coexist.
    unique("sales_working_order_id_key").on(t.workingOrderId),
    // A corrective invoice by differences carries a NEGATIVE total, which this column must hold as
    // filed; an ordinary sale (link NULL) may not be negative.
    check("sales_total_ck", sql`${t.total} >= 0 or ${t.correctsSaleId} is not null`),
    check("sales_invoice_number_ck", sql`${t.invoiceNumber} >= 1`),
    check("sales_invoice_locales_ck", sql`json_array_length(${t.invoiceLocales}) between 1 and 2`),
    // Membership in that same list. A CHECK may not hold a `json_each` subquery, so the member is
    // matched on its QUOTED token — exact while a locale tag carries no `"` and needs no JSON escape.
    check("sales_locale_member_ck", sql`instr(${t.invoiceLocales}, '"' || ${t.locale} || '"') > 0`),
    check("sales_issued_offset_ck", sql`${t.issuedOffsetMinutes} between -840 and 840`),
    check("sales_fiscal_state_ck", enumCheck(t.fiscalState)),
  ],
);

/** Snapshotted values, never catalogue keys (architecture §6). */
export const saleLines = table(
  "sale_lines",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id").notNull(),
    lineNo: count("line_no").notNull(),
    // Frozen staff-facing product name (products.name at sale time).
    name: label("name").notNull(),
    descriptions: json<Record<string, string>>("descriptions").notNull(),
    variantName: label("variant_name"),
    // Snapshotted under the venue's invoice locales like `descriptions`. Nothing in the database
    // checks the locales here: the trigger is on `working_order_lines`, whose lines the till copies
    // across, so a caller that builds its own lines keeps the invoice locales right by itself.
    variantDescriptions: json<Record<string, string>>("variant_descriptions"),
    variantKitchenName: label("variant_kitchen_name"),
    kitchenName: label("kitchen_name"),
    // The diner's answers to this dish's OPTIONS lists, copied by value — no id points back at a
    // list or a label, so a later catalogue edit cannot rewrite a filed sale. EXTRAS are not in
    // here: an extras pick is filed as its own child line of the dish (`parent_line_id`).
    optionSnapshots: json<OptionSnapshot[]>("option_snapshots").notNull().default([]),
    // The printed unit label (the unit's abbreviation), frozen at add-time — presentation only.
    unitName: json<Record<string, string>>("unit_name"),
    unitPrecision: count("unit_precision"),
    quantity: quantity("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    vatRate: rate("vat_rate").notNull(),
    lineTotal: money("line_total").notNull(),
    // Snapshotted analytics label, NOT a category_id or a catalogue FK, so a later taxonomy edit
    // can never reach back into a completed record.
    category: label("category"),
    // The dish line this line belongs to — a filed EXTRAS pick is a line of its own and points at
    // the dish it was picked for; a top-level line leaves it NULL. Presentation/reporting metadata
    // only.
    parentLineId: id("parent_line_id"),
    // What was sold and from which menu: values, never keys, so a filed line keeps no link to a
    // catalogue row. A foreign key declared on `product_id` made drizzle-kit 0.31.10 generate a
    // rebuild of this append-only table (copy into `__new_sale_lines`, `DROP TABLE`, rename), not an
    // `ALTER`; the command and output are in the PR that added these columns. Null where the filing
    // path records none, as on every line filed before they existed; a variant line names the
    // variant, `parent_product_id` its parent.
    productId: id("product_id"),
    parentProductId: id("parent_product_id"),
    menuId: id("menu_id"),
    menuVersionId: id("menu_version_id"),
    // The line's VAT-inclusive total, beside `line_total`'s net base.
    lineGross: money("line_gross"),
    // The product's reporting chain and labels as they stood when the sale was issued.
    classification: json<SaleLineClassification>("classification"),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "sale_lines_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.parentLineId],
      foreignColumns: [t.id],
      name: "sale_lines_parent_fk",
    }),
    unique("sale_lines_line_no_key").on(t.saleId, t.lineNo),
    check(
      "sale_lines_unit_precision_ck",
      sql`${t.unitPrecision} is null or ${t.unitPrecision} between 0 and 3`,
    ),
    index("sale_lines_sale_idx").on(t.saleId),
    check("sale_lines_quantity_ck", sql`${t.quantity} <> 0`),
    // 10000 basis points is 100%.
    check("sale_lines_vat_rate_ck", sql`${t.vatRate} >= 0 and ${t.vatRate} <= 10000`),
    check("sale_lines_line_no_ck", sql`${t.lineNo} >= 1`),
  ],
);

/**
 * One row per payment against one invoice. Split tender is several rows; the
 * sale is fully paid only once they sum to `total + sum(tip_amount)`, checked
 * when settlement is DECLARED — the INSERT into `sale_settlements`, not on this
 * table's own INSERT.
 *
 * `tip_amount` is the payer's affirmed gratuity, non-taxable and on no invoice.
 * It rides on the tender rather than the sale so it is attributed to the payer
 * who left it. `amount` is the whole instrument charge; the tip is a part of it,
 * never on top, because the terminal is sent one final figure.
 */
export const tenders = table(
  "tenders",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id").notNull(),
    method: tenderMethod("method").notNull(),
    amount: money("amount").notNull(),
    /** Cash handed over before change; amount remains the settled charge, including any tip. */
    cashTendered: money("cash_tendered"),
    tipAmount: money("tip_amount").notNull().default(0),
    settledAt: tsString("settled_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "tenders_sale_fk",
    }).onDelete("restrict"),
    index("tenders_sale_idx").on(t.saleId),
    check("tenders_amount_ck", sql`${t.amount} > 0`),
    check(
      "tenders_cash_tendered_ck",
      sql`${t.cashTendered} is null or (${t.method} = 'cash' and ${t.cashTendered} >= ${t.amount})`,
    ),
    check("tenders_tip_amount_ck", sql`${t.tipAmount} >= 0 and ${t.tipAmount} <= ${t.amount}`),
    check("tenders_method_ck", enumCheck(t.method)),
  ],
);

/**
 * One row per fully-settled sale — appended when settlement is *declared*
 * complete. Its existence is the answer to "is this sale paid?"; under
 * invoice-first an unsettled sale is a legitimate steady state, not an anomaly.
 */
export const saleSettlements = table(
  "sale_settlements",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id").notNull(),
    settledAt: tsString("settled_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "sale_settlements_sale_fk",
    }).onDelete("restrict"),
    unique("sale_settlements_sale_key").on(t.saleId),
  ],
);

/**
 * One row per (full invoice, substituted simplified ticket) pair: a full invoice issued in
 * substitution of one or more earlier simplified tickets. Deliberately NOT `corrects_sale_id`
 * reuse — a corrective invoice points at one sale, a substitution at one or more.
 *
 * `unique(substituted_sale_id)`: a ticket is substituted at most once, or the underlying operation
 * would appear on two full invoices.
 */
export const saleSubstitutions = table(
  "sale_substitutions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // The full invoice — the substitute.
    substitutionSaleId: id("substitution_sale_id").notNull(),
    substitutedSaleId: id("substituted_sale_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.substitutionSaleId],
      foreignColumns: [sales.id],
      name: "sale_substitutions_substitution_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.substitutedSaleId],
      foreignColumns: [sales.id],
      name: "sale_substitutions_substituted_fk",
    }).onDelete("restrict"),
    unique("sale_substitutions_substituted_key").on(t.substitutedSaleId),
    index("sale_substitutions_substitution_idx").on(t.substitutionSaleId),
  ],
);
