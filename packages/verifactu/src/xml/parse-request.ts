import { asArray, parser } from "./parse-common.js";
import type { Cabecera, ConsultaFiltro, EnvioRegistro } from "./serialize.js";
import type {
  DesgloseRectificacion,
  DetalleDesglose,
  Encadenamiento,
  IDFacturaAR,
  RegistroAlta,
  RegistroAnulacion,
  SistemaInformatico,
} from "../types.js";

// fast-xml-parser (parse-common's shared `parser`) strips namespace prefixes and keeps leaf
// values as exact strings, so every field below is read straight through. `removeNSPrefix` means
// `sfLR:RegistroFactura` and `sf:IDFactura` both land unprefixed.
interface RawEnvelope {
  Envelope?: {
    Body?: {
      RegFactuSistemaFacturacion?: {
        Cabecera?: RawCabecera;
        RegistroFactura?: RawRegistroFactura | RawRegistroFactura[];
      };
      ConsultaFactuSistemaFacturacion?: {
        Cabecera?: RawCabecera;
        FiltroConsulta?: RawFiltro;
      };
    };
  };
}
interface RawCabecera {
  ObligadoEmision: { NombreRazon: string; NIF: string };
  Representante?: { NombreRazon: string; NIF: string };
}
type RawRegistroFactura = { RegistroAlta: RawRecord } | { RegistroAnulacion: RawRecord };
type RawRecord = Record<string, unknown>;
interface RawFiltro {
  PeriodoImputacion: { Ejercicio: string; Periodo: string };
  NumSerieFactura?: string;
  FechaExpedicionFactura?: { FechaExpedicionFactura: string };
  ClavePaginacion?: {
    IDEmisorFactura: string;
    NumSerieFactura: string;
    FechaExpedicionFactura: string;
  };
}

function cabeceraOf(raw: RawCabecera): Cabecera {
  const cabecera: Cabecera = {
    ObligadoEmision: { NombreRazon: raw.ObligadoEmision.NombreRazon, NIF: raw.ObligadoEmision.NIF },
  };
  if (raw.Representante)
    cabecera.Representante = {
      NombreRazon: raw.Representante.NombreRazon,
      NIF: raw.Representante.NIF,
    };
  return cabecera;
}

// Only defined keys are copied back, so `toEqual` against the original record (which omits absent
// optionals) holds. `pick` copies a key only when present.
function pick<T extends object>(into: T, raw: RawRecord, keys: readonly string[]): void {
  for (const key of keys) {
    if (raw[key] !== undefined) (into as Record<string, unknown>)[key] = raw[key];
  }
}

function encadenamientoOf(raw: RawRecord): Encadenamiento {
  const enc = raw.Encadenamiento as {
    PrimerRegistro?: string;
    RegistroAnterior?: Record<string, string>;
  };
  if (enc.RegistroAnterior !== undefined) {
    const a = enc.RegistroAnterior;
    return {
      RegistroAnterior: {
        IDEmisorFactura: a.IDEmisorFactura,
        NumSerieFactura: a.NumSerieFactura,
        FechaExpedicionFactura: a.FechaExpedicionFactura,
        Huella: a.Huella,
      },
    };
  }
  return { PrimerRegistro: "S" };
}

function detalleOf(raw: RawRecord): DetalleDesglose {
  const d: DetalleDesglose = {} as DetalleDesglose;
  pick(d, raw, [
    "Impuesto",
    "ClaveRegimen",
    "CalificacionOperacion",
    "OperacionExenta",
    "TipoImpositivo",
    "BaseImponibleOimporteNoSujeto",
    "BaseImponibleACoste",
    "CuotaRepercutida",
    "TipoRecargoEquivalencia",
    "CuotaRecargoEquivalencia",
  ]);
  return d;
}

function idFacturaArOf(raw: RawRecord): IDFacturaAR {
  return {
    IDEmisorFactura: raw.IDEmisorFactura as string,
    NumSerieFactura: raw.NumSerieFactura as string,
    FechaExpedicionFactura: raw.FechaExpedicionFactura as string,
  };
}

function altaOf(raw: RawRecord): RegistroAlta {
  const idf = raw.IDFactura as Record<string, string>;
  const record = {
    IDVersion: raw.IDVersion,
    IDFactura: {
      IDEmisorFactura: idf.IDEmisorFactura,
      NumSerieFactura: idf.NumSerieFactura,
      FechaExpedicionFactura: idf.FechaExpedicionFactura,
    },
    // serializeEnvio wraps each line in its own <sf:Desglose><sf:DetalleDesglose>...</sf:DetalleDesglose></sf:Desglose>,
    // so raw.Desglose is `{ DetalleDesglose: ... }`, not the array of lines directly — same
    // one-level-of-wrapping pattern as FacturasRectificadas/FacturasSustituidas below.
    Desglose: asArray(
      (raw.Desglose as { DetalleDesglose: RawRecord | RawRecord[] }).DetalleDesglose,
    ).map(detalleOf),
    Encadenamiento: encadenamientoOf(raw),
    SistemaInformatico: raw.SistemaInformatico as SistemaInformatico,
    FechaHoraHusoGenRegistro: raw.FechaHoraHusoGenRegistro,
    TipoHuella: raw.TipoHuella,
    Huella: raw.Huella,
  } as RegistroAlta;
  pick(record, raw, [
    "RefExterna",
    "NombreRazonEmisor",
    "Subsanacion",
    "RechazoPrevio",
    "TipoFactura",
    "TipoRectificativa",
    "FechaOperacion",
    "DescripcionOperacion",
    "FacturaSimplificadaArt7273",
    "FacturaSinIdentifDestinatarioArt61d",
    "Macrodato",
    "Cupon",
    "CuotaTotal",
    "ImporteTotal",
  ]);
  const fr = raw.FacturasRectificadas as
    { IDFacturaRectificada: RawRecord | RawRecord[] } | undefined;
  if (fr)
    record.FacturasRectificadas = {
      IDFacturaRectificada: asArray(fr.IDFacturaRectificada).map(idFacturaArOf),
    };
  const fs = raw.FacturasSustituidas as
    { IDFacturaSustituida: RawRecord | RawRecord[] } | undefined;
  if (fs)
    record.FacturasSustituidas = {
      IDFacturaSustituida: asArray(fs.IDFacturaSustituida).map(idFacturaArOf),
    };
  const ir = raw.ImporteRectificacion as Record<string, string> | undefined;
  if (ir) {
    const rectif: DesgloseRectificacion = {} as DesgloseRectificacion;
    pick(rectif, ir, ["BaseRectificada", "CuotaRectificada", "CuotaRecargoRectificado"]);
    record.ImporteRectificacion = rectif;
  }
  return record;
}

function anulacionOf(raw: RawRecord): RegistroAnulacion {
  const idf = raw.IDFactura as Record<string, string>;
  const record = {
    IDVersion: raw.IDVersion,
    IDFactura: {
      IDEmisorFacturaAnulada: idf.IDEmisorFacturaAnulada,
      NumSerieFacturaAnulada: idf.NumSerieFacturaAnulada,
      FechaExpedicionFacturaAnulada: idf.FechaExpedicionFacturaAnulada,
    },
    Encadenamiento: encadenamientoOf(raw),
    SistemaInformatico: raw.SistemaInformatico as SistemaInformatico,
    FechaHoraHusoGenRegistro: raw.FechaHoraHusoGenRegistro,
    TipoHuella: raw.TipoHuella,
    Huella: raw.Huella,
  } as RegistroAnulacion;
  pick(record, raw, ["RefExterna", "SinRegistroPrevio", "RechazoPrevio", "GeneradoPor"]);
  return record;
}

export function parseEnvio(xml: string): { cabecera: Cabecera; registros: EnvioRegistro[] } {
  const body = (parser.parse(xml) as RawEnvelope).Envelope?.Body?.RegFactuSistemaFacturacion;
  if (!body?.Cabecera)
    throw new Error("Envio does not contain a RegFactuSistemaFacturacion Cabecera");
  const registros = asArray(body.RegistroFactura).map((entry): EnvioRegistro =>
    "RegistroAlta" in entry
      ? { RegistroAlta: altaOf(entry.RegistroAlta) }
      : { RegistroAnulacion: anulacionOf(entry.RegistroAnulacion) },
  );
  if (registros.length === 0)
    throw new Error("Envio does not contain at least one RegistroFactura");
  return { cabecera: cabeceraOf(body.Cabecera), registros };
}

export function parseConsulta(xml: string): { cabecera: Cabecera; filtro: ConsultaFiltro } {
  const body = (parser.parse(xml) as RawEnvelope).Envelope?.Body?.ConsultaFactuSistemaFacturacion;
  if (!body?.Cabecera || !body.FiltroConsulta)
    throw new Error("Consulta does not contain a ConsultaFactuSistemaFacturacion body");
  const f = body.FiltroConsulta;
  if (!f.PeriodoImputacion)
    throw new Error("Consulta FiltroConsulta does not contain a PeriodoImputacion");
  const filtro: ConsultaFiltro = {
    Ejercicio: f.PeriodoImputacion.Ejercicio,
    Periodo: f.PeriodoImputacion.Periodo,
  };
  if (f.NumSerieFactura !== undefined) filtro.NumSerieFactura = f.NumSerieFactura;
  if (f.FechaExpedicionFactura !== undefined)
    filtro.FechaExpedicionFactura = f.FechaExpedicionFactura.FechaExpedicionFactura;
  if (f.ClavePaginacion !== undefined) filtro.ClavePaginacion = f.ClavePaginacion;
  return { cabecera: cabeceraOf(body.Cabecera), filtro };
}
