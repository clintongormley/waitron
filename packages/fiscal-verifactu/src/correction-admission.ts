import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { CorrectionAdmission } from "@waitron/fiscal";
import type { NodeId, SaleId } from "@waitron/shared";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";

type Filing = Extract<CorrectionAdmission, { eligible: true }>["filing"];

const FILING: Record<string, Filing | undefined> = {
  pendiente: "queued",
  enviando: "sending",
  aceptado: "accepted",
  aceptado_con_errores: "accepted_with_issues",
};

/**
 * Judges the sale's newest alta version, the one a correction is filed against
 * (`VerifactuBackend.recordCorrection`), and that version's submission. Any other submission
 * state, including one this code does not know, refuses. `issuingNodeId` is the box that would
 * issue the correction.
 */
export async function correctionAdmissionFor(
  tx: Transaction,
  saleId: SaleId,
  issuingNodeId: NodeId,
): Promise<CorrectionAdmission> {
  const rows = await tx
    .select({
      id: registrosFacturacion.id,
      tipoRegistro: registrosFacturacion.tipoRegistro,
      tipoFactura: registrosFacturacion.tipoFactura,
      nodeId: registrosFacturacion.nodeId,
      correctsRegistroId: registrosFacturacion.correctsRegistroId,
      numSerieFactura: registrosFacturacion.numSerieFactura,
      fechaExpedicionFactura: registrosFacturacion.fechaExpedicionFactura,
      estado: envios.estado,
    })
    .from(registrosFacturacion)
    .leftJoin(envios, eq(envios.registroId, registrosFacturacion.id))
    .where(eq(registrosFacturacion.saleId, saleId));

  if (rows.some((row) => row.tipoRegistro === "anulacion")) {
    return { eligible: false, reason: "voided" };
  }
  if (rows.length === 0) return { eligible: false, reason: "missing" };
  // Each fix names a distinct earlier alta of the same sale (`registros_corrects_registro_uq`,
  // `appendToChain`), so each line of fixes ends in one unfixed version: one means one line.
  const fixed = new Set(rows.map((row) => row.correctsRegistroId));
  const latest = rows.filter((row) => !fixed.has(row.id));
  if (latest.length !== 1) return { eligible: false, reason: "filing_versions_unusable" };
  const alta = latest[0]!;
  if (alta.nodeId !== issuingNodeId) return { eligible: false, reason: "wrong_node" };
  if (alta.tipoFactura !== "F2") return { eligible: false, reason: "not_simplified" };
  if (alta.estado === null) return { eligible: false, reason: "missing" };
  const filing = FILING[alta.estado];
  if (filing === undefined) return { eligible: false, reason: "filing_refused" };
  return {
    eligible: true,
    filing,
    original: { number: alta.numSerieFactura, issuedAt: alta.fechaExpedicionFactura },
  };
}
