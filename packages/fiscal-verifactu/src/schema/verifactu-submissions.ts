import { isNotNull, sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, json, label, now, persons, table, ts } from "@waitron/db";
import type { FilingCaseCause, FilingCaseEvidence } from "./filing-cases.js";
import { verifactuRecords } from "./verifactu-records.js";

/**
 * The submission SIDECAR — 1:1 with a registro, holding the delivery state that mutates
 * constantly. It exists because `verifactu_records` is immutable, and submission state cannot
 * live on an immutable table.
 *
 * Chain order has exactly one source of truth, and this table never reorders anything, only
 * records what happened to each row.
 */
export const verifactuSubmissions = table(
  "verifactu_submissions",
  {
    // The registro id IS the primary key. 1:1 becomes structural rather than conventional: there
    // is no shape of this table in which a registro can have two envío rows.
    registroId: id("registro_id")
      .primaryKey()
      .references(() => verifactuRecords.id),
    estado: label("estado").notNull().default("pendiente"),
    intentos: count("intentos").notNull().default(0),
    // Persisted, never an in-memory timer. This is what makes art. 16.4's hourly duty survive a
    // restart and a week-long offline period.
    proximoIntentoEn: ts("proximo_intento_en").notNull().$defaultFn(now),
    incidencia: flag("incidencia").notNull().default(false),
    // Technical submission interruptions are separate from operator holds and fiscal refusals.
    technicalIncidence: flag("technical_incidence").notNull().default(false),
    // Written in the same transaction as the response that carried it. AEAT: the CSV "no podrá
    // ser recuperado a través de consultas posteriores" — neither consulta nor resubmission ever
    // returns it, so losing it is unrecoverable.
    csv: label("csv"),
    codigoError: label("codigo_error"),
    mensajeError: label("mensaje_error"),
    enviadoEn: ts("enviado_en"),
    confirmadoEn: ts("confirmado_en"),
    // Set by reconcile when it re-submits a `noTrace` record (reset to `pendiente`), so a later
    // sweep can tell "already remediated once, still missing → escalate to an incident" from a
    // first detection. Cleared once AEAT has a trace of the record again. NULL for every record
    // reconcile has never had to remediate. See reconcile.ts's noTrace lifecycle.
    reconciledResubmitAt: ts("reconciled_resubmit_at"),
    caseCause: label("case_cause").$type<FilingCaseCause>(),
    caseEvidence: json<FilingCaseEvidence>("case_evidence"),
    caseOpenedAt: ts("case_opened_at"),
    caseResolvedAt: ts("case_resolved_at"),
    caseResolvedBy: id("case_resolved_by").references(() => persons.id, { onDelete: "restrict" }),
    caseResolutionAction: label("case_resolution_action"),
    caseResolutionKey: label("case_resolution_key"),
    caseRemedyRegistroId: id("case_remedy_registro_id").references(() => verifactuRecords.id),
  },
  (t) => [
    // The drainer's access path: oldest due first.
    index("verifactu_submissions_drenaje_idx").on(t.estado, t.proximoIntentoEn),
    // The certificate card's newest-acceptance read, taken under the write lock.
    index("verifactu_submissions_confirmado_idx").on(t.confirmadoEn),
    check(
      "verifactu_submissions_estado_ck",
      sql`${t.estado} in ('pendiente', 'enviando', 'aceptado', 'aceptado_con_errores', 'rechazado', 'detenido', 'retenido')`,
    ),
    check(
      "verifactu_submissions_case_ck",
      sql`(${t.caseCause} is null) = (${t.caseEvidence} is null)
        and (${t.caseCause} is null) = (${t.caseOpenedAt} is null)
        and (${t.caseCause} is null or ${t.caseCause} <> '')`,
    ),
    check(
      "verifactu_submissions_resolution_ck",
      sql`(${t.caseResolvedAt} is null) = (${t.caseResolvedBy} is null)
        and (${t.caseResolvedAt} is null) = (${t.caseResolutionAction} is null)
        and (${t.caseResolvedAt} is null) = (${t.caseResolutionKey} is null)
        and (${t.caseResolvedAt} is null or ${t.caseOpenedAt} is not null)
        and (${t.caseRemedyRegistroId} is null or
          (${t.caseResolvedAt} is not null and ${t.caseRemedyRegistroId} <> ${t.registroId}))`,
    ),
    uniqueIndex("verifactu_submissions_resolution_key_uq").on(t.caseResolutionKey),
    index("verifactu_submissions_case_idx").on(t.caseOpenedAt).where(isNotNull(t.caseOpenedAt)),
  ],
);
