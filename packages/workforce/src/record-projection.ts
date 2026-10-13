import { AppError } from "@waitron/shared";
import { projectWorkSessions, type TimeEntryRecord } from "./projection.js";
import {
  compareRecording,
  effectiveClockEntries,
  uncountedAutomaticEntryIds,
  sameSubject,
} from "./effective-entries.js";
import type { EntryAuthor, TimeRecord } from "./record-types.js";
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
export function projectTimeRecord(entries: readonly TimeEntryRecord[]): TimeRecord {
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
  return {
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
}
