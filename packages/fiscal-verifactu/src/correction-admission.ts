import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { CorrectionAdmission } from "@waitron/fiscal";
import type { SaleId } from "@waitron/shared";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { verifactuRecords } from "./schema/verifactu-records.js";

/**
 * Judges the sale's newest alta version, the one a correction is filed against
 * (`VerifactuBackend.recordCorrection`): an F2, or an R5 by replacement, or a full invoice (an F1,
 * or an R4 by replacement), whose answer says `fullInvoice` unless it is `voided`,
 * `filing_versions_unusable` or about a sale with no records. Whatever AEAT has answered, or not
 * yet answered, on any chain, the version is admitted: a corrective names its original whether
 * AEAT holds it or not. One with no submission is `missing`.
 */
export async function correctionAdmissionFor(
  tx: Transaction,
  saleId: SaleId,
): Promise<CorrectionAdmission> {
  const rows = await tx
    .select({
      id: verifactuRecords.id,
      tipoRegistro: verifactuRecords.tipoRegistro,
      tipoFactura: verifactuRecords.tipoFactura,
      tipoRectificativa: verifactuRecords.tipoRectificativa,
      correctsRegistroId: verifactuRecords.correctsRegistroId,
      numSerieFactura: verifactuRecords.numSerieFactura,
      fechaExpedicionFactura: verifactuRecords.fechaExpedicionFactura,
      estado: verifactuSubmissions.estado,
    })
    .from(verifactuRecords)
    .leftJoin(verifactuSubmissions, eq(verifactuSubmissions.registroId, verifactuRecords.id))
    .where(eq(verifactuRecords.saleId, saleId));

  if (rows.some((row) => row.tipoRegistro === "anulacion")) {
    return { eligible: false, reason: "voided" };
  }
  if (rows.length === 0) return { eligible: false, reason: "missing" };
  // Each fix names a distinct earlier alta of the same sale (`verifactu_records_corrects_registro_uq`,
  // `appendToChain`), so each line of fixes ends in one unfixed version: one means one line.
  const fixed = new Set(rows.map((row) => row.correctsRegistroId));
  const latest = rows.filter((row) => !fixed.has(row.id));
  if (latest.length !== 1) return { eligible: false, reason: "filing_versions_unusable" };
  const alta = latest[0]!;
  // A replacement (an R5 or R4 by replacement) stands in for the invoice it replaced.
  const byReplacement = alta.tipoRectificativa === "S";
  const full = alta.tipoFactura === "F1" || (alta.tipoFactura === "R4" && byReplacement);
  const marked = full ? { fullInvoice: true as const } : {};
  if (!full && alta.tipoFactura !== "F2" && !(alta.tipoFactura === "R5" && byReplacement)) {
    return { eligible: false, reason: "not_simplified" };
  }
  // The drain files only records with a submission (`claimBatch`), so one without never reaches AEAT.
  if (alta.estado === null) return { eligible: false, reason: "missing", ...marked };
  return {
    eligible: true,
    original: { number: alta.numSerieFactura, issuedAt: alta.fechaExpedicionFactura },
    ...marked,
  };
}
