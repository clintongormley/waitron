import "./errors.js";
import { and, eq } from "drizzle-orm";
import { recordIncident } from "@waitron/core";
import { readHistoryNodes, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { canonicalJson } from "@waitron/recovery-pack";
import { AppError, type NodeId } from "@waitron/shared";
import { appendToChain, type PendingRegistro } from "./chain.js";
import { recordCaseEvent } from "./filing-cases.js";
import { FISCAL_REMEDY } from "./permissions.js";
import type { Entorno } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { filingCaseEvents, filingCases } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";
import { verifyChain } from "./verify.js";
import type { CorrectedRecordFacts } from "./record-remedy-facts.js";

export const REMEDY_KINDS = [
  "record-correction",
  "corrective-invoice",
  "absent-original-cancellation",
  "release-brake",
  "release-held-cancellation",
] as const;
export type RemedyKind = (typeof REMEDY_KINDS)[number];

export async function admitRecordRemedy(
  tx: Transaction,
  managementSessionId: string,
  kind: RemedyKind,
  enabledRemedies: ReadonlySet<RemedyKind>,
): Promise<string> {
  const { authorizedBy } = await authorizeManager(tx, {
    managementSessionId,
    permission: FISCAL_REMEDY,
  });
  if (!enabledRemedies.has(kind)) throw new AppError("fiscal.remedy_disabled", { kind });
  return authorizedBy;
}

/** True when a record on `recordNodeId` is this box's own, or one of a box it took over from. */
export async function isInHistory(
  tx: Transaction,
  nodeId: NodeId,
  recordNodeId: string,
): Promise<boolean> {
  return (await readHistoryNodes(tx, nodeId)).some((id) => id === recordNodeId);
}

export interface RecordCorrectionRequest {
  caseId: string;
  registroId: string;
  actionKey: string;
  reason: string;
  pending: Extract<PendingRegistro, { tipo: "alta" }>;
}

export async function applyRecordCorrection(
  tx: Transaction,
  input: {
    managementSessionId: string;
    nodeId: NodeId;
    environment: Entorno;
    enabledRemedies: ReadonlySet<RemedyKind>;
    request: RecordCorrectionRequest;
    correctionDecision?: CorrectedRecordFacts & {
      priorOutcome: "rejected" | "accepted-with-errors";
    };
    now: Date;
  },
): Promise<{ registroId: string; eventId: string }> {
  const personId = await admitRecordRemedy(
    tx,
    input.managementSessionId,
    "record-correction",
    input.enabledRemedies,
  );
  const { request } = input;
  if (request.actionKey.trim() === "" || request.reason.trim() === "") {
    throw new AppError("fiscal.remedy_request_invalid", {});
  }
  const [target] = await tx
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, request.registroId));
  if (
    target === undefined ||
    !(await isInHistory(tx, input.nodeId, target.nodeId)) ||
    target.entorno !== input.environment ||
    request.pending.entorno !== input.environment
  ) {
    throw new AppError("fiscal.remedy_invalid", { registroId: request.registroId });
  }
  // Serialise dates before sorting keys: canonicalJson reads enumerable object keys.
  // HTTP decisions exclude generation facts that the server rebinds on each attempt.
  const action = canonicalJson(
    JSON.parse(
      JSON.stringify(
        input.correctionDecision === undefined
          ? request
          : {
              caseId: request.caseId,
              registroId: request.registroId,
              actionKey: request.actionKey,
              reason: request.reason,
              facts: input.correctionDecision,
            },
      ),
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
    ) {
      throw new AppError("filing_case.action_mismatch", {
        caseId: request.caseId,
        actionKey: request.actionKey,
      });
    }
    return { registroId: stored.remedyRegistroId, eventId: stored.id };
  }
  const [filingCase] = await tx
    .select()
    .from(filingCases)
    .where(eq(filingCases.id, request.caseId));
  if (filingCase === undefined)
    throw new AppError("filing_case.not_found", { caseId: request.caseId });
  const [delivery] = await tx
    .select()
    .from(envios)
    .where(eq(envios.registroId, request.registroId));
  const [cancellation] = await tx
    .select({ sinRegistroPrevio: registrosFacturacion.sinRegistroPrevio, estado: envios.estado })
    .from(registrosFacturacion)
    .leftJoin(envios, eq(envios.registroId, registrosFacturacion.id))
    .where(
      and(
        eq(registrosFacturacion.tipoRegistro, "anulacion"),
        eq(registrosFacturacion.idEmisorFactura, target.idEmisorFactura),
        eq(registrosFacturacion.numSerieFactura, target.numSerieFactura),
        eq(registrosFacturacion.fechaExpedicionFactura, target.fechaExpedicionFactura),
      ),
    );
  if (
    filingCase.registroId !== request.registroId ||
    (filingCase.cause !== "fiscal.registro_rechazado" &&
      filingCase.cause !== "fiscal.aceptado_con_errores") ||
    (delivery?.estado !== "rechazado" && delivery?.estado !== "aceptado_con_errores") ||
    delivery.codigoError === "3000" ||
    (delivery.estado === "rechazado" &&
      (delivery.codigoError === null ||
        filingCase.evidence.codigo === null ||
        String(filingCase.evidence.codigo) !== delivery.codigoError)) ||
    // A waiting cancellation would wait for this correction while blocking it in the queue.
    (cancellation !== undefined &&
      (cancellation.estado !== "retenido" || cancellation.sinRegistroPrevio === "S")) ||
    (input.correctionDecision !== undefined &&
      (input.correctionDecision.priorOutcome === "rejected"
        ? delivery?.estado !== "rechazado" || filingCase.cause !== "fiscal.registro_rechazado"
        : delivery?.estado !== "aceptado_con_errores" ||
          filingCase.cause !== "fiscal.aceptado_con_errores")) ||
    request.pending.correctsRegistroId !== request.registroId
  ) {
    throw new AppError("fiscal.remedy_invalid", { registroId: request.registroId });
  }
  const verification = await verifyChain(tx, input.nodeId);
  if (verification.issues.length > 0) {
    await recordIncident(tx, {
      origin: request.pending.origin,
      saleId: request.pending.saleId,
      severity: "error",
      detectedAt: input.now,
      error: new AppError("chain.verification_failed", {
        deviceId: request.pending.origin.deviceId,
        issues: verification.issues.map((issue) => ({
          issueCode: issue.code,
          recordId: issue.recordId ?? null,
          issueParams: issue.params,
        })),
      }),
    });
  }
  const appended = await appendToChain(tx, input.nodeId, request.pending);
  await tx.insert(envios).values({ registroId: appended.id, proximoIntentoEn: input.now });
  const event = await recordCaseEvent(tx, {
    caseId: request.caseId,
    actionKey: request.actionKey,
    kind: "resolved",
    personId,
    action,
    remedyRegistroId: appended.id,
    now: input.now,
  });
  return { registroId: appended.id, eventId: event.id };
}

export { applyCorrectiveInvoice } from "./record-remedy-corrective.js";
