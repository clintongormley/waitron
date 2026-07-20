import { asArray, asNumber, asRequiredNumber, parser } from "./parse-common.js";
import type { IDFactura } from "../types.js";

export type EstadoEnvio = "Correcto" | "ParcialmenteCorrecto" | "Incorrecto";
export type EstadoRegistroSuministro = "Correcto" | "AceptadoConErrores" | "Incorrecto";

/** Consulta uses a DIFFERENT enum (different spelling too). Never share this type with that path. */
export type EstadoRegistroDuplicado = "Correcta" | "AceptadaConErrores" | "Anulada";

export interface RegistroDuplicado {
  IdPeticionRegistroDuplicado?: string;
  EstadoRegistroDuplicado?: EstadoRegistroDuplicado;
  CodigoErrorRegistro?: number;
  DescripcionErrorRegistro?: string;
}

export interface RespuestaLinea {
  IDFactura: IDFactura;
  Operacion?: string;
  RefExterna?: string;
  EstadoRegistro: EstadoRegistroSuministro;
  CodigoErrorRegistro?: number;
  DescripcionErrorRegistro?: string;
  RegistroDuplicado?: RegistroDuplicado;
}

export interface RespuestaSuministro {
  /**
   * Only present when the envio was not rejected outright, and never
   * retrievable later by any query — the caller must persist it on receipt
   * or lose it permanently.
   */
  CSV?: string;
  EstadoEnvio: EstadoEnvio;
  TiempoEsperaEnvio: number;
  RespuestaLinea: RespuestaLinea[];
}

/** What the caller should actually record, after resolving the 3000 inversion. */
export type EstadoEfectivo =
  "accepted" | "accepted_with_errors" | "rejected" | "duplicate_annulled" | "duplicate_unknown";

export const ERROR_DUPLICADO = 3000;

// The raw shape fast-xml-parser hands back. Leaf values stay strings — parseTagValue is off — so
// TiempoEsperaEnvio and the error codes need explicit numeric conversion below.

interface RawRegistroDuplicado {
  IdPeticionRegistroDuplicado?: string;
  EstadoRegistroDuplicado?: string;
  CodigoErrorRegistro?: string;
  DescripcionErrorRegistro?: string;
}

interface RawRespuestaLinea {
  IDFactura: IDFactura;
  Operacion?: string;
  RefExterna?: string;
  EstadoRegistro: string;
  CodigoErrorRegistro?: string;
  DescripcionErrorRegistro?: string;
  RegistroDuplicado?: RawRegistroDuplicado;
}

interface RawRespuestaSuministro {
  CSV?: string;
  EstadoEnvio: string;
  TiempoEsperaEnvio: string;
  RespuestaLinea?: RawRespuestaLinea | RawRespuestaLinea[];
}

interface RawEnvelope {
  Envelope?: {
    Body?: {
      RespuestaRegFactuSistemaFacturacion?: RawRespuestaSuministro;
    };
  };
}

function parseRegistroDuplicado(
  raw: RawRegistroDuplicado | undefined,
): RegistroDuplicado | undefined {
  if (!raw) return undefined;
  return {
    IdPeticionRegistroDuplicado: raw.IdPeticionRegistroDuplicado,
    EstadoRegistroDuplicado: raw.EstadoRegistroDuplicado as EstadoRegistroDuplicado | undefined,
    CodigoErrorRegistro: asNumber(raw.CodigoErrorRegistro, "RegistroDuplicado.CodigoErrorRegistro"),
    DescripcionErrorRegistro: raw.DescripcionErrorRegistro,
  };
}

function parseRespuestaLinea(raw: RawRespuestaLinea): RespuestaLinea {
  return {
    IDFactura: {
      IDEmisorFactura: raw.IDFactura.IDEmisorFactura,
      NumSerieFactura: raw.IDFactura.NumSerieFactura,
      FechaExpedicionFactura: raw.IDFactura.FechaExpedicionFactura,
    },
    Operacion: raw.Operacion,
    RefExterna: raw.RefExterna,
    EstadoRegistro: raw.EstadoRegistro as EstadoRegistroSuministro,
    CodigoErrorRegistro: asNumber(raw.CodigoErrorRegistro, "RespuestaLinea.CodigoErrorRegistro"),
    DescripcionErrorRegistro: raw.DescripcionErrorRegistro,
    RegistroDuplicado: parseRegistroDuplicado(raw.RegistroDuplicado),
  };
}

/** Parses a `RespuestaRegFactuSistemaFacturacion` SOAP response into a plain object. */
export function parseRespuestaSuministro(xml: string): RespuestaSuministro {
  const parsed = parser.parse(xml) as RawEnvelope;
  const body = parsed.Envelope?.Body?.RespuestaRegFactuSistemaFacturacion;
  if (!body) {
    throw new Error("Response does not contain a RespuestaRegFactuSistemaFacturacion body");
  }
  return {
    CSV: body.CSV,
    EstadoEnvio: body.EstadoEnvio as EstadoEnvio,
    // \d{0,4} in the schema, so up to 9999 seconds — never narrow this to 8 bits.
    // This value drives the caller's next-submission scheduling, so a
    // malformed or absent element must throw here rather than silently
    // becoming NaN and poisoning that schedule.
    TiempoEsperaEnvio: asRequiredNumber(body.TiempoEsperaEnvio, "TiempoEsperaEnvio"),
    RespuestaLinea: asArray(body.RespuestaLinea).map(parseRespuestaLinea),
  };
}

/**
 * Resolves what a response line actually means.
 *
 * Error 3000 inverts: the outer EstadoRegistro reads `Incorrecto`, but the
 * RegistroDuplicado block may report the ALREADY-STORED record as `Correcta`.
 * Reading the outer status as authoritative would mark an accepted record
 * rejected and halt a healthy chain — the opposite of the truth.
 *
 * `duplicate_unknown` means AEAT holds something under this identity but did
 * not say what; the caller must resolve it with a consulta and compare the
 * stored huella. `duplicate_annulled` means AEAT holds an annulled record
 * there, which needs attention rather than a retry.
 */
export function resolveEstadoEfectivo(linea: RespuestaLinea): EstadoEfectivo {
  if (linea.CodigoErrorRegistro === ERROR_DUPLICADO) {
    switch (linea.RegistroDuplicado?.EstadoRegistroDuplicado) {
      case "Correcta":
        return "accepted";
      case "AceptadaConErrores":
        return "accepted_with_errors";
      case "Anulada":
        return "duplicate_annulled";
      default:
        return "duplicate_unknown";
    }
  }
  switch (linea.EstadoRegistro) {
    case "Correcto":
      return "accepted";
    case "AceptadoConErrores":
      return "accepted_with_errors";
    default:
      return "rejected";
  }
}
