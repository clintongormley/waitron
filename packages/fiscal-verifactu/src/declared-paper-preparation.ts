import "./errors.js";
import { AppError } from "@waitron/shared";
import { readOperationAuthority, type ModuleOperationPreparation } from "@waitron/module";
import type { AllocationEvidenceRequest } from "./allocation-operation.js";
import { createAllocationPreparation } from "./allocation-preparation.js";
import {
  readDeclaredPaperConfirmation,
  withDeclaredPaperAdmission,
} from "./declared-paper-evidence.js";

export type DeclaredEvidenceSource = (request: AllocationEvidenceRequest) => Promise<unknown>;

export function createDeclaredPaperPreparation(
  source: DeclaredEvidenceSource,
): ModuleOperationPreparation {
  return {
    async prepare(operation, run) {
      const binding = Object.freeze({ ...operation.binding });
      const operator = readOperationAuthority(operation.authority, binding);
      if (operator === undefined)
        throw new AppError("sif.allocation_invalid", { reason: "reauthentication_required" });
      const held = { ...operation, binding, input: structuredClone(operation.input) };
      const facts = readDeclaredPaperConfirmation(
        await source(structuredClone({ binding, operatorId: operator.operatorId })),
      );
      return withDeclaredPaperAdmission({ operation: held, facts }, (token) =>
        createAllocationPreparation(async () => ({
          binding: facts.binding,
          operatorId: facts.operatorId,
          evidence: {
            allocationId: facts.input.allocation.allocationId,
            incidentEvidence: facts.input.approval.incidentEvidence,
            requiredBases: facts.requiredBases,
            priorActivation: facts.priorActivation,
            authority: { kind: "paper-declared", token },
          },
        })).prepare(held, run),
      );
    },
  };
}
