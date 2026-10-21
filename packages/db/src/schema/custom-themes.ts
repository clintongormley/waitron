import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, id, json, label, newId, nowIso, table, tsString } from "./columns.js";

export const customThemes = table(
  "custom_themes",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    nameKey: label("name_key").notNull(),
    // `count`, not `flag`: a flag's `false` is written 0, which the CHECK refuses. NULL means not in
    // use, so the unique index allows any number of those and one 1.
    inUse: count("in_use"),
    theme: json("theme").notNull(),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("custom_themes_name_key_uq").on(t.nameKey),
    uniqueIndex("custom_themes_in_use_uq").on(t.inUse),
    check("custom_themes_in_use_ck", sql`${t.inUse} = 1`),
  ],
);
