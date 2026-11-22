import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { readTaxpayer, type Transaction } from "@waitron/db";
import { prepareIssueClock } from "@waitron/fiscal";
import type { ModuleRouteContext } from "@waitron/module";
import { canonicalJson } from "@waitron/recovery-pack";
import { AppError, readSaleOrigin, saleId } from "@waitron/shared";
import { appendToChain } from "./chain.js";
import { recordCaseEvent } from "./filing-cases.js";
import { admitRecordRemedy, isInHistory, type RemedyPolicy } from "./record-remedy.js";
import type { RegistroRow } from "./registro-row.js";
import { currentSif } from "./registro-sif.js";
import { queueSubmission } from "./queue-submission.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { filingCaseEvents, filingCases } from "./schema/filing-cases.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import {
  producerFields,
  runningIdentity,
  SOFTWARE_IDENTITY,
  softwareVersion,
} from "./software-identity.js";

export async function applyAbsentOriginalCancellation(
  tx: Transaction,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: RemedyPolicy,
  raw: Record<string, unknown>,
): Promise<{ registroId: string; eventId: string }> {
  const personId = await admitRecordRemedy(
    tx,
    token,
    "absent-original-cancellation",
    enabledRemedies,
  );
  const keys = ["kind", "caseId", "registroId", "actionKey", "reason"];
  if (
    Object.keys(raw).some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof raw[key] !== "string" || (raw[key] as string).trim() === "")
  ) {
    throw new AppError("fiscal.remedy_request_invalid", {});
  }
  const { caseId, registroId, actionKey, reason } = raw as {
    caseId: string;
    registroId: string;
    actionKey: string;
    reason: string;
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
    target.tipoRegistro !== "alta"
  ) {
    throw new AppError("fiscal.remedy_invalid", { registroId });
  }
  const action = canonicalJson({
    kind: "absent-original-cancellation",
    caseId,
    registroId,
    actionKey,
    reason,
  });
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
      stored.remedyRegistroId === null
    ) {
      throw new AppError("filing_case.action_mismatch", { caseId, actionKey });
    }
    return { registroId: stored.remedyRegistroId, eventId: stored.id };
  }
  const [filingCase] = await tx.select().from(filingCases).where(eq(filingCases.id, caseId));
  const [delivery] = await tx.select().from(verifactuSubmissions).where(eq(verifactuSubmissions.registroId, registroId));
  const [replacement] = await tx
    .select({ id: verifactuRecords.id })
    .from(verifactuRecords)
    .where(eq(verifactuRecords.correctsRegistroId, registroId));
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
    filingCase?.registroId !== registroId ||
    filingCase?.cause !== "fiscal.registro_rechazado" ||
    delivery?.estado !== "rechazado" ||
    delivery.codigoError === null ||
    delivery.codigoError === "3000" ||
    filingCase.evidence.codigo === null ||
    String(filingCase.evidence.codigo) !== delivery.codigoError ||
    replacement !== undefined ||
    cancellation !== undefined
  ) {
    throw new AppError("fiscal.remedy_invalid", { registroId });
  }
  const {
    rows: [issued],
  } = await tx.execute<Pick<RegistroRow, "source" | "device_id">>(sql`
    select source, device_id
    from verifactu_records indexed by verifactu_records_sale_idx
    where sale_id = ${target.saleId} and tipo_registro = 'alta'
      and corrects_registro_id is null
  `);
  if (issued === undefined) throw new AppError("fiscal.remedy_invalid", { registroId });
  const clock = await prepareIssueClock(tx, { nodeId: generation.nodeId }, generation.clock);
  const reading = clock.now();
  const sif = await currentSif(tx, generation.nodeId);
  const taxpayer = await readTaxpayer(tx);
  if (taxpayer === null) throw new AppError("fiscal.remedy_invalid", { registroId });
  const appended = await appendToChain(
    tx,
    generation.nodeId,
    {
      tipo: "anulacion",
      saleId: saleId(target.saleId),
      origin: readSaleOrigin(issued.source, issued.device_id),
      entorno: generation.environment,
      nombreRazonEmisor: target.nombreRazonEmisor,
      input: {
        IDEmisorFacturaAnulada: target.idEmisorFactura,
        NumSerieFacturaAnulada: target.numSerieFactura,
        FechaExpedicionFacturaAnulada: new Date(
          Date.parse(`${target.fechaExpedicionFactura}T00:00:00Z`) - reading.offsetMinutes * 60_000,
        ),
        SinRegistroPrevio: "S",
        SistemaInformatico: {
          ...producerFields(runningIdentity(generation.environment), {
            legalName: taxpayer.legalName,
            nif: sif.nif,
          }),
          NombreSistemaInformatico: SOFTWARE_IDENTITY.name,
          IdSistemaInformatico: sif.idSistemaInformatico,
          Version: softwareVersion(),
          NumeroInstalacion: String(sif.numeroInstalacion),
          TipoUsoPosibleSoloVerifactu: SOFTWARE_IDENTITY.onlyVerifactu,
          TipoUsoPosibleMultiOT: SOFTWARE_IDENTITY.multipleTaxpayersPossible,
          IndicadorMultiplesOT: SOFTWARE_IDENTITY.multipleTaxpayersNow,
        },
        generadoEn: reading.instant,
        offsetMinutes: reading.offsetMinutes,
      },
    },
    { sif },
  );
  await queueSubmission(tx, { registroId: appended.id, proximoIntentoEn: reading.instant });
  const event = await recordCaseEvent(tx, {
    caseId,
    actionKey,
    kind: "resolved",
    personId,
    action,
    remedyRegistroId: appended.id,
    now: reading.instant,
  });
  return { registroId: appended.id, eventId: event.id };
}
