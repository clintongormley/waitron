import "./errors.js";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import type {
  ModuleOperationInput,
  ModuleOperationPreparation,
  ProvisionedNode,
} from "@waitron/module";
import {
  withCollectedModuleAllocation,
  type AllocationEvidenceSource,
} from "./allocation-operation.js";
import type { ActivationResult } from "./schema/allocations.js";
import { createPaperAllocationSource } from "./allocation-paper-source.js";

export function createPaperAllocationPreparation(configuration: {
  readonly custodianPath: string;
  readonly confirmationPath: string;
  readonly confirmedFingerprint: string;
}): ModuleOperationPreparation {
  return createAllocationPreparation(createPaperAllocationSource(configuration));
}

const prepared = new WeakMap<
  object,
  {
    readonly operation: ModuleOperationInput;
    readonly activate: (tx: Transaction, node: ProvisionedNode) => Promise<ActivationResult>;
  }
>();

export function createAllocationPreparation(
  source: AllocationEvidenceSource | undefined,
): ModuleOperationPreparation {
  return {
    prepare(operation, run) {
      const held = { ...operation, binding: Object.freeze({ ...operation.binding }) };
      return withCollectedModuleAllocation(held, source, async (activate) => {
        // Only this attempt holds the collected source; a backup or marker cannot recreate it.
        const token = Object.freeze({});
        prepared.set(token, { operation: held, activate });
        try {
          return await run(Object.freeze({ ...held, input: token }));
        } finally {
          prepared.delete(token);
        }
      });
    },
  };
}

export async function activatePreparedModuleAllocation(
  tx: Transaction,
  node: ProvisionedNode,
  operation: ModuleOperationInput,
): Promise<ActivationResult> {
  const refuse = (reason: string): never => {
    throw new AppError("sif.allocation_invalid", { reason });
  };
  const token = operation.input;
  const collected = typeof token === "object" && token !== null ? prepared.get(token) : undefined;
  if (collected === undefined) return refuse("outside_confirmation_missing");
  if (collected.operation.authority !== operation.authority)
    return refuse("reauthentication_required");
  if (!isDeepStrictEqual(collected.operation.binding, operation.binding))
    return refuse("event_mismatch");
  return collected.activate(tx, node);
}
