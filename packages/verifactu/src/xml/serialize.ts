import { escapeXml } from "./escape.js";
import type {
  DesgloseRectificacion,
  Destinatario,
  DetalleDesglose,
  Encadenamiento,
  IDFacturaAR,
  IDOtro,
  RegistroAlta,
  RegistroAnulacion,
  SistemaInformatico,
} from "../types.js";

/** maxOccurs="1000" in the official XSD; exceeding it draws error 4113/4114. */
export const MAX_REGISTROS_POR_ENVIO = 1000;

// Verified against the AEAT schema files committed in ../../schemas/ (targetNamespace of each
// .xsd): SuministroInformacion.xsd, SuministroLR.xsd, ConsultaLR.xsd — see ./schemas.test.ts,
// which reads those files back and asserts each targetNamespace against these exact constants.
// Exported (Task 18) so that guard imports them rather than carrying its own, independently
// re-declared copy that could drift from what this module actually emits.
export const NS_SF =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";
export const NS_LR =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd";
export const NS_LRC =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd";
const NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/";

export interface Cabecera {
  ObligadoEmision: { NombreRazon: string; NIF: string };
  Representante?: { NombreRazon: string; NIF: string };
}

export type EnvioRegistro =
  { RegistroAlta: RegistroAlta } | { RegistroAnulacion: RegistroAnulacion };

export interface ConsultaFiltro {
  Ejercicio: string;
  Periodo: string;
  NumSerieFactura?: string;
  FechaExpedicionFactura?: string;
  ClavePaginacion?: {
    IDEmisorFactura: string;
    NumSerieFactura: string;
    FechaExpedicionFactura: string;
  };
}

function el(prefix: string, name: string, value: string | undefined): string {
  return value === undefined ? "" : `<${prefix}:${name}>${escapeXml(value)}</${prefix}:${name}>`;
}

function obligadoEmisionXml(obligado: Cabecera["ObligadoEmision"]): string {
  return (
    "<sf:ObligadoEmision>" +
    el("sf", "NombreRazon", obligado.NombreRazon) +
    el("sf", "NIF", obligado.NIF) +
    "</sf:ObligadoEmision>"
  );
}

function sistemaInformatico(sistema: SistemaInformatico): string {
  return (
    "<sf:SistemaInformatico>" +
    el("sf", "NombreRazon", sistema.NombreRazon) +
    el("sf", "NIF", sistema.NIF) +
    el("sf", "NombreSistemaInformatico", sistema.NombreSistemaInformatico) +
    el("sf", "IdSistemaInformatico", sistema.IdSistemaInformatico) +
    el("sf", "Version", sistema.Version) +
    el("sf", "NumeroInstalacion", sistema.NumeroInstalacion) +
    el("sf", "TipoUsoPosibleSoloVerifactu", sistema.TipoUsoPosibleSoloVerifactu) +
    el("sf", "TipoUsoPosibleMultiOT", sistema.TipoUsoPosibleMultiOT) +
    el("sf", "IndicadorMultiplesOT", sistema.IndicadorMultiplesOT) +
    "</sf:SistemaInformatico>"
  );
}

function encadenamiento(value: Encadenamiento): string {
  // Tests RegistroAnterior, the same branch huellaAnteriorOf (huella.ts) and
  // validate.ts key off — not PrimerRegistro — so all three consumers of
  // Encadenamiento agree on which branch is authoritative. `!== undefined`,
  // not `in`: see huellaAnteriorOf for why `in` no longer narrows this union.
  if (value.RegistroAnterior === undefined) {
    return "<sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>";
  }
  const previous = value.RegistroAnterior;
  return (
    "<sf:Encadenamiento><sf:RegistroAnterior>" +
    el("sf", "IDEmisorFactura", previous.IDEmisorFactura) +
    el("sf", "NumSerieFactura", previous.NumSerieFactura) +
    el("sf", "FechaExpedicionFactura", previous.FechaExpedicionFactura) +
    el("sf", "Huella", previous.Huella) +
    "</sf:RegistroAnterior></sf:Encadenamiento>"
  );
}

function detalle(line: DetalleDesglose): string {
  return (
    "<sf:DetalleDesglose>" +
    el("sf", "Impuesto", line.Impuesto) +
    el("sf", "ClaveRegimen", line.ClaveRegimen) +
    el("sf", "CalificacionOperacion", line.CalificacionOperacion) +
    el("sf", "OperacionExenta", line.OperacionExenta) +
    el("sf", "TipoImpositivo", line.TipoImpositivo) +
    el("sf", "BaseImponibleOimporteNoSujeto", line.BaseImponibleOimporteNoSujeto) +
    el("sf", "BaseImponibleACoste", line.BaseImponibleACoste) +
    el("sf", "CuotaRepercutida", line.CuotaRepercutida) +
    el("sf", "TipoRecargoEquivalencia", line.TipoRecargoEquivalencia) +
    el("sf", "CuotaRecargoEquivalencia", line.CuotaRecargoEquivalencia) +
    "</sf:DetalleDesglose>"
  );
}

/** One entry of FacturasRectificadas/FacturasSustituidas — sf:IDFacturaARType, under the given tag name. */
function idFacturaArXml(tag: string, entry: IDFacturaAR): string {
  return (
    `<sf:${tag}>` +
    el("sf", "IDEmisorFactura", entry.IDEmisorFactura) +
    el("sf", "NumSerieFactura", entry.NumSerieFactura) +
    el("sf", "FechaExpedicionFactura", entry.FechaExpedicionFactura) +
    `</sf:${tag}>`
  );
}

function facturasRectificadasXml(value: RegistroAlta["FacturasRectificadas"]): string {
  if (value === undefined) return "";
  return (
    "<sf:FacturasRectificadas>" +
    value.IDFacturaRectificada.map((entry) => idFacturaArXml("IDFacturaRectificada", entry)).join(
      "",
    ) +
    "</sf:FacturasRectificadas>"
  );
}

function facturasSustituidasXml(value: RegistroAlta["FacturasSustituidas"]): string {
  if (value === undefined) return "";
  return (
    "<sf:FacturasSustituidas>" +
    value.IDFacturaSustituida.map((entry) => idFacturaArXml("IDFacturaSustituida", entry)).join(
      "",
    ) +
    "</sf:FacturasSustituidas>"
  );
}

/** sf:IDOtroType — the CodigoPais element is optional; `el` drops it when absent. */
function idOtroXml(value: IDOtro): string {
  return (
    "<sf:IDOtro>" +
    el("sf", "CodigoPais", value.CodigoPais) +
    el("sf", "IDType", value.IDType) +
    el("sf", "ID", value.ID) +
    "</sf:IDOtro>"
  );
}

/**
 * One Destinatarios/IDDestinatario entry — sf:PersonaFisicaJuridicaType. NIF and
 * IDOtro are an xsd:choice; `!== undefined` (not `in`) narrows the union, since
 * each Destinatario branch pins the other's identifier to `?: never` — the same
 * reason formatDetalle/encadenamiento use the dotted-name check.
 */
function idDestinatarioXml(entry: Destinatario): string {
  return (
    "<sf:IDDestinatario>" +
    el("sf", "NombreRazon", entry.NombreRazon) +
    (entry.NIF !== undefined ? el("sf", "NIF", entry.NIF) : idOtroXml(entry.IDOtro)) +
    "</sf:IDDestinatario>"
  );
}

function destinatariosXml(value: RegistroAlta["Destinatarios"]): string {
  if (value === undefined) return "";
  return (
    "<sf:Destinatarios>" +
    value.IDDestinatario.map(idDestinatarioXml).join("") +
    "</sf:Destinatarios>"
  );
}

function importeRectificacionXml(value: DesgloseRectificacion | undefined): string {
  if (value === undefined) return "";
  return (
    "<sf:ImporteRectificacion>" +
    el("sf", "BaseRectificada", value.BaseRectificada) +
    el("sf", "CuotaRectificada", value.CuotaRectificada) +
    el("sf", "CuotaRecargoRectificado", value.CuotaRecargoRectificado) +
    "</sf:ImporteRectificacion>"
  );
}

function registroAlta(record: RegistroAlta): string {
  return (
    "<sf:RegistroAlta>" +
    el("sf", "IDVersion", record.IDVersion) +
    "<sf:IDFactura>" +
    el("sf", "IDEmisorFactura", record.IDFactura.IDEmisorFactura) +
    el("sf", "NumSerieFactura", record.IDFactura.NumSerieFactura) +
    el("sf", "FechaExpedicionFactura", record.IDFactura.FechaExpedicionFactura) +
    "</sf:IDFactura>" +
    el("sf", "RefExterna", record.RefExterna) +
    el("sf", "NombreRazonEmisor", record.NombreRazonEmisor) +
    el("sf", "Subsanacion", record.Subsanacion) +
    el("sf", "RechazoPrevio", record.RechazoPrevio) +
    el("sf", "TipoFactura", record.TipoFactura) +
    el("sf", "TipoRectificativa", record.TipoRectificativa) +
    facturasRectificadasXml(record.FacturasRectificadas) +
    facturasSustituidasXml(record.FacturasSustituidas) +
    importeRectificacionXml(record.ImporteRectificacion) +
    el("sf", "FechaOperacion", record.FechaOperacion) +
    el("sf", "DescripcionOperacion", record.DescripcionOperacion) +
    el("sf", "FacturaSimplificadaArt7273", record.FacturaSimplificadaArt7273) +
    el("sf", "FacturaSinIdentifDestinatarioArt61d", record.FacturaSinIdentifDestinatarioArt61d) +
    el("sf", "Macrodato", record.Macrodato) +
    destinatariosXml(record.Destinatarios) +
    el("sf", "Cupon", record.Cupon) +
    `<sf:Desglose>${record.Desglose.map(detalle).join("")}</sf:Desglose>` +
    el("sf", "CuotaTotal", record.CuotaTotal) +
    el("sf", "ImporteTotal", record.ImporteTotal) +
    encadenamiento(record.Encadenamiento) +
    sistemaInformatico(record.SistemaInformatico) +
    el("sf", "FechaHoraHusoGenRegistro", record.FechaHoraHusoGenRegistro) +
    el("sf", "TipoHuella", record.TipoHuella) +
    el("sf", "Huella", record.Huella) +
    "</sf:RegistroAlta>"
  );
}

function registroAnulacion(record: RegistroAnulacion): string {
  return (
    "<sf:RegistroAnulacion>" +
    el("sf", "IDVersion", record.IDVersion) +
    "<sf:IDFactura>" +
    el("sf", "IDEmisorFacturaAnulada", record.IDFactura.IDEmisorFacturaAnulada) +
    el("sf", "NumSerieFacturaAnulada", record.IDFactura.NumSerieFacturaAnulada) +
    el("sf", "FechaExpedicionFacturaAnulada", record.IDFactura.FechaExpedicionFacturaAnulada) +
    "</sf:IDFactura>" +
    el("sf", "RefExterna", record.RefExterna) +
    el("sf", "SinRegistroPrevio", record.SinRegistroPrevio) +
    el("sf", "RechazoPrevio", record.RechazoPrevio) +
    el("sf", "GeneradoPor", record.GeneradoPor) +
    encadenamiento(record.Encadenamiento) +
    sistemaInformatico(record.SistemaInformatico) +
    el("sf", "FechaHoraHusoGenRegistro", record.FechaHoraHusoGenRegistro) +
    el("sf", "TipoHuella", record.TipoHuella) +
    el("sf", "Huella", record.Huella) +
    "</sf:RegistroAnulacion>"
  );
}

function cabeceraXml(cabecera: Cabecera): string {
  return (
    "<sfLR:Cabecera>" +
    obligadoEmisionXml(cabecera.ObligadoEmision) +
    (cabecera.Representante
      ? "<sf:Representante>" +
        el("sf", "NombreRazon", cabecera.Representante.NombreRazon) +
        el("sf", "NIF", cabecera.Representante.NIF) +
        "</sf:Representante>"
      : "") +
    "</sfLR:Cabecera>"
  );
}

function envelope(body: string, extraNs: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${NS_SOAP}" xmlns:sf="${NS_SF}" ${extraNs}>` +
    `<soapenv:Body>${body}</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

/**
 * Serialises a submission. One Cabecera names the obligado tributario; each
 * record carries its own SistemaInformatico, so a single envio may cover
 * several SIFs of the same obligado — which is what lets one batch span
 * several tills.
 */
export function serializeEnvio(cabecera: Cabecera, registros: EnvioRegistro[]): string {
  if (registros.length === 0) {
    throw new Error("An envio must contain at least one registro");
  }
  if (registros.length > MAX_REGISTROS_POR_ENVIO) {
    throw new Error(
      `An envio may carry at most ${MAX_REGISTROS_POR_ENVIO} registros, received ${registros.length}`,
    );
  }
  const body =
    `<sfLR:RegFactuSistemaFacturacion>` +
    cabeceraXml(cabecera) +
    registros
      .map(
        (entry) =>
          "<sfLR:RegistroFactura>" +
          ("RegistroAlta" in entry
            ? registroAlta(entry.RegistroAlta)
            : registroAnulacion(entry.RegistroAnulacion)) +
          "</sfLR:RegistroFactura>",
      )
      .join("") +
    `</sfLR:RegFactuSistemaFacturacion>`;
  return envelope(body, `xmlns:sfLR="${NS_LR}"`);
}

/** Serialises a consulta. PeriodoImputacion is mandatory even for one invoice. */
export function serializeConsulta(cabecera: Cabecera, filtro: ConsultaFiltro): string {
  const body =
    `<sfLRC:ConsultaFactuSistemaFacturacion>` +
    "<sfLRC:Cabecera>" +
    el("sf", "IDVersion", "1.0") +
    obligadoEmisionXml(cabecera.ObligadoEmision) +
    "</sfLRC:Cabecera>" +
    "<sfLRC:FiltroConsulta>" +
    "<sfLRC:PeriodoImputacion>" +
    el("sf", "Ejercicio", filtro.Ejercicio) +
    el("sf", "Periodo", filtro.Periodo) +
    "</sfLRC:PeriodoImputacion>" +
    el("sfLRC", "NumSerieFactura", filtro.NumSerieFactura) +
    (filtro.FechaExpedicionFactura !== undefined
      ? "<sfLRC:FechaExpedicionFactura>" +
        el("sf", "FechaExpedicionFactura", filtro.FechaExpedicionFactura) +
        "</sfLRC:FechaExpedicionFactura>"
      : "") +
    (filtro.ClavePaginacion
      ? "<sfLRC:ClavePaginacion>" +
        el("sf", "IDEmisorFactura", filtro.ClavePaginacion.IDEmisorFactura) +
        el("sf", "NumSerieFactura", filtro.ClavePaginacion.NumSerieFactura) +
        el("sf", "FechaExpedicionFactura", filtro.ClavePaginacion.FechaExpedicionFactura) +
        "</sfLRC:ClavePaginacion>"
      : "") +
    "</sfLRC:FiltroConsulta>" +
    `</sfLRC:ConsultaFactuSistemaFacturacion>`;
  return envelope(body, `xmlns:sfLRC="${NS_LRC}"`);
}
