import { sql } from "drizzle-orm";
import { check, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { count, id, label, nodes, table, ts } from "@waitron/db";

/**
 * A SIF identity: NIF + IdSistemaInformatico + NúmeroInstalación (findings §1). Append-mostly —
 * a node that re-registers gets a NEW row, and the old one is marked revoked rather than updated,
 * because the old identity's registros are immutable and must keep pointing at the identity that
 * actually generated them. (Node-id rekey, 2026-08-03: the SIF is the node — #33 — so this moved
 * from till to node.)
 */
export const registroSif = table(
  "registro_sif",
  {
    id: id("id").primaryKey().defaultRandom(),
    // The node this SIF identity belongs to (node-id rekey, 2026-08-03: was `till_id`; the SIF IS
    // the node — #33). Plain one-argument FK.
    nodeId: id("node_id")
      .notNull()
      .references(() => nodes.id),
    nif: label("nif").notNull(),
    idSistemaInformatico: label("id_sistema_informatico").notNull(),
    numeroInstalacion: count("numero_instalacion").notNull(),
    registradoEn: ts("registrado_en").notNull().defaultNow(),
    revocadoEn: ts("revocado_en"),
  },
  // See cadenas.ts's identical comment: this extraConfig callback is invoked lazily, only by
  // `drizzle-kit generate` (in its own process) or a `drizzle(client, { schema })` wired to this
  // package's own schema — neither happens during this package's `vitest run`. The ignore markers
  // bracket the whole arrow function, not just its returned array, because leaving the function's
  // own closing bracket outside the range left it separately reported as uncovered.
  /* v8 ignore start */
  (t) => [
    // Installation identity is unique by NIF, system id and installation number.
    uniqueIndex("registro_sif_instalacion_uq").on(
      t.nif,
      t.idSistemaInformatico,
      t.numeroInstalacion,
    ),
    // At most one live identity per node. Partial, so revoked rows accumulate freely.
    uniqueIndex("registro_sif_activo_uq")
      .on(t.nodeId)
      .where(sql`${t.revocadoEn} is null`),
    check("registro_sif_numero_ck", sql`${t.numeroInstalacion} > 0`),
  ],
  /* v8 ignore stop */
);

/**
 * One allocation counter per (NIF, IdSIF), independent of retained registro_sif rows.
 * Keeping the counter separate prevents allocation from restarting when identities are removed.
 */
export const contadoresInstalacion = table(
  "contadores_instalacion",
  {
    nif: label("nif").notNull(),
    idSistemaInformatico: label("id_sistema_informatico").notNull(),
    proximoNumero: count("proximo_numero").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.nif, t.idSistemaInformatico] })],
);
