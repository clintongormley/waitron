import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, label, newId, nodes, now, table, ts } from "@waitron/db";

/**
 * A SIF identity: NIF + IdSistemaInformatico + NúmeroInstalación. Append-mostly — a node that
 * re-registers gets a NEW row, and the old one is marked revoked rather than updated, because the
 * old identity's registros are immutable and must keep pointing at the identity that actually
 * generated them.
 */
export const registroSif = table(
  "registro_sif",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    nodeId: id("node_id")
      .notNull()
      /* v8 ignore start */
      .references(() => nodes.id),
    /* v8 ignore stop */
    nif: label("nif").notNull(),
    idSistemaInformatico: label("id_sistema_informatico").notNull(),
    numeroInstalacion: label("numero_instalacion").notNull(),
    registradoEn: ts("registrado_en").notNull().$defaultFn(now),
    revocadoEn: ts("revocado_en"),
  },
  /* v8 ignore start */
  (t) => [
    uniqueIndex("registro_sif_instalacion_uq").on(
      t.nif,
      t.idSistemaInformatico,
      t.numeroInstalacion,
    ),
    // At most one live identity per node. Partial, so revoked rows accumulate freely.
    uniqueIndex("registro_sif_activo_uq")
      .on(t.nodeId)
      .where(sql`${t.revocadoEn} is null`),
    check("registro_sif_numero_ck", sql`length(${t.numeroInstalacion}) between 1 and 30`),
  ],
  /* v8 ignore stop */
);
