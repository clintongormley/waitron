// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  allocateInvoiceNumber,
  insertInChunks,
  saleLines,
  saleSubstitutions,
  saleVoids,
  sales,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, centsToDecimal, decimal } from "@waitron/shared";
import type { NodeId, SaleId, SaleOrigin, SeriesId } from "@waitron/shared";
import type { FiscalBackend, FiscalRecordRef, TrustedClock } from "@waitron/fiscal";
import { authorize, authorizeManager, type AuthzInput } from "@waitron/identity";
import { insertSale } from "./insert-sale.js";
import { recordIncident } from "./incidents.js";
import type { IncidentSeverity } from "./incidents.js";
import { requireSupportedCorrection } from "./correction-eligibility.js";
import { requireCorrectiveSeries } from "./corrective-series.js";
import { operationDescriptionFor } from "./operation-description.js";

export interface RecordReplacementInput {
  origin: SaleOrigin;
  operationDescription?: string;
  /** The node that issues the replacement and whose chain it extends. */
  nodeId: NodeId;
  /** Must be this node's live `rectificative` series. */
  seriesId: SeriesId;
  /** The invoice the replacement takes the place of. */
  correctsSaleId: SaleId;
  /** The day the original sale really happened, `YYYY-MM-DD`, handed to the backend as is. */
  operationDate?: string;
  /** Checked against permission `sale.rectify`; the authorizer is recorded on the sale. */
  authz: AuthzInput | { managementSessionId: string };
  clock: TrustedClock;
}

/**
 * Records a corrective invoice by replacement: a new invoice, numbered from the rectificative
 * series, carrying the original's own total, stored VAT split and lines in its place. It takes no
 * amounts from the caller. Its own refusals come before a number is allocated; the fiscal backend's
 * come after it, inside the same transaction. A failed integrity check records an incident and
 * the replacement proceeds anyway, as for any corrective.
 */
export async function recordReplacement(
  tx: Transaction,
  backend: FiscalBackend,
  input: RecordReplacementInput,
): Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }> {
  // `${sales}.id`, not `${sales.id}`: see the same subquery in `settleSale`.
  const [original] = await tx
    .select({
      locale: sales.locale,
      invoiceLocales: sales.invoiceLocales,
      total: sales.total,
      counterpartyTaxId: sales.counterpartyTaxId,
      vatBreakdown: sales.vatBreakdown,
      correctsSaleId: sales.correctsSaleId,
      correctionCount: sql<number>`(select count(*) from sales c where c.corrects_sale_id = ${sales}.id)`,
    })
    .from(sales)
    .where(eq(sales.id, input.correctsSaleId));

  if (original === undefined) {
    throw new AppError("sale.not_found", { saleId: input.correctsSaleId });
  }

  const [voided] = await tx
    .select({ saleId: saleVoids.saleId })
    .from(saleVoids)
    .where(eq(saleVoids.saleId, input.correctsSaleId));
  if (voided !== undefined) {
    throw new AppError("sale.voided", { saleId: input.correctsSaleId });
  }

  const [substituted] = await tx
    .select({ id: saleSubstitutions.id })
    .from(saleSubstitutions)
    .where(eq(saleSubstitutions.substitutedSaleId, input.correctsSaleId));
  if (substituted !== undefined) {
    throw new AppError("sale.correction_not_admitted", { reason: "replaced" });
  }

  if (original.correctsSaleId !== null) {
    throw new AppError("sale.correction_not_admitted", { reason: "not_simplified" });
  }

  const series = await requireCorrectiveSeries(tx, input.seriesId, input.nodeId);

  const authorization =
    "managementSessionId" in input.authz
      ? await authorizeManager(tx, {
          managementSessionId: input.authz.managementSessionId,
          permission: "sale.rectify",
        })
      : await authorize(tx, {
          sessionId: input.authz.sessionId,
          permission: "sale.rectify",
          override: input.authz.override,
        });

  requireSupportedCorrection(original.counterpartyTaxId, input.correctsSaleId);

  // A replacement carries the whole invoice; an earlier corrective's change would then be counted
  // beside it.
  if (original.correctionCount > 0) {
    throw new AppError("sale.replacement_not_first", { saleId: input.correctsSaleId });
  }

  const lines = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, input.correctsSaleId))
    .orderBy(saleLines.lineNo);

  const verification = await backend.checkIntegrity(tx, input.nodeId);
  const pending: Array<{ error: AppError; severity: IncidentSeverity }> = [];
  if (verification.issues.length > 0) {
    pending.push({
      error: new AppError("chain.verification_failed", {
        deviceId: input.origin.deviceId,
        issues: verification.issues.map((issue) => ({
          issueCode: issue.code,
          recordId: issue.recordId ?? null,
          issueParams: issue.params,
        })),
      }),
      severity: "error",
    });
  }

  const now = input.clock.now();
  if (now.warning) {
    pending.push({ error: now.warning, severity: "warning" });
  }

  const invoiceNumber = await allocateInvoiceNumber(tx, input.seriesId);

  const saleId = await insertSale(tx, {
    source: input.origin.source,
    deviceId: input.origin.deviceId,
    nodeId: input.nodeId,
    seriesId: input.seriesId,
    vatBreakdown: original.vatBreakdown,
    invoiceNumber,
    issuedAt: now.instant.toISOString(),
    issuedOffsetMinutes: now.offsetMinutes,
    total: original.total,
    locale: original.locale,
    invoiceLocales: original.invoiceLocales,
    fiscalBackend: backend.id,
    fiscalState: "recorded",
    correctsSaleId: input.correctsSaleId,
    replacesOriginal: true,
    authorizedBy: authorization.authorizedBy,
  });

  for (const incident of pending) {
    await recordIncident(tx, {
      origin: input.origin,
      saleId,
      detectedAt: now.instant,
      ...incident,
    });
  }

  const copiedId = new Map(lines.map((line) => [line.id, randomUUID()]));
  await insertInChunks(
    tx,
    saleLines,
    lines.map((line) => ({
      ...line,
      id: copiedId.get(line.id)!,
      saleId,
      parentLineId: line.parentLineId === null ? null : (copiedId.get(line.parentLineId) ?? null),
      correctsLineId: null,
    })),
  );

  const descriptionOfOperation = await operationDescriptionFor(tx, input.operationDescription);

  const fiscal = await backend.recordCorrection(
    tx,
    {
      origin: input.origin,
      nodeId: input.nodeId,
      saleId,
      seriesId: input.seriesId,
      seriesCode: series.code,
      invoiceNumber,
      issuedAt: now.instant,
      offsetMinutes: now.offsetMinutes,
      descriptionOfOperation,
      total: centsToDecimal(original.total),
      vatBreakdown: original.vatBreakdown.map((group) => ({
        rate: decimal(group.rate),
        base: decimal(group.base),
        tax: decimal(group.tax),
      })),
      counterparty: null,
    },
    {
      correctsSaleId: input.correctsSaleId,
      replaces: true,
      ...(input.operationDate === undefined ? {} : { operationDate: input.operationDate }),
    },
  );

  return { saleId, fiscal };
}
