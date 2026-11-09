import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  ACTIVITY_KINDS,
  type ActivityKind,
  type ActivityKindData,
  type ActivitySubjectKind,
} from "./activity-kinds.js";
import type { Database, Transaction } from "./client.js";
import { activityLog } from "./schema/activity-log.js";
import { persons } from "./schema/identity/persons.js";

export interface ActivityInput<K extends ActivityKind> {
  readonly kind: K;
  readonly subjectId: string;
  /** The person who acted; null only when no person acted. */
  readonly personId: string | null;
  readonly deviceId?: string | null;
  readonly data: ActivityKindData[K];
  readonly at?: Date;
}
export interface RecordedActivity {
  readonly id: string;
  readonly at: Date;
}

export async function recordActivity<K extends ActivityKind>(
  tx: Transaction,
  entry: ActivityInput<K>,
): Promise<RecordedActivity> {
  const [row] = await tx
    .insert(activityLog)
    .values({
      kind: entry.kind,
      subjectKind: ACTIVITY_KINDS[entry.kind].subject,
      subjectId: entry.subjectId,
      personId: entry.personId,
      deviceId: entry.deviceId ?? null,
      data: entry.data,
      at: entry.at ?? new Date(),
    })
    .returning({ id: activityLog.id, at: activityLog.at });
  return row!;
}

export type ActivityEntry = {
  [K in ActivityKind]: {
    readonly id: string;
    readonly at: Date;
    readonly kind: K;
    readonly subjectKind: string;
    readonly subjectId: string;
    readonly personId: string | null;
    readonly personName: string | null;
    readonly subjectPersonName: string | null;
    readonly deviceId: string | null;
    readonly data: ActivityKindData[K];
  };
}[ActivityKind];
export interface ActivityReadOptions {
  readonly kinds?: readonly ActivityKind[];
}

async function readEntries(
  db: Database | Transaction,
  predicate: SQL,
  options: ActivityReadOptions,
): Promise<ActivityEntry[]> {
  if (options.kinds?.length === 0) return [];
  const actor = alias(persons, "activity_actor");
  const subject = alias(persons, "activity_subject");
  const rows = await db
    .select({
      id: activityLog.id,
      at: activityLog.at,
      kind: activityLog.kind,
      subjectKind: activityLog.subjectKind,
      subjectId: activityLog.subjectId,
      personId: activityLog.personId,
      personName: actor.displayName,
      subjectPersonName: subject.displayName,
      deviceId: activityLog.deviceId,
      data: activityLog.data,
    })
    .from(activityLog)
    .leftJoin(actor, eq(activityLog.personId, actor.id))
    .leftJoin(
      subject,
      and(eq(activityLog.subjectKind, "person"), eq(activityLog.subjectId, subject.id)),
    )
    .where(
      and(
        predicate,
        options.kinds === undefined ? undefined : inArray(activityLog.kind, [...options.kinds]),
      ),
    )
    .orderBy(activityLog.at, sql`${activityLog}.rowid`);
  return rows as ActivityEntry[];
}

/** Oldest first, with ties in written order. */
export function readActivityForSubject(
  db: Database | Transaction,
  subject: { readonly kind: ActivitySubjectKind; readonly id: string },
  options: ActivityReadOptions = {},
): Promise<ActivityEntry[]> {
  return readEntries(
    db,
    and(eq(activityLog.subjectKind, subject.kind), eq(activityLog.subjectId, subject.id))!,
    options,
  );
}

/** Entries the person did or that were done to them, oldest first. */
export function readActivityForPerson(
  db: Database | Transaction,
  personId: string,
  options: ActivityReadOptions = {},
): Promise<ActivityEntry[]> {
  return readEntries(
    db,
    or(
      eq(activityLog.personId, personId),
      and(eq(activityLog.subjectKind, "person"), eq(activityLog.subjectId, personId)),
    )!,
    options,
  );
}
