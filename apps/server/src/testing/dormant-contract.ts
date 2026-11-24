import {
  invoiceSeries,
  nodes,
  stampDeployment,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { Endorsement } from "@waitron/membership";
import type {
  ModuleOperationInput,
  ModuleOperationPreparation,
  OperationBinding,
  OperationOperator,
} from "@waitron/module";
import { nodeId } from "@waitron/shared";
import { withHourAdmission } from "@waitron/fiscal-verifactu/src/allocation-envelope.js";
import { createAllocationPreparation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { encodeMinuteIdentity } from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { establishReservedStandbyIdentity, type StandbyIdentity } from "../reserved-identity.js";
import { sealAdoptedStandbyKey } from "./adopted-standby-key.js";

const bases = [
  { code: "FA", purpose: "standard" },
  { code: "FF", purpose: "full" },
];

export function hourPromotionInput(
  binding: OperationBinding,
  operatorId: OperationOperator,
  taxpayerNif: string,
  environment: "production" | "preproduction",
  requiredBases: readonly { code: string; purpose: string }[],
) {
  const issuedAt = "2026-10-16T12:00:00.000Z";
  const identity = encodeMinuteIdentity(Date.parse(issuedAt));
  const incidentEvidence = `hour/${binding.eventId}`;
  return {
    allocation: {
      version: 1,
      allocationId: incidentEvidence,
      taxpayerNif,
      softwareId: "W1",
      environment,
      installationIdentity: identity,
      series: requiredBases.map(({ code, purpose }) => ({ code: `${code}-${identity}`, purpose })),
      source: "hour",
      reservationEvidence: null,
      issuedAt,
    },
    approval: {
      version: 1,
      eventId: binding.eventId,
      sourceId: binding.sourceId,
      targetNodeId: binding.targetNodeId,
      operatorId,
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
      confirmedAt: issuedAt,
      incidentEvidence,
    },
  };
}

export const hourPromotionOperations: ModuleOperationPreparation = {
  prepare(operation: ModuleOperationInput, run) {
    return withHourAdmission(
      operation,
      { requiredBases: bases, priorActivation: "none" },
      (evidence) =>
        createAllocationPreparation(async (request) => ({ ...request, evidence })).prepare(
          operation,
          run,
        ),
    );
  },
};

export async function establishDormantContract(args: {
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  sourceId: string;
  taxpayerNif: string;
  standby: StandbyIdentity;
  endorsement: Endorsement;
  operatorId: string;
  recoveryKey?: boolean;
}) {
  const source = nodeId(args.sourceId);
  await sealAdoptedStandbyKey(args.node, args.ring, args.standby);
  await stampDeployment(args.db, "production");
  await args.db.insert(nodes).values({ id: source, name: "Original primary" });
  await args.db.insert(invoiceSeries).values(bases.map((base) => ({ ...base, nodeId: source })));
  await withTransaction(args.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: source,
      nif: args.taxpayerNif,
      idSistemaInformatico: "W1",
      numeroInstalacion: "S000001",
    }),
  );
  await establishReservedStandbyIdentity(
    { ownerDb: args.db },
    {
      standby: args.standby,
      nodeName: "cloud",
      filingModule: "verifactu",
      taxModule: "vat",
      modules: [],
      reserved: { modules: {}, series: [], endorsement: args.endorsement },
    },
  );
  const binding: OperationBinding = {
    module: "fiscal-verifactu",
    action: "promote",
    eventId: "test-promotion",
    sourceId: source,
    targetNodeId: args.standby.nodeId,
  };
  return (recoveryKey = args.recoveryKey) => ({
    binding,
    input: hourPromotionInput(
      binding,
      recoveryKey
        ? { kind: "recovery-key", nodeId: binding.targetNodeId, eventId: binding.eventId }
        : args.operatorId,
      args.taxpayerNif,
      "production",
      bases,
    ),
  });
}
