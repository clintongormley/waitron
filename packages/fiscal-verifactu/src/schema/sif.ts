import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, tills } from "@waitron/db";

/**
 * A SIF identity: NIF + IdSistemaInformatico + NúmeroInstalación (findings §1). Append-mostly —
 * a till that re-registers gets a NEW row, and the old one is marked revoked rather than updated,
 * because the old identity's registros are immutable and must keep pointing at the identity that
 * actually generated them.
 */
export const registroSif = pgTable(
  "registro_sif",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    tillId: uuid("till_id")
      .notNull()
      .references(() => tills.id),
    nif: text("nif").notNull(),
    idSistemaInformatico: text("id_sistema_informatico").notNull(),
    numeroInstalacion: integer("numero_instalacion").notNull(),
    registradoEn: timestamp("registrado_en", { withTimezone: true }).notNull().defaultNow(),
    revocadoEn: timestamp("revocado_en", { withTimezone: true }),
  },
  // See cadenas.ts's identical comment: this extraConfig callback is invoked lazily, only by
  // `drizzle-kit generate` (in its own process) or a `drizzle(client, { schema })` wired to this
  // package's own schema — neither happens during this package's `vitest run`. The ignore markers
  // bracket the whole arrow function, not just its returned array, because leaving the function's
  // own closing bracket outside the range left it separately reported as uncovered.
  /* v8 ignore start */
  (t) => [
    // `NºInstalación` "no puede repetirse nunca". This index — not the allocator, not a code
    // review, not a spreadsheet — is what makes that true. Note it enforces across tenants even
    // under FORCE ROW LEVEL SECURITY: unique constraints are not RLS-filtered, so a conflicting
    // row you cannot SELECT still raises 23505.
    uniqueIndex("registro_sif_instalacion_uq").on(
      t.nif,
      t.idSistemaInformatico,
      t.numeroInstalacion,
    ),
    // At most one live identity per till. Partial, so revoked rows accumulate freely.
    uniqueIndex("registro_sif_activo_uq")
      .on(t.tenantId, t.tillId)
      .where(sql`${t.revocadoEn} is null`),
    check("registro_sif_numero_ck", sql`${t.numeroInstalacion} > 0`),
  ],
  /* v8 ignore stop */
).enableRLS();

/**
 * The upstream allocator's counter, one row per (NIF, IdSIF).
 *
 * Rejected alternative: `coalesce(max(numero_instalacion), 0) + 1` over `registro_sif`. That
 * derives never-reuse from never-deleting, which makes a routine housekeeping DELETE a compliance
 * breach with no error message — a wiped-and-re-registered till would silently be handed a number
 * a previous installation had already used, and AEAT would see two SIFs with one identity. A
 * counter row is independent of the retention of anything.
 *
 * Deliberately carries NO `tenant_id` and NO RLS. It is keyed by NIF, which IS the obligado
 * tributario for this purpose, and a single writer cannot guarantee uniqueness over rows a policy
 * hides from it: an RLS predicate here would silently let two tenants sharing a NIF allocate the
 * same number.
 */
export const contadoresInstalacion = pgTable(
  "contadores_instalacion",
  {
    nif: text("nif").notNull(),
    idSistemaInformatico: text("id_sistema_informatico").notNull(),
    proximoNumero: integer("proximo_numero").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.nif, t.idSistemaInformatico] })],
);
