import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { day, id, newId, table, timeOfDay } from "@waitron/db";
import { menuPeriods } from "./menus.js";
import { departments } from "./service.js";

export const periodExtensions = table(
  "period_extensions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id").notNull(),
    businessDay: day("business_day").notNull(),
    periodId: id("period_id").notNull(),
    startsAt: timeOfDay("starts_at").notNull(),
    endsAt: timeOfDay("ends_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "period_extensions_department_fk",
    }),
    foreignKey({
      columns: [t.periodId, t.departmentId],
      foreignColumns: [menuPeriods.id, menuPeriods.departmentId],
      name: "period_extensions_period_fk",
    }).onDelete("cascade"),
    uniqueIndex("period_extensions_day_key").on(t.departmentId, t.businessDay),
    check(
      "period_extensions_step_ck",
      sql`substr(${t.startsAt}, 4, 2) in ('00', '15', '30', '45')
      and substr(${t.endsAt}, 4, 2) in ('00', '15', '30', '45')`,
    ),
  ],
);
