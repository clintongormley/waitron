import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CALENDAR_COLOURS } from "@waitron/shared";
import { count, enumCheck, enumType, id, label, newId, table, tsString } from "../columns.js";
import { persons } from "./persons.js";

const calendarColour = enumType(CALENDAR_COLOURS);

export const staffRoles = table(
  "staff_roles",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    colour: calendarColour("colour").notNull().default("grey"),
    position: count("position").notNull().default(0),
    hiddenAt: tsString("hidden_at"),
  },
  (t) => [
    uniqueIndex("staff_roles_name_key")
      .on(t.name)
      .where(sql`${t.hiddenAt} is null`),
    check("staff_roles_name_ck", sql`trim(${t.name}) <> ''`),
    check("staff_roles_colour_ck", enumCheck(t.colour)),
  ],
);

export const personStaffRoles = table(
  "person_staff_roles",
  { personId: id("person_id").notNull(), staffRoleId: id("staff_role_id").notNull() },
  (t) => [
    primaryKey({ columns: [t.personId, t.staffRoleId], name: "person_staff_roles_pk" }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "person_staff_roles_person_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.staffRoleId],
      foreignColumns: [staffRoles.id],
      name: "person_staff_roles_role_fk",
    }).onDelete("cascade"),
  ],
);
