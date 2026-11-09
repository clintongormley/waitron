import { foreignKey, index } from "drizzle-orm/sqlite-core";
import { id, json, label, newId, table, ts } from "./columns.js";
import { persons } from "./identity/persons.js";
import { devices } from "./devices.js";

export const activityLog = table(
  "activity_log",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    at: ts("at").notNull(),
    kind: label("kind").notNull(),
    subjectKind: label("subject_kind").notNull(),
    subjectId: id("subject_id").notNull(),
    personId: id("person_id"),
    deviceId: id("device_id"),
    data: json<Record<string, unknown>>("data").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "activity_log_person_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "activity_log_device_fk",
    }).onDelete("restrict"),
    index("activity_log_subject_idx").on(t.subjectKind, t.subjectId),
    index("activity_log_kind_at_idx").on(t.kind, t.at),
    index("activity_log_at_idx").on(t.at),
    index("activity_log_person_at_idx").on(t.personId, t.at),
  ],
);
