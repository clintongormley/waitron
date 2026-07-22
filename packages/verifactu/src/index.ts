// The entire public surface of @waitron/verifactu. Re-exports only — no logic here.
export { formatAmountExact, formatDate, formatDateTime, trimValue } from "./format.js";
export {
  buildCadena,
  buildCadenaAlta,
  buildCadenaAnulacion,
  computeHuella,
  huellaAnteriorOf,
  verifyHuella,
} from "./huella.js";
export { buildAltaRecord, buildAnulacionRecord } from "./records.js";
export { validate } from "./validate.js";
export { buildQrPayload } from "./qr.js";
export { QR_ENDPOINTS, SOAP_ENDPOINTS, SOAP_ENDPOINTS_SELLO } from "./endpoints.js";
export { MAX_REGISTROS_POR_ENVIO, serializeConsulta, serializeEnvio } from "./xml/serialize.js";
export {
  ERROR_DUPLICADO,
  parseRespuestaSuministro,
  resolveEstadoEfectivo,
} from "./xml/parse-suministro.js";
export { parseRespuestaConsulta } from "./xml/parse-consulta.js";
export { parseConsulta, parseEnvio } from "./xml/parse-request.js";
export { createClient } from "./client.js";

export type * from "./types.js";
export type { Environment } from "./endpoints.js";
export type { ValidationCode, ValidationIssue, ValidationSeverity } from "./validate.js";
export type { Cabecera, ConsultaFiltro, EnvioRegistro } from "./xml/serialize.js";
export type {
  EstadoEfectivo,
  EstadoEnvio,
  EstadoRegistroDuplicado,
  EstadoRegistroSuministro,
  RegistroDuplicado,
  RespuestaLinea,
  RespuestaSuministro,
} from "./xml/parse-suministro.js";
export type {
  DatosPresentacionConsulta,
  EstadoRegistroConsulta,
  RegistroConsultado,
  RespuestaConsulta,
} from "./xml/parse-consulta.js";
export type { ClientOptions, VerifactuClient } from "./client.js";
