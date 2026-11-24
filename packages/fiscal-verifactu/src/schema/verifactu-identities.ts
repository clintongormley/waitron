import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, json, label, newId, nodes, now, table, ts } from "@waitron/db";
import type { FiscalAllocation, RecoveryApproval } from "../allocation-envelope.js";
import type { ActivationResult } from "../allocation-types.js";

/**
 * A SIF identity: NIF + IdSistemaInformatico + NúmeroInstalación. A replacement identity gets
 * a NEW row, and the old one is marked revoked rather than updated, because the
 * old identity's registros are immutable and must keep pointing at the identity that actually
 * generated them.
 */
export const verifactuIdentities = table(
  "verifactu_identities",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    nodeId: id("node_id")
      .notNull()
      .references(() => nodes.id),
    nif: label("nif").notNull(),
    idSistemaInformatico: label("id_sistema_informatico").notNull(),
    numeroInstalacion: label("numero_instalacion").notNull(),
    registradoEn: ts("registrado_en").notNull().$defaultFn(now),
    revocadoEn: ts("revocado_en"),
    // Test fixtures can hold an identity without an approval. Activation records all seven fields.
    environment: label("environment"),
    eventKey: label("event_key"),
    allocationKey: label("allocation_key"),
    allocation: json<FiscalAllocation>("allocation"),
    approval: json<RecoveryApproval>("approval"),
    bases: json<readonly { readonly code: string; readonly purpose: string }[]>("bases"),
    result: json<ActivationResult>("result"),
  },
  (t) => [
    uniqueIndex("verifactu_identities_instalacion_uq").on(
      t.nif,
      t.idSistemaInformatico,
      t.numeroInstalacion,
    ),
    // At most one live identity per node. Partial, so revoked rows accumulate freely.
    uniqueIndex("verifactu_identities_activo_uq")
      .on(t.nodeId)
      .where(sql`${t.revocadoEn} is null`),
    uniqueIndex("verifactu_identities_event_key_uq").on(t.eventKey),
    uniqueIndex("verifactu_identities_allocation_uq").on(t.allocationKey),
    check("verifactu_identities_numero_ck", sql`length(${t.numeroInstalacion}) between 1 and 30`),
    check(
      "verifactu_identities_allocation_ck",
      sql`(${t.eventKey} is null) = (${t.environment} is null)
        and (${t.eventKey} is null) = (${t.allocationKey} is null)
        and (${t.eventKey} is null) = (${t.allocation} is null)
        and (${t.eventKey} is null) = (${t.approval} is null)
        and (${t.eventKey} is null) = (${t.bases} is null)
        and (${t.eventKey} is null) = (${t.result} is null)`,
    ),
  ],
);
