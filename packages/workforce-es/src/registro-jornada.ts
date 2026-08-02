import type { Period, WorkSession } from "@waitron/workforce";

/**
 * The registro de jornada — the Spanish rendering of the regime-neutral work-session projection
 * (ET art. 34.9, RD-ley 8/2019). `packages/workforce` computes the immutable clock stream and its
 * projection in English; this package, EXEMPT from the English-only guard, renders that projection
 * into the legal record's own vocabulary and framing.
 *
 * Slice 3 owns no tables: `exportTimeRecord` is a pure render over `WorkSession[]` (already
 * reprojected, so approved corrections are reflected). The convenio tables, ruleset numbers and
 * payroll adapters are D2/D3.
 */

/**
 * The three titulares con derecho de acceso al registro (art. 34.9): la persona trabajadora, sus
 * representantes legales y la Inspección de Trabajo y Seguridad Social. Every registro must be
 * available to all three, so it is a property of the record, not a parameter of the export.
 */
export type TitularAcceso = "trabajador" | "representantes_legales" | "inspeccion_trabajo";

export const TITULARES_ACCESO = [
  "trabajador",
  "representantes_legales",
  "inspeccion_trabajo",
] as const satisfies readonly TitularAcceso[];

/** Años de conservación del registro (art. 34.9: "durante cuatro años"). */
export const ANOS_CONSERVACION = 4;

/** Una línea del registro: el inicio y fin de la jornada de una persona trabajadora en un día. */
export interface LineaJornada {
  personId: string;
  /** El día natural local de la persona trabajadora (art. 34.9 es por trabajador y por día). */
  fecha: string;
  horaInicio: string;
  horaFin: string;
  minutosTrabajados: number;
  minutosDescanso: number;
}

/** El registro de jornada de un periodo, listo para entregar a cualquiera de los tres titulares. */
export interface RegistroDeJornada {
  periodo: Period;
  /** Fecha hasta la que debe conservarse el registro: fin del periodo + ANOS_CONSERVACION años. */
  conservarHasta: string;
  titularesAcceso: readonly TitularAcceso[];
  lineas: LineaJornada[];
}

/** Suma `anos` al año de una fecha `YYYY-MM-DD`, dejando mes y día intactos. */
function sumarAnos(fecha: string, anos: number): string {
  const [ano, resto] = [fecha.slice(0, 4), fecha.slice(4)];
  return `${Number(ano) + anos}${resto}`;
}

/**
 * Renders the registro de jornada for a period from the reprojected work sessions.
 *
 * Filters to the half-open `[start, end)` window and orders by person then day, so the same input
 * always renders the same registro. `conservarHasta` states the art. 34.9 four-year retention floor
 * as a concrete date (period end + four years); there is no deletion path — retention is the default
 * of the append-only stream this projects.
 */
export function exportTimeRecord(
  sessions: readonly WorkSession[],
  periodo: Period,
): RegistroDeJornada {
  const lineas = sessions
    .filter((s) => s.workDate >= periodo.start && s.workDate < periodo.end)
    .sort((a, b) =>
      a.personId === b.personId
        ? a.workDate.localeCompare(b.workDate)
        : a.personId.localeCompare(b.personId),
    )
    .map((s) => ({
      personId: s.personId,
      fecha: s.workDate,
      horaInicio: s.startedAt,
      horaFin: s.endedAt,
      minutosTrabajados: s.workedMinutes,
      minutosDescanso: s.breakMinutes,
    }));

  return {
    periodo,
    conservarHasta: sumarAnos(periodo.end, ANOS_CONSERVACION),
    titularesAcceso: TITULARES_ACCESO,
    lineas,
  };
}
