import "./errors.js";
import { and, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { ModuleRouteContext } from "@waitron/module";
import { canonicalJson } from "@waitron/recovery-pack";
import { AppError } from "@waitron/shared";
import { deleteAck } from "./acks.js";
import { recordCaseEvent } from "./filing-cases.js";
import { admitRecordRemedy, isInHistory, type RemedyKind } from "./record-remedy.js";
import { envios } from "./schema/envios.js";
import { filingCaseEvents, filingCases } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";

export async function releaseHeldCancellation(
  tx: Transaction,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: ReadonlySet<RemedyKind>,
  raw: Record<string, unknown>,
): Promise<{ registroId: string; eventId: string }> {
  const personId = await admitRecordRemedy(tx, token, "release-held-cancellation", enabledRemedies);
  const keys = ["kind", "caseId", "registroId", "acceptedRegistroId", "actionKey", "reason"];
  if (
    Object.keys(raw).some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof raw[key] !== "string" || (raw[key] as string).trim() === "")
  )
    throw new AppError("fiscal.remedy_request_invalid", {});
  const { caseId, registroId, acceptedRegistroId, actionKey } = raw as {
    caseId: string;
    registroId: string;
    acceptedRegistroId: string;
    actionKey: string;
  };
  generation.requireWritable();
  const [target] = await tx
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, registroId));
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
  const [stored] = await tx
    .select()
    .from(filingCaseEvents)
    .where(eq(filingCaseEvents.actionKey, actionKey));
  if (stored !== undefined) {
    if (
      stored.caseId !== caseId ||
      stored.personId !== personId ||
      stored.kind !== "resolved" ||
      stored.action !== action ||
      stored.remedyRegistroId !== null
    ) {
      throw new AppError("filing_case.action_mismatch", { caseId, actionKey });
    }
    return { registroId, eventId: stored.id };
  }
  const [filingCase] = await tx.select().from(filingCases).where(eq(filingCases.id, caseId));
  const [delivery] = await tx.select().from(envios).where(eq(envios.registroId, registroId));
  const [accepted] = await tx
    .select({ record: registrosFacturacion, delivery: envios })
    .from(registrosFacturacion)
    .innerJoin(envios, eq(envios.registroId, registrosFacturacion.id))
    .where(eq(registrosFacturacion.id, acceptedRegistroId));
  const [successor] = await tx
    .select({ id: registrosFacturacion.id })
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.correctsRegistroId, acceptedRegistroId));
  if (
    filingCase?.registroId !== registroId ||
    filingCase.cause !== "fiscal.anulacion_retenida" ||
    delivery?.estado !== "retenido" ||
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
    .update(envios)
    .set({ estado: "pendiente", proximoIntentoEn: now })
    .where(and(eq(envios.registroId, registroId), eq(envios.estado, "retenido")));
  await deleteAck(tx, registroId);
  const event = await recordCaseEvent(tx, {
    caseId,
    actionKey,
    kind: "resolved",
    personId,
    action,
    now,
  });
  return { registroId, eventId: event.id };
}
