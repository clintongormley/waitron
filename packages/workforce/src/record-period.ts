import type { Period, TimeEntryRecord } from "./projection.js";
import type { TimeRecord } from "./record-types.js";
import { compareEvents, effectiveClockEntries } from "./effective-entries.js";
import { recordRoot } from "./record-projection.js";

export function entryDate(entry: TimeEntryRecord): string {
  return new Date(Date.parse(entry.eventAt) + entry.offsetMinutes * 60000)
    .toISOString()
    .slice(0, 10);
}

export function recordInPeriod(record: TimeRecord, period: Period): TimeRecord {
  const entries = record.entries.map((row) => row.entry);
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const sessions = record.sessions.filter(
    (s) => s.workDate >= period.start && s.workDate < period.end,
  );
  const roots = new Set(
    entries
      .filter((e) => entryDate(e) >= period.start && entryDate(e) < period.end)
      .map((e) => recordRoot(e, byId).entryId),
  );
  const sessionsBySubject = new Map<string, { sessions: typeof sessions; index: number }>();
  for (const session of sessions) {
    const key = JSON.stringify([session.personId, session.locationId]);
    const group = sessionsBySubject.get(key) ?? { sessions: [], index: 0 };
    group.sessions.push(session);
    sessionsBySubject.set(key, group);
  }
  for (const e of effectiveClockEntries(entries).sort(compareEvents)) {
    const group = sessionsBySubject.get(JSON.stringify([e.personId, e.locationId]));
    if (group === undefined) continue;
    while (group.index < group.sessions.length && e.eventAt > group.sessions[group.index]!.endedAt)
      group.index++;
    const session = group.sessions[group.index];
    if (session !== undefined && e.eventAt >= session.startedAt && e.eventAt <= session.endedAt)
      roots.add(recordRoot(e, byId).entryId);
  }
  return {
    ...record,
    sessions,
    entries: record.entries.filter((row) => roots.has(recordRoot(row.entry, byId).entryId)),
  };
}
