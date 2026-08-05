// Side-effect only: registers this package's `sale.*` codes on the shared `ErrorParams` registry
// by declaration merging. See ./errors.ts for why, and ./errors.reachability.test.ts for the
// mechanical check that keeps errors.ts reachable from this package's own public barrel
// (index.ts).
import "./errors.js";
import { and, eq } from "drizzle-orm";
import {
  allocateInvoiceNumber,
  invoiceSeries,
  locations,
  saleLines,
  sales,
  tills,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import type {
  Decimal,
  NodeId,
  SaleId,
  SeriesId,
  TenantId,
  TillId,
  WorkingOrderId,
} from "@waitron/shared";
import type {
  FiscalBackend,
  FiscalRecordRef,
  TrustedClock,
  VatBreakdownLine,
} from "@waitron/fiscal";
import { recordIncident } from "./incidents.js";
import type { IncidentSeverity } from "./incidents.js";
import { settleSale } from "./settle-sale.js";
import { percentOf } from "./vat.js";

export interface RecordSaleLine {
  lineNo: number;
  /** locale -> text, snapshotted at line-add time. Never a catalogue reference. */
  descriptions: Record<string, string>;
  quantity: string;
  unitPrice: string;
  /** A percentage literal, e.g. "21.00" meaning 21% — matches `sale_lines.vat_rate`'s own
   * convention. */
  vatRate: string;
  /** The line's tax-EXCLUSIVE base amount. `buildVatBreakdown` below groups lines by `vatRate`
   * and derives each group's tax from this figure via `./vat.js`'s `percentOf` — plain
   * multiplication, because this is already the base rather than a customer-facing gross price
   * that would need reversing out of. */
  lineTotal: string;
  /** Snapshotted analytics label, copied onto `sale_lines.category` at insert; never a catalogue
   * reference. Optional: when absent the line inserts `null`, exactly as before this field existed. */
  category?: string | null;
}

export interface RecordSaleTender {
  method: string;
  amount: string;
  /** The payer's affirmed gratuity on THIS tender, non-taxable and on no invoice — it rides on
   * the tender so it is attributed to the payer who left it, and is a part of `amount`, never on
   * top of it (`tip_amount <= amount`; design §9.2). Consumed by `settleSale`, which sums it into
   * the coverage identity `sum(amount) = total + sum(tip)` and writes it to `tenders.tip_amount`.
   * `recordSale`'s `settlement:{kind:"immediate"}` half hands these straight to `settleSale`. */
  tipAmount: string;
  /** `null` means the payment has not completed. Nothing is settled until every one is set. */
  settledAt: Date | null;
}

export interface RecordSaleInput {
  tenantId: TenantId;
  /** Where the sale rings — written to `sales.till_id` and the fiscal record's `till_id` snapshot,
   * and used for incidents (which stay till-keyed). */
  tillId: TillId;
  /** Which node processes and chains the sale — the SIF/chain/series key (node-id rekey,
   * 2026-08-03, #33). The series↔node guard requires the named series to belong to this node. */
  nodeId: NodeId;
  seriesId: SeriesId;
  workingOrderId: WorkingOrderId;
  locale: string;
  invoiceLocales: string[];
  /** The taxable total — base plus VAT summed across every line — excluding the tip, which is
   * non-taxable and never reaches the fiscal record. Supplied directly rather than re-derived
   * from `lines` here: by the time a completed working order reaches `recordSale`, this is
   * already the figure the till displayed and the customer paid against, and re-deriving it from
   * `lines` would risk it silently disagreeing with what was actually charged. */
  total: string;
  lines: RecordSaleLine[];
  /** The caller-supplied VAT desglose — e.g. `@waitron/catalogue`'s gross-inclusive
   * difference-method breakdown (cuota = gross − base). When absent, `buildVatBreakdown(lines)`
   * derives it as before, so existing callers are unaffected. When present it is filed VERBATIM as
   * the fiscal record's breakdown and asserted to agree with `total` at the top of `recordSale`
   * (`sale.total_mismatch`) — a defence for an unrepairable record (§5), never a re-derivation. */
  vatBreakdown?: VatBreakdownLine[];
  /**
   * Which backend recorded this sale — for the `sales.fiscal_backend` column. Supplied by the
   * caller rather than read off `backend`'s own return value, because it must be known BEFORE
   * `backend.recordSale` runs: `sales` (step 4) is written before the module's own registro
   * (step 5), and `registros_facturacion.sale_id` is a NOT NULL foreign key onto `sales.id`, so
   * the fiscal record cannot exist before the sale row does. The caller already chose which
   * `FiscalBackend` to inject here and therefore already knows its identifying string.
   */
  fiscalBackend: string;
  clock: TrustedClock;
  /**
   * Pay-first vs invoice-first, chosen per sale (design D5). `immediate` settles in the SAME
   * transaction — its `tenders` are handed straight to `settleSale` (design D6), so pay-first
   * behaviour cannot drift from the deferred path. `deferred` records the invoice with no tender
   * and no settlement; the sale is a legitimate unsettled steady state, settled later by
   * `settleSale`. Whether staff are OFFERED the choice is till-UI policy (sub-project 7), never a
   * `tenants` column.
   */
  settlement: { kind: "immediate"; tenders: RecordSaleTender[] } | { kind: "deferred" };
  /** The operator who rang this sale, for attribution (design §7). Optional: the till (#7) supplies
   * it from the open session; enforcement ("must be logged in") is a #7 concern. */
  operatorId?: string;
}

/**
 * `NumSerieFactura`-shaped identity string — series code and counter joined by `/`. Kept
 * regime-neutral in name and shape (nothing here is AEAT-specific), and exported so a receipt or
 * till-display component can render the same "A/1" form the fiscal record itself carries, without
 * duplicating the join.
 */
export function formatInvoiceNumber(code: string, number: number): string {
  return `${code}/${number}`;
}

/**
 * Groups `lines` by `vatRate` and derives each group's tax from its summed base — the shape
 * `FiscalBackend.recordSale`'s `SaleForFiscalRecord.vatBreakdown` requires. Two lines at the same
 * rate become one breakdown entry, matching how a real VAT breakdown is reported: per rate, not
 * per line.
 */
export function buildVatBreakdown(lines: readonly RecordSaleLine[]): VatBreakdownLine[] {
  const bases = new Map<Decimal, Decimal>();
  for (const line of lines) {
    const rate = decimal(line.vatRate);
    const base = decimal(line.lineTotal);
    const existing = bases.get(rate);
    bases.set(rate, existing === undefined ? base : addDecimal(existing, base));
  }
  return [...bases.entries()].map(([rate, base]) => ({
    rate,
    base,
    tax: percentOf(base, rate),
  }));
}

/**
 * Spec §4, steps 1-7. Takes a transaction handle rather than a database: the atomicity between
 * the sale rows and the fiscal write is the entire point, and an interface hiding the transaction
 * would let a backend break it silently.
 */
export async function recordSale(
  tx: Transaction,
  backend: FiscalBackend,
  input: RecordSaleInput,
): Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }> {
  // A caller-supplied breakdown is filed VERBATIM as the fiscal record's desglose (below), so it
  // must reconcile with the total it is filed against BEFORE anything is written — a breakdown that
  // disagrees would chain a self-inconsistent, unrepairable record (§5). Value comparison, never
  // lexical, so "7.97" reconciles regardless of scale. Only the supplied path can trip this: the
  // derived path (`buildVatBreakdown(input.lines)`) cannot disagree with itself, so no existing
  // caller reaches it. Placed at the very top, before `checkIntegrity` — this is a caller-precondition
  // failure, not a fiscal condition, and no state should exist by the time it throws.
  if (input.vatBreakdown !== undefined) {
    const breakdownTotal = sumDecimals(input.vatBreakdown.flatMap((g) => [g.base, g.tax]));
    if (compareDecimal(breakdownTotal, decimal(input.total)) !== 0) {
      throw new AppError("sale.total_mismatch", { declaredTotal: input.total, breakdownTotal });
    }
  }

  // Steps 1 and 2, one call and deliberately so. A real backend's `checkIntegrity` takes the
  // (tenant, node) chain-head row lock as its own first statement and holds it until commit, so
  // art. 7.i verification runs against exactly the state this transaction is about to extend
  // rather than a snapshot another writer may already have moved past.
  const verification = await backend.checkIntegrity(tx, input.tenantId, input.nodeId);
  // Nothing branches on `verification.ok`. A failed check records an incident (below, once
  // `saleId` exists) and the sale is chained anyway — no fiscal condition may block a sale. If a
  // later change adds `if (!verification.ok) throw ...` here, it has implemented the one
  // behaviour the law forbids.
  //
  // ONE incident per failed check (never one per issue), deferred until `saleId` exists:
  // `incidents.sale_id` is what ties a chain failure to the receipt a customer is holding, and it
  // cannot be set before the sale row is. All of this call's issues are aggregated into a single
  // `chain.verification_failed` — the table-wide `incidents_open_dedup` index holds at most one open
  // incident per (tenant, till, code, sale), so emitting one row per issue (all sharing this sale +
  // code) would collapse to a single row and drop every issue after the first; carrying them in
  // `params.issues` keeps them all. Collected here rather than recorded immediately, so this stays
  // the single place that decides WHAT counts as an incident on this write path.
  const pending: Array<{ error: AppError; severity: IncidentSeverity }> = [];
  if (verification.issues.length > 0) {
    pending.push({
      error: new AppError("chain.verification_failed", {
        tillId: input.tillId,
        issues: verification.issues.map((issue) => ({
          issueCode: issue.code,
          recordId: issue.recordId ?? null,
          issueParams: issue.params,
        })),
      }),
      severity: "error",
    });
  }

  const [series] = await tx
    .select({
      code: invoiceSeries.code,
      nodeId: invoiceSeries.nodeId,
      purpose: invoiceSeries.purpose,
    })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.id, input.seriesId), eq(invoiceSeries.tenantId, input.tenantId)));

  if (series === undefined) {
    throw new AppError("sale.series_not_found", {
      seriesId: input.seriesId,
      tenantId: input.tenantId,
    });
  }
  if (series.nodeId !== input.nodeId) {
    throw new AppError("sale.series_wrong_node", {
      seriesId: input.seriesId,
      expected: series.nodeId,
      actual: input.nodeId,
    });
  }
  // An ordinary sale must draw from a `purpose='standard'` series, never a corrective one — the
  // other half of the §5 separation `recordCorrection` enforces from its side. A corrective series
  // exists to number rectificativas «en todo caso» (RD 1619/2012 art. 6.1.a); a normal sale drawing
  // from it would consume a corrective number and break the mandated split.
  if (series.purpose !== "standard") {
    throw new AppError("sale.series_wrong_purpose", {
      seriesId: input.seriesId,
      expected: "standard",
      actual: series.purpose,
    });
  }

  // Step 3. Allocation comes AFTER the chain-head lock, never before, and the reason is lock
  // ordering rather than regulation: both the chain-head row and the series row stay locked
  // until commit, so every path must take them in the same order. Chain-then-series here and
  // series-then-chain anywhere else is the textbook inversion that deadlocks two concurrent
  // sales on one node — the chain-head lock is the per-node `cadenas` row, which spans that
  // node's tills (node-id rekey, 2026-08-03).
  const invoiceNumber = await allocateInvoiceNumber(tx, input.seriesId);

  // One clock reading for the whole transaction. Reading it again later (e.g. inside the module,
  // for its own generation timestamp) would let a second boundary fall between the two, and the
  // sale and its fiscal record would then carry different timestamps for a single event — which
  // is why the SAME `now.instant`/`now.offsetMinutes` travel into both the `sales` row below and
  // `SaleForFiscalRecord.issuedAt`/`offsetMinutes` handed to the backend afterwards.
  const now = input.clock.now();

  // Spec §4: clock confidence degraded is WARN ONLY, never blocking. `now.warning` is already a
  // fully-formed `AppError<"clock.degraded" | "clock.jump_detected">` (packages/fiscal's own
  // `createTrustedClock`) — reused verbatim rather than reconstructed, so its `anchorAgeSeconds`/
  // `wallClockDeltaSeconds` params travel through unchanged instead of being re-derived here.
  if (now.warning) {
    pending.push({ error: now.warning, severity: "warning" });
  }

  // Step 4. `total` is the only money column left on the sale: the tip moved to
  // `tenders.tip_amount` and `amount_charged` is derived, never stored (design D1-D3, migration
  // 0012) — which is exactly what lets the sale be written before payment settles.
  const [inserted] = await tx
    .insert(sales)
    .values({
      tenantId: input.tenantId,
      tillId: input.tillId,
      nodeId: input.nodeId,
      seriesId: input.seriesId,
      invoiceNumber,
      issuedAt: now.instant.toISOString(),
      issuedOffsetMinutes: now.offsetMinutes,
      total: input.total,
      locale: input.locale,
      invoiceLocales: input.invoiceLocales,
      fiscalBackend: input.fiscalBackend,
      fiscalState: "recorded",
      operatorId: input.operatorId ?? null,
    })
    .returning({ id: sales.id });

  /* v8 ignore start */
  if (inserted === undefined) {
    // Unreachable: this INSERT carries no WHERE clause, and RLS's WITH CHECK — not its USING
    // clause — governs an insert, so a mismatched app.tenant_id fails the check with an error
    // rather than silently inserting zero rows.
    throw new Error("sales: insert returned no row");
  }
  /* v8 ignore stop */

  const saleId = inserted.id as SaleId;

  // Recorded now that saleId exists, on this same transaction — never a fresh connection, which
  // would let an incident commit for a sale that later rolls back (or the reverse). See
  // ./incidents.ts's own doc comment on recordIncident.
  for (const incident of pending) {
    await recordIncident(tx, {
      tenantId: input.tenantId,
      tillId: input.tillId,
      saleId,
      detectedAt: now.instant,
      ...incident,
    });
  }

  await tx.insert(saleLines).values(
    input.lines.map((line) => ({
      tenantId: input.tenantId,
      saleId,
      lineNo: line.lineNo,
      descriptions: line.descriptions,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      lineTotal: line.lineTotal,
      category: line.category ?? null,
    })),
  );

  if (input.settlement.kind === "immediate") {
    // The one settlement implementation both modes take (design D6): pay-first hands its tenders
    // straight to `settleSale`, in this same transaction. A shortfall or an unsettled tender throws
    // HERE, which aborts the whole transaction — the allocated invoice number and everything written
    // so far roll back — so a declined card still leaves nothing chained (as before), by atomicity
    // rather than by an early pre-check. Placed before `backend.recordSale` so the fiscal write is
    // never reached on a settlement that cannot complete.
    await settleSale(tx, {
      tenantId: input.tenantId,
      saleId,
      tenders: input.settlement.tenders,
    });
  }

  const [location] = await tx
    .select({ operationDescription: locations.operationDescription })
    .from(tills)
    .innerJoin(locations, eq(locations.id, tills.locationId))
    .where(and(eq(tills.id, input.tillId), eq(tills.tenantId, input.tenantId)));

  /* v8 ignore start */
  if (location === undefined) {
    // Structurally unreachable given the schema's own invariants: `tills.location_id` is a NOT
    // NULL foreign key onto `locations.id`, so a till that exists at all always joins to exactly
    // one location. Reaching here means `input.tillId` does not exist, or RLS hid a till
    // belonging to another tenant — a caller programming error, not a fiscal condition, so there
    // is no `sale.*` code reserved for it.
    throw new Error(`recordSale: no location found for till ${input.tillId}`);
  }
  /* v8 ignore stop */

  // Steps 5 and 6, both inside the module. packages/core may not touch a module's own tables —
  // this package must not know a chain, a hash or a submission sidecar exist at all — so building
  // the fiscal record, advancing whatever internal chain the regime keeps, and inserting its own
  // pending-submission row all happen behind this one call, on this transaction.
  const fiscal = await backend.recordSale(tx, {
    tenantId: input.tenantId,
    tillId: input.tillId,
    nodeId: input.nodeId,
    saleId,
    seriesId: input.seriesId,
    seriesCode: series.code,
    invoiceNumber,
    issuedAt: now.instant,
    offsetMinutes: now.offsetMinutes,
    descriptionOfOperation: location.operationDescription,
    total: decimal(input.total),
    // Supplied verbatim when the caller computed its own desglose (asserted to reconcile with
    // `total` at the top of this function); otherwise derived from `lines` exactly as before.
    vatBreakdown: input.vatBreakdown ?? buildVatBreakdown(input.lines),
    // Null for a simplified invoice, which is the ordinary case at a till (spec's own framing on
    // `FiscalBackend.recordSale`'s `SaleForFiscalRecord.counterparty`). This task does not wire
    // up a recipient-identified (B2B) sale at all; a future task that does supplies a real
    // `Counterparty` here instead.
    counterparty: null,
  });

  // Step 7 is the caller's. Returning inside the transaction rather than committing here is what
  // lets the till write the working-order settlement, the sale and the fiscal record as one unit
  // of work.
  return { saleId, fiscal };
}
