import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The submission SIDECAR — 1:1 with a registro, holding the delivery state that mutates
 * constantly. It exists because `registros_facturacion` is immutable, and submission state cannot
 * live on an immutable table. Same split that separated sales from fiscal records, applied once
 * more: immutable fact, mutable delivery state.
 *
 * It also preserves the property wanted from an outbox-as-projection — chain order has exactly
 * one source of truth, and this table never reorders anything, only records what happened to each
 * row.
 *
 * THIS PLAN ONLY WRITES ROWS HERE, in `pendiente`. The drainer — batching, flow control, retry,
 * CSV persistence, error-3000 resolution, Incidencia="S", acks — is plan 3. Every column it will
 * need is created now, because adding columns to a table the write path already populates is a
 * migration against live fiscal data.
 */
export const envios = pgTable(
  "envios",
  {
    // The registro id IS the primary key. 1:1 becomes structural rather than conventional: there
    // is no shape of this table in which a registro can have two envío rows.
    registroId: uuid("registro_id")
      .primaryKey()
      .references(() => registrosFacturacion.id),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    estado: text("estado").notNull().default("pendiente"),
    intentos: integer("intentos").notNull().default(0),
    // Persisted, never an in-memory timer. This is what makes art. 16.4's hourly duty survive a
    // restart and a week-long offline period.
    proximoIntentoEn: timestamp("proximo_intento_en", { withTimezone: true })
      .notNull()
      .defaultNow(),
    incidencia: boolean("incidencia").notNull().default(false),
    // Written in the same transaction as the response that carried it. AEAT: the CSV "no podrá
    // ser recuperado a través de consultas posteriores" — neither consulta nor resubmission ever
    // returns it, so losing it is unrecoverable.
    csv: text("csv"),
    codigoError: text("codigo_error"),
    mensajeError: text("mensaje_error"),
    enviadoEn: timestamp("enviado_en", { withTimezone: true }),
    confirmadoEn: timestamp("confirmado_en", { withTimezone: true }),
  },
  // See cadenas.ts's identical comment: this extraConfig callback is invoked lazily, only by
  // `drizzle-kit generate` (in its own process) or a `drizzle(client, { schema })` wired to this
  // package's own schema — neither happens during this package's `vitest run`. The ignore markers
  // bracket the whole arrow function, not just its returned array, because leaving the function's
  // own closing bracket outside the range left it separately reported as uncovered.
  /* v8 ignore start */
  (t) => [
    // The drainer's access path: batched per obligado tributario, oldest due first.
    index("envios_drenaje_idx").on(t.tenantId, t.estado, t.proximoIntentoEn),
    check(
      "envios_estado_ck",
      sql`${t.estado} in ('pendiente', 'enviando', 'aceptado', 'aceptado_con_errores', 'rechazado', 'detenido')`,
    ),
  ],
  /* v8 ignore stop */
).enableRLS();
