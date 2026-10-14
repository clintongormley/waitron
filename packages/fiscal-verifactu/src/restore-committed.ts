import "./errors.js";
import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { OperationBinding, ProvisionedNode } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { fiscalAllocations } from "./schema/allocations.js";

export async function assertFiscalRestoreCommitted(
  tx: Transaction,
  node: ProvisionedNode,
  binding: OperationBinding,
): Promise<void> {
  const [prior] = await tx
    .select()
    .from(fiscalAllocations)
    .where(eq(fiscalAllocations.eventKey, binding.eventId));
  if (
    binding.module !== "fiscal-verifactu" ||
    binding.action !== "restore" ||
    prior === undefined ||
    prior.nodeId !== node.nodeId ||
    binding.targetNodeId !== node.nodeId ||
    prior.approval.sourceId !== binding.sourceId
  )
    throw new AppError("sif.allocation_invalid", { reason: "prior_activation_requires_replay" });
}
