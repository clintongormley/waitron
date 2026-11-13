import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  enumCheck,
  enumType,
  id,
  json,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "../columns.js";
import { persons } from "./persons.js";

export const builtInRole = enumType(["staff", "supervisor", "manager", "admin"]);

export const roles = table(
  "roles",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    builtInKey: builtInRole("built_in_key"),
    name: label("name"),
    nameFolded: label("name_folded"),
    permissions: json<string[]>("permissions").notNull().default([]),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("roles_built_in_key_uq")
      .on(t.builtInKey)
      .where(sql`${t.builtInKey} is not null`),
    uniqueIndex("roles_name_folded_uq")
      .on(t.nameFolded)
      .where(sql`${t.nameFolded} is not null`),
    check("roles_name_ck", sql`(${t.builtInKey} is null) = (${t.name} is not null)`),
    check(
      "roles_admin_permissions_ck",
      sql`${t.builtInKey} is not 'admin' or json_array_length(${t.permissions}) = 0`,
    ),
    check("roles_built_in_key_ck", enumCheck(t.builtInKey)),
  ],
);

export const personRoles = table(
  "person_roles",
  {
    personId: id("person_id").notNull(),
    roleId: id("role_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.roleId], name: "person_roles_pk" }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "person_roles_person_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.roleId],
      foreignColumns: [roles.id],
      name: "person_roles_role_fk",
    }).onDelete("restrict"),
  ],
);
