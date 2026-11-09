import "./errors.js";
import { sql } from "drizzle-orm";
import { readHistoryNodes, readTenant, type Transaction } from "@waitron/db";
import { prepareIssueClock } from "@waitron/fiscal";
import type { ModuleRouteContext } from "@waitron/module";
import { AppError, readSaleOrigin, saleId } from "@waitron/shared";
import type { AltaInput } from "@waitron/verifactu";
import { applyRecordCorrection, type RemedyKind } from "./record-remedy.js";
import { readCorrectedRecordFacts } from "./record-remedy-facts.js";
import { currentSif } from "./registro-sif.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import {
  producerFields,
  runningIdentity,
  SOFTWARE_IDENTITY,
  softwareVersion,
} from "./software-identity.js";

function invalid(): never {
  throw new AppError("fiscal.remedy_request_invalid", {});
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return invalid();
  return value;
}
function only(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
}

export async function applyCorrectedRecordFacts(
  tx: Transaction,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: ReadonlySet<RemedyKind>,
  raw: unknown,
) {
  const body = object(raw);
  only(body, ["kind", "caseId", "registroId", "actionKey", "reason", "facts", "priorOutcome"]);
  const priorOutcome = body.priorOutcome === undefined ? "rejected" : body.priorOutcome;
  if (priorOutcome !== "rejected" && priorOutcome !== "accepted-with-errors") invalid();
  const facts = readCorrectedRecordFacts(body.facts);
  const caseId = text(body.caseId);
  const registroId = text(body.registroId);
  const actionKey = text(body.actionKey);
  const reason = text(body.reason);
  generation.requireWritable();
  const {
    rows: [rawTarget],
  } = await tx.execute(sql`select * from registros_facturacion where id = ${registroId}`);
  if (rawTarget === undefined) throw new AppError("fiscal.remedy_invalid", { registroId });
  const target = decodeRegistroRow(rawTarget);
  const history = await readHistoryNodes(tx, generation.nodeId);
  if (
    !history.some((id) => id === target.node_id) ||
    target.entorno !== generation.environment ||
    target.tipo_registro !== "alta"
  )
    throw new AppError("fiscal.remedy_invalid", { registroId });
  const original = fromRegistroRow(target);
  if (!("TipoFactura" in original)) throw new AppError("fiscal.remedy_invalid", { registroId });
  const clock = await prepareIssueClock(tx, { nodeId: generation.nodeId }, generation.clock);
  const reading = clock.now();
  const sif = await currentSif(tx, generation.nodeId);
  const tenant = await readTenant(tx);
  if (tenant === null) throw new AppError("fiscal.remedy_invalid", { registroId });
  // Dates retain their stored calendar day even when the generation offset changes.
  const day = (value: string) => {
    const [d, m, y] = value.split("-");
    return new Date(Date.parse(`${y}-${m}-${d}T00:00:00Z`) - reading.offsetMinutes * 60_000);
  };
  const identity = (value: {
    IDEmisorFactura: string;
    NumSerieFactura: string;
    FechaExpedicionFactura: string;
  }) => ({ ...value, FechaExpedicionFactura: day(value.FechaExpedicionFactura) });
  const references = (values: NonNullable<typeof facts.correctedInvoices>) =>
    values.map((value) => {
      const [y, m, d] = value.FechaExpedicionFactura.split("-");
      return { ...value, FechaExpedicionFactura: day(`${d}-${m}-${y}`) };
    });
  const correctionType =
    facts.correctionType === undefined
      ? original.TipoRectificativa
      : (facts.correctionType ?? undefined);
  const correctedInvoices =
    facts.correctedInvoices === undefined
      ? original.FacturasRectificadas?.IDFacturaRectificada.map(identity)
      : facts.correctedInvoices === null
        ? undefined
        : references(facts.correctedInvoices);
  const substitutedInvoices =
    facts.substitutedInvoices === undefined
      ? original.FacturasSustituidas?.IDFacturaSustituida.map(identity)
      : facts.substitutedInvoices === null
        ? undefined
        : references(facts.substitutedInvoices);
  const correctionAmounts =
    facts.correctionAmounts === undefined
      ? original.ImporteRectificacion
      : (facts.correctionAmounts ?? undefined);
  const recipients =
    facts.recipients === undefined
      ? original.Destinatarios
      : facts.recipients === null
        ? undefined
        : { IDDestinatario: facts.recipients };
  const input: Omit<AltaInput, "Encadenamiento"> = {
    ...identity(original.IDFactura),
    NombreRazonEmisor: facts.issuerName ?? original.NombreRazonEmisor,
    TipoFactura: facts.invoiceType ?? original.TipoFactura,
    ...(correctionType !== undefined && {
      TipoRectificativa: correctionType,
    }),
    ...(correctedInvoices !== undefined && {
      FacturasRectificadas: correctedInvoices,
    }),
    ...(substitutedInvoices !== undefined && {
      FacturasSustituidas: substitutedInvoices,
    }),
    ...(correctionAmounts !== undefined && {
      ImporteRectificacion: correctionAmounts,
    }),
    ...(recipients !== undefined && { Destinatarios: recipients }),
    DescripcionOperacion: facts.description ?? original.DescripcionOperacion,
    Desglose: facts.breakdown ?? original.Desglose,
    CuotaTotal: facts.taxTotal ?? original.CuotaTotal,
    ImporteTotal: facts.total ?? original.ImporteTotal,
    Subsanacion: "S",
    RechazoPrevio: priorOutcome === "rejected" ? "X" : "N",
    SistemaInformatico: {
      ...producerFields(runningIdentity(generation.environment), {
        legalName: tenant.legalName,
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
  };
  return applyRecordCorrection(tx, {
    managementSessionId: token,
    nodeId: generation.nodeId,
    environment: generation.environment,
    enabledRemedies,
    now: reading.instant,
    history,
    correctionDecision: { ...facts, priorOutcome },
    request: {
      caseId,
      registroId,
      actionKey,
      reason,
      pending: {
        tipo: "alta",
        saleId: saleId(target.sale_id),
        origin: readSaleOrigin(target.source, target.device_id),
        entorno: generation.environment,
        correctsRegistroId: registroId,
        input,
      },
    },
  });
}
