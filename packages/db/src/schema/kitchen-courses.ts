import { sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";

export const kitchenCourses = table(
  "kitchen_courses",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    starterKey: label("starter_key"),
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("kitchen_courses_name_key")
      .on(t.name)
      .where(sql`${t.active} = 1`),
    uniqueIndex("kitchen_courses_starter_key")
      .on(t.starterKey)
      .where(sql`${t.active} = 1`),
  ],
);
