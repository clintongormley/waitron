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
  tenders,
  tills,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import type { Decimal, SaleId, SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
import type {
  FiscalBackend,
  FiscalRecordRef,
  TrustedClock,
  VatBreakdownLine,
} from "@waitron/fiscal";
import { recordIncident } from "./incidents.js";
import type { IncidentSeverity } from "./incidents.js";
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
}

export interface RecordSaleTender {
  method: string;
  amount: string;
  /** `null` means the payment has not completed. Nothing is chained until every one is set. */
  settledAt: Date | null;
}

export interface RecordSaleInput {
  tenantId: TenantId;
  tillId: TillId;
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
  tipAmount: string;
  lines: RecordSaleLine[];
  tenders: RecordSaleTender[];
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
 * The fiscal record is created when ALL tenders settle, never per payment.
 *
 * Checked before anything at all is written, so a declined card leaves the working order open and
 * retryable with nothing chained. The alternative chains records for sales that never happened,
 * correctable only by issuing a rectifying record later.
 */
function assertAllTendersSettled(input: RecordSaleInput): void {
  const unsettled = input.tenders.filter((tender) => tender.settledAt === null);
  if (unsettled.length > 0) {
    throw new AppError("sale.tender_unsettled", {
      tillId: input.tillId,
      workingOrderId: input.workingOrderId,
      unsettledCount: unsettled.length,
    });
  }
  const due = addDecimal(decimal(input.total), decimal(input.tipAmount));
  const charged = sumDecimals(input.tenders.map((tender) => decimal(tender.amount)));
  if (compareDecimal(charged, due) !== 0) {
    throw new AppError("sale.tender_shortfall", {
      tillId: input.tillId,
      workingOrderId: input.workingOrderId,
      due,
      charged,
    });
  }
}

/**
 * Groups `lines` by `vatRate` and derives each group's tax from its summed base — the shape
 * `FiscalBackend.recordSale`'s `SaleForFiscalRecord.vatBreakdown` requires. Two lines at the same
 * rate become one breakdown entry, matching how a real VAT breakdown is reported: per rate, not
 * per line.
 */
function buildVatBreakdown(lines: readonly RecordSaleLine[]): VatBreakdownLine[] {
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
  assertAllTendersSettled(input);

  // Steps 1 and 2, one call and deliberately so. A real backend's `checkIntegrity` takes the
  // (tenant, till) chain-head row lock as its own first statement and holds it until commit, so
  // art. 7.i verification runs against exactly the state this transaction is about to extend
  // rather than a snapshot another writer may already have moved past.
  const verification = await backend.checkIntegrity(tx, input.tenantId, input.tillId);
  // Nothing branches on `verification.ok`. A failed check records an incident (below, once
  // `saleId` exists) and the sale is chained anyway — no fiscal condition may block a sale. If a
  // later change adds `if (!verification.ok) throw ...` here, it has implemented the one
  // behaviour the law forbids.
  //
  // One incident per issue, deferred until `saleId` exists: `incidents.sale_id` is what ties a
  // chain failure to the receipt a customer is holding, and it cannot be set before the sale row
  // is. Collected here rather than recorded immediately, so this stays the single place that
  // decides WHAT counts as an incident on this write path.
  const pending: Array<{ error: AppError; severity: IncidentSeverity }> = [];
  for (const issue of verification.issues) {
    pending.push({
      error: new AppError("chain.verification_failed", {
        tillId: input.tillId,
        issueCode: issue.code,
        recordId: issue.recordId ?? null,
        issueParams: issue.params,
      }),
      severity: "error",
    });
  }

  const [series] = await tx
    .select({ code: invoiceSeries.code, tillId: invoiceSeries.tillId })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.id, input.seriesId), eq(invoiceSeries.tenantId, input.tenantId)));

  if (series === undefined) {
    throw new AppError("sale.series_not_found", {
      seriesId: input.seriesId,
      tenantId: input.tenantId,
    });
  }
  if (series.tillId !== input.tillId) {
    throw new AppError("sale.series_wrong_till", {
      seriesId: input.seriesId,
      expected: series.tillId,
      actual: input.tillId,
    });
  }

  // Step 3. Allocation comes AFTER the chain-head lock, never before, and the reason is lock
  // ordering rather than regulation: both the chain-head row and the series row stay locked
  // until commit, so every path must take them in the same order. Chain-then-series here and
  // series-then-chain anywhere else is the textbook inversion that deadlocks two concurrent
  // sales on one till.
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

  const amountCharged = addDecimal(decimal(input.total), decimal(input.tipAmount));

  // Step 4.
  const [inserted] = await tx
    .insert(sales)
    .values({
      tenantId: input.tenantId,
      tillId: input.tillId,
      seriesId: input.seriesId,
      invoiceNumber,
      issuedAt: now.instant.toISOString(),
      issuedOffsetMinutes: now.offsetMinutes,
      total: input.total,
      tipAmount: input.tipAmount,
      amountCharged,
      locale: input.locale,
      invoiceLocales: input.invoiceLocales,
      fiscalBackend: input.fiscalBackend,
      fiscalState: "recorded",
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
    })),
  );

  await tx.insert(tenders).values(
    input.tenders.map((tender) => ({
      tenantId: input.tenantId,
      saleId,
      // `assertAllTendersSettled` above already guarantees every `settledAt` is non-null; the
      // `!` reflects that guard rather than asserting past it blind.
      method: tender.method as (typeof tenders.$inferInsert)["method"],
      amount: tender.amount,
      settledAt: tender.settledAt!.toISOString(),
    })),
  );

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
    saleId,
    seriesId: input.seriesId,
    seriesCode: series.code,
    invoiceNumber,
    issuedAt: now.instant,
    offsetMinutes: now.offsetMinutes,
    descriptionOfOperation: location.operationDescription,
    total: decimal(input.total),
    vatBreakdown: buildVatBreakdown(input.lines),
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
