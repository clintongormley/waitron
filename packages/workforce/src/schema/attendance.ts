import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  day,
  enumCheck,
  enumType,
  flag,
  id,
  json,
  label,
  newId,
  table,
  tsString,
} from "@waitron/db";
import { persons } from "@waitron/identity";
import { timeEntries } from "./time-entries.js";

export const staffActivity = table(
  "staff_activity",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    businessDay: day("business_day").notNull(),
    shiftKey: label("shift_key").notNull(),
    shiftStartAt: tsString("shift_start_at"),
    shiftEndAt: tsString("shift_end_at"),
    firstAt: tsString("first_at").notNull(),
    lastAt: tsString("last_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "staff_activity_person_fk",
    }).onDelete("restrict"),
    uniqueIndex("staff_activity_person_shift_uq").on(t.personId, t.shiftKey),
    index("staff_activity_day_idx").on(t.businessDay, t.personId),
    check("staff_activity_bounds_ck", sql`${t.firstAt} <= ${t.lastAt}`),
  ],
);

export const attendanceDays = table(
  "attendance_days",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    businessDay: day("business_day").notNull(),
    startAt: tsString("start_at").notNull(),
    endAt: tsString("end_at").notNull(),
    dirtyRevision: count("dirty_revision").notNull().default(1),
    evaluatedRevision: count("evaluated_revision").notNull().default(0),
    nextDueAt: tsString("next_due_at").notNull(),
  },
  (t) => [
    uniqueIndex("attendance_days_scope_uq").on(t.businessDay),
    index("attendance_days_due_idx").on(t.nextDueAt),
    check("attendance_days_bounds_ck", sql`${t.endAt} > ${t.startAt}`),
    check(
      "attendance_days_revision_ck",
      sql`${t.dirtyRevision} > 0 and ${t.evaluatedRevision} >= 0 and ${t.evaluatedRevision} <= ${t.dirtyRevision}`,
    ),
  ],
);

const questionKind = enumType(["automatic-out", "missing-times"]);
export const attendanceQuestions = table(
  "attendance_questions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    attendanceDayId: id("attendance_day_id").notNull(),
    shiftKey: label("shift_key").notNull(),
    kind: questionKind("kind").notNull(),
    missingKinds: json<("in" | "out")[]>("missing_kinds").notNull(),
    openEntryId: id("open_entry_id"),
    automaticEntryId: id("automatic_entry_id"),
    resolvedByEntryId: id("resolved_by_entry_id"),
    evidenceKeys: json<string[]>("evidence_keys").notNull(),
    createdAt: tsString("created_at").notNull(),
    active: flag("active").notNull().default(true),
    canonicalQuestionId: id("canonical_question_id"),
    inactiveReason: label("inactive_reason"),
  },
  (t) => [
    uniqueIndex("attendance_questions_shift_uq").on(t.personId, t.shiftKey),
    uniqueIndex("attendance_questions_subject_uq").on(t.id, t.personId),
    index("attendance_questions_own_day_idx").on(
      t.personId,
      t.active,
      t.resolvedByEntryId,
      t.attendanceDayId,
      t.id,
    ),
    foreignKey({
      columns: [t.attendanceDayId],
      foreignColumns: [attendanceDays.id],
      name: "attendance_questions_day_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.openEntryId, t.personId],
      foreignColumns: [timeEntries.id, timeEntries.personId],
      name: "attendance_questions_open_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.automaticEntryId, t.personId],
      foreignColumns: [timeEntries.id, timeEntries.personId],
      name: "attendance_questions_automatic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.resolvedByEntryId, t.personId],
      foreignColumns: [timeEntries.id, timeEntries.personId],
      name: "attendance_questions_resolution_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.canonicalQuestionId, t.personId],
      foreignColumns: [t.id, t.personId],
      name: "attendance_questions_canonical_fk",
    }).onDelete("restrict"),
    check("attendance_questions_kind_ck", enumCheck(t.kind)),
    check(
      "attendance_questions_activity_ck",
      sql`(${t.active} = 1 and ${t.inactiveReason} is null and ${t.canonicalQuestionId} is null) or (${t.active} = 0 and ${t.inactiveReason} is not null)`,
    ),
    check(
      "attendance_questions_canonical_ck",
      sql`${t.canonicalQuestionId} is null or ${t.canonicalQuestionId} <> ${t.id}`,
    ),
    check(
      "attendance_questions_automatic_ck",
      sql`(${t.kind} = 'automatic-out' and ${t.openEntryId} is not null and ${t.automaticEntryId} is not null and json_array_length(${t.missingKinds}) = 0) or (${t.kind} = 'missing-times' and ${t.automaticEntryId} is null and json_array_length(${t.missingKinds}) > 0)`,
    ),
  ],
);
