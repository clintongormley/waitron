import { saleLineRows } from "./sale-line-rows.js";
// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { eq } from "drizzle-orm";
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
import { AppError, decimal, stringToCents } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import type { FiscalBackend, FiscalRecordRef, TrustedClock } from "@waitron/fiscal";
import { authorize, type AuthzInput } from "@waitron/identity";
import { recordIncident } from "./incidents.js";
import type { IncidentSeverity } from "./incidents.js";
import { buildVatBreakdown } from "./record-sale.js";
import type { RecordSaleLine } from "./record-sale.js";

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
 * codes, and before the number is allocated, so a refused correction burns no number. A failed
 * integrity check records an incident and the correction proceeds anyway.
 */
export async function recordCorrection(
  tx: Transaction,
  backend: FiscalBackend,
  input: RecordCorrectionInput,
): Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }> {
  // The corrective inherits the original's `locale` and `invoiceLocales`.
  const [original] = await tx
    .select({ locale: sales.locale, invoiceLocales: sales.invoiceLocales })
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

  // Resolved once so the stored `sales.vat_breakdown` and the filed breakdown are the same value.
  const vatBreakdown = buildVatBreakdown(input.lines);

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
      total: stringToCents(input.total),
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

  await tx.insert(saleLines).values(saleLineRows(saleId, input.lines));

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
      total: decimal(input.total),
      vatBreakdown,
      counterparty: null,
    },
    { correctsSaleId: input.correctsSaleId },
  );

  return { saleId, fiscal };
}
