// Browser-safe: the Fiscal filing screen will reach this file, so it imports types only.
import type { FilingCaseView } from "./filing-overview-types.js";

export type PutRight =
  { kind: "record-correction" } | { kind: "none"; why: "full-invoice" | "not-yet" };

const NOT_YET: PutRight = { kind: "none", why: "not-yet" };

/**
 * Which fix the Fiscal filing page offers for a case. The first check repeats the case and delivery
 * checks the server makes before a remedy (`record-remedy.ts`, `record-remedy-corrective.ts`); the
 * server still makes its own.
 */
export function putRightFor(view: FilingCaseView): PutRight {
  const code = view.evidence.codigo;
  if (
    view.cause !== "fiscal.registro_rechazado" ||
    view.submission?.estado !== "rechazado" ||
    code === null ||
    String(code) !== view.submission.codigoError ||
    view.record.tipoRegistro !== "alta"
  )
    return NOT_YET;
  if (code === 1112)
    return view.record.tipoFactura === "F1" || view.record.tipoFactura === "F3"
      ? { kind: "none", why: "full-invoice" }
      : NOT_YET;
  if (code === 1100) {
    // A description fix is refused again when AEAT objected to some other field.
    const message = view.submission.mensajeError ?? view.evidence.mensaje ?? "";
    if (message.toLowerCase().includes("descripcionoperacion"))
      return { kind: "record-correction" };
  }
  return NOT_YET;
}
