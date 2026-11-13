// Browser-safe: the Fiscal filing screen reaches this file, so it imports nothing
// (`scripts/dashboard-browser-purity.test.ts`).

/** The states `envios_estado_ck` admits. */
export const ENVIO_STATES = [
  "pendiente",
  "enviando",
  "aceptado",
  "aceptado_con_errores",
  "rechazado",
  "detenido",
  "retenido",
] as const;
export type EnvioState = (typeof ENVIO_STATES)[number];

/**
 * The cause of a case, written as an incident code. Closed here, not in the table: a fixed list in
 * a CHECK would make each new cause a table rebuild, which fails once events point at the cases.
 */
export type FilingCaseCause =
  | "fiscal.registro_rechazado"
  | "fiscal.huella_divergente"
  | "fiscal.duplicado_anulado"
  | "fiscal.aceptado_con_errores"
  | "fiscal.anulacion_retenida";
