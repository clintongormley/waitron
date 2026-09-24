import { saleLineRows } from "./sale-line-rows.js";
// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { eq, inArray } from "drizzle-orm";
import {
  allocateInvoiceNumber,
  invoiceSeries,
  isUniqueViolation,
  locations,
  saleLines,
  saleSubstitutions,
  saleVoids,
  sales,
  tills,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, decimal, stringToCents } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import type { Counterparty, FiscalBackend, FiscalRecordRef, TrustedClock } from "@waitron/fiscal";
import { recordIncident } from "./incidents.js";
import type { IncidentSeverity } from "./incidents.js";
import { buildVatBreakdown } from "./record-sale.js";
import type { RecordSaleLine } from "./record-sale.js";

export interface RecordSubstitutionInput {
  /** Where the F3 rings; not checked against the series (`nodeId` is). */
  tillId: TillId;
  /**
   * The node that issues this F3 and whose chain it extends. Checked against the series but not
   * against the substituted tickets' nodes: an F3 references them only by identity
   * (`FacturasSustituidas`). The same open question as `RecordCorrectionInput.nodeId` applies.
   */
  nodeId: NodeId;
  /**
   * An F3 draws its own number from an ordinary `standard` series (owner decision: there is no
   * separate substitution purpose), guarded exactly as `recordSale`'s series is.
   */
  seriesId: SeriesId;
  /**
   * The simplified (F2) tickets this one full invoice replaces: non-empty and free of duplicates,
   * or a plain Error before anything is read or written.
   */
  substitutedSaleIds: SaleId[];
  /**
   * The recipient, required because a full invoice always names one («siempre debe llevar el
   * destinatario»). Written to the F3's `counterparty_*` columns and passed to the module.
   */
  counterparty: Counterparty;
  /** The F3's own total, positive: it restates the substituted operations rather than negating
   * them, and `corrects_sale_id` stays null. */
  total: string;
  /** The F3's own positive lines. Same shape as an ordinary sale's. */
  lines: RecordSaleLine[];
  /** Supplied by the caller rather than inherited, unlike a corrective invoice's: an F3 is a fresh
   * invoice, not a property of any one ticket. */
  locale: string;
  invoiceLocales: string[];
  clock: TrustedClock;
}

/**
 * Records a `factura de canje` (AEAT `TipoFactura` F3): a full invoice, naming the customer's tax
 * details, issued in substitution of one or more simplified tickets (F2).
 *
 * An F3 is not a corrective invoice. The tickets stay recorded, neither edited nor annulled; AEAT
 * avoids counting the amount twice because the record identifies itself as a substitution. So the
 * F3 carries a positive total and one `sale_substitutions` row per ticket.
 *
 * The customer already paid on the tickets («no cobrar dos veces»), so the F3 is recorded with no
 * tender and no settlement. A failed integrity check records an incident and the F3 proceeds
 * anyway.
 */
export async function recordSubstitution(
  tx: Transaction,
  backend: FiscalBackend,
  input: RecordSubstitutionInput,
): Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }> {
  // Programming errors the till UI must prevent, so plain Errors rather than `sale.*` codes. An
  // empty list would file a full invoice replacing nothing; a duplicate would name one ticket twice.
  // Enforced here rather than trusted to the caller or the backend.
  if (input.substitutedSaleIds.length === 0) {
    throw new Error(
      "recordSubstitution: substitutedSaleIds must name at least one ticket — an F3 substitutes one or more simplified tickets",
    );
  }
  if (new Set(input.substitutedSaleIds).size !== input.substitutedSaleIds.length) {
    throw new Error(
      "recordSubstitution: substitutedSaleIds must not contain duplicate ids — a ticket may be substituted at most once per F3",
    );
  }

  // The first missing id in input order is the one reported.
  const found = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(inArray(sales.id, input.substitutedSaleIds));
  const foundIds = new Set(found.map((row) => row.id));
  for (const substitutedSaleId of input.substitutedSaleIds) {
    if (!foundIds.has(substitutedSaleId)) {
      throw new AppError("sale.not_found", { saleId: substitutedSaleId });
    }
  }

  // A voided ticket cannot be exchanged. The first voided ticket in input order is named.
  const voided = await tx
    .select({ saleId: saleVoids.saleId })
    .from(saleVoids)
    .where(inArray(saleVoids.saleId, input.substitutedSaleIds));
  const voidedIds = new Set(voided.map((row) => row.saleId));
  for (const substitutedSaleId of input.substitutedSaleIds) {
    if (voidedIds.has(substitutedSaleId)) {
      throw new AppError("sale.voided", { saleId: substitutedSaleId });
    }
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

  // Nothing branches on `verification.ok`: a failed check records one incident carrying every
  // issue, once `saleId` exists, and the F3 is chained anyway.
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

  // One clock reading, so the F3 and its fiscal record carry the same timestamp.
  const now = input.clock.now();

  if (now.warning) {
    pending.push({ error: now.warning, severity: "warning" });
  }

  const invoiceNumber = await allocateInvoiceNumber(tx, input.seriesId);

  // Resolved once so the stored `sales.vat_breakdown` and the filed breakdown are the same value.
  const vatBreakdown = buildVatBreakdown(input.lines);

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
      locale: input.locale,
      invoiceLocales: input.invoiceLocales,
      fiscalBackend: backend.id,
      fiscalState: "recorded",
      counterpartyTaxId: input.counterparty.taxId,
      counterpartyLegalName: input.counterparty.legalName,
      counterpartyCountryCode: input.counterparty.countryCode,
    })
    .returning({ id: sales.id });

  /* v8 ignore start */
  if (inserted === undefined) {
    // This unconditional INSERT returns its row or throws on a constraint violation.
    throw new Error("sales: insert returned no row");
  }
  /* v8 ignore stop */

  const saleId = inserted.id as SaleId;

  // On this same transaction, attached to the F3.
  for (const incident of pending) {
    await recordIncident(tx, {
      tillId: input.tillId,
      saleId,
      detectedAt: now.instant,
      ...incident,
    });
  }

  await tx.insert(saleLines).values(saleLineRows(saleId, input.lines));

  // One row per ticket, inserted one at a time so a unique violation names the ticket that
  // collides. Before the fiscal write, so a refused substitution writes no fiscal record.
  for (const substitutedSaleId of input.substitutedSaleIds) {
    try {
      await tx.insert(saleSubstitutions).values({
        substitutionSaleId: saleId,
        substitutedSaleId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("sale.already_substituted", { saleId: substitutedSaleId });
      }
      throw error;
    }
  }

  const [location] = await tx
    .select({ operationDescription: locations.operationDescription })
    .from(tills)
    .innerJoin(locations, eq(locations.id, tills.locationId))
    .where(eq(tills.id, input.tillId));

  /* v8 ignore start */
  if (location === undefined) {
    // `tills.location_id` is a not-null foreign key, so this means the till does not exist.
    throw new Error(`recordSubstitution: no location found for till ${input.tillId}`);
  }
  /* v8 ignore stop */

  const fiscal = await backend.recordSubstitution(
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
      counterparty: input.counterparty,
    },
    { substitutedSaleIds: input.substitutedSaleIds },
  );

  return { saleId, fiscal };
}
