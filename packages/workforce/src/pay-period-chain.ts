import { createHash } from "node:crypto";
import type { ChainVerification } from "./chain-hash.js";
import type { PayPeriodClosure, PayPeriodSnapshot, ProjectedRecordEntry } from "./record-types.js";
import type { WorkSession } from "./projection.js";

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalEntry(row: ProjectedRecordEntry) {
  const e = row.entry;
  const extension = e.extension;
  return {
    entry: {
      entryId: e.entryId,
      personId: e.personId,
      locationId: e.locationId,
      nodeId: e.nodeId,
      entryKind: e.entryKind,
      eventAt: e.eventAt,
      recordedAt: e.recordedAt,
      offsetMinutes: e.offsetMinutes,
      sequenceNo: e.sequenceNo,
      correctsEntryId: e.correctsEntryId ?? null,
      correctionStatus: e.correctionStatus ?? null,
      recordedByPersonId: e.recordedByPersonId ?? null,
      origin:
        e.origin === undefined ? null : { source: e.origin.source, deviceId: e.origin.deviceId },
      correctionReason: e.correctionReason ?? null,
      correctionActorId: e.correctionActorId ?? null,
      extension:
        extension === undefined || extension === null
          ? null
          : {
              selfApproved: extension.selfApproved ?? false,
              authorKind: extension.authorKind,
              direction: extension.direction,
              missingEntryKind: extension.missingEntryKind,
              respondsToEntryId: extension.respondsToEntryId,
              payPeriodClosureId: extension.payPeriodClosureId,
            },
    },
    author: { kind: row.author.kind, personId: row.author.personId },
    effective: row.effective,
    confirmed: row.confirmed,
    confirmedByWorker: row.confirmedByWorker,
    selfApproved: row.selfApproved,
    corrected: row.corrected,
    disputed: row.disputed,
    closedPeriodIds: [...row.closedPeriodIds].sort(compare),
  };
}

function canonicalSession(s: WorkSession): WorkSession {
  return {
    personId: s.personId,
    locationId: s.locationId,
    workDate: s.workDate,
    startedAt: s.startedAt,
    startOffsetMinutes: s.startOffsetMinutes,
    endedAt: s.endedAt,
    endOffsetMinutes: s.endOffsetMinutes,
    breakMinutes: s.breakMinutes,
    workedMinutes: s.workedMinutes,
  };
}

function canonicalSnapshot(snapshot: PayPeriodSnapshot) {
  const ids = snapshot.entries.map((row) => row.entry.entryId);
  if (
    new Set(ids).size !== ids.length ||
    new Set(snapshot.markedAutomaticEntryIds).size !== snapshot.markedAutomaticEntryIds.length
  ) {
    throw new Error("Duplicate pay-period snapshot entry ids");
  }
  return {
    sessions: snapshot.sessions
      .map(canonicalSession)
      .sort(
        (a, b) =>
          compare(a.personId, b.personId) ||
          compare(a.startedAt, b.startedAt) ||
          compare(a.locationId, b.locationId),
      ),
    entries: snapshot.entries
      .map(canonicalEntry)
      .sort(
        (a, b) =>
          compare(a.entry.recordedAt, b.entry.recordedAt) ||
          compare(a.entry.nodeId, b.entry.nodeId) ||
          a.entry.sequenceNo - b.entry.sequenceNo ||
          compare(a.entry.entryId, b.entry.entryId),
      ),
    summaries: snapshot.summaries
      .map(({ personId, summary }) => ({
        personId,
        summary:
          summary === null
            ? null
            : {
                workedMinutes: summary.workedMinutes,
                contractedMinutes: summary.contractedMinutes,
                dailyAccrualOvertimeMinutes: summary.dailyAccrualOvertimeMinutes,
                periodNetOvertimeMinutes: summary.periodNetOvertimeMinutes,
                overtimeMinutes: summary.overtimeMinutes,
                days: summary.days.map((d) => ({
                  workDate: d.workDate,
                  workedMinutes: d.workedMinutes,
                  contractedTargetMinutes: d.contractedTargetMinutes,
                  overtimeMinutes: d.overtimeMinutes,
                })),
              },
      }))
      .sort((a, b) => compare(a.personId, b.personId)),
    markedAutomaticEntryIds: [...snapshot.markedAutomaticEntryIds].sort(compare),
  };
}

export function computeClosureHash(row: Omit<PayPeriodClosure, "closureHash">): string {
  const bytes = JSON.stringify([
    row.id,
    row.nodeId,
    row.locationId,
    row.period.start,
    row.period.end,
    row.clock.timeZone,
    row.clock.dayCutover,
    row.clock.cutoverChanges.map((c) => ({
      effectiveBusinessDay: c.effectiveBusinessDay,
      dayCutover: c.dayCutover,
    })),
    row.scheduledCloseAt,
    row.closedAt,
    canonicalSnapshot(row.snapshot),
    row.sequenceNo,
    row.prevClosureHash,
  ]);
  return createHash("sha256").update(bytes, "utf8").digest("hex").toUpperCase();
}

export function verifyPayPeriodClosures(rows: readonly PayPeriodClosure[]): ChainVerification {
  const ordered = [...rows].sort((a, b) => a.sequenceNo - b.sequenceNo);
  let previous: PayPeriodClosure | undefined;
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i]!;
    if (row.sequenceNo !== i + 1) return { ok: false, reason: "sequence", sequenceNo: i + 1 };
    if (i === 0 && row.prevClosureHash !== null)
      return { ok: false, reason: "genesis", sequenceNo: 1 };
    if (
      previous !== undefined &&
      (row.prevClosureHash !== previous.closureHash ||
        row.nodeId !== previous.nodeId ||
        row.locationId !== previous.locationId)
    ) {
      return { ok: false, reason: "broken_link", sequenceNo: row.sequenceNo };
    }
    let expected: string;
    try {
      expected = computeClosureHash(row);
    } catch {
      return { ok: false, reason: "hash_mismatch", sequenceNo: row.sequenceNo };
    }
    if (expected !== row.closureHash)
      return { ok: false, reason: "hash_mismatch", sequenceNo: row.sequenceNo };
    previous = row;
  }
  return { ok: true };
}
