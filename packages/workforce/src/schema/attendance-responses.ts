import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, json, locations, table, tsString } from "@waitron/db";
import { persons } from "@waitron/identity";
import type { AttendanceCommandPayload } from "../attendance-contract.js";
import { attendanceQuestions } from "./attendance.js";

const responseAction = enumType([
  "confirm",
  "request",
  "propose",
  "approve",
  "decline",
  "accept",
  "disagree",
]);
export const attendanceResponseCommands = table(
  "attendance_response_commands",
  {
    id: id("id").primaryKey(),
    requestedByPersonId: id("requested_by_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    authorizedByPersonId: id("authorized_by_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    personId: id("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    locationId: id("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    questionId: id("question_id"),
    action: responseAction("action").notNull(),
    input: json<AttendanceCommandPayload>("input").notNull(),
    entryIds: json<string[]>("entry_ids").notNull(),
    createdAt: tsString("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.questionId, t.personId, t.locationId],
      foreignColumns: [
        attendanceQuestions.id,
        attendanceQuestions.personId,
        attendanceQuestions.locationId,
      ],
      name: "attendance_response_commands_question_fk",
    }).onDelete("restrict"),
    index("attendance_response_commands_question_idx").on(t.personId, t.questionId),
    check("attendance_response_commands_action_ck", enumCheck(t.action)),
    check(
      "attendance_response_commands_entries_ck",
      sql`json_valid(${t.entryIds}) and json_type(${t.entryIds}) = 'array' and json_array_length(${t.entryIds}) > 0`,
    ),
  ],
);
