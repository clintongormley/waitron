import { sql } from "drizzle-orm";
import { check, primaryKey } from "drizzle-orm/sqlite-core";
import { count, id, label, nodes, now, table, ts } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The chain head — MUTABLE, unlike everything it points at. One row per node; `selectHead`
 * (`../chain.ts`) says why it is read without a row lock.
 *
 * The predecessor's serie/número/fecha are deliberately NOT denormalised here. Building the
 * four-part Encadenamiento pointer costs one read of `ultimo_registro_id`'s row inside the
 * transaction the append already holds, whereas a copy on this mutable row would be a second
 * source of truth for four values that must match the immutable row exactly — and the mutable copy
 * is the one that can drift.
 */
export const cadenas = table(
  "cadenas",
  {
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
  /* v8 ignore start */
  (t) => [
    primaryKey({ columns: [t.nodeId] }),
    // Both null (a fresh or re-registered chain) or neither. A half-set pointer would make
    // PrimerRegistro ambiguous, and PrimerRegistro must follow from local state unambiguously.
    check("cadenas_puntero_ck", sql`(${t.ultimoRegistroId} is null) = (${t.ultimaHuella} is null)`),
  ],
  /* v8 ignore stop */
);
