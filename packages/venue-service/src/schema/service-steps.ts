import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, id, kitchenCourses, label, newId, table } from "@waitron/db";
import { departments } from "./service.js";

export const SERVICE_STEP_STARTS = [
  "seated",
  "after_previous",
  "course_served",
  "all_served",
  "since_last_order",
] as const;
export type ServiceStepStart = (typeof SERVICE_STEP_STARTS)[number];
const serviceStepStart = enumType(SERVICE_STEP_STARTS);

/** No unique index on (department_id, position): a save rewrites positions row by row. */
export const serviceSteps = table(
  "service_steps",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id").notNull(),
    position: count("position").notNull(),
    name: label("name").notNull(),
    start: serviceStepStart("start").notNull(),
    courseId: id("course_id"),
    minutes: count("minutes").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "service_steps_department_fk",
    }),
    foreignKey({
      columns: [t.courseId],
      foreignColumns: [kitchenCourses.id],
      name: "service_steps_course_fk",
    }),
    index("service_steps_department_position_idx").on(t.departmentId, t.position),
    check("service_steps_start_ck", enumCheck(t.start)),
    check(
      "service_steps_course_ck",
      sql`(${t.start} = 'course_served') = (${t.courseId} is not null)`,
    ),
    check(
      "service_steps_minutes_ck",
      sql`${t.minutes} between 0 and 120 and (${t.start} <> 'since_last_order' or ${t.minutes} >= 1)`,
    ),
  ],
);
