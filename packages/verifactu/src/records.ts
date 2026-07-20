import { formatAmount, formatDate, formatDateTime } from "./format.js";
import { computeHuella } from "./huella.js";
import type {
  AltaInput,
  AnulacionInput,
  DesgloseRectificacion,
  DesgloseRectificacionInput,
  DetalleDesglose,
  DetalleDesgloseInput,
  IDFacturaAR,
  IDFacturaARInput,
  RegistroAlta,
  RegistroAnulacion,
} from "./types.js";

function formatDetalle(detalle: DetalleDesgloseInput): DetalleDesglose {
  // CalificacionOperacion/OperacionExenta are built as the union's
  // discriminant directly, rather than conditional-spreading both — the type
  // no longer allows a shape with neither (or both) present, so the choice
  // has to be made once, up front, and the rest of the line built onto it.
  const common = {
    ...(detalle.Impuesto !== undefined && { Impuesto: detalle.Impuesto }),
    ...(detalle.ClaveRegimen !== undefined && { ClaveRegimen: detalle.ClaveRegimen }),
    ...(detalle.TipoImpositivo !== undefined && {
      TipoImpositivo: formatAmount(detalle.TipoImpositivo),
    }),
    BaseImponibleOimporteNoSujeto: formatAmount(detalle.BaseImponibleOimporteNoSujeto),
    ...(detalle.BaseImponibleACoste !== undefined && {
      BaseImponibleACoste: formatAmount(detalle.BaseImponibleACoste),
    }),
    ...(detalle.CuotaRepercutida !== undefined && {
      CuotaRepercutida: formatAmount(detalle.CuotaRepercutida),
    }),
    ...(detalle.TipoRecargoEquivalencia !== undefined && {
      TipoRecargoEquivalencia: formatAmount(detalle.TipoRecargoEquivalencia),
    }),
    ...(detalle.CuotaRecargoEquivalencia !== undefined && {
      CuotaRecargoEquivalencia: formatAmount(detalle.CuotaRecargoEquivalencia),
    }),
  };
  // `!== undefined`, not `"CalificacionOperacion" in detalle`: the `in`
  // operator only narrows a union member out of the truthy branch when the
  // property is entirely absent from its type, but the other branch still
  // declares CalificacionOperacion (as `?: never`) so it isn't absent — it
  // would leave detalle.CalificacionOperacion typed `string | undefined`
  // rather than narrowing to `string`.
  return detalle.CalificacionOperacion !== undefined
    ? { ...common, CalificacionOperacion: detalle.CalificacionOperacion }
    : { ...common, OperacionExenta: detalle.OperacionExenta };
}

/** Formats one FacturasRectificadas/FacturasSustituidas entry — sf:IDFacturaARType. */
function formatIDFacturaAR(entry: IDFacturaARInput, offsetMinutes: number): IDFacturaAR {
  return {
    IDEmisorFactura: entry.IDEmisorFactura,
    NumSerieFactura: entry.NumSerieFactura,
    FechaExpedicionFactura: formatDate(entry.FechaExpedicionFactura, offsetMinutes),
  };
}

/** Formats ImporteRectificacion — sf:DesgloseRectificacionType. */
function formatImporteRectificacion(input: DesgloseRectificacionInput): DesgloseRectificacion {
  return {
    BaseRectificada: formatAmount(input.BaseRectificada),
    CuotaRectificada: formatAmount(input.CuotaRectificada),
    ...(input.CuotaRecargoRectificado !== undefined && {
      CuotaRecargoRectificado: formatAmount(input.CuotaRecargoRectificado),
    }),
  };
}

/**
 * Builds a registro de alta, formatting every value exactly once and hashing
 * the resulting literals. The returned record is complete and ready to
 * serialise — the same strings go into the XML and went into the hash, which
 * is the property AEAT's recomputation depends on.
 *
 * The `Huella: ""` placeholder a few lines down (and its anulación
 * counterpart below) is mutation-tested as equivalent, not merely untested:
 * it exists only so `record` type-checks as a complete RegistroAlta before
 * hashing, is never read by computeHuella (which hashes Encadenamiento's
 * PREDECESSOR huella, never the record's own — see huella.test.ts's "ignores
 * the record's own Huella field"), and is unconditionally overwritten by the
 * later `Huella: computeHuella(record)` key in the object spread below. No
 * value the placeholder could hold is ever observable, so no test can kill a
 * mutant of its literal.
 */
export function buildAltaRecord(input: AltaInput): RegistroAlta {
  const record: RegistroAlta = {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFactura: input.IDEmisorFactura,
      NumSerieFactura: input.NumSerieFactura,
      FechaExpedicionFactura: formatDate(input.FechaExpedicionFactura, input.offsetMinutes),
    },
    ...(input.RefExterna !== undefined && { RefExterna: input.RefExterna }),
    NombreRazonEmisor: input.NombreRazonEmisor,
    ...(input.Subsanacion !== undefined && { Subsanacion: input.Subsanacion }),
    ...(input.RechazoPrevio !== undefined && { RechazoPrevio: input.RechazoPrevio }),
    TipoFactura: input.TipoFactura,
    ...(input.TipoRectificativa !== undefined && { TipoRectificativa: input.TipoRectificativa }),
    ...(input.FacturasRectificadas !== undefined && {
      FacturasRectificadas: {
        IDFacturaRectificada: input.FacturasRectificadas.map((entry) =>
          formatIDFacturaAR(entry, input.offsetMinutes),
        ),
      },
    }),
    ...(input.FacturasSustituidas !== undefined && {
      FacturasSustituidas: {
        IDFacturaSustituida: input.FacturasSustituidas.map((entry) =>
          formatIDFacturaAR(entry, input.offsetMinutes),
        ),
      },
    }),
    ...(input.ImporteRectificacion !== undefined && {
      ImporteRectificacion: formatImporteRectificacion(input.ImporteRectificacion),
    }),
    ...(input.FechaOperacion !== undefined && {
      FechaOperacion: formatDate(input.FechaOperacion, input.offsetMinutes),
    }),
    DescripcionOperacion: input.DescripcionOperacion,
    ...(input.FacturaSimplificadaArt7273 !== undefined && {
      FacturaSimplificadaArt7273: input.FacturaSimplificadaArt7273,
    }),
    ...(input.FacturaSinIdentifDestinatarioArt61d !== undefined && {
      FacturaSinIdentifDestinatarioArt61d: input.FacturaSinIdentifDestinatarioArt61d,
    }),
    ...(input.Macrodato !== undefined && { Macrodato: input.Macrodato }),
    ...(input.Cupon !== undefined && { Cupon: input.Cupon }),
    Desglose: input.Desglose.map(formatDetalle),
    CuotaTotal: formatAmount(input.CuotaTotal),
    ImporteTotal: formatAmount(input.ImporteTotal),
    Encadenamiento: input.Encadenamiento,
    SistemaInformatico: input.SistemaInformatico,
    FechaHoraHusoGenRegistro: formatDateTime(input.generadoEn, input.offsetMinutes),
    TipoHuella: "01",
    Huella: "",
  };
  return { ...record, Huella: computeHuella(record) };
}

export function buildAnulacionRecord(input: AnulacionInput): RegistroAnulacion {
  const record: RegistroAnulacion = {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFacturaAnulada: input.IDEmisorFacturaAnulada,
      NumSerieFacturaAnulada: input.NumSerieFacturaAnulada,
      FechaExpedicionFacturaAnulada: formatDate(
        input.FechaExpedicionFacturaAnulada,
        input.offsetMinutes,
      ),
    },
    ...(input.RefExterna !== undefined && { RefExterna: input.RefExterna }),
    ...(input.SinRegistroPrevio !== undefined && { SinRegistroPrevio: input.SinRegistroPrevio }),
    ...(input.RechazoPrevio !== undefined && { RechazoPrevio: input.RechazoPrevio }),
    ...(input.GeneradoPor !== undefined && { GeneradoPor: input.GeneradoPor }),
    Encadenamiento: input.Encadenamiento,
    SistemaInformatico: input.SistemaInformatico,
    FechaHoraHusoGenRegistro: formatDateTime(input.generadoEn, input.offsetMinutes),
    TipoHuella: "01",
    Huella: "",
  };
  return { ...record, Huella: computeHuella(record) };
}
