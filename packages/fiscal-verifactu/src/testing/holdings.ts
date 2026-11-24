import { eq } from "drizzle-orm";
import type { Database } from "@waitron/db";
import type { ChainHolding, LackingChain, LackingReason } from "../handover-holdings.js";
import { verifactuIdentities } from "../schema/verifactu-identities.js";

/** A three-record chain of an earlier box, as an old main box lists it in its holdings. */
export function earlierBoxChain(): ChainHolding {
  return {
    nodeId: "earlier-box",
    sifId: "sif-1",
    idSistemaInformatico: "WT",
    numeroInstalacion: "inst-1",
    count: 3,
    secuencia: 3,
    huella: "a".repeat(64),
  };
}

/** `chain` as the main box names it when it lacks that chain for `reason`. */
export function lackingChainOf(chain: ChainHolding, reason: LackingReason): LackingChain {
  return {
    nodeId: chain.nodeId,
    sifId: chain.sifId,
    idSistemaInformatico: chain.idSistemaInformatico,
    numeroInstalacion: chain.numeroInstalacion,
    reason,
  };
}

/** `chain` as listed by a box whose last record at that position is a different one. */
export function differingAtItsLast(chain: ChainHolding): ChainHolding {
  return { ...chain, huella: "a".repeat(64) };
}

/** A one-record chain of identity `sifId`, as a box holding that record lists it. */
export async function oneRecordChainOf(db: Database, sifId: string): Promise<ChainHolding> {
  const [identity] = await db
    .select()
    .from(verifactuIdentities)
    .where(eq(verifactuIdentities.id, sifId));
  if (identity === undefined) throw new Error(`no identity ${sifId}`);
  return {
    nodeId: identity.nodeId,
    sifId,
    idSistemaInformatico: identity.idSistemaInformatico,
    numeroInstalacion: identity.numeroInstalacion,
    count: 1,
    secuencia: 1,
    huella: "F".repeat(64),
  };
}
