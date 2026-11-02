import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { readTenant, type Transaction } from "@waitron/db";
import { prepareIssueClock } from "@waitron/fiscal";
import type { ModuleRouteContext } from "@waitron/module";
import { canonicalJson } from "@waitron/recovery-pack";
import { AppError, readSaleOrigin, saleId } from "@waitron/shared";
import { appendToChain } from "./chain.js";
import { recordCaseEvent } from "./filing-cases.js";
import { admitRecordRemedy, type RemedyKind } from "./record-remedy.js";
import { currentSif } from "./registro-sif.js";
import { envios } from "./schema/envios.js";
import { filingCaseEvents, filingCases } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";
import { producerFields, SOFTWARE_IDENTITY, softwareVersion } from "./software-identity.js";

export async function applyAbsentOriginalCancellation(
  tx: Transaction,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: ReadonlySet<RemedyKind>,
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
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, registroId));
  if (
    target === undefined ||
    target.nodeId !== generation.nodeId ||
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
  const [delivery] = await tx.select().from(envios).where(eq(envios.registroId, registroId));
  const [replacement] = await tx
    .select({ id: registrosFacturacion.id })
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.correctsRegistroId, registroId));
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
  const [issued] = await tx
    .select({ source: registrosFacturacion.source, deviceId: registrosFacturacion.deviceId })
    .from(registrosFacturacion)
    .where(
      and(
        eq(registrosFacturacion.saleId, target.saleId),
        eq(registrosFacturacion.tipoRegistro, "alta"),
        isNull(registrosFacturacion.correctsRegistroId),
      ),
    );
  if (issued === undefined) throw new AppError("fiscal.remedy_invalid", { registroId });
  const clock = await prepareIssueClock(tx, { nodeId: generation.nodeId }, generation.clock);
  const reading = clock.now();
  const sif = await currentSif(tx, generation.nodeId);
  const tenant = await readTenant(tx);
  if (tenant === null) throw new AppError("fiscal.remedy_invalid", { registroId });
  const appended = await appendToChain(
    tx,
    generation.nodeId,
    {
      tipo: "anulacion",
      saleId: saleId(target.saleId),
      origin: readSaleOrigin(issued.source, issued.deviceId),
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
          ...producerFields(SOFTWARE_IDENTITY, { legalName: tenant.legalName, nif: sif.nif }),
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
    sif,
  );
  await tx.insert(envios).values({ registroId: appended.id, proximoIntentoEn: reading.instant });
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
