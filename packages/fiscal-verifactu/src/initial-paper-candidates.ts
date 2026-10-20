import "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import { AppError } from "@waitron/shared";
import type { InitialSetupContext } from "@waitron/module";
import { isAllocatedSeries } from "./allocation-identity.js";
import { parsePaperAllocation, type PaperAllocation } from "./paper-protocol.js";
import { WAITRON_ID_SISTEMA } from "./software.js";

export interface ValidatedInitialCandidates {
  readonly version: 1;
  readonly candidates: readonly PaperAllocation[];
  readonly candidateDigest: string;
}

function refuse(): never {
  throw new AppError("sif.allocation_invalid", { reason: "malformed_allocation" });
}

function checkContext(context: InitialSetupContext): void {
  const purposes = new Set(context.bases.map((base) => base.purpose));
  if (
    context.country !== "ES" ||
    !["production", "preproduction"].includes(context.environment) ||
    !/^[A-Z0-9]{9}$/.test(context.taxId) ||
    context.bases.length < 3 ||
    purposes.size !== 3 ||
    !["standard", "full", "rectificative"].every((purpose) => purposes.has(purpose)) ||
    !isAllocatedSeries(
      context.bases.map(({ code, purpose }) => ({ code: `${code}-S000001`, purpose })),
      "S000001",
      context.bases,
    )
  )
    refuse();
}

function digest(candidates: readonly PaperAllocation[]): string {
  return createHash("sha256").update(JSON.stringify(candidates)).digest("hex");
}

// Synthetic F2 records exercise complete record validation for names; they are never filed or stored.
function checkRecordNames(allocation: PaperAllocation): void {
  try {
    for (const series of allocation.series)
      for (const counter of [1, 9999999999]) {
        const record = buildAltaRecord({
          IDEmisorFactura: allocation.taxpayerNif,
          NumSerieFactura: `${series.code}/${counter}`,
          FechaExpedicionFactura: new Date("2026-10-15T12:00:00.000Z"),
          NombreRazonEmisor: "Allocation boundary check",
          TipoFactura: "F2",
          DescripcionOperacion: "Allocation boundary check",
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
            NombreRazon: "Allocation boundary check",
            NIF: "89890001K",
            NombreSistemaInformatico: "Waitron POS",
            IdSistemaInformatico: WAITRON_ID_SISTEMA,
            Version: "1",
            NumeroInstalacion: allocation.installationIdentity,
            TipoUsoPosibleSoloVerifactu: "S",
            TipoUsoPosibleMultiOT: "S",
            IndicadorMultiplesOT: "N",
          },
          Encadenamiento: { PrimerRegistro: "S" },
          generadoEn: new Date("2026-10-15T12:00:00.000Z"),
          offsetMinutes: 0,
        });
        if (validate(record, { now: new Date("2026-10-15T12:00:00.000Z") }).length !== 0) refuse();
      }
  } catch {
    refuse();
  }
}

function checked(
  context: InitialSetupContext,
  input: readonly unknown[],
  prefix: "S" | "P" = "S",
): readonly PaperAllocation[] {
  checkContext(context);
  if (
    input.length === 0 ||
    input.length > 100 ||
    Buffer.byteLength(JSON.stringify(input)) > 60 * 1024
  )
    refuse();
  const ids = new Set<string>();
  const identities = new Set<string>();
  const candidates = input.map((value) => {
    const allocation = parsePaperAllocation(value);
    if (
      allocation === null ||
      allocation.source !== (prefix === "S" ? "initial-paper" : "paper") ||
      allocation.taxpayerNif !== context.taxId ||
      allocation.softwareId !== WAITRON_ID_SISTEMA ||
      allocation.environment !== context.environment ||
      ids.has(allocation.allocationId) ||
      identities.has(allocation.installationIdentity) ||
      !isAllocatedSeries(allocation.series, allocation.installationIdentity, context.bases)
    )
      refuse();
    ids.add(allocation.allocationId);
    identities.add(allocation.installationIdentity);
    checkRecordNames(allocation);
    return allocation;
  });
  return Object.freeze(candidates);
}

export function validateInitialPaperCandidates(
  context: InitialSetupContext,
  serials: readonly number[],
): ValidatedInitialCandidates {
  return validatePaperCandidates(context, "S", serials);
}

export function validatePaperCandidates(
  context: InitialSetupContext,
  prefix: "S" | "P",
  serials: readonly number[],
): ValidatedInitialCandidates {
  checkContext(context);
  if (
    (prefix !== "S" && prefix !== "P") ||
    serials.length === 0 ||
    serials.length > 100 ||
    new Set(serials).size !== serials.length ||
    serials.some((serial) => !Number.isInteger(serial) || serial < 1 || serial > 999999)
  )
    refuse();
  const issuedAt = new Date().toISOString();
  const candidates = checked(
    context,
    serials.map((serial): PaperAllocation => {
      const installationIdentity = `${prefix}${String(serial).padStart(6, "0")}`;
      return {
        version: 1,
        allocationId: randomUUID(),
        taxpayerNif: context.taxId,
        softwareId: WAITRON_ID_SISTEMA,
        environment: context.environment,
        installationIdentity,
        series: context.bases.map(({ code, purpose }) => ({
          code: `${code}-${installationIdentity}`,
          purpose,
        })),
        source: prefix === "S" ? "initial-paper" : "paper",
        issuedAt,
      };
    }),
    prefix,
  );
  return Object.freeze({ version: 1, candidates, candidateDigest: digest(candidates) });
}

export function readInitialPaperCandidates(
  context: InitialSetupContext,
  value: unknown,
): ValidatedInitialCandidates {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse();
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 3 ||
    input.version !== 1 ||
    !Array.isArray(input.candidates) ||
    typeof input.candidateDigest !== "string"
  )
    refuse();
  const candidates = checked(context, input.candidates);
  if (digest(candidates) !== input.candidateDigest) refuse();
  return Object.freeze({ version: 1, candidates, candidateDigest: input.candidateDigest });
}
