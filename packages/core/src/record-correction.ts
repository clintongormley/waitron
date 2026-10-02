import { saleLineRows } from "./sale-line-rows.js";
// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { eq, sql } from "drizzle-orm";
import {
  allocateInvoiceNumber,
  invoiceSeries,
  locations,
  saleLines,
  saleVoids,
  sales,
  tills,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  negateDecimal,
  rawCentsToDecimal,
  stringToCents,
  sumDecimals,
} from "@waitron/shared";
import type { Decimal, NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import type {
  FiscalBackend,
  FiscalRecordRef,
  TrustedClock,
  VatBreakdownLine,
} from "@waitron/fiscal";
import { authorize, type AuthzInput } from "@waitron/identity";
import { recordIncident } from "./incidents.js";
import type { IncidentSeverity } from "./incidents.js";
import { assertSumsTo, atCents, deriveVatBreakdown } from "./record-sale.js";
import type { RecordSaleLine } from "./record-sale.js";

const ZERO = decimal("0");

export interface RecordCorrectionInput {
  /** Where the corrective invoice rings; not checked against the series (`nodeId` is). */
  tillId: TillId;
  /**
   * The node that issues this corrective invoice and whose chain it extends. Checked against the
   * corrective series (`sale.series_wrong_node`) but deliberately NOT against the original sale's
   * node: a corrective invoice references the original only by identity (`FacturasRectificadas`),
   * from which we infer that the issuing SIF need not be the original's. AEAT's developer FAQ
   * (4-Dec-2025) allows this for the remedy and annulment records — «se [podría] generar y
   * conservar o remitir a la AEAT desde un SIF distinto al que expidió la factura original» — but
   * extending it to a corrective invoice is our reading, not the FAQ's words: confirm it with the
   * asesor before a real cross-node caller is wired.
   */
  nodeId: NodeId;
  /** Must name a `rectificative` series (`sale.series_wrong_purpose`); none is provisioned here. */
  seriesId: SeriesId;
  /** The earlier sale being corrected. */
  correctsSaleId: SaleId;
  /**
   * The corrective invoice's own, already-signed total: negative for a reversal, which
   * `sales_total_ck` allows only because `corrects_sale_id` is set.
   */
  total: string;
  /** The already-signed delta lines (negative for a reversal). Same shape as an ordinary sale's. */
  lines: RecordSaleLine[];
  /**
   * Credits the whole invoice: the corrective's VAT breakdown is the original's stored one,
   * negated, instead of one derived from `lines`, whose per-rate tax can differ from the invoice's
   * by a cent. Refused with `sale.correction_not_whole` unless `total` is minus the original's and
   * nothing corrects the original yet; with `sale.total_mismatch` unless the copy sums to `total`;
   * and with `sale.correction_lines_mismatch` unless, rate by rate, the lines' totals are the
   * copy's base and the gross amounts they state are its base plus tax.
   */
  wholeInvoice?: boolean;
  /** Checked by `recordCorrection` itself against permission `sale.rectify`; the authorizer is
   * recorded on `sales.authorized_by`. */
  authz: AuthzInput;
  clock: TrustedClock;
}

/**
 * Records a corrective invoice (a credit note) for a prior sale: a new record with its own number
 * that points at the invoice it corrects. It settles nothing; a refund is a separate payments
 * action.
 *
 * The authorization gate runs after the sale and series checks, so those still report their own
 * codes, and before the number is allocated, so a correction it refuses burns no number. A
 * derived breakdown's `sale.total_mismatch` refusal comes before all three; a whole-invoice
 * credit's refusals come after the gate and `sale.correction_exceeds_total`, because they read
 * what is on the invoice, and before the number, the refusal of a line no column can store
 * included. A failed integrity check records an incident and the correction proceeds anyway.
 */
export async function recordCorrection(
  tx: Transaction,
  backend: FiscalBackend,
  input: RecordCorrectionInput,
): Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }> {
  // Unless the whole invoice is credited, derived before anything is written; refused when a line
  // total is past the cent and the breakdown no longer sums to the total (`deriveVatBreakdown`).
  const derived =
    input.wholeInvoice === true ? undefined : deriveVatBreakdown(input.total, input.lines);

  // The corrective inherits the original's `locale` and `invoiceLocales`.
  // `${sales}.id`, not `${sales.id}`: see the same subquery in `settleSale`.
  const [original] = await tx
    .select({
      locale: sales.locale,
      invoiceLocales: sales.invoiceLocales,
      total: sales.total,
      vatBreakdown: sales.vatBreakdown,
      corrections: sql<string>`cast(coalesce((select sum(c.total) from sales c where c.corrects_sale_id = ${sales}.id), 0) as text)`,
      correctionCount: sql<number>`(select count(*) from sales c where c.corrects_sale_id = ${sales}.id)`,
    })
    .from(sales)
    .where(eq(sales.id, input.correctsSaleId));

  if (original === undefined) {
    throw new AppError("sale.not_found", { saleId: input.correctsSaleId });
  }

  // A voided sale is not corrected: it was annulled.
  const [voided] = await tx
    .select({ saleId: saleVoids.saleId })
    .from(saleVoids)
    .where(eq(saleVoids.saleId, input.correctsSaleId));

  if (voided !== undefined) {
    throw new AppError("sale.voided", { saleId: input.correctsSaleId });
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
  if (series.purpose !== "rectificative") {
    throw new AppError("sale.series_wrong_purpose", {
      seriesId: input.seriesId,
      expected: "rectificative",
      actual: series.purpose,
    });
  }
  if (series.retiredAt !== null) {
    throw new AppError("sale.series_retired", {
      seriesId: input.seriesId,
      retiredAt: series.retiredAt.toISOString(),
    });
  }

  const authorization = await authorize(tx, {
    sessionId: input.authz.sessionId,
    permission: "sale.rectify",
    override: input.authz.override,
  });

  // After the gate, so a session that may not correct is not told what is left on the invoice.
  // Compared, stored and filed at the cent amount the row stores, not the unrounded input.
  const totalCents = stringToCents(input.total);
  const correction = centsToDecimal(totalCents);
  const remaining = sumDecimals([
    centsToDecimal(original.total),
    rawCentsToDecimal(original.corrections),
  ]);
  if (
    compareDecimal(correction, ZERO) < 0 &&
    compareDecimal(sumDecimals([remaining, correction]), ZERO) < 0
  ) {
    throw new AppError("sale.correction_exceeds_total", {
      saleId: input.correctsSaleId,
      remaining,
      correction,
    });
  }

  // The stored `sales.vat_breakdown` and the filed breakdown are this one value.
  const vatBreakdown =
    derived ?? wholeInvoiceBreakdown(input.correctsSaleId, original, totalCents, input.lines);
  // A whole-invoice credit converts its lines before a number is allocated, so one no column can
  // store is refused with nothing written; the sale's id is filled in once it exists.
  const wholeLineRows = input.wholeInvoice === true ? saleLineRows("", input.lines) : undefined;

  // Nothing branches on `verification.ok`: a failed check records one incident carrying every
  // issue, once `saleId` exists, and the correction is chained anyway.
  const verification = await backend.checkIntegrity(tx, input.nodeId);
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

  // One clock reading, so the corrective sale and its fiscal record carry the same timestamp.
  const now = input.clock.now();

  if (now.warning) {
    pending.push({ error: now.warning, severity: "warning" });
  }

  const invoiceNumber = await allocateInvoiceNumber(tx, input.seriesId);

  // No settlement and no tenders: the refund is a separate action.
  const [inserted] = await tx
    .insert(sales)
    .values({
      tillId: input.tillId,
      nodeId: input.nodeId,
      seriesId: input.seriesId,
      vatBreakdown,
      invoiceNumber,
      issuedAt: now.instant.toISOString(),
      issuedOffsetMinutes: now.offsetMinutes,
      total: totalCents,
      locale: original.locale,
      invoiceLocales: original.invoiceLocales,
      fiscalBackend: backend.id,
      fiscalState: "recorded",
      correctsSaleId: input.correctsSaleId,
      // Written at insert: `sales` is append-only, so the authorizer cannot be added later.
      authorizedBy: authorization.authorizedBy,
    })
    .returning({ id: sales.id });

  /* v8 ignore start */
  if (inserted === undefined) {
    // This unconditional INSERT returns its row or throws on a constraint violation.
    throw new Error("sales: insert returned no row");
  }
  /* v8 ignore stop */

  const saleId = inserted.id as SaleId;

  // On this same transaction, attached to the corrective sale.
  for (const incident of pending) {
    await recordIncident(tx, {
      tillId: input.tillId,
      saleId,
      detectedAt: now.instant,
      ...incident,
    });
  }

  await tx
    .insert(saleLines)
    .values(wholeLineRows?.map((row) => ({ ...row, saleId })) ?? saleLineRows(saleId, input.lines));

  const [location] = await tx
    .select({ operationDescription: locations.operationDescription })
    .from(tills)
    .innerJoin(locations, eq(locations.id, tills.locationId))
    .where(eq(tills.id, input.tillId));

  /* v8 ignore start */
  if (location === undefined) {
    // `tills.location_id` is a not-null foreign key, so this means the till does not exist.
    throw new Error(`recordCorrection: no location found for till ${input.tillId}`);
  }
  /* v8 ignore stop */

  const fiscal = await backend.recordCorrection(
    tx,
    {
      tillId: input.tillId,
      nodeId: input.nodeId,
      saleId,
      seriesId: input.seriesId,
      seriesCode: series.code,
      invoiceNumber,
      issuedAt: now.instant,
      offsetMinutes: now.offsetMinutes,
      descriptionOfOperation: location.operationDescription,
      total: correction,
      vatBreakdown,
      counterparty: null,
    },
    { correctsSaleId: input.correctsSaleId },
  );

  return { saleId, fiscal };
}

/**
 * The original's stored breakdown negated, for a credit of the whole invoice. Refused unless the
 * credit is minus the invoice's total and the first correction of it, so the two net to zero rate
 * by rate; and unless the copy sums to the credit and the lines carry its bases and, where they
 * state one, its gross, so the record agrees with its own total and with the lines stored beside
 * it. A line stating no gross counts as none at its rate; a rate where no line states one is not
 * compared, so an invoice whose lines were written without one can still be credited.
 */
function wholeInvoiceBreakdown(
  saleId: SaleId,
  original: {
    total: number;
    correctionCount: number;
    vatBreakdown: { rate: string; base: string; tax: string }[];
  },
  totalCents: number,
  lines: readonly RecordSaleLine[],
): VatBreakdownLine[] {
  const correction = centsToDecimal(totalCents);
  if (totalCents !== -original.total || original.correctionCount > 0) {
    throw new AppError("sale.correction_not_whole", {
      saleId,
      invoiceTotal: centsToDecimal(original.total),
      correctionCount: original.correctionCount,
      correction,
    });
  }
  const breakdown = original.vatBreakdown.map((group) => ({
    rate: decimal(group.rate),
    base: negateDecimal(decimal(group.base)),
    tax: negateDecimal(decimal(group.tax)),
  }));
  assertSumsTo(breakdown, correction);
  for (const rate of [...breakdown.map((g) => g.rate), ...lines.map((l) => decimal(l.vatRate))]) {
    const atRate = (other: Decimal) => compareDecimal(other, rate) === 0;
    const linesAtRate = lines.filter((l) => atRate(decimal(l.vatRate)));
    const groupsAtRate = breakdown.filter((g) => atRate(g.rate));
    const linesBase = sumDecimals(linesAtRate.map((l) => atCents(l.lineTotal)));
    const breakdownBase = sumDecimals(groupsAtRate.map((g) => g.base));
    // `rateLines` (`@waitron/catalogue`) files tax as gross − base per rate, so a priced invoice's
    // line grosses sum to base + tax there.
    const statedGross = linesAtRate.flatMap((l) =>
      l.lineGross == null ? [] : [atCents(l.lineGross)],
    );
    const linesGross = statedGross.length === 0 ? null : sumDecimals(statedGross);
    const breakdownGross = sumDecimals(groupsAtRate.flatMap((g) => [g.base, g.tax]));
    if (
      compareDecimal(linesBase, breakdownBase) !== 0 ||
      (linesGross !== null && compareDecimal(linesGross, breakdownGross) !== 0)
    ) {
      throw new AppError("sale.correction_lines_mismatch", {
        saleId,
        rate,
        linesBase,
        breakdownBase,
        linesGross,
        breakdownGross,
      });
    }
  }
  return breakdown;
}
