import { businessDayBounds } from "@waitron/shared";

export interface BackupAuditRun<T> {
  periodFrom: string;
  periodTo: string;
  generation: number;
  summary: { backupMatches?: T[]; backupUnmatched?: T[] } | null;
}

export function backupAuditDay<T extends { settledAt: string }>(
  day: string,
  timeZone: string,
  runs: readonly BackupAuditRun<T>[],
) {
  const { startAt, endAt } = businessDayBounds(
    { timeZone, dayCutover: "00:00", cutoverChanges: [] },
    day,
  );
  const backupMatches: T[] = [];
  const backupUnmatched: T[] = [];
  const inside = (row: T) => row.settledAt >= startAt && row.settledAt < endAt;
  let coveredTo = startAt;
  let complete = true;
  for (const run of latestAuditRuns({ startAt, endAt }, runs)) {
    if (run.periodFrom > coveredTo) complete = false;
    if (run.summary?.backupMatches === undefined || run.summary.backupUnmatched === undefined) {
      complete = false;
      continue;
    }
    backupMatches.push(...run.summary.backupMatches.filter(inside));
    backupUnmatched.push(...run.summary.backupUnmatched.filter(inside));
    if (run.periodTo > coveredTo) coveredTo = run.periodTo;
  }
  return {
    day,
    timeZone,
    complete: complete && coveredTo >= endAt,
    backupMatches,
    backupUnmatched,
  };
}

type DayBounds = { startAt: string; endAt: string };
type AuditPeriod = { periodFrom: string; periodTo: string; generation: number };
type PairedSummary = {
  chargeAudit?: unknown;
  unlinkedCharges?: number;
  missingLocal?: { workingOrderId: string | null }[];
};

function latestAuditRuns<T extends AuditPeriod>({ startAt, endAt }: DayBounds, runs: readonly T[]) {
  const latest = new Map<string, T>();
  for (const run of runs) {
    if (run.periodFrom >= endAt || run.periodTo <= startAt) continue;
    const prior = latest.get(run.periodFrom);
    if (prior === undefined || run.generation > prior.generation) latest.set(run.periodFrom, run);
  }
  return [...latest.values()].sort((a, b) => a.periodFrom.localeCompare(b.periodFrom));
}

export function pairedAuditRuns<T extends AuditPeriod & { summary: PairedSummary | null }>(
  bounds: DayBounds,
  candidates: readonly T[],
) {
  const runs = latestAuditRuns(bounds, candidates);
  let coveredTo = bounds.startAt;
  let complete = true;
  for (const run of runs) {
    const summary = run.summary;
    const readableUnlinked =
      summary?.missingLocal?.filter((row) => row.workingOrderId === null).length ?? 0;
    if (
      run.periodFrom > coveredTo ||
      summary?.chargeAudit === undefined ||
      (summary.unlinkedCharges ?? 0) > readableUnlinked
    )
      complete = false;
    if (run.periodTo > coveredTo) coveredTo = run.periodTo;
  }
  return { runs, complete: complete && coveredTo >= bounds.endAt };
}
