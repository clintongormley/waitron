import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { nodes, tenants } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The chain head — MUTABLE, unlike everything it points at. One row per (tenant, node), row-locked
 * with FOR UPDATE during append (node-id rekey, 2026-08-03: the chain owner moved from till to
 * node — the SIF is the node, #33).
 *
 * The predecessor's serie/número/fecha are deliberately NOT denormalised here. Building the
 * four-part Encadenamiento pointer costs one join to `ultimo_registro_id` under a lock we are
 * already holding, whereas a copy on this mutable row would be a second source of truth for four
 * values that must match the immutable row exactly — and the mutable copy is the one that can
 * drift.
 */
export const cadenas = pgTable(
  "cadenas",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    // The node that owns this chain (node-id rekey, 2026-08-03: was `till_id`). Plain one-argument
    // FK.
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id),
    // Monotonic across SIF identities and NEVER reset. Re-registration breaks the chain POINTER
    // (below), not the counter: resetting to zero would collide head-on with
    // `registros_tenant_node_secuencia_uq`, and the sequence is ours anyway.
    secuencia: integer("secuencia").notNull().default(0),
    ultimoRegistroId: uuid("ultimo_registro_id").references(() => registrosFacturacion.id),
    ultimaHuella: text("ultima_huella"),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  // Drizzle stores this extraConfig callback lazily and invokes it only when something walks the
  // table's full metadata — `drizzle-kit generate`, in its own separate CLI process, or a
  // `drizzle(client, { schema })` wired to THIS package's own schema (no test in this package
  // constructs one; every test reaches these tables through `@waitron/db`'s `createPgliteDb()`,
  // wired to CORE's schema, and raw `sql` execution instead). It never runs inside this package's
  // own `vitest run`. The ignore markers bracket the WHOLE arrow function, not just its returned
  // array's elements: v8 tracks "was this function ever called" as well as per-statement
  // coverage, and a range that opened only after the arrow function's own `(t) => [` left the
  // function's closing bracket itself reported as a separately uncovered line.
  /* v8 ignore start */
  (t) => [
    primaryKey({ columns: [t.tenantId, t.nodeId] }),
    // Both null (a fresh or re-registered chain) or neither. A half-set pointer would make
    // PrimerRegistro ambiguous, and PrimerRegistro must follow from local state unambiguously.
    check("cadenas_puntero_ck", sql`(${t.ultimoRegistroId} is null) = (${t.ultimaHuella} is null)`),
  ],
  /* v8 ignore stop */
);
