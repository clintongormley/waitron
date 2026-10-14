import {
  localWallClock,
  type Period,
  type WorkSession,
  type TimeRecord,
  type EntryAuthor,
  type WorkforceEntryKind,
  type ClockEntryKind,
  type CorrectionStatus,
  type PayPeriodClosureView,
  type ClosedPeriodImpact,
} from "@waitron/workforce";

/**
 * The registro de jornada — the Spanish rendering of the regime-neutral work-session projection
 * (ET art. 34.9, RD-ley 8/2019). `packages/workforce` computes the immutable clock stream and its
 * projection in English; this package, EXEMPT from the English-only guard, renders that projection
 * into the legal record's own vocabulary and framing.
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
  entradas?: EntradaJornada[];
  cierres?: PayPeriodClosureView[];
  cambiosPeriodosCerrados?: ClosedPeriodImpact[];
}

export interface EntradaJornada {
  entryId: string;
  personId: string;
  locationId: string;
  tipo: WorkforceEntryKind;
  tipoEntradaFaltante: ClockEntryKind | null;
  direccionCorreccion: "worker_request" | "manager_proposal" | null;
  estadoCorreccion: CorrectionStatus | null;
  instante: string;
  offsetMinutes: number;
  autor: EntryAuthor;
  motivo: string | null;
  corrigeEntradaId: string | null;
  respondeEntradaId: string | null;
  efectiva: boolean;
  automatica: boolean;
  sinConfirmar: boolean;
  confirmadaPorTrabajador: boolean;
  autoaprobada: boolean;
  corregida: boolean;
  disputada: boolean;
  periodosCerrados: string[];
}

function historyForPeriod(record: TimeRecord, periodo: Period): EntradaJornada[] {
  const byId = new Map(record.entries.map((row) => [row.entry.entryId, row]));
  const neighbours = new Map<string, string[]>();
  for (const { entry: e } of record.entries)
    for (const targetId of [e.correctsEntryId, e.extension?.respondsToEntryId]) {
      const target = targetId ? byId.get(targetId)?.entry : undefined;
      if (
        target === undefined ||
        target.personId !== e.personId ||
        target.locationId !== e.locationId
      )
        continue;
      neighbours.set(e.entryId, [...(neighbours.get(e.entryId) ?? []), target.entryId]);
      neighbours.set(target.entryId, [...(neighbours.get(target.entryId) ?? []), e.entryId]);
    }
  const sessions = record.sessions.filter(
    (s) => s.workDate >= periodo.start && s.workDate < periodo.end,
  );
  const selected = new Set<string>();
  const pending = record.entries
    .filter(({ entry: e }) => {
      const date = localWallClock(e.eventAt, e.offsetMinutes).slice(0, 10);
      return (
        (date >= periodo.start && date < periodo.end) ||
        sessions.some(
          (s) =>
            s.personId === e.personId &&
            s.locationId === e.locationId &&
            e.eventAt >= s.startedAt &&
            e.eventAt <= s.endedAt,
        )
      );
    })
    .map((row) => row.entry.entryId);
  while (pending.length) {
    const id = pending.pop()!;
    if (selected.has(id)) continue;
    selected.add(id);
    pending.push(...(neighbours.get(id) ?? []));
  }
  return record.entries
    .filter((row) => selected.has(row.entry.entryId))
    .sort(
      (a, b) =>
        a.entry.recordedAt.localeCompare(b.entry.recordedAt) ||
        a.entry.nodeId.localeCompare(b.entry.nodeId) ||
        a.entry.sequenceNo - b.entry.sequenceNo ||
        a.entry.entryId.localeCompare(b.entry.entryId),
    )
    .map((row) => {
      const e = row.entry;
      return {
        entryId: e.entryId,
        personId: e.personId,
        locationId: e.locationId,
        tipo: e.entryKind,
        tipoEntradaFaltante: e.extension?.missingEntryKind ?? null,
        direccionCorreccion: e.extension?.direction ?? null,
        estadoCorreccion: e.correctionStatus ?? null,
        instante: localWallClock(e.eventAt, e.offsetMinutes),
        offsetMinutes: e.offsetMinutes,
        autor: row.author,
        motivo: e.correctionReason ?? null,
        corrigeEntradaId: e.correctsEntryId ?? null,
        respondeEntradaId: e.extension?.respondsToEntryId ?? null,
        efectiva: row.effective,
        automatica: row.author.kind === "automatic",
        sinConfirmar: !row.confirmed,
        confirmadaPorTrabajador: row.confirmedByWorker,
        autoaprobada: row.selfApproved,
        corregida: row.corrected,
        disputada: row.disputed,
        periodosCerrados: [...row.closedPeriodIds],
      };
    });
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
): RegistroDeJornada;
export function exportTimeRecord(record: TimeRecord, periodo: Period): RegistroDeJornada;
export function exportTimeRecord(
  input: readonly WorkSession[] | TimeRecord,
  periodo: Period,
): RegistroDeJornada {
  const record = Array.isArray(input) ? undefined : (input as TimeRecord);
  const sessions = record === undefined ? (input as readonly WorkSession[]) : record.sessions;
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
      // El horario CONCRETO local (art. 34.9), no el instante UTC: cada extremo se renderiza con su
      // propio offset, así una jornada que cruza el cambio de hora conserva el offset de cada extremo
      // y nunca queda un horaInicio en el día natural anterior a `fecha`. minutosTrabajados sigue
      // derivándose de los instantes UTC (verdadero tiempo transcurrido, inmune al DST).
      horaInicio: localWallClock(s.startedAt, s.startOffsetMinutes),
      horaFin: localWallClock(s.endedAt, s.endOffsetMinutes),
      minutosTrabajados: s.workedMinutes,
      minutosDescanso: s.breakMinutes,
    }));

  const result: RegistroDeJornada = {
    periodo,
    conservarHasta: sumarAnos(periodo.end, ANOS_CONSERVACION),
    titularesAcceso: TITULARES_ACCESO,
    lineas,
  };
  if (record !== undefined) {
    result.entradas = historyForPeriod(record, periodo);
    result.cierres = record.closures.filter(
      (c) => c.period.start < periodo.end && c.period.end > periodo.start,
    );
    const closureIds = new Set(result.cierres.map((c) => c.closureId));
    result.cambiosPeriodosCerrados = record.closedPeriodImpacts.filter((i) =>
      closureIds.has(i.closureId),
    );
  }
  return result;
}
