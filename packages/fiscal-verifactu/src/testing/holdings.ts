import type { ChainHolding, LackingChain, LackingReason } from "../handover-holdings.js";

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
