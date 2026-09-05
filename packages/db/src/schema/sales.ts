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
import { nodes } from "./nodes.js";
import { workingOrders } from "./orders.js";
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
    // Which node processed and chained this sale (node-id rekey, 2026-08-03).
    // NOT NULL — the fiscal write path always supplies it. The tenant-consistent
    // composite `(tenant_id, node_id) → nodes(tenant_id, id)` FK is declared in
    // `extraConfig` below (mirroring `sale_lines_sale_fk`/`tenders_sale_fk`), so
    // this column carries NO plain single-column `.references()` of its own —
    // the composite is the FK. `till_id` STAYS (where the sale rang); this adds
    // the node beside it, it does not replace it.
    nodeId: uuid("node_id").notNull(),
    invoiceNumber: integer("invoice_number").notNull(),
    // mode: "string" rather than "date" — a JS Date normalises through the host
    // timezone the moment anything formats it, and nothing formatted is ever
    // stored. The offset travels in its own column.
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }).notNull(),
    issuedOffsetMinutes: integer("issued_offset_minutes").notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    // The filed per-rate VAT desglose ({rate, base, tax}[]) — the SAME breakdown written into the
    // hash-chained registro, stored here queryably for reporting. Written once at INSERT (sales is
    // immutable); NOT a recompute. Reporting reads this for an exact VAT summary (spec 8a).
    vatBreakdown: jsonb("vat_breakdown")
      .$type<{ rate: string; base: string; tax: string }[]>()
      .notNull(),
    locale: text("locale").notNull(),
    invoiceLocales: text("invoice_locales").array().notNull(),
    fiscalBackend: text("fiscal_backend").notNull(),
    fiscalState: fiscalState("fiscal_state").notNull(),
    // The generic-layer projection of "this sale corrects that one" — set on a
    // rectificativa, NULL on an ordinary sale. Justified exactly as `sale_voids`
    // and `fiscal_state`/`fiscal_backend` are (see this table's own comment
    // above): core reads nothing fiscal from it, it exists so a
    // Z-report/receipt/till can answer "is this a correction, and of what?" with
    // no cross-boundary join. The tenant-consistent FK below mirrors
    // `sale_lines_sale_fk`/`tenders_sale_fk`; NULLABLE with no backfill
    // (pre-production, no deployed data), and immutable table-wide like every
    // other column here.
    correctsSaleId: uuid("corrects_sale_id"),
    // The recipient (destinatario) of a full invoice — set on an F3 canje (and, later, an F1),
    // NULL on an ordinary F2 sale. Stored on the generic sales row, not only in the fiscal
    // registro's `destinatarios`, for the same reason `corrects_sale_id`/`fiscal_state` are here
    // (see this table's own comment above): a full invoice's recipient is a reprint/Z-report fact,
    // and keeping it here answers "who was this invoiced to?" with no cross-boundary join. English
    // names, because `destinatario`/`destinatarios` are the fiscal module's declared vocabulary
    // and this package is scanned by the english-only guard; they mirror the module's
    // `Counterparty` shape (packages/fiscal/src/backend.ts). All NULLABLE with no backfill
    // (pre-production, no deployed data), and immutable table-wide like every other column here.
    counterpartyTaxId: text("counterparty_tax_id"),
    counterpartyLegalName: text("counterparty_legal_name"),
    counterpartyCountryCode: text("counterparty_country_code"),
    // The person who AUTHORISED this row's creation, recorded on privileged writes and NULL on an
    // ordinary sale. Set by recordCorrection (sale.rectify) at insert (Task 10). Plain uuid, no FK —
    // the same shape as sale_voids.voided_by — NULLABLE with no backfill (pre-production, no deployed
    // data), and immutable/write-once at insert like every other column here (the app role has no
    // UPDATE on this table at all).
    authorizedBy: uuid("authorized_by"),
    // The operator who rang this sale (attribution), from their open session — set by recordSale at
    // insert (Task 11), NULL until the till (#7) supplies it. Plain uuid, no FK; NULLABLE with no
    // backfill (pre-production), write-once at insert and immutable table-wide like every other
    // column here.
    operatorId: uuid("operator_id"),
    // The parked working order this sale was FILED from (park & retrieve, sub-project 7b), or NULL
    // for a walk-up sale rung with no draft. This is the SALE-IDEMPOTENCY KEY: `sales_working_order_id_key`
    // below makes (tenant_id, working_order_id) unique, so a retrieved order that is submitted twice
    // (double-tap, two registers racing) files exactly one sale — the second INSERT collides 23505
    // rather than minting a second invoice number for the same order. NULLABLE: MATCH SIMPLE skips
    // the FK for a NULL, and NULLs are distinct under the UNIQUE, so any number of walk-up sales
    // coexist. The tenant-consistent composite FK is in extraConfig below, so this bare column
    // carries no single-column `.references()`. Write-once and immutable table-wide like the rest.
    workingOrderId: uuid("working_order_id"),
  },
  (t) => [
    unique("sales_series_invoice_number_key").on(t.tenantId, t.seriesId, t.invoiceNumber),
    // Composite target for tenant-consistent foreign keys from sale_lines and
    // tenders: a child row cannot point at a sale belonging to another tenant.
    unique("sales_tenant_id_key").on(t.tenantId, t.id),
    index("sales_tenant_issued_idx").on(t.tenantId, t.issuedAt),
    index("sales_fiscal_state_idx").on(t.tenantId, t.fiscalState),
    // A rectificativa points at the sale it corrects, within its own tenant.
    // MATCH SIMPLE (the default) means a NULL `corrects_sale_id` satisfies the
    // FK, so ordinary sales are unaffected. NOT unique — unlike
    // `sale_voids_sale_id_key` (one void per sale), a sale may be corrected more
    // than once by successive rectificativas; the plain index below is for the
    // lookup, not a uniqueness guard.
    foreignKey({
      columns: [t.tenantId, t.correctsSaleId],
      foreignColumns: [t.tenantId, t.id],
      name: "sales_corrects_fk",
    }).onDelete("restrict"),
    index("sales_corrects_idx").on(t.tenantId, t.correctsSaleId),
    // Tenant-consistent composite FK to the owning node (node-id rekey,
    // 2026-08-03): a sale cannot point at a node belonging to another tenant,
    // independently of whether RLS is in force on this connection. Mirrors the
    // `sales`→`invoice_series` composite target (`invoice_series_tenant_id_key`)
    // and the `sale_lines_sale_fk`/`tenders_sale_fk` pattern.
    foreignKey({
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
      name: "sales_node_fk",
    }).onDelete("restrict"),
    // Tenant-consistent composite FK to the parked order this sale was filed from (park & retrieve):
    // a sale cannot point at a working order of another tenant. MATCH SIMPLE (the default) means a
    // NULL working_order_id — an ordinary walk-up sale — skips the check, so the column stays
    // nullable. onDelete "restrict": the settled draft is not deleted out from under its sale.
    foreignKey({
      columns: [t.tenantId, t.workingOrderId],
      foreignColumns: [workingOrders.tenantId, workingOrders.id],
      name: "sales_working_order_fk",
    }).onDelete("restrict"),
    // The sale-idempotency key: at most one sale per (tenant, working order). NULLs are distinct in
    // a UNIQUE, so unlimited walk-up sales (working_order_id NULL) coexist; only a retrieved order
    // filed twice collides. See the column comment above.
    unique("sales_working_order_id_key").on(t.tenantId, t.workingOrderId),
    // `total >= 0` for an ordinary sale, but a rectificativa por diferencias
    // carries a NEGATIVE total (findings §10.2): `record-sale` passes `total`
    // verbatim into the fiscal record's `ImporteTotal`, which the huella hashes,
    // so this column must be allowed to hold that negative value. A corrective
    // (link set) may be negative; an ordinary sale (link NULL) may not.
    check("sales_total_ck", sql`${t.total} >= 0 or ${t.correctsSaleId} is not null`),
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
    // Snapshotted analytics label (architecture §6), NOT a category_id or a catalogue FK — the
    // value is frozen onto the line at sale time so a roll-up sums one canonical bucket and a later
    // taxonomy edit can never reach back into a completed record.
    category: text("category"),
    // The parent line this line modifies (ordering modifiers, Task 2) — a filed MODIFIER child line
    // points at the dish line it belongs to; a top-level line leaves it NULL. Presentation/reporting
    // metadata ONLY — the fiscal record is built from `total` + `vat_breakdown`, never from
    // `sale_lines`, so this never reaches the huella (design §4). Bare NULLABLE uuid: the
    // tenant-consistent self-FK (tenant_id, parent_line_id) → sale_lines(tenant_id, id) is
    // hand-written in the --custom migration (drizzle does not emit a self-referential composite FK —
    // the same split sales_corrects_fk uses), targeting sale_lines_tenant_id_key below. MATCH SIMPLE
    // means a NULL parent satisfies it. NO option/catalogue reference is added here: filed records
    // stay decoupled from the mutable catalogue (option_group_item_id lives on working_order_lines
    // only). Write-once at sale time and immutable table-wide like every other column here.
    parentLineId: uuid("parent_line_id"),
  },
  (t) => [
    // Composite FK: a line cannot point at a sale belonging to another tenant,
    // independently of whether RLS is in force on this connection.
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "sale_lines_sale_fk",
    }).onDelete("restrict"),
    // Composite (tenant_id, id) UNIQUE — the target for the tenant-consistent self-FK
    // (tenant_id, parent_line_id) added in the --custom migration, the same role
    // sales_tenant_id_key plays for sales' children. Neither existed before Task 2.
    unique("sale_lines_tenant_id_key").on(t.tenantId, t.id),
    unique("sale_lines_line_no_key").on(t.saleId, t.lineNo),
    index("sale_lines_sale_idx").on(t.saleId),
    check("sale_lines_quantity_ck", sql`${t.quantity} <> 0`),
    check("sale_lines_vat_rate_ck", sql`${t.vatRate} >= 0 and ${t.vatRate} <= 100`),
    check("sale_lines_line_no_ck", sql`${t.lineNo} >= 1`),
  ],
).enableRLS();

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
export const tenders = pgTable(
  "tenders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    method: tenderMethod("method").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    tipAmount: numeric("tip_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "tenders_sale_fk",
    }).onDelete("restrict"),
    index("tenders_sale_idx").on(t.saleId),
    // Tightened from `amount <> 0` (design §3): the permission for a negative
    // tender was an artefact of spelling, never a decision, and `tip_amount <=
    // amount` cannot coexist with a negative amount.
    check("tenders_amount_ck", sql`${t.amount} > 0`),
    check("tenders_tip_amount_ck", sql`${t.tipAmount} >= 0 and ${t.tipAmount} <= ${t.amount}`),
  ],
).enableRLS();

/**
 * One row per fully-settled sale — appended when settlement is *declared*
 * complete. Append-only (REVOKE UPDATE/DELETE + reject_mutation triggers) like
 * `tenders`. Its existence is the answer to "is this sale paid?"; under
 * invoice-first an unsettled sale is a legitimate steady state, not an anomaly
 * (design §3).
 */
export const saleSettlements = pgTable(
  "sale_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "sale_settlements_sale_fk",
    }).onDelete("restrict"),
    unique("sale_settlements_sale_key").on(t.tenantId, t.saleId),
  ],
).enableRLS();

/**
 * The N:1 substitution link for F3 canje: one row per (F3 sale, substituted simplified ticket)
 * pair (docs/superpowers/plans/2026-08-02-f3-canje.md §2.1). An F3 (factura de canje) issues a full
 * invoice in substitution of one or more previously-issued simplified tickets; this is the
 * generic-layer projection of that relationship, deliberately NOT `corrects_sale_id` reuse —
 * `corrects_sale_id` is 1:1 and means "corrects" (a rectificativa), canje is N:1 and means
 * "substitutes".
 *
 * An immutable, append-only child of `sales` exactly like `sale_lines`/`tenders`: composite
 * tenant-consistent FKs (a row cannot reference a sale of another tenant), RLS with FORCE, and the
 * reject_mutation() triggers — all applied in migration 0014.
 *
 * `unique(tenant_id, substituted_sale_id)` is the DB control for "a ticket is substituted at most
 * once" (§5, decision 4): were the same ticket substituted by two F3s, the underlying operation
 * would appear in two canje invoices. There is deliberately NO unique on `substitution_sale_id` —
 * one F3 substitutes MANY tickets (N rows, the fan-out).
 */
export const saleSubstitutions = pgTable(
  "sale_substitutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // The F3 canje sale — the substitute.
    substitutionSaleId: uuid("substitution_sale_id").notNull(),
    // One substituted simplified ticket. N of these per F3.
    substitutedSaleId: uuid("substituted_sale_id").notNull(),
  },
  (t) => [
    // Composite FKs: neither the substitute nor a substituted ticket may belong to another tenant,
    // independently of whether RLS is in force on this connection. Mirrors sale_lines_sale_fk.
    foreignKey({
      columns: [t.tenantId, t.substitutionSaleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "sale_substitutions_substitution_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.substitutedSaleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "sale_substitutions_substituted_fk",
    }).onDelete("restrict"),
    // A ticket is substituted at most once (§5, decision 4). This also indexes the substituted
    // side; the plain index below covers the substitution (F3 → its tickets) lookup.
    unique("sale_substitutions_substituted_key").on(t.tenantId, t.substitutedSaleId),
    index("sale_substitutions_substitution_idx").on(t.tenantId, t.substitutionSaleId),
  ],
).enableRLS();
