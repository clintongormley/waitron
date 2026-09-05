/**
 * The Spanish labour terms this module OWNS (module-system architecture §3; SP-3b spec §2–§3):
 * legitimate inside this package, forbidden in every generic package — in particular in
 * packages/workforce, the English generic package this Spain module sits over. Wired onto the
 * `workforce-es` descriptor's `vocabulary` seat by the composition root (`apps/server/src/modules.ts`)
 * and read only by the root english-only suite. Nothing at runtime consults it.
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
