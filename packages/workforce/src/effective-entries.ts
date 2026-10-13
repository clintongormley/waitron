import type { TimeEntryRecord } from "./projection.js";

export function compareRecording(a: TimeEntryRecord, b: TimeEntryRecord): number {
  return (
    a.recordedAt.localeCompare(b.recordedAt) ||
    a.nodeId.localeCompare(b.nodeId) ||
    a.sequenceNo - b.sequenceNo ||
    a.entryId.localeCompare(b.entryId)
  );
}
export function compareEvents(a: TimeEntryRecord, b: TimeEntryRecord): number {
  return Date.parse(a.eventAt) - Date.parse(b.eventAt) || compareRecording(a, b);
}
export function isClockEntry(entry: TimeEntryRecord): boolean {
  return ["in", "out", "break_start", "break_end"].includes(entry.entryKind);
}
export function sameSubject(a: TimeEntryRecord, b: TimeEntryRecord): boolean {
  return a.personId === b.personId && a.locationId === b.locationId;
}
export function originalEntry(
  entry: TimeEntryRecord,
  byId: ReadonlyMap<string, TimeEntryRecord>,
): TimeEntryRecord {
  let current = entry;
  const visited = new Set([entry.entryId]);
  while (current.correctsEntryId) {
    const previous = byId.get(current.correctsEntryId);
    if (previous === undefined || visited.has(previous.entryId) || !sameSubject(current, previous))
      break;
    current = previous;
    visited.add(current.entryId);
  }
  return current;
}
export function effectiveClockEntries(entries: readonly TimeEntryRecord[]): TimeEntryRecord[] {
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const approved = new Map<string, TimeEntryRecord>();
  for (const e of entries) {
    if (e.entryKind !== "correction" || e.correctionStatus !== "approved" || !e.correctsEntryId)
      continue;
    const target = byId.get(e.correctsEntryId);
    if (target === undefined || !sameSubject(e, target)) continue;
    const old = approved.get(e.correctsEntryId);
    if (old === undefined || compareRecording(e, old) > 0) approved.set(e.correctsEntryId, e);
  }
  const bases = entries.filter(
    (e) =>
      isClockEntry(e) ||
      (e.entryKind === "correction" &&
        e.correctionStatus === "approved" &&
        !e.correctsEntryId &&
        e.extension?.missingEntryKind),
  );
  return bases.map((base) => {
    let effective = base;
    const visited = new Set([base.entryId]);
    for (
      let next = approved.get(effective.entryId);
      next !== undefined && !visited.has(next.entryId);
      next = approved.get(effective.entryId)
    ) {
      effective = next;
      visited.add(next.entryId);
    }
    return { ...effective, entryKind: base.extension?.missingEntryKind ?? base.entryKind };
  });
}
export function liveClockEntries(entries: readonly TimeEntryRecord[]): TimeEntryRecord[] {
  return entries.flatMap((e) =>
    isClockEntry(e)
      ? [e]
      : e.entryKind === "correction" &&
          e.correctionStatus === "approved" &&
          !e.correctsEntryId &&
          e.extension?.missingEntryKind
        ? [{ ...e, entryKind: e.extension.missingEntryKind }]
        : [],
  );
}
export function uncountedAutomaticEntryIds(entries: readonly TimeEntryRecord[]): Set<string> {
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const confirmations = new Set(
    entries
      .filter((e) => e.entryKind === "confirmation")
      .flatMap((e) => {
        const target = byId.get(e.extension?.respondsToEntryId ?? "");
        return target !== undefined && sameSubject(e, target) ? [target.entryId] : [];
      }),
  );
  return new Set(
    effectiveClockEntries(entries)
      .filter(
        (e) =>
          e.entryKind === "out" &&
          e.extension?.authorKind === "automatic" &&
          !confirmations.has(e.entryId),
      )
      .map((e) => e.entryId),
  );
}
