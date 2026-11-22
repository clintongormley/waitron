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
import { queueSubmission } from "./queue-submission.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { filingCaseEvents, filingCases } from "./schema/filing-cases.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { verifyChain } from "./verify.js";
import type { CorrectedRecordFacts } from "./record-remedy-facts.js";

export const REMEDY_KINDS = [
  "record-correction",
  "corrective-invoice",
  "replacement-invoice",
  "absent-original-cancellation",
  "release-brake",
  "release-held-cancellation",
] as const;
export type RemedyKind = (typeof REMEDY_KINDS)[number];
/** A reach `record-correction` does not carry by itself: correcting a case AEAT accepted with errors. */
export const ACCEPTED_WITH_ERRORS_CORRECTION = "accepted-with-errors-correction";
/** A reach `replacement-invoice` does not carry by itself: replacing a full invoice (F1) with an R4. */
export const FULL_INVOICE_REPLACEMENT = "full-invoice-replacement";
/** Server policy: the remedy kinds it enables, and the reaches beyond them it allows. */
export type RemedyPolicy = ReadonlySet<
  RemedyKind | typeof ACCEPTED_WITH_ERRORS_CORRECTION | typeof FULL_INVOICE_REPLACEMENT
>;

export async function admitRecordRemedy(
  tx: Transaction,
  managementSessionId: string,
  kind: RemedyKind,
  enabledRemedies: RemedyPolicy,
): Promise<string> {
  const { authorizedBy } = await authorizeManager(tx, {
    managementSessionId,
    permission: FISCAL_REMEDY,
  });
  if (!enabledRemedies.has(kind)) throw new AppError("fiscal.remedy_disabled", { kind });
  return authorizedBy;
}

/** True when a record on `recordNodeId` is this box's own, or one of a box in its takeover history. */
export async function isInHistory(
  tx: Transaction,
  nodeId: NodeId,
  recordNodeId: string,
): Promise<boolean> {
  return (await readHistoryNodes(tx, nodeId)).some((id) => id === recordNodeId);
}

/** A record has at most one case (`filing_cases_registro_uq`), so its id names the case. */
export async function caseIdForRecord(tx: Transaction, registroId: string): Promise<string> {
  const [filingCase] = await tx
    .select({ id: filingCases.id })
    .from(filingCases)
    .where(eq(filingCases.registroId, registroId));
  if (filingCase === undefined) throw new AppError("fiscal.remedy_invalid", { registroId });
  return filingCase.id;
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
    enabledRemedies: RemedyPolicy;
    request: RecordCorrectionRequest;
    correctionDecision?: CorrectedRecordFacts & {
      priorOutcome: "rejected" | "accepted-with-errors";
    };
    now: Date;
    /** `readHistoryNodes` of `nodeId`, when the caller has already read it in this transaction. */
    history?: readonly NodeId[];
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
  const [delivery] = await tx
    .select()
    .from(verifactuSubmissions)
    .where(eq(verifactuSubmissions.registroId, request.registroId));
  // Checked before a replay too, as the kind's own enablement is.
  const answersAcceptance =
    input.correctionDecision === undefined
      ? delivery?.estado === "aceptado_con_errores"
      : input.correctionDecision.priorOutcome === "accepted-with-errors";
  if (answersAcceptance && !input.enabledRemedies.has(ACCEPTED_WITH_ERRORS_CORRECTION))
    throw new AppError("fiscal.remedy_disabled", {
      kind: "record-correction",
      priorOutcome: "accepted-with-errors",
    });
  const [target] = await tx
    .select()
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, request.registroId));
  const history = input.history ?? (await readHistoryNodes(tx, input.nodeId));
  if (
    target === undefined ||
    !history.some((id) => id === target.nodeId) ||
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
  const [cancellation] = await tx
    .select({
      sinRegistroPrevio: verifactuRecords.sinRegistroPrevio,
      estado: verifactuSubmissions.estado,
    })
    .from(verifactuRecords)
    .leftJoin(verifactuSubmissions, eq(verifactuSubmissions.registroId, verifactuRecords.id))
    .where(
      and(
        eq(verifactuRecords.tipoRegistro, "anulacion"),
        eq(verifactuRecords.idEmisorFactura, target.idEmisorFactura),
        eq(verifactuRecords.numSerieFactura, target.numSerieFactura),
        eq(verifactuRecords.fechaExpedicionFactura, target.fechaExpedicionFactura),
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
  const appended = await appendToChain(tx, input.nodeId, request.pending, { history });
  await queueSubmission(tx, { registroId: appended.id, proximoIntentoEn: input.now });
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
