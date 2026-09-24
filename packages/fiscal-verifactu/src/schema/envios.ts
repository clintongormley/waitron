import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, now, table, ts } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The submission SIDECAR — 1:1 with a registro, holding the delivery state that mutates
 * constantly. It exists because `registros_facturacion` is immutable, and submission state cannot
 * live on an immutable table.
 *
 * Chain order has exactly one source of truth, and this table never reorders anything, only
 * records what happened to each row.
 */
export const envios = table(
  "envios",
  {
    // The registro id IS the primary key. 1:1 becomes structural rather than conventional: there
    // is no shape of this table in which a registro can have two envío rows.
    registroId: id("registro_id")
      .primaryKey()
      /* v8 ignore start */
      .references(() => registrosFacturacion.id),
    /* v8 ignore stop */
    estado: label("estado").notNull().default("pendiente"),
    intentos: count("intentos").notNull().default(0),
    // Persisted, never an in-memory timer. This is what makes art. 16.4's hourly duty survive a
    // restart and a week-long offline period.
    proximoIntentoEn: ts("proximo_intento_en").notNull().$defaultFn(now),
    incidencia: flag("incidencia").notNull().default(false),
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
  },
  /* v8 ignore start */
  (t) => [
    // The drainer's access path: oldest due first.
    index("envios_drenaje_idx").on(t.estado, t.proximoIntentoEn),
    check(
      "envios_estado_ck",
      sql`${t.estado} in ('pendiente', 'enviando', 'aceptado', 'aceptado_con_errores', 'rechazado', 'detenido')`,
    ),
  ],
  /* v8 ignore stop */
);
