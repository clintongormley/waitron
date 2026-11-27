import {
  buildAltaRecord,
  type AltaInput,
  type RegistroAlta,
  type RespuestaLinea,
} from "@waitron/verifactu";
import { timeZoneOffsetMinutes } from "@waitron/shared";

export type ProbeLabel = "control" | "madrid-day" | "own-offset" | "future";

export interface ProbeTaxpayer {
  taxId: string;
  legalName: string;
}

export interface ProbeRecord {
  label: ProbeLabel;
  input: AltaInput;
  record: RegistroAlta;
}

export interface Outcome {
  kind: "accepted" | "1112" | "other";
  status: string;
  code?: number;
  text?: string;
}

export interface ProbeResult {
  entry: ProbeRecord;
  outcome: Outcome;
}

const MADRID = "Europe/Madrid";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function madridMinute(now: Date): number {
  const local = new Date(now.getTime() + timeZoneOffsetMinutes(MADRID, now) * MINUTE);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

export function inSendWindow(now: Date): boolean {
  const minute = madridMinute(now);
  return minute >= 5 && minute < 55;
}

function stamp(now: Date): string {
  return now.toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

export function probeRecords(now: Date, taxpayer: ProbeTaxpayer): ProbeRecord[] {
  const madrid = timeZoneOffsetMinutes(MADRID, now);
  const plan: Array<[ProbeLabel, number, number]> = [
    ["control", now.getTime() - DAY, madrid],
    ["madrid-day", now.getTime(), madrid],
    // Madrid's date written at offset 0: the instant whose UTC date is Madrid's date now.
    ["own-offset", now.getTime() + madrid * MINUTE, 0],
    ["future", now.getTime() + DAY, madrid],
  ];
  return plan.map(([label, dated, offsetMinutes]) => {
    const number = `A1270-${stamp(now)}-${label}`;
    const input: AltaInput = {
      IDEmisorFactura: taxpayer.taxId,
      NumSerieFactura: number,
      FechaExpedicionFactura: new Date(dated),
      NombreRazonEmisor: taxpayer.legalName,
      TipoFactura: "F2",
      DescripcionOperacion: "A1270 probe",
      Desglose: [
        {
          Impuesto: "01",
          ClaveRegimen: "01",
          CalificacionOperacion: "S1",
          TipoImpositivo: "21.00",
          BaseImponibleOimporteNoSujeto: "1.00",
          CuotaRepercutida: "0.21",
        },
      ],
      CuotaTotal: "0.21",
      ImporteTotal: "1.21",
      SistemaInformatico: {
        NombreRazon: taxpayer.legalName,
        NIF: taxpayer.taxId,
        NombreSistemaInformatico: "A1270 probe",
        IdSistemaInformatico: "PB",
        Version: "1.0",
        NumeroInstalacion: number,
        TipoUsoPosibleSoloVerifactu: "S",
        TipoUsoPosibleMultiOT: "N",
        IndicadorMultiplesOT: "N",
      },
      Encadenamiento: { PrimerRegistro: "S" },
      generadoEn: now,
      offsetMinutes,
    };
    return { label, input, record: buildAltaRecord(input) };
  });
}

export function outcomeOf(line: RespuestaLinea | Error | undefined): Outcome {
  if (line === undefined) return { kind: "other", status: "no line" };
  if (line instanceof Error) return { kind: "other", status: "error", text: line.message };
  const status = line.EstadoRegistro ?? "no status";
  const kind =
    status === "Correcto" || status === "AceptadoConErrores"
      ? "accepted"
      : status === "Incorrecto" && line.CodigoErrorRegistro === 1112
        ? "1112"
        : "other";
  return {
    kind,
    status,
    ...(line.CodigoErrorRegistro === undefined ? {} : { code: line.CodigoErrorRegistro }),
    ...(line.DescripcionErrorRegistro === undefined ? {} : { text: line.DescripcionErrorRegistro }),
  };
}

export function verdict(outcomes: Record<ProbeLabel, Outcome>): string {
  const shape = (["control", "madrid-day", "own-offset", "future"] as const)
    .map((label) => outcomes[label].kind)
    .join(" ");
  switch (shape) {
    case "accepted 1112 1112 1112":
    case "accepted 1112 other 1112":
      return "AEAT refused today's Madrid date at 00:10 Madrid: it compares in UTC, as the fake does";
    case "accepted accepted accepted 1112":
      return "AEAT accepted today's Madrid date at 00:10 Madrid, also when the record said UTC: it compares with its own Madrid date (or UTC with at least 50 minutes' leeway)";
    case "accepted accepted 1112 1112":
      return "AEAT accepted the Madrid date but refused the same date written in UTC: it reads the date in the record's own offset";
    default:
      return `Inconclusive: control ${outcomes.control.kind}, madrid-day ${outcomes["madrid-day"].kind}, own-offset ${outcomes["own-offset"].kind}, future ${outcomes.future.kind}`;
  }
}

function mask(text: string, taxpayer: ProbeTaxpayer): string {
  let masked = text;
  for (const secret of [taxpayer.taxId, taxpayer.legalName]) {
    if (secret.trim() === "") continue;
    masked = masked.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "***");
  }
  return masked;
}

function when(now: Date): string {
  const minute = madridMinute(now);
  const hhmm = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return `${now.toISOString()} UTC, ${hhmm} Madrid`;
}

export function describeRecord({ label, record }: ProbeRecord): string {
  return `${label} ${record.IDFactura.NumSerieFactura} date ${record.IDFactura.FechaExpedicionFactura} generated ${record.FechaHoraHusoGenRegistro}`;
}

export function recordLine({ entry, outcome }: ProbeResult, taxpayer: ProbeTaxpayer): string {
  const parts = [
    outcome.kind,
    outcome.status,
    ...(outcome.code === undefined ? [] : [String(outcome.code)]),
    ...(outcome.text === undefined ? [] : [outcome.text]),
  ];
  return mask(`${describeRecord(entry)}: ${parts.join(" ")}`, taxpayer);
}

export function resultText(
  sentAt: Date,
  results: readonly ProbeResult[],
  taxpayer: ProbeTaxpayer,
): string {
  const byLabel = Object.fromEntries(
    results.map((result) => [result.entry.label, result.outcome]),
  ) as Record<ProbeLabel, Outcome>;
  return [
    `sent ${when(sentAt)}`,
    ...results.map((result) => recordLine(result, taxpayer)),
    mask(verdict(byLabel), taxpayer),
    "",
  ].join("\n");
}

export function notSentText(now: Date, reason: string, taxpayer: ProbeTaxpayer): string {
  return mask(`not sent at ${when(now)}: ${reason}`, taxpayer);
}
