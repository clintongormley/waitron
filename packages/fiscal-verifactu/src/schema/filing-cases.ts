import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, json, label, newId, table, ts } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The incident code that opened a case. Closed here, not in the table: a fixed list in a CHECK
 * would make each new cause a table rebuild, which fails once events point at the cases.
 */
export type FilingCaseCause =
  "fiscal.registro_rechazado" | "fiscal.huella_divergente" | "fiscal.duplicado_anulado";

/** What AEAT said about the record when the case opened. `csv` is the envío's. */
export interface FilingCaseEvidence {
  codigo: number | null;
  mensaje: string | null;
  csv: string | null;
}

export const filingCaseEventKind = enumType(["note", "resolved"]);

/**
 * One row per original record that needs a human decision. Declared `appendOnly()` in
 * `../classification.ts`: a case is evidence, and its status is derived from its events, never
 * stored here.
 */
export const filingCases = table(
  "filing_cases",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    registroId: id("registro_id")
      .notNull()
      .references(() => registrosFacturacion.id),
    cause: label("cause").$type<FilingCaseCause>().notNull(),
    evidence: json<FilingCaseEvidence>("evidence").notNull(),
    openedAt: ts("opened_at").notNull(),
  },
  (t) => [
    uniqueIndex("filing_cases_registro_uq").on(t.registroId),
    check("filing_cases_cause_ck", sql`${t.cause} <> ''`),
  ],
);

/** What a person did about a case. Declared `appendOnly()`: a resolution is a new row, never an
 * edit. */
export const filingCaseEvents = table(
  "filing_case_events",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    caseId: id("case_id")
      .notNull()
      .references(() => filingCases.id),
    // The caller's idempotency key. Not `_id`: it names no row.
    actionKey: label("action_key").notNull(),
    kind: filingCaseEventKind("kind").notNull(),
    // No foreign key: `persons` is in @waitron/identity's migration set, which this set does not
    // require. Nothing checks that it names a person yet: `recordCaseEvent` stores any id, so the
    // route that will record events (plan Tasks 8–9) must take it from the signed-in person.
    personId: id("person_id").notNull(),
    action: label("action").notNull(),
    remedyRegistroId: id("remedy_registro_id").references(() => registrosFacturacion.id),
    recordedAt: ts("recorded_at").notNull(),
  },
  (t) => [
    uniqueIndex("filing_case_events_action_key_uq").on(t.actionKey),
    uniqueIndex("filing_case_events_one_resolution_uq")
      .on(t.caseId)
      .where(sql`${t.kind} = 'resolved'`),
    index("filing_case_events_case_idx").on(t.caseId),
    check("filing_case_events_kind_ck", enumCheck(t.kind)),
  ],
);
