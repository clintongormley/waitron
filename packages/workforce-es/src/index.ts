// The public surface of @waitron/workforce-es — the Spain module for the registro de jornada.
// Re-exports only. Slice 3 owns the export rendering; convenio tables, ruleset numbers and payroll
// adapters are D2/D3.
export { ANOS_CONSERVACION, TITULARES_ACCESO, exportTimeRecord } from "./registro-jornada.js";
export type { LineaJornada, RegistroDeJornada, TitularAcceso } from "./registro-jornada.js";
