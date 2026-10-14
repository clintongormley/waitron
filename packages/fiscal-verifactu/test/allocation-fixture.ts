import { generateKeyPairSync } from "node:crypto";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  withOperationAuthority,
  type ModuleOperationInput,
  type ProvisionedNode,
  type OperationOperator,
} from "@waitron/module";
import { createAllocationPreparation } from "../src/allocation-preparation.js";
import { createStandbyAllocationPreparation } from "../src/allocated-standby.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
  signPaperReservationForBlock,
} from "../src/paper-evidence.js";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian(
  "contract-custodian",
  publicKey,
  paperCustodianFingerprint(publicKey),
)!;

export function allocationFixture(options: {
  node: ProvisionedNode;
  bases: readonly { code: string; purpose: string }[];
  identity: string;
  taxpayerNif?: string;
  softwareId?: string;
  primary?: ProvisionedNode;
  operatorId?: string;
  recoveryKey?: boolean;
  environment?: "preproduction" | "production";
}) {
  const { node, bases, identity, primary } = options;
  const allocation = {
    version: 1 as const,
    allocationId: `contract-${identity}`,
    taxpayerNif: options.taxpayerNif ?? "89890001K",
    softwareId: options.softwareId ?? "W1",
    environment: options.environment ?? "preproduction",
    installationIdentity: identity,
    series: bases.map(({ code, purpose }) => ({ code: `${code}-${identity}`, purpose })),
    source: identity.startsWith("S") ? ("initial-paper" as const) : ("paper" as const),
    issuedAt: "2026-10-14T08:00:00.000Z",
  };
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "contract-custodian",
      generationId: "contract-generation",
      blockId: `contract-block-${identity}`,
      packVersion: 1,
      recipientVenueId: "contract-venue",
      allocations: [allocation],
    },
    privateKey,
  );
  const operatorId = options.operatorId ?? "contract-administrator";
  const joinEvent = `join-${identity}`;
  const incidentEvidence = `master/${identity}`;
  const reservation =
    primary === undefined
      ? undefined
      : signPaperReservationForBlock(
          block,
          allocation.allocationId,
          {
            eventId: joinEvent,
            operatorId,
            sourceId: primary.nodeId,
            targetNodeId: node.nodeId,
            incidentEvidence,
            reservedAt: "2026-10-14T08:01:00.000Z",
          },
          privateKey,
        );
  const state = { version: 1, evidence: { block, reservation } };

  function request(action: string, priorActivation: "none" | "committed" = "none") {
    const joining = action === "reserve" || action === "establish";
    const binding = {
      module: "fiscal-verifactu",
      action,
      eventId: joining ? joinEvent : `${action}-${identity}`,
      sourceId: primary?.nodeId ?? (action === "setup" ? "initial-venue" : "archive-contract"),
      targetNodeId: node.nodeId,
    };
    const authenticatedOperator: OperationOperator = options.recoveryKey
      ? { kind: "recovery-key", nodeId: node.nodeId, eventId: binding.eventId }
      : operatorId;
    const common = {
      trust,
      allocationId: allocation.allocationId,
      recipientVenueId: "contract-venue",
      generationId: "contract-generation",
      blockId: block.payload.blockId,
      incidentEvidence,
      currentRegisterConfirmed: true,
    };
    if (joining) {
      const preparation = createStandbyAllocationPreparation(async (scope) => ({
        ...scope,
        evidence: { ...common, reservationConfirmed: true, currentEntryState: "reserved" },
      }));
      return {
        binding,
        operatorId,
        preparation,
        input: state.evidence,
        confirmation: {
          version: 1,
          allocationId: allocation.allocationId,
          binding,
          operatorId,
          recipientVenueId: common.recipientVenueId,
          generationId: common.generationId,
          blockId: common.blockId,
          incidentEvidence,
          currentRegisterConfirmed: true,
          reservationConfirmed: true,
          currentEntryState: "reserved",
        },
      };
    }
    const approval = {
      version: 1 as const,
      eventId: binding.eventId,
      sourceId: binding.sourceId,
      targetNodeId: node.nodeId,
      operatorId: authenticatedOperator,
      oldMachineOffline: action !== "setup",
      oldMachineAbsent: action === "setup",
      noParallelRecovery: true,
      confirmedAt: "2026-10-14T08:02:00.000Z",
      incidentEvidence,
    };
    const consumption = signPaperConsumptionForBlock(
      block,
      allocation.allocationId,
      {
        eventId: binding.eventId,
        sourceId: binding.sourceId,
        targetNodeId: binding.targetNodeId,
        operatorId: authenticatedOperator,
        incidentEvidence,
        consumedAt: approval.confirmedAt,
      },
      privateKey,
    );
    const preparation = createAllocationPreparation(async (scope) => ({
      ...scope,
      evidence: {
        allocationId: allocation.allocationId,
        priorActivation,
        incidentEvidence,
        requiredBases: bases,
        authority: {
          ...common,
          kind: "paper",
          consumptionConfirmed: true,
          currentEntryState: "consumed-for-event",
        },
      },
    }));
    const input = {
      allocation: { ...allocation, reservationEvidence: { block, consumption } },
      approval,
      ...(action === "promote" ? { reservationEventId: joinEvent } : {}),
    };
    return {
      binding,
      operatorId: authenticatedOperator,
      preparation,
      input,
      confirmation: {
        version: 1,
        allocationId: allocation.allocationId,
        binding,
        operatorId: authenticatedOperator,
        priorActivation,
        incidentEvidence,
        requiredBases: bases,
        recipientVenueId: common.recipientVenueId,
        generationId: common.generationId,
        blockId: common.blockId,
        currentRegisterConfirmed: true,
        consumptionConfirmed: true,
        currentEntryState: "consumed-for-event",
      },
    };
  }
  async function prepared<T>(
    action: string,
    run: (operation: ModuleOperationInput) => Promise<T>,
    priorActivation: "none" | "committed" = "none",
  ) {
    const held = request(action, priorActivation);
    return withOperationAuthority(held.binding, held.operatorId, (authority) =>
      held.preparation.prepare({ binding: held.binding, authority, input: held.input }, run),
    );
  }

  return {
    allocation,
    state,
    custodian: {
      custodianId: "contract-custodian",
      publicKey,
      fingerprint: trust.fingerprint,
    },
    request,
    authorised<T>(action: string, run: (operation: ModuleOperationInput) => Promise<T>) {
      const held = request(action);
      return withOperationAuthority(held.binding, held.operatorId, (authority) =>
        run({ binding: held.binding, authority, input: held.input }),
      );
    },
    prepared,
    transaction<T>(
      db: Database,
      action: string,
      run: (tx: Transaction, operation: ModuleOperationInput) => Promise<T>,
    ) {
      return prepared(action, (operation) => withTransaction(db, (tx) => run(tx, operation)));
    },
  };
}
