import type { Database, Transaction } from "@waitron/db";
import { asc, isNotNull } from "drizzle-orm";
import type { DatabaseSync } from "node:sqlite";
import { allocationOf } from "../src/identity-allocation.js";
import { verifactuIdentities } from "../src/schema/verifactu-identities.js";

export async function allocationRows(db: Database | Transaction) {
  const rows = await db
    .select()
    .from(verifactuIdentities)
    .where(isNotNull(verifactuIdentities.eventKey))
    .orderBy(asc(verifactuIdentities.registradoEn), asc(verifactuIdentities.id));
  return rows.map((row) => ({
    ...allocationOf(row)!,
    nodeId: row.nodeId,
    sifId: row.id,
    taxpayerNif: row.nif,
    softwareId: row.idSistemaInformatico,
    installationIdentity: row.numeroInstalacion,
    activatedAt: row.registradoEn,
  }));
}

export function allocationInstallations(db: DatabaseSync) {
  return db
    .prepare(
      "select environment, numero_instalacion as identity from verifactu_identities where event_key is not null",
    )
    .all();
}
