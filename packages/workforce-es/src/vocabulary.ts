/**
 * The Spanish labour terms this module OWNS: legitimate inside this package, forbidden in every
 * generic package. Interpreted only by the root english-only suite; nothing at runtime consults it.
 *
 * Tokens, not words — the guard's tokeniser contract (`packages/db/src/english-only.ts`): lowercase
 * ASCII, unaccented, singular and plural listed separately, nothing stemmed. Terms this package also
 * uses but does not own (`registro`, `hora`, `fecha`, `periodo` — fiscal's; `linea`/`lineas` — the
 * guard's base list) are deliberately not repeated here: a declaration adds a word to the forbidden
 * set, and those are forbidden already.
 */
export const WORKFORCE_ES_VOCABULARY: readonly string[] = [
  "jornada",
  "jornadas",
  "empleado",
  "empleados",
  "trabajador",
  "trabajadores",
  "trabajo",
  "fichaje",
  "fichajes",
  "presencia",
  "descanso",
  "descansos",
  "ausencia",
  "ausencias",
  "turno",
  "turnos",
  "horario",
  "horarios",
  "nocturnidad",
  "festivo",
  "festivos",
  "vacaciones",
  "permiso",
  "permisos",
  "baja",
  "bajas",
  "finiquito",
  "contrato",
  "contratos",
  "salario",
  "salarios",
  "nomina",
  "nominas",
  "convenio",
  "convenios",
  "retribucion",
];
