import "./errors.js";
import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import type { ThrowawayAllocation } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { AllocationOperationEvidence } from "./allocation-operation.js";
import { createAllocationPreparation } from "./allocation-preparation.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "./paper-evidence.js";
import { WAITRON_ID_SISTEMA } from "./software.js";

const CUSTODIAN_ID = "waitron-throwaway-preproduction";
const RECIPIENT_VENUE_ID = "throwaway-preproduction";
const SOURCE_ID = "throwaway-preproduction";
const INCIDENT_EVIDENCE = "throwaway-preproduction-allocation";

function describeEnvironment(value: unknown): string {
  try {
    return String(value);
  } catch {
    return typeof value;
  }
}

const throwawayId = () => `throwaway-${randomUUID()}`;

export interface ThrowawayAllocationOptions {
  /** Makes the signing key. It lives only in memory and is never written anywhere. */
  readonly generateKey?: () => { readonly publicKey: KeyObject; readonly privateKey: KeyObject };
}

export function createThrowawayAllocation(
  options: ThrowawayAllocationOptions = {},
): ThrowawayAllocation {
  const generateKey = options.generateKey ?? (() => generateKeyPairSync("ed25519"));
  return {
    prepare({ environments, taxpayerNif, bases, nodeId, administratorId }) {
      if (environments.length === 0)
        throw new AppError("sif.throwaway_allocation_refused", { environment: "none" });
      const refused = environments.findIndex((environment) => environment !== "preproduction");
      if (refused !== -1)
        throw new AppError("sif.throwaway_allocation_refused", {
          environment: describeEnvironment(environments[refused]),
        });

      const keys = generateKey();
      const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
      const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const trust = enrolPaperCustodian(
        CUSTODIAN_ID,
        publicPem,
        paperCustodianFingerprint(publicPem),
      )!;
      const eventId = randomUUID();
      const issuedAt = new Date().toISOString();
      const allocation = {
        version: 1 as const,
        allocationId: throwawayId(),
        taxpayerNif,
        softwareId: WAITRON_ID_SISTEMA,
        environment: "preproduction" as const,
        installationIdentity: "S000001",
        series: bases.map(({ code, purpose }) => ({ code: `${code}-S000001`, purpose })),
        source: "initial-paper" as const,
        issuedAt,
      };
      const block = signPaperBlock(
        {
          version: 1,
          custodianId: CUSTODIAN_ID,
          generationId: throwawayId(),
          blockId: throwawayId(),
          packVersion: 1,
          recipientVenueId: RECIPIENT_VENUE_ID,
          allocations: [allocation],
        },
        privatePem,
      );
      const approval = {
        version: 1 as const,
        eventId,
        sourceId: SOURCE_ID,
        targetNodeId: nodeId,
        operatorId: administratorId,
        oldMachineAbsent: true,
        oldMachineOffline: false,
        noParallelRecovery: true,
        confirmedAt: issuedAt,
        incidentEvidence: INCIDENT_EVIDENCE,
      };
      const consumption = signPaperConsumptionForBlock(
        block,
        allocation.allocationId,
        {
          eventId,
          operatorId: administratorId,
          sourceId: SOURCE_ID,
          targetNodeId: nodeId,
          incidentEvidence: INCIDENT_EVIDENCE,
          consumedAt: issuedAt,
        },
        privatePem,
      );
      const evidence: AllocationOperationEvidence = {
        allocationId: allocation.allocationId,
        priorActivation: "none",
        incidentEvidence: INCIDENT_EVIDENCE,
        requiredBases: bases.map(({ code, purpose }) => ({ code, purpose })),
        authority: {
          kind: "paper",
          trust,
          recipientVenueId: block.payload.recipientVenueId,
          generationId: block.payload.generationId,
          blockId: block.payload.blockId,
          currentRegisterConfirmed: true,
          consumptionConfirmed: true,
          currentEntryState: "consumed-for-event",
        },
      };
      return {
        eventId,
        sourceId: SOURCE_ID,
        input: {
          allocation: { ...allocation, reservationEvidence: { block, consumption } },
          approval,
        },
        operations: createAllocationPreparation(async (scope) => ({ ...scope, evidence })),
      };
    },
  };
}

export const FISCAL_THROWAWAY_ALLOCATION = createThrowawayAllocation();
