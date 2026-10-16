import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ThrowawayAllocation } from "@waitron/module";
import { readOperationAuthority } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { withHourAdmission } from "./allocation-envelope.js";
import { createAllocationPreparation } from "./allocation-preparation.js";
import { encodeHourIdentity } from "./hour-identity.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import "./errors.js";

function describe(value: unknown): string {
  try {
    return String(value);
  } catch {
    return typeof value;
  }
}
export function createHourThrowawayAllocation(
  options: { now?: () => Date } = {},
): ThrowawayAllocation {
  return {
    prepare({ environments, taxpayerNif, bases: suppliedBases, nodeId, administratorId }) {
      if (environments.length === 0)
        throw new AppError("sif.throwaway_allocation_refused", { environment: "none" });
      const refused = environments.findIndex((environment) => environment !== "preproduction");
      if (refused !== -1)
        throw new AppError("sif.throwaway_allocation_refused", {
          environment: describe(environments[refused]),
        });
      const now = (options.now ?? (() => new Date()))();
      let identity: string;
      try {
        identity = encodeHourIdentity(now.getTime());
      } catch {
        throw new AppError("sif.allocation_invalid", { reason: "clock_unconfirmed" });
      }
      const bases = suppliedBases.map(({ code, purpose }) => ({ code, purpose }));
      const eventId = randomUUID();
      const binding = {
        module: "fiscal-verifactu",
        action: "setup",
        eventId,
        sourceId: "throwaway-preproduction",
        targetNodeId: nodeId,
      };
      const input = {
        allocation: {
          version: 1,
          allocationId: `throwaway-${randomUUID()}`,
          taxpayerNif,
          softwareId: WAITRON_ID_SISTEMA,
          environment: "preproduction",
          installationIdentity: identity,
          series: bases.map(({ code, purpose }) => ({ code: `${code}-${identity}`, purpose })),
          source: "hour",
          reservationEvidence: null,
          issuedAt: now.toISOString(),
        },
        approval: {
          version: 1,
          eventId,
          sourceId: binding.sourceId,
          targetNodeId: nodeId,
          operatorId: administratorId,
          oldMachineAbsent: true,
          oldMachineOffline: false,
          noParallelRecovery: true,
          confirmedAt: now.toISOString(),
          incidentEvidence: "throwaway-preproduction-allocation",
        },
      };
      return {
        eventId,
        sourceId: binding.sourceId,
        input: structuredClone(input),
        operations: {
          async prepare(operation, run) {
            const operator = readOperationAuthority(operation.authority, operation.binding);
            if (operator?.operatorId !== administratorId)
              throw new AppError("sif.allocation_invalid", { reason: "reauthentication_required" });
            if (
              !isDeepStrictEqual(operation.binding, binding) ||
              !isDeepStrictEqual(operation.input, input)
            )
              throw new AppError("sif.allocation_invalid", { reason: "event_mismatch" });
            return withHourAdmission(
              operation,
              { requiredBases: bases, priorActivation: "none" },
              (evidence) =>
                createAllocationPreparation(async (scope) => ({ ...scope, evidence })).prepare(
                  operation,
                  run,
                ),
            );
          },
        },
      };
    },
  };
}
