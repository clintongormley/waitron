import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { day, enumCheck, enumType, id, label, newId, nowIso, table, tsString } from "@waitron/db";
import { persons } from "@waitron/identity";

/** English tokens: the Spanish rendering belongs to packages/workforce-es. */
export const absenceKind = enumType(["holiday", "sick_leave", "leave", "unpaid"]);

export const absenceStatus = enumType(["requested", "approved", "rejected"]);

export type AbsenceKind = (typeof absenceKind.enumValues)[number];

export type AbsenceStatus = (typeof absenceStatus.enumValues)[number];

/**
 * A person's planned absence — planning data, not the legal record, so ordinary mutable rows. The
 * range is inclusive on both ends. No constraint refuses two overlapping absences for one person;
 * `createAbsence` (../absences.ts) does.
 */
export const absences = table(
  "absences",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    kind: absenceKind("absence_kind").notNull(),
    startsOn: day("starts_on").notNull(),
    endsOn: day("ends_on").notNull(),
    status: absenceStatus("status").notNull().default("requested"),
    note: label("note"),
    decidedByPersonId: id("decided_by_person_id"),
    decidedAt: tsString("decided_at"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "absences_person_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.decidedByPersonId],
      foreignColumns: [persons.id],
      name: "absences_decided_by_person_fk",
    }).onDelete("restrict"),
    // Serves `createAbsence`'s overlap check.
    index("absences_person_idx").on(t.personId, t.startsOn),
    check("absences_range_ck", sql`${t.endsOn} >= ${t.startsOn}`),
    check("absences_absence_kind_ck", enumCheck(t.kind)),
    check("absences_status_ck", enumCheck(t.status)),
  ],
);
