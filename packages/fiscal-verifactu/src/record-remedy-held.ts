import "./errors.js";
import { and, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { ModuleRouteContext } from "@waitron/module";
import { canonicalJson } from "@waitron/recovery-pack";
import { AppError } from "@waitron/shared";
import { deleteAck } from "./acks.js";
import { caseEventByActionKey, findFilingCase, recordCaseEvent } from "./filing-cases.js";
import { admitRecordRemedy, isInHistory, type RemedyPolicy } from "./record-remedy.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { verifactuRecords } from "./schema/verifactu-records.js";

export async function releaseHeldCancellation(
  tx: Transaction,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: RemedyPolicy,
  raw: Record<string, unknown>,
): Promise<{ registroId: string; actionKey: string }> {
  const personId = await admitRecordRemedy(tx, token, "release-held-cancellation", enabledRemedies);
  const keys = [
    "kind",
    "caseRegistroId",
    "registroId",
    "acceptedRegistroId",
    "actionKey",
    "reason",
  ];
  if (
    Object.keys(raw).some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof raw[key] !== "string" || (raw[key] as string).trim() === "")
  )
    throw new AppError("fiscal.remedy_request_invalid", {});
  const { caseRegistroId, registroId, acceptedRegistroId, actionKey } = raw as {
    caseRegistroId: string;
    registroId: string;
    acceptedRegistroId: string;
    actionKey: string;
  };
  generation.requireWritable();
  const [target] = await tx
    .select()
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, registroId));
  if (
    target === undefined ||
    !(await isInHistory(tx, generation.nodeId, target.nodeId)) ||
    target.entorno !== generation.environment ||
    target.tipoRegistro !== "anulacion" ||
    target.sinRegistroPrevio === "S"
  ) {
    throw new AppError("fiscal.remedy_invalid", { registroId });
  }
  const action = canonicalJson(raw);
  const stored = await caseEventByActionKey(tx, actionKey);
  if (stored !== undefined) {
    if (
      stored.registroId !== caseRegistroId ||
      stored.personId !== personId ||
      stored.kind !== "resolved" ||
      stored.action !== action ||
      stored.remedyRegistroId !== null
    ) {
      throw new AppError("filing_case.action_mismatch", { caseRegistroId, actionKey });
    }
    return { registroId, actionKey: stored.actionKey };
  }
  const filingCase = await findFilingCase(tx, caseRegistroId);
  const [accepted] = await tx
    .select({ record: verifactuRecords, delivery: verifactuSubmissions })
    .from(verifactuRecords)
    .innerJoin(verifactuSubmissions, eq(verifactuSubmissions.registroId, verifactuRecords.id))
    .where(eq(verifactuRecords.id, acceptedRegistroId));
  const [successor] = await tx
    .select({ id: verifactuRecords.id })
    .from(verifactuRecords)
    .where(eq(verifactuRecords.correctsRegistroId, acceptedRegistroId));
  if (
    filingCase?.registroId !== registroId ||
    filingCase.cause !== "fiscal.anulacion_retenida" ||
    filingCase.estado !== "retenido" ||
    accepted === undefined ||
    accepted.delivery.estado !== "aceptado" ||
    accepted.record.tipoRegistro !== "alta" ||
    accepted.record.entorno !== target.entorno ||
    accepted.record.saleId !== target.saleId ||
    accepted.record.idEmisorFactura !== target.idEmisorFactura ||
    accepted.record.numSerieFactura !== target.numSerieFactura ||
    accepted.record.fechaExpedicionFactura !== target.fechaExpedicionFactura ||
    successor !== undefined
  ) {
    throw new AppError("fiscal.remedy_invalid", { registroId });
  }
  const now = generation.clock.now().instant;
  await tx
    .update(verifactuSubmissions)
    .set({ estado: "pendiente", proximoIntentoEn: now })
    .where(
      and(
        eq(verifactuSubmissions.registroId, registroId),
        eq(verifactuSubmissions.estado, "retenido"),
      ),
    );
  await deleteAck(tx, registroId);
  const event = await recordCaseEvent(tx, {
    caseRegistroId,
    actionKey,
    kind: "resolved",
    personId,
    action,
    now,
  });
  return { registroId, actionKey: event.actionKey };
}
