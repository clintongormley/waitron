// Side-effect only: registers this package's error codes on the shared `ErrorParams` registry.
import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { verifactuIdentities } from "./schema/verifactu-identities.js";

export interface SifRegistration {
  id: string;
  nodeId: NodeId;
  nif: string;
  idSistemaInformatico: string;
  numeroInstalacion: string;
  registradoEn: Date;
  revocadoEn: Date | null;
}

export async function currentSif(tx: Transaction, nodeId: NodeId): Promise<SifRegistration> {
  const [row] = await tx
    .select({
      id: verifactuIdentities.id,
      nif: verifactuIdentities.nif,
      idSistemaInformatico: verifactuIdentities.idSistemaInformatico,
      numeroInstalacion: verifactuIdentities.numeroInstalacion,
      registradoEn: verifactuIdentities.registradoEn,
      revocadoEn: verifactuIdentities.revocadoEn,
    })
    .from(verifactuIdentities)
    .where(and(eq(verifactuIdentities.nodeId, nodeId), isNull(verifactuIdentities.revocadoEn)))
    .limit(1);

  if (row === undefined) {
    throw new AppError("sif.not_registered", { nodeId });
  }

  return { ...row, nodeId };
}
