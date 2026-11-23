import "./errors.js";
import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { ModuleRouteContext } from "@waitron/module";
import { canonicalJson } from "@waitron/recovery-pack";
import { AppError } from "@waitron/shared";
import { releaseBrakeHold } from "./drain.js";
import { caseEventByActionKey, recordCaseEvent } from "./filing-cases.js";
import { admitRecordRemedy, isInHistory, type RemedyPolicy } from "./record-remedy.js";
import { verifactuRecords } from "./schema/verifactu-records.js";

export async function releaseRecordBrake(
  tx: Transaction,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: RemedyPolicy,
  raw: Record<string, unknown>,
): Promise<{ registroId: string; actionKey: string }> {
  const personId = await admitRecordRemedy(tx, token, "release-brake", enabledRemedies);
  const keys = ["kind", "caseRegistroId", "registroId", "actionKey", "reason"];
  if (
    Object.keys(raw).some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof raw[key] !== "string" || (raw[key] as string).trim() === "")
  )
    throw new AppError("fiscal.remedy_request_invalid", {});
  const { caseRegistroId, registroId, actionKey } = raw as {
    caseRegistroId: string;
    registroId: string;
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
    target.entorno !== generation.environment
  )
    throw new AppError("fiscal.remedy_invalid", { registroId });
  const action = canonicalJson(raw);
  const stored = await caseEventByActionKey(tx, actionKey);
  if (stored !== undefined) {
    if (
      stored.registroId !== caseRegistroId ||
      stored.personId !== personId ||
      stored.kind !== "note" ||
      stored.action !== action ||
      stored.remedyRegistroId !== null
    )
      throw new AppError("filing_case.action_mismatch", { caseRegistroId, actionKey });
    return { registroId, actionKey: stored.actionKey };
  }
  const now = generation.clock.now().instant;
  if (!(await releaseBrakeHold(tx, registroId, caseRegistroId, generation.environment, now)))
    throw new AppError("fiscal.remedy_invalid", { registroId });
  const event = await recordCaseEvent(tx, {
    caseRegistroId,
    actionKey,
    kind: "note",
    personId,
    action,
    now,
  });
  return { registroId, actionKey: event.actionKey };
}
