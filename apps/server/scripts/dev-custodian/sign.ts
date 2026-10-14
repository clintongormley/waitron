import { generateKeyPairSync, randomUUID } from "node:crypto";
import { WAITRON_ID_SISTEMA, type AllocationOperationEvidence } from "@waitron/fiscal-verifactu";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { AppError } from "@waitron/shared";
import { deploymentEnvironment } from "../../src/config.js";
import "../../src/errors.js";

export interface DevelopmentKey {
  readonly custodianId: string;
  readonly publicPem: string;
  readonly privatePem: string;
  readonly fingerprint: string;
}

export interface DevelopmentAllocationRequest {
  readonly key: DevelopmentKey;
  readonly taxpayerNif: string;
  readonly bases: readonly { readonly code: string; readonly purpose: string }[];
  readonly nodeId: string;
  readonly administratorId: string;
  readonly eventId: string;
  readonly sourceId: string;
  readonly now: Date;
}

const INCIDENT_EVIDENCE = "developer-custodian-simulation";

export function assertDevelopmentEnvironment(env: NodeJS.ProcessEnv): void {
  const environment = deploymentEnvironment(env);
  if (environment === "production")
    throw new AppError("deployment.development_custodian_refused", { environment });
}

export function createDevelopmentKey(env: NodeJS.ProcessEnv): DevelopmentKey {
  assertDevelopmentEnvironment(env);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    custodianId: "developer-custodian",
    publicPem,
    privatePem,
    fingerprint: paperCustodianFingerprint(publicPem)!,
  };
}

export function signDevelopmentAllocation(
  request: DevelopmentAllocationRequest,
  env: NodeJS.ProcessEnv,
) {
  assertDevelopmentEnvironment(env);
  const { key, taxpayerNif, bases, nodeId, administratorId, eventId, sourceId, now } = request;
  const trust = enrolPaperCustodian(key.custodianId, key.publicPem, key.fingerprint)!;
  const issuedAt = now.toISOString();
  const allocation = {
    version: 1 as const,
    allocationId: randomUUID(),
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
      custodianId: key.custodianId,
      generationId: randomUUID(),
      blockId: randomUUID(),
      packVersion: 1,
      recipientVenueId: key.custodianId,
      allocations: [allocation],
    },
    key.privatePem,
  );
  const approval = {
    version: 1 as const,
    eventId,
    sourceId,
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
      sourceId,
      targetNodeId: nodeId,
      incidentEvidence: INCIDENT_EVIDENCE,
      consumedAt: issuedAt,
    },
    key.privatePem,
  );
  const requiredBases = bases.map(({ code, purpose }) => ({ code, purpose }));
  const paper = {
    recipientVenueId: block.payload.recipientVenueId,
    generationId: block.payload.generationId,
    blockId: block.payload.blockId,
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event" as const,
  };
  const evidence: AllocationOperationEvidence = {
    allocationId: allocation.allocationId,
    priorActivation: "none",
    incidentEvidence: INCIDENT_EVIDENCE,
    requiredBases,
    authority: { kind: "paper", trust, ...paper },
  };
  const confirmation = {
    version: 1 as const,
    allocationId: allocation.allocationId,
    binding: {
      module: "fiscal-verifactu",
      action: "setup",
      eventId,
      sourceId,
      targetNodeId: nodeId,
    },
    operatorId: administratorId,
    priorActivation: "none" as const,
    incidentEvidence: INCIDENT_EVIDENCE,
    requiredBases,
    ...paper,
  };
  return {
    input: {
      allocation: { ...allocation, reservationEvidence: { block, consumption } },
      approval,
    },
    confirmation,
    evidence,
  };
}
