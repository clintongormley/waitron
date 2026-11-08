import "./errors.js";
import { AppError, isAppError, readSoftwareProducer } from "@waitron/shared";
import { buildAltaRecord, validate, type SiNo } from "@waitron/verifactu";
import { WAITRON_ID_SISTEMA } from "./software.js";

export const PRODUCER_PENDING: unique symbol = Symbol("producer pending");

export interface SoftwareProducer {
  readonly name: string;
  readonly nif: string;
}

export interface InvalidProducer {
  readonly invalid: AppError;
}

export type RunningProducer = SoftwareProducer | typeof PRODUCER_PENDING | InvalidProducer;

export interface SoftwareProduct {
  readonly name: string;
  readonly code: string;
  readonly onlyVerifactu: SiNo;
  readonly multipleTaxpayersPossible: SiNo;
  readonly multipleTaxpayersNow: SiNo;
}

export interface SoftwareIdentity extends SoftwareProduct {
  readonly producer: RunningProducer;
}

export const SOFTWARE_IDENTITY: SoftwareProduct = Object.freeze({
  name: "Waitron",
  // Not what a record files: `IdSistemaInformatico` comes from the node's `registro_sif` row
  // (`currentSif`).
  code: WAITRON_ID_SISTEMA,
  onlyVerifactu: "S",
  multipleTaxpayersPossible: "N",
  multipleTaxpayersNow: "N",
});

declare const __WAITRON_HOUR_RELEASE__: unknown;

// Read the global directly, never through readHourRelease(): many test files mock that reader to
// hand the clock code a stamp, and a mocked stamp must not make a test run count as published.
function stampedCommit(): string | null {
  const value = typeof __WAITRON_HOUR_RELEASE__ === "undefined" ? null : __WAITRON_HOUR_RELEASE__;
  if (value === null || typeof value !== "object") return null;
  const commit = (value as { sourceCommit?: unknown }).sourceCommit;
  return typeof commit === "string" && /^[a-f0-9]{40}$/.test(commit) ? commit : null;
}

export const BUILD_COMMIT: string | null = stampedCommit();

export function softwareVersion(commit: string | null = BUILD_COMMIT): string {
  return commit === null ? "0.0.0-dev" : `0.0.0-dev+${commit}`;
}

const PRODUCER_SETTING = {
  "SistemaInformatico.NombreRazon": "WAITRON_PRODUCER_NAME",
  "SistemaInformatico.NIF": "WAITRON_PRODUCER_TAX_ID",
} as const;

const PRODUCER_REASON: Record<string, "too_long" | "wrong_length" | "check_failed"> = {
  XSD_TEXT_LENGTH: "too_long",
  NIF_LENGTH: "wrong_length",
  NIF_CONTROL: "check_failed",
};

/**
 * The producer named by the process's settings, read on each call: `PRODUCER_PENDING` when none is
 * set, or the refusal to throw when a value fails the shared shape check or Veri*Factu's own.
 */
export function runningProducer(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RunningProducer {
  let read;
  try {
    read = readSoftwareProducer(env);
  } catch (error) {
    if (isAppError(error)) return { invalid: error };
    throw error;
  }
  if (read === null) return PRODUCER_PENDING;
  const producer = { name: read.name, nif: read.taxId };
  const issue = veriFactuIssue(producer);
  return issue === null ? producer : { invalid: issue };
}

// The library does not export its NIF check, so a record carrying the producer is validated and
// only the producer's two fields are read from its answer.
function veriFactuIssue(producer: SoftwareProducer): AppError | null {
  const at = new Date("2026-01-01T12:00:00.000Z");
  const record = buildAltaRecord({
    IDEmisorFactura: producer.nif,
    NumSerieFactura: "A/1",
    FechaExpedicionFactura: at,
    NombreRazonEmisor: producer.name,
    TipoFactura: "F2",
    DescripcionOperacion: "Producer check",
    Desglose: [
      {
        BaseImponibleOimporteNoSujeto: "100.00",
        CuotaRepercutida: "21.00",
        TipoImpositivo: "21.00",
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
      },
    ],
    CuotaTotal: "21.00",
    ImporteTotal: "121.00",
    SistemaInformatico: {
      NombreRazon: producer.name,
      NIF: producer.nif,
      NombreSistemaInformatico: SOFTWARE_IDENTITY.name,
      IdSistemaInformatico: SOFTWARE_IDENTITY.code,
      Version: softwareVersion(),
      NumeroInstalacion: "1",
      TipoUsoPosibleSoloVerifactu: SOFTWARE_IDENTITY.onlyVerifactu,
      TipoUsoPosibleMultiOT: SOFTWARE_IDENTITY.multipleTaxpayersPossible,
      IndicadorMultiplesOT: SOFTWARE_IDENTITY.multipleTaxpayersNow,
    },
    Encadenamiento: { PrimerRegistro: "S" },
    generadoEn: at,
    offsetMinutes: 0,
  });
  for (const issue of validate(record, { now: at })) {
    if (!(issue.field in PRODUCER_SETTING)) continue;
    return new AppError("sif.producer_invalid", {
      setting: PRODUCER_SETTING[issue.field as keyof typeof PRODUCER_SETTING],
      reason: PRODUCER_REASON[issue.code] ?? "rejected",
    });
  }
  return null;
}

function isInvalid(producer: RunningProducer): producer is InvalidProducer {
  return typeof producer === "object" && "invalid" in producer;
}

// While unset, the taxpayer is named: AEAT's test service, whose acceptance the first production
// activation requires, could reject placeholder text.
export function producerFields(
  identity: SoftwareIdentity,
  taxpayer: { legalName: string; nif: string },
): { NombreRazon: string; NIF: string } {
  const producer = identity.producer;
  if (producer === PRODUCER_PENDING) return { NombreRazon: taxpayer.legalName, NIF: taxpayer.nif };
  if (isInvalid(producer)) throw producer.invalid;
  return { NombreRazon: producer.name, NIF: producer.nif };
}

export function refuseProducerSettings(environment: string, identity: SoftwareIdentity): void {
  if (isInvalid(identity.producer)) throw identity.producer.invalid;
  if (environment === "production" && identity.producer === PRODUCER_PENDING)
    throw new AppError("sif.producer_unset", { environment });
}
