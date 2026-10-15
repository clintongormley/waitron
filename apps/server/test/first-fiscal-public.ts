import { generateKeyPairSync } from "node:crypto";
import type { InitialSetupContext } from "@waitron/module";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import type { PaperAllocation } from "@waitron/fiscal-verifactu/src/paper-protocol.js";

export function publicFirstFiscalInput(
  request: InitialSetupContext & {
    candidates: PaperAllocation[];
    operatorId: string;
    recipientVenueId: string;
    binding: InitialSetupContext["binding"];
  },
) {
  const keys = generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const key = {
    custodianId: "Synthetic paper test",
    publicKey,
    fingerprint: paperCustodianFingerprint(publicKey)!,
  };
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: key.custodianId,
      generationId: "generation-test",
      blockId: "block-test",
      packVersion: 1,
      recipientVenueId: request.recipientVenueId,
      allocations: request.candidates,
    },
    privateKey,
  );
  const approval = {
    version: 1 as const,
    ...request.binding,
    operatorId: request.operatorId,
    oldMachineAbsent: true,
    oldMachineOffline: false,
    noParallelRecovery: true,
    confirmedAt: "2026-10-15T09:00:00.000Z",
    incidentEvidence: "test original / entry 1",
  };
  const { module: _, action: __, ...binding } = approval;
  void _;
  void __;
  const consumption = signPaperConsumptionForBlock(
    block,
    request.candidates[0]!.allocationId,
    {
      eventId: binding.eventId,
      operatorId: binding.operatorId,
      sourceId: binding.sourceId,
      targetNodeId: binding.targetNodeId,
      incidentEvidence: binding.incidentEvidence,
      consumedAt: binding.confirmedAt,
    },
    privateKey,
  );
  const input = {
    allocation: { ...request.candidates[0]!, reservationEvidence: { block, consumption } },
    approval: binding,
  };
  const current = {
    version: 1,
    allocationId: request.candidates[0]!.allocationId,
    binding: request.binding,
    operatorId: request.operatorId,
    priorActivation: "none",
    incidentEvidence: binding.incidentEvidence,
    requiredBases: (request as unknown as { requiredBases: unknown }).requiredBases,
    recipientVenueId: request.recipientVenueId,
    generationId: "generation-test",
    blockId: "block-test",
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event",
  };
  return { input, key, current };
}
