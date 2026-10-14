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
  locations,
  newId,
  table,
  tsString,
} from "@waitron/db";
import { persons } from "@waitron/identity";
import type { ActivityKind, AttendanceSource } from "../attendance-types.js";
import { timeEntries } from "./time-entries.js";

export const attendanceDayWork = table(
  "attendance_day_work",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    businessDay: day("business_day").notNull(),
    startAt: tsString("start_at").notNull(),
    endAt: tsString("end_at").notNull(),
    dirtyRevision: count("dirty_revision").notNull().default(1),
    evaluatedRevision: count("evaluated_revision").notNull().default(0),
    nextDueAt: tsString("next_due_at").notNull(),
    deferredShiftIds: json<string[]>("deferred_shift_ids").notNull().default([]),
  },
  (t) => [
    uniqueIndex("attendance_day_work_scope_uq").on(t.locationId, t.businessDay),
    index("attendance_day_work_due_idx").on(t.locationId, t.nextDueAt),
    check("attendance_day_work_bounds_ck", sql`${t.endAt} > ${t.startAt}`),
    check(
      "attendance_day_work_revision_ck",
      sql`${t.dirtyRevision} > 0 and ${t.evaluatedRevision} >= 0 and ${t.evaluatedRevision} <= ${t.dirtyRevision}`,
    ),
  ],
);

const sourceKind = enumType(["scan", "watch"]);
const discoverySource = enumType([
  "session",
  "draft",
  "order",
  "group",
  "whole-payment",
  "bill-payment",
  "refund",
  "clock",
  "rota",
  "operation",
]);
export const attendanceSourceState = table(
  "attendance_source_state",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    source: discoverySource("source").notNull(),
    key: label("key").notNull(),
    recordKind: sourceKind("record_kind").notNull(),
    generation: label("generation"),
    cursor: count("cursor"),
    endpoint: count("endpoint"),
    completed: flag("completed"),
    fingerprint: label("fingerprint"),
    previousDays: json<string[]>("previous_days").notNull().default([]),
    nextDueAt: tsString("next_due_at"),
  },
  (t) => [
    uniqueIndex("attendance_source_state_scope_uq").on(t.locationId, t.source, t.recordKind, t.key),
    index("attendance_source_state_watch_idx").on(t.locationId, t.recordKind, t.nextDueAt, t.id),
    check("attendance_source_state_source_ck", enumCheck(t.source)),
    check("attendance_source_state_kind_ck", enumCheck(t.recordKind)),
    check(
      "attendance_source_state_shape_ck",
      sql`(${t.recordKind} = 'scan' and ${t.generation} is not null and ${t.cursor} is not null and ${t.endpoint} is not null and ${t.completed} is not null and ${t.cursor} >= 0 and ${t.endpoint} >= 0 and ${t.cursor} <= ${t.endpoint}) or (${t.recordKind} = 'watch' and ${t.generation} is null and ${t.cursor} is null and ${t.endpoint} is null and ${t.completed} is null)`,
    ),
  ],
);

const activityKind = enumType(["sign-in", "order", "payment", "break"]);
const operationSource = enumType([
  "session",
  "draft",
  "order",
  "whole-payment",
  "bill-payment",
  "refund",
  "clock",
]);
const operationOutcome = enumType(["pending", "qualifying", "refused"]);
export const attendanceOperationFacts = table(
  "attendance_operation_facts",
  {
    sequence: count("sequence").primaryKey({ autoIncrement: true }),
    source: operationSource("source").$type<AttendanceSource>().notNull(),
    key: label("key").notNull(),
    personId: id("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    locationId: id("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    kind: activityKind("kind").$type<ActivityKind>().notNull(),
    at: tsString("at").notNull(),
    offsetMinutes: count("offset_minutes").notNull(),
    businessDay: day("business_day").notNull(),
    outcome: operationOutcome("outcome").notNull(),
  },
  (t) => [
    uniqueIndex("attendance_operation_facts_source_uq").on(t.source, t.key),
    index("attendance_operation_facts_day_idx").on(t.locationId, t.businessDay, t.personId, t.at),
    index("attendance_operation_facts_pending_idx").on(t.outcome, t.sequence),
    check("attendance_operation_facts_source_ck", enumCheck(t.source)),
    check("attendance_operation_facts_kind_ck", enumCheck(t.kind)),
    check("attendance_operation_facts_outcome_ck", enumCheck(t.outcome)),
    check("attendance_operation_facts_offset_ck", sql`${t.offsetMinutes} between -840 and 840`),
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
    locationId: id("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    businessDay: day("business_day").notNull(),
    startAt: tsString("start_at").notNull(),
    endAt: tsString("end_at").notNull(),
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
    uniqueIndex("attendance_questions_shift_uq").on(t.personId, t.locationId, t.shiftKey),
    uniqueIndex("attendance_questions_subject_uq").on(t.id, t.personId, t.locationId),
    index("attendance_questions_own_idx").on(
      t.personId,
      t.active,
      t.resolvedByEntryId,
      t.businessDay,
      t.startAt,
      t.id,
    ),
    foreignKey({
      columns: [t.openEntryId, t.personId, t.locationId],
      foreignColumns: [timeEntries.id, timeEntries.personId, timeEntries.locationId],
      name: "attendance_questions_open_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.automaticEntryId, t.personId, t.locationId],
      foreignColumns: [timeEntries.id, timeEntries.personId, timeEntries.locationId],
      name: "attendance_questions_automatic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.resolvedByEntryId, t.personId, t.locationId],
      foreignColumns: [timeEntries.id, timeEntries.personId, timeEntries.locationId],
      name: "attendance_questions_resolution_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.canonicalQuestionId, t.personId, t.locationId],
      foreignColumns: [t.id, t.personId, t.locationId],
      name: "attendance_questions_canonical_fk",
    }).onDelete("restrict"),
    check("attendance_questions_kind_ck", enumCheck(t.kind)),
    check("attendance_questions_bounds_ck", sql`${t.endAt} > ${t.startAt}`),
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

const mailStatus = enumType(["pending", "sending", "sent", "rejected", "unknown", "cancelled"]);
const mailOutcome = enumType(["sent", "rejected", "unknown"]);
export const attendanceMail = table(
  "attendance_mail",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    questionId: id("question_id")
      .notNull()
      .references(() => attendanceQuestions.id, { onDelete: "restrict" }),
    status: mailStatus("status").notNull().default("pending"),
    claimToken: id("claim_token"),
    claimedAt: tsString("claimed_at"),
    nextAttemptAt: tsString("next_attempt_at").notNull(),
    recipient: label("recipient"),
    outcome: mailOutcome("outcome"),
  },
  (t) => [
    uniqueIndex("attendance_mail_question_uq").on(t.questionId),
    index("attendance_mail_due_idx").on(t.status, t.nextAttemptAt, t.id),
    check("attendance_mail_status_ck", enumCheck(t.status)),
    check("attendance_mail_outcome_ck", enumCheck(t.outcome)),
    check(
      "attendance_mail_claim_ck",
      sql`(${t.claimToken} is null and ${t.claimedAt} is null) or (${t.claimToken} is not null and ${t.claimedAt} is not null)`,
    ),
    check(
      "attendance_mail_sending_ck",
      sql`${t.status} <> 'sending' or (${t.claimToken} is not null and ${t.recipient} is not null)`,
    ),
  ],
);
