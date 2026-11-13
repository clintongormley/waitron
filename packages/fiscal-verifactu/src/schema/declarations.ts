import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { label, table, ts } from "@waitron/db";

/**
 * The declaración responsable text of each release version this venue has run. `first_started_at`
 * is the box's own, unconfirmed reading and orders nothing. Declared `appendOnly()` in
 * `../classification.ts`.
 */
export const declaracionesResponsables = table(
  "declaraciones_responsables",
  {
    version: label("version").primaryKey(),
    text: label("text").notNull(),
    firstStartedAt: ts("first_started_at").notNull(),
  },
  (t) => [
    check(
      "declaraciones_responsables_version_ck",
      sql`${t.version} glob '[0-9]*.[0-9]*.[0-9]*' and ${t.version} not glob '*[^0-9.]*' and ${t.version} not glob '*..*' and ${t.version} not glob '.*' and ${t.version} not glob '*.' and length(${t.version}) - length(replace(${t.version}, '.', '')) = 2`,
    ),
  ],
);
