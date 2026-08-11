import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { aggregateVatByRate } from "./vat-summary.js";
import type { VatReturn, VatReturnInput } from "./types.js";

/**
 * The modelo 303 output-VAT (*IVA devengado*) aggregate over one calendar month, for one obligado
 * (tenant), across ALL nodes of the legal entity. Reuses the shared `aggregateVatByRate` core — the
 * same jsonb-unnest + per-rate `Σ` over the filed `sales.vat_breakdown` — with NO node predicate (RLS
 * + the explicit tenant predicate inside the core are the only scoping across nodes, per spec §4/D5).
 *
 * OUTPUT SIDE ONLY. This yields the régimen-general *IVA devengado* per rate ({rate, base, tax} +
 * totals) — the raw material for the 303's output boxes. Deliberately OUT of scope (spec §4, D6): the
 * *IVA deducible/soportado* (input-VAT) side, recargo de equivalencia, and both the exact AEAT casilla
 * mapping and the submittable form. There is no gross box on a 303, so `VatReturn` omits `grossTotal`.
 *
 * Bucketing is by the filed *fecha de expedición* — a CIVIL calendar date, not the operational
 * business day (spec §4/D4). The filed `FechaExpedicionFactura` is the civil-local date of the
 * issuance instant using the sale's OWN snapshotted offset, exactly what AEAT received:
 * `formatDate(issued_at, issued_offset_minutes)` shifts by the offset then reads the date
 * (`packages/verifactu/src/format.ts:119-122` `formatDate` → `:97-112` `shift`). The SQL below is
 * byte-identical to that shift-then-read-date, so it needs no `timeZone` input.
 */
export async function computeVatReturn(tx: Transaction, input: VatReturnInput): Promise<VatReturn> {
  // Caller preconditions — a bad year/month is a plain Error (spec §D9; matches business-day.ts's
  // validators, no registered code). Validated BEFORE any query.
  if (!Number.isInteger(input.year)) {
    throw new Error(`reporting: year must be an integer: ${JSON.stringify(input.year)}`);
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new Error(`reporting: month must be an integer in 1..12: ${JSON.stringify(input.month)}`);
  }

  const firstDay = sql`make_date(${input.year}, ${input.month}, 1)`;
  // The filed fecha de expedición = shift(issued_at, issued_offset_minutes) then read the civil date —
  // byte-identical to verifactu/format.ts's formatDate (spec §4). `at time zone 'UTC'` yields the UTC
  // wall-clock timestamp of the stored timestamptz; adding the snapshot offset reproduces the filed
  // local calendar date without re-deriving any zone.
  const filedDate = sql`((s.issued_at at time zone 'UTC') + make_interval(mins => s.issued_offset_minutes))::date`;
  // Half-open month bound on pure calendar dates (no DST subtlety, spec §4).
  const dateFilter = sql`${filedDate} >= ${firstDay} and ${filedDate} < (${firstDay} + interval '1 month')`;

  const summary = await aggregateVatByRate(tx, { tenantId: input.tenantId, dateFilter });
  return {
    tenantId: input.tenantId,
    year: input.year,
    month: input.month,
    byRate: summary.byRate,
    baseTotal: summary.baseTotal,
    taxTotal: summary.taxTotal,
  };
}
