import "./errors.js";
import { and, eq } from "drizzle-orm";
import { recordCorrection, type RecordCorrectionInput } from "@waitron/core";
import type { Transaction } from "@waitron/db";
import { prepareIssueClock } from "@waitron/fiscal";
import type { ModuleRouteContext } from "@waitron/module";
import { canonicalJson } from "@waitron/recovery-pack";
import { AppError, saleId } from "@waitron/shared";
import type { VerifactuBackend } from "./backend.js";
import { recordCaseEvent } from "./filing-cases.js";
import { admitRecordRemedy, type RemedyKind } from "./record-remedy.js";
import { envios } from "./schema/envios.js";
import { filingCaseEvents, filingCases } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";

export interface CorrectiveInvoiceRequest {
  caseId: string;
  registroId: string;
  actionKey: string;
  reason: string;
  correction: Omit<RecordCorrectionInput, "nodeId" | "correctsSaleId" | "clock" | "authz">;
}

export async function applyCorrectiveInvoice(
  tx: Transaction,
  input: {
    managementSessionId: string;
    generation: NonNullable<ModuleRouteContext["recordGeneration"]>;
    enabledRemedies: ReadonlySet<RemedyKind>;
    backend: VerifactuBackend;
    request: CorrectiveInvoiceRequest;
  },
): Promise<{ saleId: string; registroId: string; eventId: string }> {
  const personId = await admitRecordRemedy(
    tx,
    input.managementSessionId,
    "corrective-invoice",
    input.enabledRemedies,
  );
  const { request, generation } = input;
  if (
    [request.caseId, request.registroId, request.actionKey, request.reason].some(
      (value) => value.trim() === "",
    )
  )
    throw new AppError("fiscal.remedy_request_invalid", {});
  generation.requireWritable();
  const [target] = await tx
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, request.registroId));
  if (
    target === undefined ||
    target.nodeId !== generation.nodeId ||
    target.entorno !== generation.environment ||
    target.tipoRegistro !== "alta"
  )
    throw new AppError("fiscal.remedy_invalid", { registroId: request.registroId });
  const action = canonicalJson(
    JSON.parse(
      JSON.stringify({
        kind: "corrective-invoice",
        ...request,
        correction: {
          ...request.correction,
          wholeInvoice: request.correction.wholeInvoice === true,
        },
      }),
    ) as unknown,
  );
  const [stored] = await tx
    .select()
    .from(filingCaseEvents)
    .where(eq(filingCaseEvents.actionKey, request.actionKey));
  if (stored !== undefined) {
    if (
      stored.caseId !== request.caseId ||
      stored.personId !== personId ||
      stored.kind !== "resolved" ||
      stored.action !== action ||
      stored.remedyRegistroId === null
    )
      throw new AppError("filing_case.action_mismatch", {
        caseId: request.caseId,
        actionKey: request.actionKey,
      });
    const [remedy] = await tx
      .select({ saleId: registrosFacturacion.saleId })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.id, stored.remedyRegistroId));
    if (remedy === undefined)
      throw new AppError("fiscal.remedy_invalid", { registroId: request.registroId });
    return { saleId: remedy.saleId, registroId: stored.remedyRegistroId, eventId: stored.id };
  }
  const [filingCase] = await tx
    .select()
    .from(filingCases)
    .where(eq(filingCases.id, request.caseId));
  const [delivery] = await tx
    .select()
    .from(envios)
    .where(eq(envios.registroId, request.registroId));
  const [replacement] = await tx
    .select({ id: registrosFacturacion.id })
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.correctsRegistroId, request.registroId));
  const [cancellation] = await tx
    .select({ id: registrosFacturacion.id })
    .from(registrosFacturacion)
    .where(
      and(
        eq(registrosFacturacion.tipoRegistro, "anulacion"),
        eq(registrosFacturacion.idEmisorFactura, target.idEmisorFactura),
        eq(registrosFacturacion.numSerieFactura, target.numSerieFactura),
        eq(registrosFacturacion.fechaExpedicionFactura, target.fechaExpedicionFactura),
      ),
    );
  if (
    filingCase?.registroId !== request.registroId ||
    !(
      (filingCase.cause === "fiscal.aceptado_con_errores" &&
        delivery?.estado === "aceptado_con_errores") ||
      (filingCase.cause === "fiscal.registro_rechazado" && delivery?.estado === "rechazado")
    ) ||
    delivery.codigoError === null ||
    delivery.codigoError === "3000" ||
    filingCase.evidence.codigo === null ||
    String(filingCase.evidence.codigo) !== delivery.codigoError ||
    replacement !== undefined ||
    cancellation !== undefined
  )
    throw new AppError("fiscal.remedy_invalid", { registroId: request.registroId });
  const clock = await prepareIssueClock(tx, { nodeId: generation.nodeId }, generation.clock);
  const result = await recordCorrection(tx, input.backend, {
    ...request.correction,
    nodeId: generation.nodeId,
    correctsSaleId: saleId(target.saleId),
    authz: { managementSessionId: input.managementSessionId },
    clock,
  });
  const [appended] = await tx
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, result.fiscal.recordId));
  if (
    appended === undefined ||
    appended.entorno !== generation.environment ||
    appended.nodeId !== generation.nodeId
  )
    throw new AppError("fiscal.remedy_invalid", { registroId: request.registroId });
  const event = await recordCaseEvent(tx, {
    caseId: request.caseId,
    actionKey: request.actionKey,
    kind: "resolved",
    personId,
    action,
    remedyRegistroId: result.fiscal.recordId,
    now: result.fiscal.issuedAt,
  });
  return { saleId: result.saleId, registroId: result.fiscal.recordId, eventId: event.id };
}
