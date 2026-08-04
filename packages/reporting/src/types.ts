import type { Decimal, NodeId, TenantId, TillId } from "@waitron/shared";

/** A tender method, mirroring `tender_method` in packages/db/src/schema/sales.ts. */
export type TenderMethod = "cash" | "card" | "voucher" | "transfer" | "other";

export interface DailyCloseInput {
  tenantId: TenantId;
  nodeId: NodeId;
  /** Local calendar date of the business day, "YYYY-MM-DD". */
  businessDay: string;
  /** IANA timezone, e.g. "Europe/Madrid". Required; never defaulted to UTC. */
  timeZone: string;
  /** "HH:MM" time-of-day in `timeZone` at which the business day starts, e.g. "05:00". */
  dayCutover: string;
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
  nodeId: NodeId;
  businessDay: string;
  timeZone: string;
  vat: VatSummary;
  cash: CashUp;
  counts: CloseCounts;
}
