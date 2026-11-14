import "./errors.js";
import { isCalendarDate } from "@waitron/shared";
import type { AltaInput, IDFacturaARInput } from "@waitron/verifactu";
import { formatAmountExact } from "@waitron/verifactu";
import { invalid, object, text } from "./record-remedy-request.js";

type InvoiceReference = Omit<IDFacturaARInput, "FechaExpedicionFactura"> & {
  FechaExpedicionFactura: string;
};

export interface CorrectedRecordFacts {
  description?: string;
  issuerName?: string;
  invoiceType?: AltaInput["TipoFactura"];
  correctionType?: AltaInput["TipoRectificativa"] | null;
  correctedInvoices?: InvoiceReference[] | null;
  substitutedInvoices?: InvoiceReference[] | null;
  correctionAmounts?: AltaInput["ImporteRectificacion"] | null;
  recipients?: NonNullable<AltaInput["Destinatarios"]>["IDDestinatario"] | null;
  breakdown?: AltaInput["Desglose"];
  taxTotal?: string;
  total?: string;
}

function amount(value: unknown) {
  const literal = text(value);
  try {
    formatAmountExact(literal);
  } catch {
    invalid();
  }
}

function strings(value: unknown, required: string[], optional: string[] = []) {
  const row = object(value);
  if (Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  for (const key of required) text(row[key]);
  for (const key of optional) if (key in row) text(row[key]);
  return row;
}

function list(value: unknown, check: (item: unknown) => void) {
  if (!Array.isArray(value) || value.length === 0) invalid();
  for (const item of value) check(item);
}

function reference(value: unknown) {
  const row = strings(value, ["IDEmisorFactura", "NumSerieFactura", "FechaExpedicionFactura"]);
  if (!isCalendarDate(text(row.FechaExpedicionFactura))) invalid();
}

function recipient(value: unknown) {
  const row = object(value);
  if (Object.keys(row).some((key) => !["NombreRazon", "NIF", "IDOtro"].includes(key))) invalid();
  text(row.NombreRazon);
  if ("NIF" in row === "IDOtro" in row) invalid();
  if ("NIF" in row) text(row.NIF);
  else strings(row.IDOtro, ["IDType", "ID"], ["CodigoPais"]);
}

function breakdown(value: unknown) {
  const row = strings(
    value,
    ["BaseImponibleOimporteNoSujeto"],
    [
      "Impuesto",
      "ClaveRegimen",
      "TipoImpositivo",
      "BaseImponibleACoste",
      "CuotaRepercutida",
      "TipoRecargoEquivalencia",
      "CuotaRecargoEquivalencia",
      "CalificacionOperacion",
      "OperacionExenta",
    ],
  );
  if ("CalificacionOperacion" in row === "OperacionExenta" in row) invalid();
  for (const key of [
    "BaseImponibleOimporteNoSujeto",
    "TipoImpositivo",
    "BaseImponibleACoste",
    "CuotaRepercutida",
    "TipoRecargoEquivalencia",
    "CuotaRecargoEquivalencia",
  ]) {
    if (key in row) amount(row[key]);
  }
}

export function readCorrectedRecordFacts(value: unknown): CorrectedRecordFacts {
  const facts = object(value);
  const keys = [
    "description",
    "issuerName",
    "invoiceType",
    "correctionType",
    "correctedInvoices",
    "substitutedInvoices",
    "correctionAmounts",
    "recipients",
    "breakdown",
    "taxTotal",
    "total",
  ];
  if (Object.keys(facts).length === 0 || Object.keys(facts).some((key) => !keys.includes(key)))
    invalid();
  for (const key of ["description", "issuerName"]) {
    if (key in facts) text(facts[key]);
  }
  for (const key of ["taxTotal", "total"]) if (key in facts) amount(facts[key]);
  if (
    "invoiceType" in facts &&
    !["F1", "F2", "F3", "R1", "R2", "R3", "R4", "R5"].includes(text(facts.invoiceType))
  )
    invalid();
  if (
    "correctionType" in facts &&
    facts.correctionType !== null &&
    facts.correctionType !== "I" &&
    facts.correctionType !== "S"
  )
    invalid();
  for (const key of ["correctedInvoices", "substitutedInvoices"]) {
    if (key in facts && facts[key] !== null) list(facts[key], reference);
  }
  if ("correctionAmounts" in facts && facts.correctionAmounts !== null) {
    const values = strings(
      facts.correctionAmounts,
      ["BaseRectificada", "CuotaRectificada"],
      ["CuotaRecargoRectificado"],
    );
    for (const value of Object.values(values)) amount(value);
  }
  if ("recipients" in facts && facts.recipients !== null) list(facts.recipients, recipient);
  if ("breakdown" in facts) list(facts.breakdown, breakdown);
  // Structural checks precede builders; fiscal validation still judges the complete new record.
  return facts as CorrectedRecordFacts;
}
