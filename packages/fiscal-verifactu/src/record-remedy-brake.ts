import "./errors.js";
import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { ModuleRouteContext } from "@waitron/module";
import { canonicalJson } from "@waitron/recovery-pack";
import { AppError } from "@waitron/shared";
import { releaseBrakeHold } from "./drain.js";
import { recordCaseEvent } from "./filing-cases.js";
import { admitRecordRemedy, isInHistory, type RemedyKind } from "./record-remedy.js";
import { filingCaseEvents } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";

export async function releaseRecordBrake(
  tx: Transaction,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: ReadonlySet<RemedyKind>,
  raw: Record<string, unknown>,
): Promise<{ registroId: string; eventId: string }> {
  const personId = await admitRecordRemedy(tx, token, "release-brake", enabledRemedies);
  const keys = ["kind", "caseId", "registroId", "actionKey", "reason"];
  if (
    Object.keys(raw).some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof raw[key] !== "string" || (raw[key] as string).trim() === "")
  )
    throw new AppError("fiscal.remedy_request_invalid", {});
  const { caseId, registroId, actionKey } = raw as {
    caseId: string;
    registroId: string;
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
    target.entorno !== generation.environment
  )
    throw new AppError("fiscal.remedy_invalid", { registroId });
  const action = canonicalJson(raw);
  const [stored] = await tx
    .select()
    .from(filingCaseEvents)
    .where(eq(filingCaseEvents.actionKey, actionKey));
  if (stored !== undefined) {
    if (
      stored.caseId !== caseId ||
      stored.personId !== personId ||
      stored.kind !== "note" ||
      stored.action !== action ||
      stored.remedyRegistroId !== null
    )
      throw new AppError("filing_case.action_mismatch", { caseId, actionKey });
    return { registroId, eventId: stored.id };
  }
  const now = generation.clock.now().instant;
  if (!(await releaseBrakeHold(tx, registroId, caseId, generation.environment, now)))
    throw new AppError("fiscal.remedy_invalid", { registroId });
  const event = await recordCaseEvent(tx, {
    caseId,
    actionKey,
    kind: "note",
    personId,
    action,
    now,
  });
  return { registroId, eventId: event.id };
}
