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
  (t) => {
    const hyphen = sql`instr(${t.version}, '-')`;
    const core = sql`substr(${t.version}, 1, instr(${t.version} || '-', '-') - 1)`;
    const suffix = sql`substr(${t.version}, ${hyphen} + 1)`;
    const channel = sql`substr(${suffix}, 1, instr(${suffix}, '.') - 1)`;
    const sequence = sql`substr(${suffix}, instr(${suffix}, '.') + 1)`;
    // SQLite text length and GLOB stop at the first NUL.
    return [
      check(
        "declaraciones_responsables_version_ck",
        sql`instr(${t.version}, char(0)) = 0
          and length(${t.version}) <= 50
          and ${core} glob '[0-9]*.[0-9]*.[0-9]*'
          and ${core} not glob '*[^0-9.]*'
          and length(${core}) - length(replace(${core}, '.', '')) = 2
          and ${core} not glob '0[0-9]*'
          and ${core} not glob '*.0[0-9]*'
          and (${hyphen} = 0 or (
            ${channel} in ('alpha', 'beta', 'rc')
            and ${sequence} glob '[0-9]*'
            and ${sequence} not glob '*[^0-9]*'
            and ${sequence} not glob '0[0-9]*'
          ))`,
      ),
    ];
  },
);
