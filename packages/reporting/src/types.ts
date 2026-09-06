import type { Decimal, NodeId, TenantId, TillId, TimingBand } from "@waitron/shared";
import type { LiquidationPeriod } from "./period.js";

/** A tender method, mirroring `tender_method` in packages/db/src/schema/sales.ts. */
export type TenderMethod = "cash" | "card" | "voucher" | "transfer" | "other";

export interface DailyCloseInput {
  tenantId: TenantId;
  /** Omit → aggregate across ALL the tenant's nodes (the tenant predicate scopes it), the same
   * venue-wide shape `PeriodVatInput` allows. Node-grain callers (the fiscal daily close, the
   * dashboard's per-till daily-close view) pass a node; the dashboard OVERVIEW omits it so its
   * takings/counts aggregate the whole venue (report-api overview, membership promotion R3a). */
  nodeId?: NodeId;
  /** Local calendar date of the business day, "YYYY-MM-DD". */
  businessDay: string;
  /** IANA timezone, e.g. "Europe/Madrid". Required; never defaulted to UTC. */
  timeZone: string;
  /** "HH:MM" time-of-day in `timeZone` at which the business day starts, e.g. "05:00". */
  dayCutover: string;
}

export interface PeriodVatInput {
  tenantId: TenantId;
  /** Omit → aggregate across ALL the tenant's nodes (the tenant predicate scopes it). */
  nodeId?: NodeId;
  /** Inclusive lower bound, local calendar date of the business day, "YYYY-MM-DD". */
  fromBusinessDay: string;
  /** Inclusive upper bound, local calendar date of the business day, "YYYY-MM-DD". */
  toBusinessDay: string;
  /** IANA timezone, e.g. "Europe/Madrid". Required; never defaulted to UTC. */
  timeZone: string;
  /** "HH:MM" time-of-day in `timeZone` at which the business day starts, e.g. "05:00". */
  dayCutover: string;
}

/** The top-sellers query: the same (tenant, optional node, business-day range, clock) scope as a
 * period VAT roll-up, plus how many rows to return. */
export interface TopSellersInput extends PeriodVatInput {
  /** How many top products to return. Must be a positive integer. */
  limit: number;
}

/** One product in the top-sellers list, keyed on the frozen per-line `descriptions` snapshot. */
export interface TopSeller {
  /** The frozen `sale_lines.descriptions` map (locale → label), returned intact for the frontend. */
  descriptions: Record<string, string>;
  /** Σ line quantity over the range (numeric(12,3)); corrections net in, so it can fall. */
  quantity: Decimal;
  /** Σ line_total over the range (numeric(12,2)); corrections net in. */
  total: Decimal;
}

export interface VatReturnInput {
  /** The obligado — a modelo 303 aggregates ALL nodes of the legal entity (no node predicate). */
  tenantId: TenantId;
  /** Civil calendar year of the liquidation period, e.g. 2026 (must be an integer). */
  year: number;
  /** The liquidation period (month/quarter/year). */
  period: LiquidationPeriod;
}

/** What an input-VAT line was spent on (mirrors the `purchase_vat_kind` enum): `ordinary` =
 * operaciones corrientes (casilla 28/29); `capital` = bienes de inversión (casilla 30/31). */
export type PurchaseVatKind = "ordinary" | "capital";

/** One deducible line, grouped by (rate, kind). `tax` is the deductible cuota (Σ of the filed
 * per-invoice cuotas × deductible_proportion/100, rounded per invoice line), never re-rounded on the
 * monthly base — the same exactness rule the output side follows. */
export interface InputVatRateLine {
  rate: Decimal;
  base: Decimal;
  tax: Decimal;
  kind: PurchaseVatKind;
}

/** The régimen-general IVA deducible aggregate (recargo de equivalencia excluded), per (rate, kind). */
export interface InputVatSummary {
  byRate: InputVatRateLine[];
  /** Σ base imponible deducible. */
  baseTotal: Decimal;
  /** Σ cuota deducible (the input-VAT total to deduct). */
  taxTotal: Decimal;
}

export interface InputVatReturn extends InputVatSummary {
  tenantId: TenantId;
  year: number;
  /** The liquidation period (month/quarter/year). */
  period: LiquidationPeriod;
}

export interface VatReturn {
  tenantId: TenantId;
  year: number;
  /** The liquidation period (month/quarter/year). */
  period: LiquidationPeriod;
  /** Régimen-general IVA devengado per rate {rate, base, tax}, corrections netted (the output side). */
  byRate: VatRateLine[];
  /** Σ base imponible devengada. */
  baseTotal: Decimal;
  /** Σ cuota devengada (the output-VAT total — casilla 27 side). */
  taxTotal: Decimal;
  /** IVA deducible (input side), régimen general only, bucketed by received_on (casilla 45 side). */
  deductible: InputVatSummary;
  /** Resultado régimen general = taxTotal (devengado) − deductible.taxTotal (casilla 46 = 27 − 45). */
  result: Decimal;
}

export interface VatRateLine {
  /** Percentage literal as stored, e.g. "21.00". */
  rate: Decimal;
  /** Net taxable base at this rate (corrections netted). */
  base: Decimal;
  /** Net tax at this rate (the fiscal cuota — English identifier, per the english-only guard). */
  tax: Decimal;
}
export interface VatSummary {
  byRate: VatRateLine[];
  baseTotal: Decimal;
  /** Σ tax across rates (the fiscal cuota total). */
  taxTotal: Decimal;
  grossTotal: Decimal;
}

export interface TenderMethodLine {
  method: TenderMethod;
  /** Total collected via this method (includes its tip portion). */
  amount: Decimal;
  /** Tip portion collected via this method. */
  tip: Decimal;
}
export interface TillCashUp {
  tillId: TillId;
  byMethod: TenderMethodLine[];
  /** Σ cash-method amount at this till (cash revenue + cash tips). */
  cashTakings: Decimal;
}
export interface CashUp {
  byTill: TillCashUp[];
  tenderTotal: Decimal;
  tipTotal: Decimal;
}

export interface CloseCounts {
  /** Ordinary altas issued in the business day (corrects_sale_id NULL), excl. voided + F3 substitutes. */
  sales: number;
  /** Rectificativas issued in the business day (corrects_sale_id set), excl. voided. */
  corrections: number;
  /** Void events (`sale_voids`) whose voided_at falls in the business day, for this node. */
  voids: number;
}

export interface DailyClose {
  tenantId: TenantId;
  /** The node this close is grain-scoped to, or omitted for a venue-wide close (mirrors
   * `DailyCloseInput.nodeId`). The fiscal `recordDailyClose` always supplies a node; the venue-wide
   * overview does not read this field. */
  nodeId?: NodeId;
  businessDay: string;
  timeZone: string;
  vat: VatSummary;
  cash: CashUp;
  counts: CloseCounts;
}

/** The manager overview's overdue-orders query: THIS node's currently-open kitchen orders, scoped
 * exactly as the other `/reports` routes are (design §7.4). No business-day range — the read is a
 * live snapshot of right now, not a closed historical period. */
export interface OverdueOrdersInput {
  tenantId: TenantId;
  nodeId: NodeId;
}

/** One currently-open order whose worst UNSERVED line has crossed into `overdue` or `forgotten`
 * (design §7.4) — the manager overview's "orders taking too long" list, worst-first. `stationName`
 * and `ageMinutes` describe that WORST line (an order can span several stations; this is the one
 * driving the escalation), not necessarily the order's oldest or first-fired line. */
export interface OverdueOrder {
  orderId: string;
  orderNumber: number;
  /** The dining table this order is served at (a tab's back-pointer or a counter delivery), or
   *  `null` for a bare walk-up — the same optionality `ExpoOrder.tableLabel` carries. */
  tableLabel: string | null;
  stationName: string;
  ageMinutes: number;
  /** Only ever `"overdue"` or `"forgotten"` — a `"fresh"`/`"warm"` order never reaches this list. */
  band: TimingBand;
}
