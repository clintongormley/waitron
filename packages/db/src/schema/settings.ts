import { sql } from "drizzle-orm";
import { check, foreignKey } from "drizzle-orm/sqlite-core";
import { count, id, json, label, nowIso, table, tsString } from "./columns.js";
import { persons } from "./identity/persons.js";

export const settings = table(
  "settings",
  {
    module: label("module").primaryKey().notNull(),
    version: count("version").notNull(),
    revision: count("revision").notNull(),
    doc: json<Record<string, unknown>>("doc").notNull(),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
    updatedBy: id("updated_by"),
  },
  (t) => [
    foreignKey({
      columns: [t.updatedBy],
      foreignColumns: [persons.id],
      name: "settings_updated_by_fk",
    }).onDelete("restrict"),
    check(
      "settings_module_ck",
      sql`${t.module} glob '[a-z]*' and ${t.module} not glob '*[^a-z0-9_]*'`,
    ),
    check("settings_version_ck", sql`${t.version} >= 1`),
    check("settings_revision_ck", sql`${t.revision} >= 1`),
    check(
      "settings_doc_ck",
      sql`case when json_valid(${t.doc}) then json_type(${t.doc}) = 'object' else 0 end`,
    ),
  ],
);
