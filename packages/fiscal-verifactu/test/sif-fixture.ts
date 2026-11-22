import type { Transaction } from "@waitron/db";
import { and, eq } from "drizzle-orm";
import { registerSif, type RegisterSifParams } from "../src/registro-sif.js";
import { verifactuIdentities } from "../src/schema/verifactu-identities.js";

export function seedNamedFixtureSif(
  tx: Transaction,
  params: {
    nodeId: RegisterSifParams["nodeId"];
    taxpayerNif: string;
    softwareId: string;
    installationIdentity: string;
  },
) {
  return seedFixtureSif(tx, {
    nodeId: params.nodeId,
    nif: params.taxpayerNif,
    idSistemaInformatico: params.softwareId,
    numeroInstalacion: params.installationIdentity,
  });
}

export async function fixtureSifIdentities(tx: Transaction) {
  return tx.select({ identity: verifactuIdentities.numeroInstalacion }).from(verifactuIdentities);
}

export async function seedFixtureSif(
  tx: Transaction,
  params: Omit<RegisterSifParams, "numeroInstalacion"> & { numeroInstalacion?: string },
) {
  const rows = await tx
    .select({ id: verifactuIdentities.id })
    .from(verifactuIdentities)
    .where(
      and(
        eq(verifactuIdentities.nif, params.nif),
        eq(verifactuIdentities.idSistemaInformatico, params.idSistemaInformatico),
      ),
    );
  // Historical fixture identities keep record bytes independent of the allocation transport.
  return registerSif(tx, {
    ...params,
    numeroInstalacion: params.numeroInstalacion ?? String(rows.length + 1),
  });
}
