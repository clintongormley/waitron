import type { OptionSnapshot } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum, unique } from "drizzle-orm/pg-core";
import { count, id, json, label, money, quantity, rate, table, tsString } from "./columns.js";
import { nodes } from "./nodes.js";
import { workingOrders } from "./orders.js";
import { invoiceSeries } from "./series.js";
import { tills } from "./tenants.js";

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
 * The immutable commercial record of a completed sale — written once, at
 * issuance, and never edited. The deliberate opposite of working_orders.
 *
 * total — taxable base plus VAT; the figure the fiscal record reports, and now
 * the ONLY number here. The tip moved to `tenders.tip_amount` (attributed to
 * the payer who left it), and `amount_charged` is derived — `total + sum(tips)`
 * — never stored, because nothing in production ever read it (design §3). This
 * is what lets an invoice be issued before payment settles: the sale carries no
 * payment fact that would be unknown at that moment.
 *
 * locale and invoice_locales retain the language choices at issuance; a corrective invoice
 * inherits that list. Optional receipt trim is rendered from the current layout.
 *
 * fiscal_backend and fiscal_state are strictly redundant with the module's own
 * tables and justified anyway (spec §6): they keep the foreign key pointing
 * module→core, and let a Z-report answer "what was sold, and is it on the
 * legal record?" with no cross-boundary join per row.
 *
 * EVERY column here is written once, fiscal_state included. There is no
 * exemption from immutability anywhere in this table — the app role has no
 * UPDATE on it at all. Submission progress is not here; it is on `envios`.
 */
export const sales = table(
  "sales",
  {
    id: id("id").primaryKey().defaultRandom(),
    // These thunks are resolved by `drizzle-kit generate` in its own CLI process, never by
    // `vitest run`, so v8 reports them as never-invoked functions. The markers keep the explicit
    // `onDelete` rather than dropping it for coverage's sake.
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
    // Which node processed and chained this sale (node-id rekey, 2026-08-03).
    // NOT NULL — the fiscal write path always supplies it. The `(node_id) → nodes(id)` FK is
    // declared in `extraConfig` below (mirroring `sale_lines_sale_fk`/`tenders_sale_fk`), so this
    // column carries no `.references()` of its own. `till_id` STAYS (where the sale rang); this adds
    // the node beside it, it does not replace it.
    nodeId: id("node_id").notNull(),
    invoiceNumber: count("invoice_number").notNull(),
    // tsString rather than ts — a JS Date takes on the host timezone as soon as
    // something formats it in local time (`toString()` moves with `TZ`;
    // `toISOString()` does not), and nothing formatted is ever stored. The
    // offset travels in its own column.
    issuedAt: tsString("issued_at").notNull(),
    issuedOffsetMinutes: count("issued_offset_minutes").notNull(),
    total: money("total").notNull(),
    // The filed per-rate VAT breakdown ({rate, base, tax}[]) — the SAME breakdown written into the
    // hash-chained record, stored here queryably for reporting. Written once at INSERT (sales is
    // immutable); NOT a recompute. Reporting reads this for an exact VAT summary (spec 8a).
    vatBreakdown: json<{ rate: string; base: string; tax: string }[]>("vat_breakdown").notNull(),
    locale: label("locale").notNull(),
    invoiceLocales: label("invoice_locales").array().notNull(),
    fiscalBackend: label("fiscal_backend").notNull(),
    fiscalState: fiscalState("fiscal_state").notNull(),
    // The generic-layer projection of "this sale corrects that one" — set on a
    // corrective invoice, NULL on an ordinary sale. Justified exactly as `sale_voids`
    // and `fiscal_state`/`fiscal_backend` are (see this table's own comment
    // above): core reads nothing fiscal from it, it exists so a
    // Z-report/receipt/till can answer "is this a correction, and of what?" with
    // no cross-boundary join. The FK below mirrors
    // `sale_lines_sale_fk`/`tenders_sale_fk`; NULLABLE with no backfill
    // (pre-production, no deployed data), and immutable table-wide like every
    // other column here.
    correctsSaleId: id("corrects_sale_id"),
    // The recipient (`destinatario`) of a full invoice — set on any sale that names one: an F3
    // canje today, and an F1 full invoice from any caller that supplies a counterparty. NULL on an
    // ordinary F2 sale. Stored on the generic sales row, not only in the fiscal
    // record's `destinatarios`, for the same reason `corrects_sale_id`/`fiscal_state` are here
    // (see this table's own comment above): a full invoice's recipient is a reprint/Z-report fact,
    // and keeping it here answers "who was this invoiced to?" with no cross-boundary join. English
    // names, because `destinatario`/`destinatarios` are the fiscal module's declared vocabulary
    // and this package is scanned by the english-only guard; they mirror the module's
    // `Counterparty` shape (packages/fiscal/src/backend.ts). All NULLABLE with no backfill
    // (pre-production, no deployed data), and immutable table-wide like every other column here.
    counterpartyTaxId: label("counterparty_tax_id"),
    counterpartyLegalName: label("counterparty_legal_name"),
    counterpartyCountryCode: label("counterparty_country_code"),
    // The person who AUTHORISED this row's creation, recorded on privileged writes and NULL on an
    // ordinary sale. Set by recordCorrection (sale.rectify) at insert (Task 10). Plain uuid, no FK —
    // the same shape as sale_voids.voided_by — NULLABLE with no backfill (pre-production, no deployed
    // data), and immutable/write-once at insert like every other column here (the app role has no
    // UPDATE on this table at all).
    authorizedBy: id("authorized_by"),
    // The operator who rang this sale (attribution), from their open session — set by recordSale at
    // insert (Task 11), NULL until the till (#7) supplies it. Plain uuid, no FK; NULLABLE with no
    // backfill (pre-production), write-once at insert and immutable table-wide like every other
    // column here.
    operatorId: id("operator_id"),
    // The parked working order this sale was FILED from (park & retrieve, sub-project 7b), or NULL
    // for a walk-up sale rung with no draft. This is the SALE-IDEMPOTENCY KEY: `sales_working_order_id_key`
    // below makes (working_order_id) unique, so a retrieved order that is submitted twice
    // (double-tap, two registers racing) files exactly one sale — the second INSERT collides 23505
    // rather than minting a second invoice number for the same order. NULLABLE: MATCH SIMPLE skips
    // the FK for a NULL, and NULLs are distinct under the UNIQUE, so any number of walk-up sales
    // coexist. The FK is in extraConfig below, so this bare column
    // carries no single-column `.references()`. Write-once and immutable table-wide like the rest.
    workingOrderId: id("working_order_id"),
  },
  (t) => [
    unique("sales_series_invoice_number_key").on(t.seriesId, t.invoiceNumber),
    // Composite target for foreign keys from sale_lines and
    index("sales_tenant_issued_idx").on(t.issuedAt),
    index("sales_fiscal_state_idx").on(t.fiscalState),
    // A corrective invoice points at the sale it corrects.
    // MATCH SIMPLE (the default) means a NULL `corrects_sale_id` satisfies the
    // FK, so ordinary sales are unaffected. NOT unique — unlike
    // `sale_voids_sale_id_key` (one void per sale), a sale may be corrected more
    // than once by successive corrective invoices; the plain index below is for the
    // lookup, not a uniqueness guard.
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
    // FK to the parked order this sale was filed from (park & retrieve):
    // MATCH SIMPLE (the default) means a
    // NULL working_order_id — an ordinary walk-up sale — skips the check, so the column stays
    // nullable. onDelete "restrict": the settled draft is not deleted out from under its sale.
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "sales_working_order_fk",
    }).onDelete("restrict"),
    // The sale-idempotency key: at most one sale per working order. NULLs are distinct in
    // a UNIQUE, so unlimited walk-up sales (working_order_id NULL) coexist; only a retrieved order
    // filed twice collides. See the column comment above.
    unique("sales_working_order_id_key").on(t.workingOrderId),
    // `total >= 0` for an ordinary sale, but a `rectificativa por diferencias`
    // carries a NEGATIVE total (findings §10.2): `record-sale` passes `total`
    // verbatim into the fiscal record's `ImporteTotal`, which the fiscal fingerprint hashes,
    // so this column must be allowed to hold that negative value. A corrective
    // (link set) may be negative; an ordinary sale (link NULL) may not.
    check("sales_total_ck", sql`${t.total} >= 0 or ${t.correctsSaleId} is not null`),
    check("sales_invoice_number_ck", sql`${t.invoiceNumber} >= 1`),
    check("sales_invoice_locales_ck", sql`array_length(${t.invoiceLocales}, 1) between 1 and 2`),
    check("sales_locale_member_ck", sql`${t.locale} = any(${t.invoiceLocales})`),
    check("sales_issued_offset_ck", sql`${t.issuedOffsetMinutes} between -840 and 840`),
  ],
);

/** Snapshotted values, never catalogue references (architecture §6). */
export const saleLines = table(
  "sale_lines",
  {
    id: id("id").primaryKey().defaultRandom(),
    saleId: id("sale_id").notNull(),
    lineNo: count("line_no").notNull(),
    // Frozen staff-facing product name (products.name at sale time) — snapshotted, never read live.
    name: label("name").notNull(),
    descriptions: json<Record<string, string>>("descriptions").notNull(),
    variantId: id("variant_id"),
    // Frozen variant staff name — plain text; null when the line names no variant.
    variantName: label("variant_name"),
    // Variant customer text, snapshotted under the venue's invoice locales like `descriptions`. No
    // locales trigger guards it HERE, and nothing else in the database does either: the check lives
    // on `working_order_lines` only (`packages/db/drizzle/0031_variant_descriptions_locales_sql.sql`,
    // which carries the probe). The till reaches a sale through a persisted working order, so its
    // lines were checked there before `recordSale` copied them across; a caller that builds its own
    // lines instead keeps the invoice locales right by itself.
    variantDescriptions: json<Record<string, string>>("variant_descriptions"),
    // Frozen variant kitchen name.
    variantKitchenName: label("variant_kitchen_name"),
    kitchenName: label("kitchen_name"),
    // The diner's answers to this dish's OPTIONS lists, each frozen as the list's three names and
    // the chosen label's three names, copied by value — no id points back at a list or a label, so a
    // later catalogue edit cannot rewrite a filed sale. EXTRAS are not in here: an extras pick is
    // filed as its own child line of the dish, carrying the picked product's frozen names, quantity,
    // price and VAT and no `product_id` (spec 2026-09-18-one-product-model-design.md §3.4 and
    // decision 11, which is this table's own "snapshotted values, never catalogue references" rule).
    optionSnapshots: json<OptionSnapshot[]>("option_snapshots").notNull().default([]),
    // Holds the printed unit label (the unit's abbreviation), frozen at add-time — presentation only, not part of the fiscal hash.
    unitName: json<Record<string, string>>("unit_name"),
    unitPrecision: count("unit_precision"),
    quantity: quantity("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    vatRate: rate("vat_rate").notNull(),
    lineTotal: money("line_total").notNull(),
    // Snapshotted analytics label (architecture §6), NOT a category_id or a catalogue FK — the
    // value is frozen onto the line at sale time so a roll-up sums one canonical bucket and a later
    // taxonomy edit can never reach back into a completed record.
    category: label("category"),
    // The dish line this line belongs to — a filed EXTRAS pick is a line of its own and points at
    // the dish it was picked for; a top-level line leaves it NULL. Presentation/reporting metadata
    // ONLY — `backend.recordSale` is handed the sale's own header fields and never `sale_lines` at
    // all (the twelve are named at `packages/core/src/record-sale.ts:389-408`), so this never
    // reaches the fiscal fingerprint (design §4). Bare NULLABLE uuid: the
    // self-FK (parent_line_id) → sale_lines(id) is
    // hand-written in the --custom migration (the same split sales_corrects_fk uses). MATCH SIMPLE
    // means a NULL parent satisfies it. Nothing here points at the extras or options list the pick
    // or the answer came from: a filed line carries frozen names only, so a catalogue edit cannot
    // reach it. Write-once at sale time and immutable table-wide like every other column here.
    parentLineId: id("parent_line_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "sale_lines_sale_fk",
    }).onDelete("restrict"),
    unique("sale_lines_line_no_key").on(t.saleId, t.lineNo),
    check(
      "sale_lines_unit_precision_ck",
      sql`${t.unitPrecision} is null or ${t.unitPrecision} between 0 and 3`,
    ),
    index("sale_lines_sale_idx").on(t.saleId),
    check("sale_lines_quantity_ck", sql`${t.quantity} <> 0`),
    check("sale_lines_vat_rate_ck", sql`${t.vatRate} >= 0 and ${t.vatRate} <= 100`),
    check("sale_lines_line_no_ck", sql`${t.lineNo} >= 1`),
  ],
);

/**
 * One row per payment against one invoice. Split tender is several rows; the
 * sale is fully paid only once they sum to `total + sum(tip_amount)`, checked
 * when settlement is DECLARED — the INSERT into `sale_settlements` (design §5),
 * not at COMMIT and no longer on this table's own INSERT.
 *
 * `tip_amount` is the payer's affirmed gratuity, non-taxable and on no invoice
 * (design §9.2). It rides on the tender rather than the sale so it is
 * attributed to the payer who left it. `amount` is the whole instrument charge;
 * the tip is a part of it, never on top (`tip_amount <= amount`), because the
 * terminal is sent one final figure (design §4).
 */
export const tenders = table(
  "tenders",
  {
    id: id("id").primaryKey().defaultRandom(),
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
    // Tightened from `amount <> 0` (design §3): the permission for a negative
    // tender was an artefact of spelling, never a decision, and `tip_amount <=
    // amount` cannot coexist with a negative amount.
    check("tenders_amount_ck", sql`${t.amount} > 0`),
    check(
      "tenders_cash_tendered_ck",
      sql`${t.cashTendered} is null or (${t.method} = 'cash' and ${t.cashTendered} >= ${t.amount})`,
    ),
    check("tenders_tip_amount_ck", sql`${t.tipAmount} >= 0 and ${t.tipAmount} <= ${t.amount}`),
  ],
);

/**
 * One row per fully-settled sale — appended when settlement is *declared*
 * complete. Append-only (REVOKE UPDATE/DELETE + reject_mutation triggers) like
 * `tenders`. Its existence is the answer to "is this sale paid?"; under
 * invoice-first an unsettled sale is a legitimate steady state, not an anomaly
 * (design §3).
 */
export const saleSettlements = table(
  "sale_settlements",
  {
    id: id("id").primaryKey().defaultRandom(),
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
 * The N:1 substitution link for F3 canje: one row per (F3 sale, substituted simplified ticket)
 * pair (docs/superpowers/plans/2026-08-02-f3-canje.md §2.1). An F3 (`factura de canje`) issues a full
 * invoice in substitution of one or more previously-issued simplified tickets; this is the
 * generic-layer projection of that relationship, deliberately NOT `corrects_sale_id` reuse —
 * `corrects_sale_id` is 1:1 and means "corrects" (a corrective invoice), canje is N:1 and means
 * "substitutes".
 *
 * `unique(substituted_sale_id)` is the DB control for "a ticket is substituted at most
 * once" (§5, decision 4): were the same ticket substituted by two F3s, the underlying operation
 * would appear in two canje invoices. There is deliberately NO unique on `substitution_sale_id` —
 * one F3 substitutes MANY tickets (N rows, the fan-out).
 */
export const saleSubstitutions = table(
  "sale_substitutions",
  {
    id: id("id").primaryKey().defaultRandom(),
    // The F3 canje sale — the substitute.
    substitutionSaleId: id("substitution_sale_id").notNull(),
    // One substituted simplified ticket. N of these per F3.
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
    // A ticket is substituted at most once (§5, decision 4). This also indexes the substituted
    // side; the plain index below covers the substitution (F3 → its tickets) lookup.
    unique("sale_substitutions_substituted_key").on(t.substitutedSaleId),
    index("sale_substitutions_substitution_idx").on(t.substitutionSaleId),
  ],
);
