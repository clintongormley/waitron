import type { Database, Transaction } from "@waitron/db";
import { asc, isNotNull } from "drizzle-orm";
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
