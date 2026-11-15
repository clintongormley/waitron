import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey, index } from "drizzle-orm/sqlite-core";
import { count, flag, id, table } from "../columns.js";
import { kitchenCourses } from "../kitchen-courses.js";
import { departments } from "./service.js";

export const departmentCourses = table(
  "department_courses",
  {
    departmentId: id("department_id").notNull(),
    courseId: id("course_id").notNull(),
    heldUntilFired: flag("held_until_fired").notNull().default(true),
    reminderMinutes: count("reminder_minutes").default(10),
  },
  (t) => [
    index("department_courses_course_idx").on(t.courseId),
    primaryKey({ columns: [t.departmentId, t.courseId], name: "department_courses_pk" }),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "department_courses_department_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.courseId],
      foreignColumns: [kitchenCourses.id],
      name: "department_courses_course_fk",
    }).onDelete("cascade"),
    check("department_courses_reminder_minutes_ck", sql`${t.reminderMinutes} between 0 and 120`),
  ],
);
