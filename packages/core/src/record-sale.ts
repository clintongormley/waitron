import { saleLineRows } from "./sale-line-rows.js";
// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { eq } from "drizzle-orm";
import {
  allocateInvoiceNumber,
  invoiceSeries,
  locations,
  saleLines,
  sales,
  tills,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  AppError,
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  percentOf,
  stringToCents,
  sumDecimals,
} from "@waitron/shared";
import type { Decimal, NodeId, SaleId, SeriesId, TillId, WorkingOrderId } from "@waitron/shared";
import type {
  FiscalBackend,
  FiscalRecordRef,
  TrustedClock,
  VatBreakdownLine,
} from "@waitron/fiscal";
import type { RecordSaleLine } from "./sale-line.js";
import { recordIncident } from "./incidents.js";
import type { IncidentSeverity } from "./incidents.js";
import { settleSale } from "./settle-sale.js";

export type { RecordSaleLine };

export interface RecordSaleTender {
  method: string;
  amount: string;
  /** Cash handed over before change, separate from the settled amount. */
  cashTendered?: string | null;
  /** The payer's gratuity on THIS tender: non-taxable, on no invoice, and part of `amount`, never
   * on top of it (`tip_amount <= amount`). */
  tipAmount: string;
  /** `null` means the payment has not completed. Nothing is settled until every one is set. */
  settledAt: Date | null;
}

export interface RecordSaleInput {
  /** Where the sale rings; also the key incidents are recorded under. */
  tillId: TillId;
  /** The node that chains the sale. The named series must belong to it. */
  nodeId: NodeId;
  seriesId: SeriesId;
  /**
   * The parked working order this sale is filed from, written to `sales.working_order_id`, which
   * is unique (the sale-idempotency key) and a foreign key onto `working_orders`.
   */
  workingOrderId?: WorkingOrderId;
  locale: string;
  invoiceLocales: string[];
  /** The taxable total, excluding the tip. Supplied rather than re-derived from `lines`: it is the
   * figure the till displayed and the customer paid against. */
  total: string;
  lines: RecordSaleLine[];
  /** A caller-supplied VAT breakdown (e.g. `@waitron/catalogue`'s gross-inclusive figures), handed
   * to the fiscal backend at the cent, and refused with `sale.total_mismatch` unless it sums to
   * `total` both as given and at the cent. Derived from `lines` by `deriveVatBreakdown` when
   * absent. */
  vatBreakdown?: VatBreakdownLine[];
  clock: TrustedClock;
  /**
   * `immediate` hands its tenders to `settleSale` in the same transaction, so pay-first cannot
   * drift from the deferred path. `deferred` records the invoice with no tender and no settlement,
   * to be settled later by `settleSale`.
   */
  settlement: { kind: "immediate"; tenders: RecordSaleTender[] } | { kind: "deferred" };
  /** The operator who rang the sale, for attribution. */
  operatorId?: string;
}

/**
 * The `NumSerieFactura`-shaped identity, series code and counter joined by `/`, exported so a
 * receipt can render the same "A/1" the fiscal record carries.
 */
export function formatInvoiceNumber(code: string, number: number): string {
  return `${code}/${number}`;
}

/** An amount at the cent, as a money column stores it: "1.005" is "1.01". */
function atCents(amount: string): Decimal {
  return centsToDecimal(stringToCents(amount));
}

/** Refuses with `sale.total_mismatch` a breakdown whose bases and taxes do not sum to `total`. */
function assertSumsTo(breakdown: readonly VatBreakdownLine[], total: Decimal): void {
  const breakdownTotal = sumDecimals(breakdown.flatMap((g) => [g.base, g.tax]));
  if (compareDecimal(breakdownTotal, total) !== 0) {
    throw new AppError("sale.total_mismatch", { declaredTotal: total, breakdownTotal });
  }
}

/**
 * Groups `lines` by `vatRate` and derives each group's tax from its summed base: VAT is reported
 * per rate, not per line. Each base is the `lineTotal` at the cent, as `saleLineRows` stores it.
 */
function buildVatBreakdown(lines: readonly RecordSaleLine[]): VatBreakdownLine[] {
  const bases = new Map<Decimal, Decimal>();
  for (const line of lines) {
    const rate = decimal(line.vatRate);
    const base = atCents(line.lineTotal);
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
 * The breakdown derived from `lines`, refused with `sale.total_mismatch` when a line total is past
 * the cent and the breakdown does not sum to `total` at the cent: rounding each line on its own can
 * move the sum, and a chained record that disagrees with its own total cannot be repaired. With
 * every line total at the cent, rounding moves no base and the breakdown is not checked, whatever
 * the total: its sum is at the cent, so a total past the cent never equalled it as typed either.
 */
export function deriveVatBreakdown(
  total: string,
  lines: readonly RecordSaleLine[],
): VatBreakdownLine[] {
  const breakdown = buildVatBreakdown(lines);
  const linePastTheCent = lines.some(
    (line) => compareDecimal(decimal(line.lineTotal), atCents(line.lineTotal)) !== 0,
  );
  if (linePastTheCent) assertSumsTo(breakdown, atCents(total));
  return breakdown;
}

/**
 * Takes a transaction rather than a database: the sale rows and the fiscal write must commit or
 * roll back together, and the caller commits.
 */
export async function recordSale(
  tx: Transaction,
  backend: FiscalBackend,
  input: RecordSaleInput,
): Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }> {
  // Stored and filed at the cent, so the row and the fiscal record cannot hold different amounts.
  const totalCents = stringToCents(input.total);
  const total = centsToDecimal(totalCents);

  // Checked before anything is written: a breakdown that disagrees with the total would chain a
  // record that cannot be repaired. A supplied one is checked as given and again at the cent,
  // where rounding each amount on its own can move the sum; a derived one only when a line total is
  // past the cent (`deriveVatBreakdown`).
  // This is a caller-precondition failure, not a fiscal condition.
  let vatBreakdown: VatBreakdownLine[];
  if (input.vatBreakdown === undefined) {
    vatBreakdown = deriveVatBreakdown(input.total, input.lines);
  } else {
    vatBreakdown = input.vatBreakdown.map((g) => ({
      rate: g.rate,
      base: atCents(g.base),
      tax: atCents(g.tax),
    }));
    assertSumsTo(input.vatBreakdown, decimal(input.total));
    assertSumsTo(vatBreakdown, total);
  }

  // Verification must run against exactly the state this transaction is about to extend; one
  // write transaction runs on the venue file at a time (`withTransaction`,
  // packages/db/src/tenancy.ts).
  const verification = await backend.checkIntegrity(tx, input.nodeId);
  // Nothing branches on `verification.ok`: a failed check records an incident and the sale is
  // chained anyway, because no fiscal condition may block a sale.
  //
  // One incident per failed check, carrying every issue in `params.issues`, and recorded once
  // `saleId` exists so the incident names the receipt the customer holds.
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
      retiredAt: invoiceSeries.retiredAt,
    })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.id, input.seriesId));

  if (series === undefined) {
    throw new AppError("sale.series_not_found", {
      seriesId: input.seriesId,
    });
  }
  if (series.nodeId !== input.nodeId) {
    throw new AppError("sale.series_wrong_node", {
      seriesId: input.seriesId,
      expected: series.nodeId,
      actual: input.nodeId,
    });
  }
  // An ordinary sale never draws from a corrective series (RD 1619/2012 art. 6.1.a).
  if (series.purpose !== "standard") {
    throw new AppError("sale.series_wrong_purpose", {
      seriesId: input.seriesId,
      expected: "standard",
      actual: series.purpose,
    });
  }
  if (series.retiredAt !== null) {
    throw new AppError("sale.series_retired", {
      seriesId: input.seriesId,
      retiredAt: series.retiredAt.toISOString(),
    });
  }

  const invoiceNumber = await allocateInvoiceNumber(tx, input.seriesId);

  // One clock reading for the whole transaction, so the sale and its fiscal record carry the
  // same timestamp for one event.
  const now = input.clock.now();

  // A degraded clock warns; it never blocks the sale.
  if (now.warning) {
    pending.push({ error: now.warning, severity: "warning" });
  }

  // `vat_breakdown` stores the same breakdown handed to `backend.recordSale` below, as decimal
  // strings, not cent counts.
  const [inserted] = await tx
    .insert(sales)
    .values({
      tillId: input.tillId,
      nodeId: input.nodeId,
      seriesId: input.seriesId,
      vatBreakdown,
      workingOrderId: input.workingOrderId ?? null,
      invoiceNumber,
      issuedAt: now.instant.toISOString(),
      issuedOffsetMinutes: now.offsetMinutes,
      total: totalCents,
      locale: input.locale,
      invoiceLocales: input.invoiceLocales,
      fiscalBackend: backend.id,
      fiscalState: "recorded",
      operatorId: input.operatorId ?? null,
    })
    .returning({ id: sales.id });

  /* v8 ignore start */
  if (inserted === undefined) {
    // This unconditional INSERT returns its row or throws on a constraint violation.
    throw new Error("sales: insert returned no row");
  }
  /* v8 ignore stop */

  const saleId = inserted.id as SaleId;

  // On this same transaction, so an incident never commits for a sale that rolls back.
  for (const incident of pending) {
    await recordIncident(tx, {
      tillId: input.tillId,
      saleId,
      detectedAt: now.instant,
      ...incident,
    });
  }

  await tx.insert(saleLines).values(saleLineRows(saleId, input.lines));

  if (input.settlement.kind === "immediate") {
    // Before `backend.recordSale`: a shortfall or an unsettled tender throws here and the whole
    // transaction, the allocated number included, rolls back with nothing chained.
    await settleSale(tx, {
      saleId,
      tenders: input.settlement.tenders,
    });
  }

  const [location] = await tx
    .select({ operationDescription: locations.operationDescription })
    .from(tills)
    .innerJoin(locations, eq(locations.id, tills.locationId))
    .where(eq(tills.id, input.tillId));

  /* v8 ignore start */
  if (location === undefined) {
    // `tills.location_id` is a not-null foreign key, so this means `input.tillId` does not exist.
    throw new Error(`recordSale: no location found for till ${input.tillId}`);
  }
  /* v8 ignore stop */

  // The module builds the fiscal record behind this one call; this package never touches a
  // module's tables.
  const fiscal = await backend.recordSale(tx, {
    tillId: input.tillId,
    nodeId: input.nodeId,
    saleId,
    seriesId: input.seriesId,
    seriesCode: series.code,
    invoiceNumber,
    issuedAt: now.instant,
    offsetMinutes: now.offsetMinutes,
    descriptionOfOperation: location.operationDescription,
    total,
    vatBreakdown,
    // A simplified invoice: no recipient.
    counterparty: null,
  });

  return { saleId, fiscal };
}
