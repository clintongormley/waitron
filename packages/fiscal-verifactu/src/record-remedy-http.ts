import "./errors.js";
import { sql } from "drizzle-orm";
import { readHistoryNodes, readTenant, type Transaction } from "@waitron/db";
import { prepareIssueClock } from "@waitron/fiscal";
import type { ModuleRouteContext } from "@waitron/module";
import { canonicalJson } from "@waitron/recovery-pack";
import { AppError, compareDecimal, decimal, readSaleOrigin, saleId } from "@waitron/shared";
import type { AltaInput, RegistroAlta } from "@waitron/verifactu";
import { applyRecordCorrection, caseIdForRecord, type RemedyPolicy } from "./record-remedy.js";
import { readCorrectedRecordFacts, type CorrectedRecordFacts } from "./record-remedy-facts.js";
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

const BREAKDOWN_AMOUNTS = [
  "TipoImpositivo",
  "BaseImponibleOimporteNoSujeto",
  "BaseImponibleACoste",
  "CuotaRepercutida",
  "TipoRecargoEquivalencia",
  "CuotaRecargoEquivalencia",
] as const;

// An absent `Impuesto` is IVA ("01"), as `@waitron/verifactu`'s validate reads it.
const BREAKDOWN_CLASS = [
  ["Impuesto", "taxType", "01"],
  ["ClaveRegimen", "regime", undefined],
  ["CalificacionOperacion", "operationClass", undefined],
  ["OperacionExenta", "exemption", undefined],
] as const;

const CORRECTION_AMOUNTS = [
  "BaseRectificada",
  "CuotaRectificada",
  "CuotaRecargoRectificado",
] as const;

function sameAmount(left: string | undefined, right: string | undefined) {
  return compareDecimal(decimal(left ?? "0"), decimal(right ?? "0")) === 0;
}

function refuseChangedAmountsOrClass(
  registroId: string,
  facts: CorrectedRecordFacts,
  original: Pick<AltaInput, "Desglose" | "CuotaTotal" | "ImporteTotal" | "ImporteRectificacion">,
) {
  const refuse = (field: "breakdown" | "taxTotal" | "total" | "correctionAmounts"): never => {
    throw new AppError("fiscal.remedy_amount_changed", { registroId, field });
  };
  if (facts.total !== undefined && !sameAmount(facts.total, original.ImporteTotal)) refuse("total");
  if (facts.taxTotal !== undefined && !sameAmount(facts.taxTotal, original.CuotaTotal))
    refuse("taxTotal");
  if (
    facts.correctionAmounts !== undefined &&
    CORRECTION_AMOUNTS.some(
      (key) => !sameAmount(facts.correctionAmounts?.[key], original.ImporteRectificacion?.[key]),
    )
  )
    refuse("correctionAmounts");
  const lines = facts.breakdown;
  if (lines === undefined) return;
  if (
    lines.length !== original.Desglose.length ||
    lines.some((line, index) => {
      const filed = original.Desglose[index]!;
      return BREAKDOWN_AMOUNTS.some((key) => !sameAmount(line[key], filed[key]));
    })
  )
    refuse("breakdown");
  lines.forEach((line, index) => {
    const filed = original.Desglose[index]!;
    for (const [key, field, absent] of BREAKDOWN_CLASS) {
      if ((line[key] ?? absent) !== (filed[key] ?? absent))
        throw new AppError("fiscal.remedy_class_changed", { registroId, field, line: index });
    }
  });
}

/** A request's `YYYY-MM-DD` reference dates in the stored `DD-MM-YYYY` form. */
function storedReferences(values: CorrectedRecordFacts["correctedInvoices"]) {
  if (values == null) return values;
  return values.map((value) => {
    const [y, m, d] = value.FechaExpedicionFactura.split("-");
    return { ...value, FechaExpedicionFactura: `${d}-${m}-${y}` };
  });
}

function refuseChangedPrintedFacts(
  registroId: string,
  facts: CorrectedRecordFacts,
  original: RegistroAlta,
) {
  if (facts.issuerName !== undefined && facts.issuerName !== original.NombreRazonEmisor)
    throw new AppError("fiscal.remedy_issuer_changed", { registroId });
  const printed = [
    ["invoiceType", facts.invoiceType, original.TipoFactura],
    ["recipients", facts.recipients, original.Destinatarios?.IDDestinatario],
    ["correctionType", facts.correctionType, original.TipoRectificativa],
    [
      "correctedInvoices",
      storedReferences(facts.correctedInvoices),
      original.FacturasRectificadas?.IDFacturaRectificada,
    ],
    [
      "substitutedInvoices",
      storedReferences(facts.substitutedInvoices),
      original.FacturasSustituidas?.IDFacturaSustituida,
    ],
  ] as const;
  for (const [field, sent, filed] of printed) {
    if (sent !== undefined && canonicalJson(sent) !== canonicalJson(filed ?? null))
      throw new AppError("fiscal.remedy_printed_fact_changed", { registroId, field });
  }
}

export async function applyCorrectedRecordFacts(
  tx: Transaction,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: RemedyPolicy,
  raw: unknown,
) {
  const body = object(raw);
  only(body, ["kind", "caseId", "registroId", "actionKey", "reason", "facts", "priorOutcome"]);
  const priorOutcome = body.priorOutcome === undefined ? "rejected" : body.priorOutcome;
  if (priorOutcome !== "rejected" && priorOutcome !== "accepted-with-errors") invalid();
  const facts = readCorrectedRecordFacts(body.facts);
  const registroId = text(body.registroId);
  const caseId =
    body.caseId === undefined ? await caseIdForRecord(tx, registroId) : text(body.caseId);
  const actionKey = text(body.actionKey);
  const reason = text(body.reason);
  generation.requireWritable();
  const {
    rows: [rawTarget],
  } = await tx.execute(sql`select * from registros_facturacion where id = ${registroId}`);
  if (rawTarget === undefined) throw new AppError("fiscal.remedy_invalid", { registroId });
  const target = decodeRegistroRow(rawTarget);
  const source = await generation.returnSource?.(tx);
  const history = [
    ...new Set([...(await readHistoryNodes(tx, generation.nodeId)), ...(source ? [source] : [])]),
  ];
  if (
    !history.some((id) => id === target.node_id) ||
    target.entorno !== generation.environment ||
    target.tipo_registro !== "alta"
  )
    throw new AppError("fiscal.remedy_invalid", { registroId });
  const original = fromRegistroRow(target);
  if (!("TipoFactura" in original)) throw new AppError("fiscal.remedy_invalid", { registroId });
  refuseChangedAmountsOrClass(registroId, facts, original);
  refuseChangedPrintedFacts(registroId, facts, original);
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
  // The correction type and references are refused unless they match the record, so they come from it.
  const correctionType = original.TipoRectificativa;
  const correctedInvoices = original.FacturasRectificadas?.IDFacturaRectificada.map(identity);
  const substitutedInvoices = original.FacturasSustituidas?.IDFacturaSustituida.map(identity);
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
