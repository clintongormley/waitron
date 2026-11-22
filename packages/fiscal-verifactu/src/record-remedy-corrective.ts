import "./errors.js";
import { and, eq } from "drizzle-orm";
import { correctionTargetFor, recordCorrection, type RecordCorrectionInput } from "@waitron/core";
import type { Transaction } from "@waitron/db";
import { prepareIssueClock, type FiscalRecordRef, type TrustedClock } from "@waitron/fiscal";
import type { ModuleRouteContext } from "@waitron/module";
import { canonicalJson } from "@waitron/recovery-pack";
import { AppError, saleId, type NodeId, type SaleId } from "@waitron/shared";
import type { VerifactuBackend } from "./backend.js";
import { recordCaseEvent } from "./filing-cases.js";
import { admitRecordRemedy, isInHistory, type RemedyPolicy } from "./record-remedy.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { filingCaseEvents, filingCases } from "./schema/filing-cases.js";
import { verifactuRecords } from "./schema/verifactu-records.js";

export interface InvoiceRemedyRequest {
  caseId: string;
  registroId: string;
  actionKey: string;
  reason: string;
}

/** A remedy that issues a new invoice for a case's record; `applyCorrectiveInvoice` makes the checks
 * every such remedy shares, saves the decision and records the case event. */
export interface InvoiceRemedy {
  kind: "corrective-invoice" | "replacement-invoice";
  /** The request's own facts, saved with its case fields as the decision a repeat must match. */
  action: Record<string, unknown>;
  /** This remedy's own checks of the case, its latest delivery and its record. */
  admits?: (facts: {
    filingCase: typeof filingCases.$inferSelect;
    delivery: typeof verifactuSubmissions.$inferSelect;
    target: typeof verifactuRecords.$inferSelect;
  }) => boolean;
  issue: (
    tx: Transaction,
    facts: {
      correctsSaleId: SaleId;
      target: typeof verifactuRecords.$inferSelect;
      clock: TrustedClock;
    },
  ) => Promise<{ saleId: string; fiscal: FiscalRecordRef }>;
}

export function correctiveRemedy(
  correction: Omit<RecordCorrectionInput, "nodeId" | "correctsSaleId" | "clock" | "authz">,
  input: { managementSessionId: string; nodeId: NodeId; backend: VerifactuBackend },
): InvoiceRemedy {
  return {
    kind: "corrective-invoice",
    action: {
      correction: {
        ...correction,
        wholeInvoice: correction.wholeInvoice === true,
      },
    },
    issue: (tx, { correctsSaleId, clock }) =>
      recordCorrection(tx, input.backend, {
        ...correction,
        nodeId: input.nodeId,
        correctsSaleId,
        authz: { managementSessionId: input.managementSessionId },
        clock,
      }),
  };
}

export async function applyCorrectiveInvoice(
  tx: Transaction,
  input: {
    managementSessionId: string;
    generation: NonNullable<ModuleRouteContext["recordGeneration"]>;
    enabledRemedies: RemedyPolicy;
    request: InvoiceRemedyRequest;
    remedy: InvoiceRemedy;
  },
): Promise<{ saleId: string; registroId: string; eventId: string }> {
  const { request, generation, remedy } = input;
  const personId = await admitRecordRemedy(
    tx,
    input.managementSessionId,
    remedy.kind,
    input.enabledRemedies,
  );
  if (
    [request.caseId, request.registroId, request.actionKey, request.reason].some(
      (value) => value.trim() === "",
    )
  )
    throw new AppError("fiscal.remedy_request_invalid", {});
  generation.requireWritable();
  const [target] = await tx
    .select()
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, request.registroId));
  if (
    target === undefined ||
    !(await isInHistory(tx, generation.nodeId, target.nodeId)) ||
    target.entorno !== generation.environment ||
    target.tipoRegistro !== "alta"
  )
    throw new AppError("fiscal.remedy_invalid", { registroId: request.registroId });
  const action = canonicalJson(
    JSON.parse(JSON.stringify({ kind: remedy.kind, ...request, ...remedy.action })) as unknown,
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
    const [remedyRecord] = await tx
      .select({ saleId: verifactuRecords.saleId })
      .from(verifactuRecords)
      .where(eq(verifactuRecords.id, stored.remedyRegistroId));
    if (remedyRecord === undefined)
      throw new AppError("fiscal.remedy_invalid", { registroId: request.registroId });
    return { saleId: remedyRecord.saleId, registroId: stored.remedyRegistroId, eventId: stored.id };
  }
  const [filingCase] = await tx
    .select()
    .from(filingCases)
    .where(eq(filingCases.id, request.caseId));
  const [delivery] = await tx
    .select()
    .from(verifactuSubmissions)
    .where(eq(verifactuSubmissions.registroId, request.registroId));
  const [replacement] = await tx
    .select({ id: verifactuRecords.id })
    .from(verifactuRecords)
    .where(eq(verifactuRecords.correctsRegistroId, request.registroId));
  const [cancellation] = await tx
    .select({ id: verifactuRecords.id })
    .from(verifactuRecords)
    .where(
      and(
        eq(verifactuRecords.tipoRegistro, "anulacion"),
        eq(verifactuRecords.idEmisorFactura, target.idEmisorFactura),
        eq(verifactuRecords.numSerieFactura, target.numSerieFactura),
        eq(verifactuRecords.fechaExpedicionFactura, target.fechaExpedicionFactura),
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
    cancellation !== undefined ||
    (remedy.admits !== undefined && !remedy.admits({ filingCase, delivery, target }))
  )
    throw new AppError("fiscal.remedy_invalid", { registroId: request.registroId });
  const correctsSaleId = saleId(target.saleId);
  if ((await correctionTargetFor(tx, correctsSaleId)) !== correctsSaleId)
    throw new AppError("fiscal.remedy_invalid", { registroId: request.registroId });
  const clock = await prepareIssueClock(tx, { nodeId: generation.nodeId }, generation.clock);
  const result = await remedy.issue(tx, { correctsSaleId, target, clock });
  const [appended] = await tx
    .select()
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, result.fiscal.recordId));
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
