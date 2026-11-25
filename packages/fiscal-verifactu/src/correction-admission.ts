import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { CorrectionAdmission } from "@waitron/fiscal";
import type { NodeId, SaleId } from "@waitron/shared";
import type { FilingCaseCause, FilingCaseEvidence } from "./filing-cases.js";
import { putRightFor } from "./put-right.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { verifactuRecords } from "./schema/verifactu-records.js";

type Filing = Extract<CorrectionAdmission, { eligible: true }>["filing"];

const FILING: Record<string, Filing | undefined> = {
  pendiente: "queued",
  enviando: "sending",
  aceptado: "accepted",
  aceptado_con_errores: "accepted_with_issues",
};

/**
 * Judges the sale's newest alta version, the one a correction is filed against
 * (`VerifactuBackend.recordCorrection`), and that version's submission: an F2, or an R5 by
 * replacement, or a full invoice (an F1, or an R4 by replacement), whose every answer says
 * `fullInvoice`. Any other submission state, including one this code does not know, refuses.
 * A full invoice AEAT refused waits (`filing_refused`) only while its open case has a fix the
 * Fiscal filing page offers (`putRightFor`); otherwise it is `refused_no_fix`. `issuingNodeId` is
 * the box that would issue the correction.
 */
export async function correctionAdmissionFor(
  tx: Transaction,
  saleId: SaleId,
  issuingNodeId: NodeId,
): Promise<CorrectionAdmission> {
  const rows = await tx
    .select({
      id: verifactuRecords.id,
      tipoRegistro: verifactuRecords.tipoRegistro,
      tipoFactura: verifactuRecords.tipoFactura,
      tipoRectificativa: verifactuRecords.tipoRectificativa,
      nodeId: verifactuRecords.nodeId,
      correctsRegistroId: verifactuRecords.correctsRegistroId,
      numSerieFactura: verifactuRecords.numSerieFactura,
      fechaExpedicionFactura: verifactuRecords.fechaExpedicionFactura,
      estado: verifactuSubmissions.estado,
      codigoError: verifactuSubmissions.codigoError,
      mensajeError: verifactuSubmissions.mensajeError,
      caseCause: verifactuSubmissions.caseCause,
      caseEvidence: verifactuSubmissions.caseEvidence,
      caseResolvedAt: verifactuSubmissions.caseResolvedAt,
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
  if (alta.nodeId !== issuingNodeId) return { eligible: false, reason: "wrong_node", ...marked };
  if (!full && alta.tipoFactura !== "F2" && !(alta.tipoFactura === "R5" && byReplacement)) {
    return { eligible: false, reason: "not_simplified" };
  }
  const { estado } = alta;
  if (estado === null) return { eligible: false, reason: "missing", ...marked };
  const filing = FILING[estado];
  if (filing === undefined) {
    const lasting = full && estado === "rechazado" && !fixOffered({ ...alta, estado });
    return { eligible: false, reason: lasting ? "refused_no_fix" : "filing_refused", ...marked };
  }
  return {
    eligible: true,
    filing,
    original: { number: alta.numSerieFactura, issuedAt: alta.fechaExpedicionFactura },
    ...marked,
  };
}

interface RefusedAlta {
  tipoRegistro: string;
  tipoFactura: string | null;
  estado: string;
  codigoError: string | null;
  mensajeError: string | null;
  caseCause: FilingCaseCause | null;
  caseEvidence: FilingCaseEvidence | null;
  caseResolvedAt: Date | null;
}

/** Whether the Fiscal filing page offers a fix for the refused filing's open case. */
function fixOffered(alta: RefusedAlta): boolean {
  // The case CHECK opens a case with its cause and evidence together.
  if (alta.caseCause === null || alta.caseEvidence === null || alta.caseResolvedAt !== null)
    return false;
  const fix = putRightFor({
    cause: alta.caseCause,
    evidence: alta.caseEvidence,
    record: alta,
    submission: alta,
  });
  return fix.kind !== "none";
}
