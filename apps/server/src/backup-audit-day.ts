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
  const latest = new Map<string, BackupAuditRun<T>>();
  for (const run of runs) {
    if (run.periodFrom >= endAt || run.periodTo <= startAt) continue;
    const prior = latest.get(run.periodFrom);
    if (prior === undefined || run.generation > prior.generation) latest.set(run.periodFrom, run);
  }
  const backupMatches: T[] = [];
  const backupUnmatched: T[] = [];
  const inside = (row: T) => row.settledAt >= startAt && row.settledAt < endAt;
  let coveredTo = startAt;
  let complete = true;
  for (const run of [...latest.values()].sort((a, b) => a.periodFrom.localeCompare(b.periodFrom))) {
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
