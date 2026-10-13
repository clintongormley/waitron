import { AppError } from "@waitron/shared";
import { projectWorkSessions, type TimeEntryRecord } from "./projection.js";
import {
  compareRecording,
  effectiveClockEntries,
  uncountedAutomaticEntryIds,
  sameSubject,
} from "./effective-entries.js";
import type { EntryAuthor, TimeRecord, PayPeriodClosure } from "./record-types.js";
import { recordInPeriod } from "./record-period.js";
import "./errors.js";

export function recordRoot(
  entry: TimeEntryRecord,
  byId: ReadonlyMap<string, TimeEntryRecord>,
): TimeEntryRecord {
  let current = entry;
  const visited = new Set([entry.entryId]);
  for (
    let id = current.correctsEntryId ?? current.extension?.respondsToEntryId;
    id;
    id = current.correctsEntryId ?? current.extension?.respondsToEntryId
  ) {
    const target = byId.get(id);
    if (target === undefined || visited.has(target.entryId) || !sameSubject(current, target)) break;
    current = target;
    visited.add(current.entryId);
  }
  return current;
}
function authorFor(entry: TimeEntryRecord): EntryAuthor {
  const kind = entry.extension?.authorKind;
  if (kind === "automatic" && entry.recordedByPersonId === null) return { kind, personId: null };
  if ((kind === "worker" || kind === "manager") && typeof entry.recordedByPersonId === "string")
    return { kind, personId: entry.recordedByPersonId };
  throw new AppError("attendance.invalid", { reason: "incomplete_attribution" });
}
export function projectTimeRecord(
  entries: readonly TimeEntryRecord[],
  closures: readonly PayPeriodClosure[] = [],
): TimeRecord {
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const groups = new Map<string, TimeEntryRecord[]>();
  for (const entry of entries) {
    const root = recordRoot(entry, byId).entryId;
    const rows = groups.get(root) ?? [];
    rows.push(entry);
    groups.set(root, rows);
  }
  const effectiveIds = new Set(effectiveClockEntries(entries).map((e) => e.entryId));
  const uncounted = uncountedAutomaticEntryIds(entries);
  const record: TimeRecord = {
    sessions: projectWorkSessions(entries).sort(
      (a, b) =>
        a.personId.localeCompare(b.personId) ||
        a.startedAt.localeCompare(b.startedAt) ||
        a.locationId.localeCompare(b.locationId),
    ),
    entries: [...entries].sort(compareRecording).map((entry) => {
      const group = groups.get(recordRoot(entry, byId).entryId)!;
      const corrected = group.some(
        (e) => e.entryKind === "correction" && e.correctionStatus === "approved",
      );
      return {
        entry,
        author: authorFor(entry),
        effective: effectiveIds.has(entry.entryId) && !uncounted.has(entry.entryId),
        confirmed:
          entry.extension?.authorKind !== "automatic" ||
          corrected ||
          group.some((e) => e.entryKind === "confirmation" && e.extension?.authorKind === "worker"),
        corrected,
        disputed: group.some((e) => e.correctionStatus === "disputed"),
        closedPeriodIds: [],
      };
    }),
    closures: [],
    closedPeriodImpacts: [],
  };
  for (const closure of [...closures].sort(
    (a, b) =>
      a.period.start.localeCompare(b.period.start) ||
      a.locationId.localeCompare(b.locationId) ||
      a.id.localeCompare(b.id),
  )) {
    record.closures.push({
      closureId: closure.id,
      locationId: closure.locationId,
      period: closure.period,
      closedAt: closure.closedAt,
      closureHash: closure.closureHash,
      snapshot: structuredClone(closure.snapshot),
    });
    const current = recordInPeriod(
      {
        ...record,
        sessions: record.sessions.filter((s) => s.locationId === closure.locationId),
        entries: record.entries.filter((e) => e.entry.locationId === closure.locationId),
      },
      closure.period,
    );
    const frozenEntries = closure.snapshot.entries;
    const frozenById = new Map(frozenEntries.map((e) => [e.entry.entryId, e.entry]));
    const roots = new Set([
      ...current.entries.map((e) => recordRoot(e.entry, byId).entryId),
      ...frozenEntries.map((e) => recordRoot(e.entry, frozenById).entryId),
    ]);
    for (const row of record.entries)
      if (
        row.entry.locationId === closure.locationId &&
        roots.has(recordRoot(row.entry, byId).entryId)
      )
        row.closedPeriodIds.push(closure.id);
    const people = new Set([
      ...closure.snapshot.sessions.map((s) => s.personId),
      ...frozenEntries.map((e) => e.entry.personId),
      ...current.entries.map((e) => e.entry.personId),
    ]);
    for (const personId of [...people].sort()) {
      const oldSessions = closure.snapshot.sessions.filter((s) => s.personId === personId);
      const newSessions = current.sessions.filter((s) => s.personId === personId);
      const history = (rows: typeof current.entries) =>
        rows
          .filter(
            (e) =>
              e.entry.personId === personId && e.entry.extension?.payPeriodClosureId !== closure.id,
          )
          .map((e) => [
            e.entry.entryId,
            e.entry.eventAt,
            e.entry.correctionStatus ?? null,
            e.effective,
            e.confirmed,
            e.corrected,
            e.disputed,
          ]);
      if (
        JSON.stringify([oldSessions, history(frozenEntries)]) ===
        JSON.stringify([newSessions, history(current.entries)])
      )
        continue;
      const beforeWorkedMinutes = oldSessions.reduce((sum, s) => sum + s.workedMinutes, 0),
        afterWorkedMinutes = newSessions.reduce((sum, s) => sum + s.workedMinutes, 0);
      record.closedPeriodImpacts.push({
        closureId: closure.id,
        personId,
        beforeWorkedMinutes,
        afterWorkedMinutes,
        deltaWorkedMinutes: afterWorkedMinutes - beforeWorkedMinutes,
      });
    }
  }
  return record;
}
