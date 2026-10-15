import { eq, inArray } from "drizzle-orm";
import { locations, type Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import type {
  RecordExportDocument,
  RecordExportInput,
  RecordExportSection,
  RecordExportValue,
} from "@waitron/shared";
import {
  WorkforceBackend,
  localWallClock,
  type TimeRecord,
  type WorkSession,
} from "@waitron/workforce";
import { exportTimeRecord, type EntradaJornada, type LineaJornada } from "./registro-jornada.js";

type Cells = Record<string, RecordExportValue>;
const LABELS: Record<string, readonly [string, string]> = {
  locationId: ["Workplace reference", "Referencia del centro"],
  locationName: ["Workplace", "Centro de trabajo"],
  periodStart: ["From", "Desde"],
  periodEnd: ["Before (excluded)", "Antes de (excluido)"],
  audience: ["Version", "Versión"],
  retainUntil: ["Keep until", "Conservar hasta"],
  accessHolder: ["Access holder", "Titular de acceso"],
  personId: ["Worker reference", "Referencia de la persona"],
  personName: ["Worker", "Persona trabajadora"],
  date: ["Day", "Día"],
  startedAtLocal: ["Start", "Inicio"],
  endedAtLocal: ["Finish", "Fin"],
  workedMinutes: ["Worked minutes", "Minutos trabajados"],
  breakMinutes: ["Break minutes", "Minutos de descanso"],
  startOffsetMinutes: ["Start UTC offset (minutes)", "Desfase UTC al inicio (minutos)"],
  endOffsetMinutes: ["Finish UTC offset (minutes)", "Desfase UTC al fin (minutos)"],
  entryId: ["Entry reference", "Referencia del asiento"],
  entryKind: ["Event", "Evento"],
  missingEntryKind: ["Missing event", "Evento faltante"],
  correctionDirection: ["Change requested by", "Cambio solicitado por"],
  correctionStatus: ["Decision", "Decisión"],
  eventAtLocal: ["Recorded event time", "Hora del evento registrado"],
  offsetMinutes: ["UTC offset (minutes)", "Desfase UTC (minutos)"],
  correctsEntryId: ["Corrects entry", "Corrige el asiento"],
  respondsToEntryId: ["Answers entry", "Responde al asiento"],
  effective: ["Counts now", "Cuenta ahora"],
  automatic: ["Automatic", "Automático"],
  unconfirmed: ["Unconfirmed", "Sin confirmar"],
  confirmedByWorker: ["Acknowledged by worker", "Confirmado por la persona"],
  selfApproved: ["Self-approved", "Autoaprobado"],
  corrected: ["Corrected", "Corregido"],
  disputed: ["Disputed", "Disputado"],
  authorKind: ["Author type", "Tipo de autor"],
  authorPersonId: ["Author reference", "Referencia del autor"],
  authorName: ["Author", "Autor"],
  recordedAt: ["Written at (UTC)", "Registrado en (UTC)"],
  nodeId: ["Node reference", "Referencia del nodo"],
  sequenceNo: ["Chain position", "Posición en la cadena"],
  reason: ["Reason", "Motivo"],
  closureId: ["Closed-period reference", "Referencia del cierre"],
  closedAt: ["Closed at", "Cerrado en"],
  closureHash: ["Closure hash", "Huella del cierre"],
  summaryAvailable: ["Summary available", "Resumen disponible"],
  contractedMinutes: ["Contracted minutes", "Minutos contratados"],
  dailyAccrualOvertimeMinutes: ["Daily overtime minutes", "Minutos extra por día"],
  periodNetOvertimeMinutes: ["Net period overtime minutes", "Minutos extra netos del período"],
  overtimeMinutes: ["Headline overtime minutes", "Minutos extra de referencia"],
  contractedTargetMinutes: ["Daily target minutes", "Minutos previstos del día"],
  beforeWorkedMinutes: ["Frozen worked minutes", "Minutos trabajados al cierre"],
  afterWorkedMinutes: ["Current worked minutes", "Minutos trabajados actuales"],
  deltaWorkedMinutes: ["Change in worked minutes", "Cambio en minutos trabajados"],
};
const SESSION_KEYS = [
  "personId",
  "personName",
  "date",
  "startedAtLocal",
  "endedAtLocal",
  "workedMinutes",
  "breakMinutes",
  "startOffsetMinutes",
  "endOffsetMinutes",
];
const ENTRY_KEYS = [
  "entryId",
  "personId",
  "personName",
  "locationId",
  "entryKind",
  "missingEntryKind",
  "correctionDirection",
  "correctionStatus",
  "eventAtLocal",
  "offsetMinutes",
  "correctsEntryId",
  "respondsToEntryId",
  "effective",
  "automatic",
  "unconfirmed",
  "confirmedByWorker",
  "selfApproved",
  "corrected",
  "disputed",
  "authorKind",
  "authorPersonId",
  "authorName",
  "recordedAt",
  "nodeId",
  "sequenceNo",
];
const SUMMARY_KEYS = [
  "personId",
  "personName",
  "summaryAvailable",
  "workedMinutes",
  "contractedMinutes",
  "dailyAccrualOvertimeMinutes",
  "periodNetOvertimeMinutes",
  "overtimeMinutes",
];
const TITLES: Record<string, readonly [string, string]> = {
  metadata: ["Record details", "Datos del registro"],
  sessions: ["Completed work", "Trabajo completado"],
  history: ["Entry and decision history", "Historial de asientos y decisiones"],
  totals: ["Completed total", "Total completado"],
  closures: ["Closed periods", "Períodos cerrados"],
  "entry-closures": ["Entries linked to closed periods", "Asientos vinculados a cierres"],
  "frozen-sessions": ["Work recorded at closure", "Trabajo registrado al cierre"],
  "frozen-history": ["History recorded at closure", "Historial registrado al cierre"],
  "frozen-summaries": ["Summaries recorded at closure", "Resúmenes registrados al cierre"],
  "frozen-days": ["Daily totals recorded at closure", "Totales diarios registrados al cierre"],
  "automatic-marks": ["Automatic entries at closure", "Asientos automáticos al cierre"],
  impacts: ["Changes after closure", "Cambios posteriores al cierre"],
};
export async function prepareTimeRecordExport(
  tx: Transaction,
  input: RecordExportInput,
): Promise<() => Promise<RecordExportDocument>> {
  const selected: RecordExportInput = {
    locationId: input.locationId,
    personId: input.personId,
    period: { start: input.period.start, end: input.period.end },
    audience: input.audience,
    locale: input.locale,
  };
  const record = await new WorkforceBackend().timeRecord(tx, {
    locationId: selected.locationId,
    personId: selected.personId,
    period: selected.period,
  });
  const ids = new Set<string>();
  const collect = (value: Pick<TimeRecord, "sessions" | "entries">) => {
    for (const session of value.sessions) ids.add(session.personId);
    for (const row of value.entries) {
      ids.add(row.entry.personId);
      if (row.author.personId !== null) ids.add(row.author.personId);
    }
  };
  collect(record);
  for (const closure of record.closures) {
    collect(closure.snapshot);
    for (const summary of closure.snapshot.summaries) ids.add(summary.personId);
  }
  const names =
    ids.size === 0
      ? []
      : await tx
          .select({ id: persons.id, name: persons.displayName })
          .from(persons)
          .where(inArray(persons.id, [...ids]));
  const people = new Map(names.map((p) => [p.id, p.name]));
  const [location] = await tx
    .select({ name: locations.name })
    .from(locations)
    .where(eq(locations.id, selected.locationId));
  const locationName = location?.name ?? selected.locationId;
  return async () => formatTimeRecordExport(record, selected, people, locationName);
}
export const WORKFORCE_ES_RECORD_EXPORT = { prepare: prepareTimeRecordExport };

export function formatTimeRecordExport(
  record: TimeRecord,
  input: RecordExportInput,
  people: ReadonlyMap<string, string>,
  locationName: string,
): RecordExportDocument {
  const language = input.locale === "es" ? 1 : 0;
  const name = (id: string) =>
    people.get(id) ?? ["Unknown person", "Persona desconocida"][language]!;
  const reasonKeys = input.audience === "standard" ? ["reason"] : [];
  const section = (
    key: string,
    keys: string[],
    data: Cells[],
    layout: "table" | "details" = "table",
  ): RecordExportSection => ({
    key,
    title: TITLES[key]![language],
    layout,
    columns: keys.map((key) => ({ key, label: LABELS[key]![language] })),
    rows: data.map((cells, index) => ({ key: `${key}:${index}`, cells })),
  });
  const sessionRows = (value: TimeRecord, lines: LineaJornada[]): Cells[] => {
    const sources = new Map<string, WorkSession[]>();
    const key = (person: string, date: string, start: string, end: string) =>
      JSON.stringify([person, date, start, end]);
    for (const s of value.sessions) {
      const k = key(
        s.personId,
        s.workDate,
        localWallClock(s.startedAt, s.startOffsetMinutes),
        localWallClock(s.endedAt, s.endOffsetMinutes),
      );
      const list = sources.get(k) ?? [];
      list.push(s);
      sources.set(k, list);
    }
    return lines.map((line) => {
      const s = sources
        .get(key(line.personId, line.fecha, line.horaInicio, line.horaFin))!
        .shift()!;
      return {
        personId: line.personId,
        personName: name(line.personId),
        date: line.fecha,
        startedAtLocal: line.horaInicio,
        endedAtLocal: line.horaFin,
        workedMinutes: line.minutosTrabajados,
        breakMinutes: line.minutosDescanso,
        startOffsetMinutes: s.startOffsetMinutes,
        endOffsetMinutes: s.endOffsetMinutes,
      };
    });
  };
  const historyRows = (value: TimeRecord, entries: EntradaJornada[]): Cells[] => {
    const originals = new Map(value.entries.map((row) => [row.entry.entryId, row.entry]));
    return entries.map((e) => {
      const source = originals.get(e.entryId)!;
      const cells: Cells = {
        entryId: e.entryId,
        personId: e.personId,
        personName: name(e.personId),
        locationId: e.locationId,
        entryKind: e.tipo,
        missingEntryKind: e.tipoEntradaFaltante,
        correctionDirection: e.direccionCorreccion,
        correctionStatus: e.estadoCorreccion,
        eventAtLocal: e.instante,
        offsetMinutes: e.offsetMinutes,
        correctsEntryId: e.corrigeEntradaId,
        respondsToEntryId: e.respondeEntradaId,
        effective: e.efectiva,
        automatic: e.automatica,
        unconfirmed: e.sinConfirmar,
        confirmedByWorker: e.confirmadaPorTrabajador,
        selfApproved: e.autoaprobada,
        corrected: e.corregida,
        disputed: e.disputada,
        authorKind: e.autor.kind,
        authorPersonId: e.autor.personId,
        authorName: e.autor.personId === null ? null : name(e.autor.personId),
        recordedAt: source.recordedAt,
        nodeId: source.nodeId,
        sequenceNo: source.sequenceNo,
      };
      if (input.audience === "standard") cells.reason = e.motivo;
      return cells;
    });
  };
  const exported = exportTimeRecord(record, input.period);
  const sessions = sessionRows(record, exported.lineas);
  const frozenSessions: Cells[] = [],
    frozenHistory: Cells[] = [],
    summaries: Cells[] = [],
    days: Cells[] = [],
    marks: Cells[] = [];
  for (const closure of exported.cierres!) {
    const frozen: TimeRecord = {
      sessions: closure.snapshot.sessions,
      entries: closure.snapshot.entries,
      closures: [],
      closedPeriodImpacts: [],
    };
    const saved = exportTimeRecord(frozen, closure.period);
    // The saved period, not the requested slice, describes the closure's frozen rows.
    const savedSessions = sessionRows(frozen, saved.lineas);
    frozenSessions.push(
      ...savedSessions.map((cells) => ({ closureId: closure.closureId, ...cells })),
    );
    frozenHistory.push(
      ...historyRows(frozen, saved.entradas!).map((cells) => ({
        closureId: closure.closureId,
        ...cells,
      })),
    );
    for (const item of closure.snapshot.summaries) {
      const s = item.summary;
      summaries.push({
        closureId: closure.closureId,
        personId: item.personId,
        personName: name(item.personId),
        summaryAvailable: s !== null,
        workedMinutes: s?.workedMinutes ?? null,
        contractedMinutes: s?.contractedMinutes ?? null,
        dailyAccrualOvertimeMinutes: s?.dailyAccrualOvertimeMinutes ?? null,
        periodNetOvertimeMinutes: s?.periodNetOvertimeMinutes ?? null,
        overtimeMinutes: s?.overtimeMinutes ?? null,
      });
      for (const d of s?.days ?? [])
        days.push({
          closureId: closure.closureId,
          personId: item.personId,
          personName: name(item.personId),
          date: d.workDate,
          workedMinutes: d.workedMinutes,
          contractedTargetMinutes: d.contractedTargetMinutes,
          overtimeMinutes: d.overtimeMinutes,
        });
    }
    for (const entryId of closure.snapshot.markedAutomaticEntryIds)
      marks.push({ closureId: closure.closureId, entryId });
  }
  const sections = [
    section(
      "metadata",
      [
        "locationId",
        "locationName",
        "periodStart",
        "periodEnd",
        "audience",
        "retainUntil",
        "accessHolder",
      ],
      exported.titularesAcceso.map((accessHolder) => ({
        locationId: input.locationId,
        locationName,
        periodStart: input.period.start,
        periodEnd: input.period.end,
        audience: input.audience,
        retainUntil: exported.conservarHasta,
        accessHolder,
      })),
      "details",
    ),
    section(
      "totals",
      ["workedMinutes"],
      [{ workedMinutes: exported.lineas.reduce((sum, line) => sum + line.minutosTrabajados, 0) }],
    ),
    section("sessions", SESSION_KEYS, sessions),
    section(
      "history",
      [...ENTRY_KEYS, ...reasonKeys],
      historyRows(record, exported.entradas!),
      "details",
    ),
    section(
      "closures",
      ["closureId", "locationId", "periodStart", "periodEnd", "closedAt", "closureHash"],
      exported.cierres!.map((c) => ({
        closureId: c.closureId,
        locationId: c.locationId,
        periodStart: c.period.start,
        periodEnd: c.period.end,
        closedAt: c.closedAt,
        closureHash: c.closureHash,
      })),
      "details",
    ),
    section(
      "entry-closures",
      ["entryId", "closureId"],
      exported.entradas!.flatMap((e) =>
        e.periodosCerrados.map((closureId) => ({ entryId: e.entryId, closureId })),
      ),
    ),
    section("frozen-sessions", ["closureId", ...SESSION_KEYS], frozenSessions),
    section(
      "frozen-history",
      ["closureId", ...ENTRY_KEYS, ...reasonKeys],
      frozenHistory,
      "details",
    ),
    section("frozen-summaries", ["closureId", ...SUMMARY_KEYS], summaries, "details"),
    section(
      "frozen-days",
      [
        "closureId",
        "personId",
        "personName",
        "date",
        "workedMinutes",
        "contractedTargetMinutes",
        "overtimeMinutes",
      ],
      days,
    ),
    section("automatic-marks", ["closureId", "entryId"], marks),
    section(
      "impacts",
      ["closureId", "personId", "beforeWorkedMinutes", "afterWorkedMinutes", "deltaWorkedMinutes"],
      exported.cambiosPeriodosCerrados!.map((i) => ({
        closureId: i.closureId,
        personId: i.personId,
        beforeWorkedMinutes: i.beforeWorkedMinutes,
        afterWorkedMinutes: i.afterWorkedMinutes,
        deltaWorkedMinutes: i.deltaWorkedMinutes,
      })),
    ),
  ];
  return {
    title: ["Working-time record", "Registro de jornada"][language]!,
    locale: input.locale,
    audience: input.audience,
    period: { start: input.period.start, end: input.period.end },
    notes: [
      [
        "From is included; Before is excluded. Names are current display names.",
        "Desde está incluido; Antes de está excluido. Los nombres son los actuales.",
      ][language]!,
      [
        "Automatic finishes count immediately. Worker acknowledgment is separate.",
        "Los fines automáticos cuentan de inmediato. La confirmación de la persona se muestra por separado.",
      ][language]!,
      ...(input.audience === "representatives"
        ? [
            [
              "This version omits free-form reasons and contact details. Names and record references remain.",
              "Esta versión omite motivos de texto libre y datos de contacto. Conserva nombres y referencias del registro.",
            ][language]!,
          ]
        : []),
    ],
    sections,
  };
}
