import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * The KIND of absence, in ENGLISH — this is a GENERIC package the english-only guard scans, and the
 * Spanish `vacaciones`/`baja`/`permiso` tokens are all in `SPANISH_WORDS`. The Spanish rendering of
 * these labels (`holiday`→vacaciones, `sick_leave`→baja, `leave`→permiso) belongs to
 * packages/workforce-es, over this English enum; it is a later slice's job and is not built here.
 *
 * A pgEnum rather than a text CHECK, matching persons' `personStatus`/`workforceRole` and
 * roster_versions' `rosterVersionStatus` precedent: the four kinds are settled, and one declaration
 * yields both the TypeScript union and the DB constraint.
 */
export const absenceKind = pgEnum("absence_kind", ["holiday", "sick_leave", "leave", "unpaid"]);

/** An absence request's lifecycle. A new absence is created `requested`; a manager moves it to
 * `approved` or `rejected` (`setAbsenceStatus`, ../absences.ts). English tokens, same reason as
 * `absenceKind`. */
export const absenceStatus = pgEnum("absence_status", ["requested", "approved", "rejected"]);

/** One of `holiday`/`sick_leave`/`leave`/`unpaid` — the `absence_kind` enum's TypeScript union. */
export type AbsenceKind = (typeof absenceKind.enumValues)[number];

/** One of `requested`/`approved`/`rejected` — the `absence_status` enum's TypeScript union. */
export type AbsenceStatus = (typeof absenceStatus.enumValues)[number];

/**
 * A person's planned absence over a date range — a holiday, sick leave, or other leave. PLANNING
 * data, NOT the legal record (the inverse of `time_entries`): ordinary mutable rows, so the app role
 * holds SELECT, INSERT, UPDATE and DELETE (drizzle/0010_scheduling_planning_rls.sql). No append-only
 * trigger and no hash chain — no Spanish statute requires an absence schedule to be tamper-evident
 * (design 2026-07-22 §2.1 / plan 2026-08-02-workforce-d2-scheduling §2.1).
 *
 * The range is inclusive on both ends: a single-day absence is `starts_on = ends_on`. Two absences
 * for the same person may not overlap — `createAbsence` (../absences.ts) rejects an overlapping range
 * with `absence.overlaps` before inserting; the DB carries no exclusion constraint for it, so the
 * guard is the application's.
 */
export const absences = pgTable(
  "absences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id").notNull(),
    kind: absenceKind("absence_kind").notNull(),
    /** First day of the absence, inclusive. */
    startsOn: date("starts_on").notNull(),
    /** Last day of the absence, inclusive. */
    endsOn: date("ends_on").notNull(),
    status: absenceStatus("status").notNull().default("requested"),
    /** A free-text note the requester or approver may attach; null when none. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process, never during vitest run). restrict, not cascade: an absence must not be silently
    // orphaned or discarded by a tenant/person delete.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "absences_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "absences_person_fk",
    }).onDelete("restrict"),
    index("absences_tenant_id_idx").on(t.tenantId),
    // The overlap check queries by (tenant, person) over the date range — this index serves it.
    index("absences_tenant_person_idx").on(t.tenantId, t.personId, t.startsOn),
    // An absence ends on or after it starts — a single day is starts_on = ends_on.
    check("absences_range_ck", sql`${t.endsOn} >= ${t.startsOn}`),
  ],
).enableRLS();
