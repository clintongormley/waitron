import "./errors.js";
import { eq } from "drizzle-orm";
import type { SistemaInformatico } from "@waitron/verifactu";
import { AppError } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { readChainHead } from "./chain.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { PRODUCER_PENDING } from "./software-identity.js";
import type { SoftwareIdentity } from "./software-identity.js";

/**
 * The producer tax number on the latest record of `nodeId`'s open chain, and the installation it
 * was filed under (`readChainHead` names only a record of the open one); `null` while that
 * installation holds no record.
 */
export async function readHeadProducer(
  tx: Transaction,
  nodeId: NodeId,
): Promise<{ nif: string | undefined; sifId: string } | null> {
  const { ultimoRegistroId } = await readChainHead(tx, nodeId);
  if (ultimoRegistroId === null) return null;
  const [record] = await tx
    .select({ software: verifactuRecords.sistemaInformatico, sifId: verifactuRecords.sifId })
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, ultimoRegistroId));
  if (record === undefined) return null;
  return { nif: (record.software as SistemaInformatico).NIF, sifId: record.sifId };
}

/**
 * Refuses, in production, a node whose open chain's latest record names a different producer tax
 * number from the one `identity` files under. Only the tax number identifies the system (design
 * §5.6); a preproduction chain may change producer part-way. Reads only.
 */
export async function refuseProducerChange(
  tx: Transaction,
  nodeId: NodeId,
  identity: SoftwareIdentity,
  environment: string,
): Promise<void> {
  const producer = identity.producer;
  if (typeof producer === "object" && "invalid" in producer) throw producer.invalid;
  if (environment !== "production" || producer === PRODUCER_PENDING) return;
  const head = await readHeadProducer(tx, nodeId);
  if (head !== null && head.nif !== producer.nif) throw new AppError("sif.producer_changed", {});
}
