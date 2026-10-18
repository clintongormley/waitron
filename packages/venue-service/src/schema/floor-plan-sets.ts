import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { flag, floorPlanSets, id, label, table } from "@waitron/db";
import { departments } from "./service.js";

/** Which department a core floor plan set belongs to, its name there, and whether it is the default. */
export const departmentFloorPlanSets = table(
  "department_floor_plan_sets",
  {
    setId: id("set_id").primaryKey(),
    departmentId: id("department_id").notNull(),
    name: label("name").notNull(),
    isDefault: flag("is_default").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.setId],
      foreignColumns: [floorPlanSets.id],
      name: "department_floor_plan_sets_set_fk",
    }),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "department_floor_plan_sets_department_fk",
    }),
    uniqueIndex("department_floor_plan_sets_name_key").on(t.departmentId, t.name),
    uniqueIndex("department_floor_plan_sets_one_default_key")
      .on(t.departmentId)
      .where(sql`${t.isDefault}`),
    check("department_floor_plan_sets_name_ck", sql`trim(${t.name}) <> ''`),
  ],
);
