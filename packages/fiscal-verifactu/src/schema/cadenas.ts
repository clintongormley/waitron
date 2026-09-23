import { sql } from "drizzle-orm";
import { check, primaryKey } from "drizzle-orm/sqlite-core";
import { count, id, label, nodes, now, table, ts } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The chain head — MUTABLE, unlike everything it points at. One row per node, row-locked with
 * FOR UPDATE during append (node-id rekey, 2026-08-03: the chain owner moved from till to node —
 * the SIF is the node, #33).
 *
 * The predecessor's serie/número/fecha are deliberately NOT denormalised here. Building the
 * four-part Encadenamiento pointer costs one join to `ultimo_registro_id` under a lock we are
 * already holding, whereas a copy on this mutable row would be a second source of truth for four
 * values that must match the immutable row exactly — and the mutable copy is the one that can
 * drift.
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as packages/db/src/schema/sales.ts.
export const cadenas = table(
  "cadenas",
  {
    // The node that owns this chain (node-id rekey, 2026-08-03: was `till_id`). Plain one-argument
    // FK.
    nodeId: id("node_id")
      .notNull()
      /* v8 ignore start */
      .references(() => nodes.id),
    /* v8 ignore stop */
    // Monotonic across SIF identities and NEVER reset. Re-registration breaks the chain POINTER
    // (below), not the counter: resetting to zero would collide head-on with
    // `registros_tenant_node_secuencia_uq`, and the sequence is ours anyway.
    secuencia: count("secuencia").notNull().default(0),
    /* v8 ignore start */
    ultimoRegistroId: id("ultimo_registro_id").references(() => registrosFacturacion.id),
    /* v8 ignore stop */
    ultimaHuella: label("ultima_huella"),
    actualizadoEn: ts("actualizado_en").notNull().$defaultFn(now),
  },
  // Drizzle stores this extraConfig callback lazily and invokes it only when something walks the
  // table's full metadata — `drizzle-kit generate`, in its own separate CLI process, or a
  // `drizzle(client, { schema })` wired to THIS package's own schema (no test in this package
  // constructs one; every test here reaches a database through `@waitron/db`'s `useVenueDb`, whose
  // handle is wired to CORE's schema barrel — `packages/db/src/client.ts` hands
  // `./schema/index.js` to `openVenueStore` as both schemas, and that barrel names none of this
  // package's tables — so these tables are reached by raw `sql` execution alone). It never runs
  // inside this package's own `vitest run`. The ignore markers bracket the WHOLE arrow function, not just its returned
  // array's elements: v8 tracks "was this function ever called" as well as per-statement
  // coverage, and a range that opened only after the arrow function's own `(t) => [` left the
  // function's closing bracket itself reported as a separately uncovered line.
  /* v8 ignore start */
  (t) => [
    primaryKey({ columns: [t.nodeId] }),
    // Both null (a fresh or re-registered chain) or neither. A half-set pointer would make
    // PrimerRegistro ambiguous, and PrimerRegistro must follow from local state unambiguously.
    check("cadenas_puntero_ck", sql`(${t.ultimoRegistroId} is null) = (${t.ultimaHuella} is null)`),
  ],
  /* v8 ignore stop */
);
