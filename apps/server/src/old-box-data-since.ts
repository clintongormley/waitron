import { asc, eq, gte } from "drizzle-orm";
import { activityLog, liveBackupQuery, persons, type Database } from "@waitron/db";
import { latestChangeAtMs } from "./handover-emergency-check.js";
import type { HeardCopy } from "./old-box-holdings.js";

/** Where the old box's "since" tabs start listing rows, and which rule chose it. */
export type SinceRule =
  { kind: "copy"; fromMs: number } | { kind: "own"; fromMs: number } | { kind: "all" };

// Margins chosen with the watcher and the owner, not measured.
const COPY_MARGIN_MS = 10 * 60_000;
const OWN_SPAN_MS = 7 * 24 * 60 * 60_000;

/** Reads only, with the database handle. */
export async function sinceRule(db: Database, copy: HeardCopy | null): Promise<SinceRule> {
  if (copy !== null)
    return copy.lastChangeAtMs === null
      ? { kind: "all" }
      : { kind: "copy", fromMs: copy.lastChangeAtMs - COPY_MARGIN_MS };
  const own = await latestChangeAtMs(liveBackupQuery(db));
  return own === null ? { kind: "all" } : { kind: "own", fromMs: own - OWN_SPAN_MS };
}

export interface ActivityRow {
  at: string;
  kind: string;
  personName: string | null;
  subjectKind: string;
  subjectId: string;
}

/** `activity_log` from the rule's start, oldest first; reads only, with the database handle. */
export async function readActivitySince(db: Database, rule: SinceRule): Promise<ActivityRow[]> {
  const rows = await db
    .select({
      at: activityLog.at,
      kind: activityLog.kind,
      personName: persons.displayName,
      subjectKind: activityLog.subjectKind,
      subjectId: activityLog.subjectId,
    })
    .from(activityLog)
    .leftJoin(persons, eq(persons.id, activityLog.personId))
    .where(rule.kind === "all" ? undefined : gte(activityLog.at, new Date(rule.fromMs)))
    .orderBy(asc(activityLog.at), asc(activityLog.id));
  return rows.map((row) => ({ ...row, at: row.at.toISOString() }));
}
