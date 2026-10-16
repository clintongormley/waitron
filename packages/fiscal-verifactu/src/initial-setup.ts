import { projectHourHistory } from "./hour-history.js";
import { readHourHistory } from "./hour-history-reader.js";
import "./errors.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import { nodes } from "@waitron/db";
import { AppError, locationId, nodeId } from "@waitron/shared";
import type { InitialSetupContext, InitialSetupContribution } from "@waitron/module";
import {
  validateAllocationEnvelope,
  type FiscalAllocation,
  type RecoveryApproval,
} from "./allocation-envelope.js";
import { readModuleAllocationSeries } from "./allocation-operation.js";
import {
  readInitialPaperCandidates,
  validateInitialPaperCandidates,
} from "./initial-paper-candidates.js";
import {
  parsePaperAllocation,
  parsePaperBlock,
  parsePaperConsumption,
  paperBlockBytes,
} from "./paper-protocol.js";
import { enrolPaperCustodian } from "./paper-evidence.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import {
  readDeclaredPaperInput,
  readDeclaredPaperConfirmation,
  type DeclaredPaperEvidence,
} from "./declared-paper-evidence.js";
import { parseDeclaredHistory, projectDeclaredHistory } from "./paper-register-history.js";
import {
  createInitialCloudRequest,
  readInitialCloudRequest,
  isInitialCloudRequest,
  prepareInitialCloudSetup,
  configuredCloudTrust,
  confirmInitialCloudSetup,
  readInitialCloudConfirmation,
} from "./initial-cloud-setup.js";
import type { KnownRegisterEvidence } from "./paper-register-protocol.js";
import type { ReceiptTrust } from "./cloud-evidence.js";
import { isAllocatedSeries } from "./allocation-identity.js";

function refuse(reason = "malformed_allocation"): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function signature(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}
function bounded(value: unknown): void {
  try {
    const json = JSON.stringify(value);
    if (json === undefined || Buffer.byteLength(json) > 64 * 1024) refuse();
  } catch {
    refuse();
  }
}
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function binding(context: InitialSetupContext): void {
  if (
    !text(context.attemptId) ||
    !text(context.administratorId) ||
    !exact(context.binding as unknown as Record<string, unknown>, [
      "module",
      "action",
      "eventId",
      "sourceId",
      "targetNodeId",
    ]) ||
    context.binding.module !== "fiscal-verifactu" ||
    context.binding.action !== "setup" ||
    !text(context.binding.eventId) ||
    !text(context.binding.targetNodeId) ||
    context.binding.sourceId !== `first-setup:${context.attemptId}` ||
    context.recipientVenueId !== context.binding.sourceId
  )
    refuse("event_mismatch");
}
function request(context: InitialSetupContext, value: unknown) {
  binding(context);
  const candidates = readInitialPaperCandidates(context, value);
  const result = structuredClone({
    version: 1 as const,
    kind: "first-fiscal-setup" as const,
    attemptId: context.attemptId,
    binding: context.binding,
    operatorId: context.administratorId,
    recipientVenueId: context.recipientVenueId,
    taxpayerNif: context.taxId,
    softwareId: WAITRON_ID_SISTEMA,
    environment: context.environment,
    requiredBases: context.bases,
    candidates: candidates.candidates,
    candidateDigest: candidates.candidateDigest,
  });
  bounded(result);
  return freeze(result);
}
function frozenRequest(context: InitialSetupContext) {
  bounded(context.request);
  if (!record(context.request)) refuse();
  const expected = request(context, {
    version: context.request.version,
    candidates: context.request.candidates,
    candidateDigest: context.request.candidateDigest,
  });
  if (!isDeepStrictEqual(expected, context.request)) refuse("event_mismatch");
  return expected;
}
function readInput(
  context: InitialSetupContext,
  value: unknown,
  trust: ReceiptTrust | null = null,
) {
  if (isInitialCloudRequest(context.request)) {
    const imported = prepareInitialCloudSetup(context, value, { trust });
    return {
      kind: "cloud" as const,
      input: imported.input as { allocation: FiscalAllocation; approval: RecoveryApproval },
      summary: imported.summary,
    };
  }
  const held = frozenRequest(context);
  bounded(value);
  if (
    !record(value) ||
    !exact(value, ["allocation", "approval"]) ||
    !record(value.allocation) ||
    !exact(value.allocation, [
      "version",
      "allocationId",
      "taxpayerNif",
      "softwareId",
      "environment",
      "installationIdentity",
      "series",
      "source",
      "issuedAt",
      "reservationEvidence",
    ])
  )
    refuse();
  const { reservationEvidence, ...candidateValue } = value.allocation;
  const candidate = parsePaperAllocation(candidateValue);
  if (candidate === null || !held.candidates.some((item) => isDeepStrictEqual(item, candidate)))
    refuse("reservation_mismatch");
  if (record(reservationEvidence) && reservationEvidence.kind === "paper-declared-evidence") {
    const input = readDeclaredPaperInput(value);
    const proof = input.allocation.reservationEvidence as DeclaredPaperEvidence;
    if (
      !isDeepStrictEqual(proof.reservation.binding, context.binding) ||
      proof.reservation.recipientVenueId !== context.recipientVenueId ||
      input.approval.operatorId !== context.administratorId ||
      input.approval.oldMachineAbsent !== true ||
      input.approval.oldMachineOffline !== false ||
      input.approval.noParallelRecovery !== true
    )
      refuse("event_mismatch");
    return { kind: "declared" as const, input, proof };
  }
  if (!record(reservationEvidence) || !exact(reservationEvidence, ["block", "consumption"]))
    refuse("reservation_mismatch");
  const signedBlock = reservationEvidence.block;
  const signedConsumption = reservationEvidence.consumption;
  if (
    !record(signedBlock) ||
    !exact(signedBlock, ["payload", "signature"]) ||
    !signature(signedBlock.signature) ||
    !record(signedConsumption) ||
    !exact(signedConsumption, ["payload", "signature"]) ||
    !signature(signedConsumption.signature)
  )
    refuse();
  const block = parsePaperBlock(signedBlock.payload);
  const consumption = parsePaperConsumption(signedConsumption.payload);
  if (
    block === null ||
    consumption === null ||
    block.recipientVenueId !== context.recipientVenueId ||
    !isDeepStrictEqual(block.allocations, held.candidates) ||
    consumption.custodianId !== block.custodianId ||
    consumption.blockDigest !== createHash("sha256").update(paperBlockBytes(block)).digest("hex") ||
    consumption.allocationId !== candidate.allocationId
  )
    refuse("reservation_mismatch");
  const approval = value.approval;
  if (
    !record(approval) ||
    !exact(approval, [
      "version",
      "eventId",
      "operatorId",
      "sourceId",
      "targetNodeId",
      "oldMachineAbsent",
      "oldMachineOffline",
      "noParallelRecovery",
      "confirmedAt",
      "incidentEvidence",
    ]) ||
    approval.version !== 1 ||
    !timestamp(approval.confirmedAt) ||
    !text(approval.incidentEvidence) ||
    approval.oldMachineAbsent !== true ||
    approval.oldMachineOffline !== false ||
    approval.noParallelRecovery !== true
  )
    refuse("malformed_approval");
  const expected = {
    eventId: context.binding.eventId,
    sourceId: context.binding.sourceId,
    targetNodeId: context.binding.targetNodeId,
    operatorId: context.administratorId,
    incidentEvidence: approval.incidentEvidence,
  };
  for (const [key, item] of Object.entries(expected)) {
    if (approval[key] !== item || consumption[key as keyof typeof consumption] !== item)
      refuse("event_mismatch");
  }
  return {
    kind: "signed" as const,
    input: {
      allocation: structuredClone(value.allocation) as unknown as FiscalAllocation,
      approval: structuredClone(approval) as unknown as RecoveryApproval,
    },
    block,
    consumption,
  };
}

function createInitialSetup(
  receiptTrust: () => ReceiptTrust | null,
  retained?: { files: readonly string[]; directories: readonly string[] },
): InitialSetupContribution {
  const assignmentFacts = (context: InitialSetupContext, input: unknown) => {
    binding(context);
    const scope = [context.taxId, WAITRON_ID_SISTEMA, context.environment];
    const allocations: Pick<FiscalAllocation, "allocationId" | "installationIdentity">[] = [];
    let operationId: string | undefined;
    if (context.request != null) {
      if (isInitialCloudRequest(context.request))
        operationId = readInitialCloudRequest(context).operationId;
      else allocations.push(...frozenRequest(context).candidates);
    }
    if (input !== undefined)
      allocations.push(readInput(context, input, receiptTrust()).input.allocation);
    return { scope, allocations, operationId };
  };
  const contribution: InitialSetupContribution = {
    localHistory: readHourHistory,
    retainedAssignments(evidence) {
      if (!record(evidence)) refuse();
      if (evidence.format === "waitron-hour-history") {
        const history = projectHourHistory(evidence);
        if (history.contradictions.length > 0) refuse("history_invalid");
        return {
          keys: [],
          positions:
            history.greatestSpentHour === null
              ? []
              : [
                  {
                    namespace: JSON.stringify([
                      history.scope.taxpayerNif,
                      history.scope.environment,
                      "hour",
                    ]),
                    position: history.greatestSpentHour,
                  },
                ],
        };
      }
      const value =
        evidence.format === "waitron-paper-register"
          ? evidence
          : (evidence.knownHistory ?? evidence.history);
      if (value === undefined) return { keys: [], positions: [] };
      const history = parseDeclaredHistory(value);
      const knownKeys = [
        "scope",
        "sHighWater",
        "pHighWater",
        "sBurnFloor",
        "pBurnFloor",
        "currentHead",
        "retainedHeads",
        "originals",
        "retiredBindings",
      ];
      if (
        evidence.known !== undefined &&
        (!record(evidence.known) ||
          !exact(
            evidence.known,
            Object.hasOwn(evidence.known, "history") ? [...knownKeys, "history"] : knownKeys,
          ))
      )
        refuse();
      const projection = projectDeclaredHistory(
        history,
        (evidence.known as KnownRegisterEvidence | undefined) ?? {
          scope: history.scope,
          sHighWater: 0,
          pHighWater: 0,
          sBurnFloor: 0,
          pBurnFloor: 0,
          currentHead: null,
          retainedHeads: [],
          originals: [],
          retiredBindings: [],
        },
      );
      const scope = [
        history.scope.taxpayerNif,
        history.scope.softwareId,
        history.scope.environment,
      ];
      return {
        keys: projection.occupied.flatMap(({ allocation }) => [
          JSON.stringify([...scope, "allocation", allocation.allocationId]),
          JSON.stringify([...scope, "installation", allocation.installationIdentity]),
        ]),
        positions: [
          { namespace: JSON.stringify([...scope, "S"]), position: projection.sHighWater },
          { namespace: JSON.stringify([...scope, "P"]), position: projection.pHighWater },
        ],
      };
    },
    ...(retained === undefined ? {} : { resolutionEvidence: () => structuredClone(retained) }),
    configure(host) {
      const paths = (names: readonly string[]) =>
        names
          .map((name) => host.environment[name])
          .filter((path): path is string => typeof path === "string" && path.trim().length > 0);
      return createInitialSetup(() => configuredCloudTrust(host.environment), {
        files: paths([
          "WAITRON_FISCAL_CUSTODIAN_FILE",
          "WAITRON_FISCAL_CLOUD_TRUST_FILE",
          "WAITRON_FISCAL_CONFIRMATION_FILE",
          "WAITRON_FISCAL_PAPER_HISTORY_FILE",
        ]),
        directories: paths([
          "WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY",
          "WAITRON_FISCAL_EMERGENCY_DIRECTORY",
        ]),
      });
    },
    assignmentPositions(context, input) {
      const { scope, allocations } = assignmentFacts(context, input);
      return allocations.map((allocation) => ({
        namespace: JSON.stringify([...scope, allocation.installationIdentity[0]]),
        position: Number(allocation.installationIdentity.slice(1)),
      }));
    },
    assignmentKeys(context, input) {
      const { scope, allocations, operationId } = assignmentFacts(context, input);
      const keys = allocations.flatMap((allocation) => [
        JSON.stringify([...scope, "allocation", allocation.allocationId]),
        JSON.stringify([...scope, "installation", allocation.installationIdentity]),
      ]);
      if (operationId !== undefined)
        keys.push(JSON.stringify([...scope, "cloud-operation", operationId]));
      return [...new Set(keys)];
    },
    candidates(context, proposal) {
      binding(context);
      if (record(proposal) && proposal.route === "cloud") {
        if (
          !exact(proposal, ["route", "venueId", "operationId", "incidentEvidence"]) ||
          typeof proposal.venueId !== "string" ||
          typeof proposal.operationId !== "string" ||
          typeof proposal.incidentEvidence !== "string"
        )
          refuse();
        return createInitialCloudRequest(
          context,
          proposal.venueId,
          proposal.operationId,
          proposal.incidentEvidence,
        );
      }
      if (!record(proposal) || !exact(proposal, ["serials"]) || !Array.isArray(proposal.serials))
        refuse();
      return validateInitialPaperCandidates(context, proposal.serials as number[]);
    },
    request(context, value) {
      return isInitialCloudRequest(value)
        ? readInitialCloudRequest({ ...context, request: value })
        : request(context, value);
    },
    inspect(context, value) {
      const checked = readInput(context, value, receiptTrust());
      const { input } = checked;
      if (checked.kind === "cloud")
        return prepareInitialCloudSetup(context, value, { trust: receiptTrust() });
      if (checked.kind === "declared") {
        return freeze({
          input,
          summary: {
            allocationId: input.allocation.allocationId,
            installationIdentity: input.allocation.installationIdentity,
            series: input.allocation.series,
            integrity: "owner-declared",
            historyDigest: checked.proof.historyDigest,
          },
        });
      }
      const { block } = checked;
      // Public inspection grants neither key enrolment nor a current-master confirmation.
      return freeze({
        input,
        summary: {
          allocationId: input.allocation.allocationId,
          installationIdentity: input.allocation.installationIdentity,
          series: input.allocation.series,
          custodianId: block.custodianId,
          generationId: block.generationId,
          blockId: block.blockId,
        },
      });
    },
    enrol(context, publicKey, comparison) {
      binding(context);
      if (!record(publicKey) || !exact(publicKey, ["custodianId", "publicKey", "fingerprint"]))
        refuse("reservation_untrusted");
      const trust = enrolPaperCustodian(publicKey.custodianId, publicKey.publicKey, comparison);
      if (trust === null || trust.fingerprint !== publicKey.fingerprint)
        refuse("reservation_untrusted");
      return freeze(trust);
    },
    documentConfirmation(context, imported, document) {
      const current = contribution.confirmation(context, imported, document.statement);
      if (isInitialCloudRequest(context.request)) {
        const facts = readInitialCloudConfirmation(current);
        const delivery = facts.delivery as { documentDigest: string; historyDigest: string };
        if (
          delivery.documentDigest !== document.documentDigest ||
          delivery.historyDigest !== document.historyDigest
        )
          refuse("outside_confirmation_missing");
        if (document.prior !== null) {
          const prior = readInitialCloudConfirmation(document.prior);
          if (
            (prior.priorActivation === "committed" && facts.priorActivation !== "committed") ||
            !isDeepStrictEqual({ ...prior, priorActivation: facts.priorActivation }, current)
          )
            refuse("outside_confirmation_missing");
        }
        return current;
      }
      const facts = readDeclaredPaperConfirmation(current);
      if (
        facts.delivery.documentDigest !== document.documentDigest ||
        facts.delivery.historyDigest !== document.historyDigest
      )
        refuse("outside_confirmation_missing");
      if (document.prior !== null) {
        const prior = readDeclaredPaperConfirmation(document.prior);
        const projected = projectDeclaredHistory(prior.history, prior.known);
        const known = {
          scope: projected.scope,
          sHighWater: projected.sHighWater,
          pHighWater: projected.pHighWater,
          sBurnFloor: projected.sBurnFloor,
          pBurnFloor: projected.pBurnFloor,
          currentHead: projected.head,
          retainedHeads: projected.heads,
          originals: projected.originals,
          retiredBindings: projected.retiredBindings,
          history: prior.history,
        };
        projectDeclaredHistory(facts.history, known);
        const serial = Number(facts.input.allocation.installationIdentity.slice(1));
        if (serial <= projected.sBurnFloor) refuse("reservation_mismatch");
      }
      return current;
    },
    confirmation(context, imported, statement) {
      const checked = readInput(context, imported.input, receiptTrust());
      if (checked.kind === "cloud")
        return confirmInitialCloudSetup(context, imported, statement, receiptTrust());
      const { input } = checked;
      if (checked.kind === "declared") {
        const facts = readDeclaredPaperConfirmation(statement);
        if (
          !isDeepStrictEqual(facts.input, input) ||
          !isDeepStrictEqual(facts.history.scope, {
            taxpayerNif: context.taxId,
            softwareId: WAITRON_ID_SISTEMA,
            environment: context.environment,
          }) ||
          !isAllocatedSeries(
            input.allocation.series,
            input.allocation.installationIdentity,
            context.bases,
          )
        )
          refuse("event_mismatch");
        return facts;
      }
      const { block } = checked;
      if (
        !record(statement) ||
        !exact(statement, ["trust", "current"]) ||
        !record(statement.trust) ||
        !exact(statement.trust, ["custodianId", "publicKey", "fingerprint"]) ||
        !record(statement.current)
      )
        refuse("outside_confirmation_missing");
      const current = statement.current;
      const expected = {
        version: 1,
        allocationId: input.allocation.allocationId,
        binding: context.binding,
        operatorId: context.administratorId,
        priorActivation: current.priorActivation,
        incidentEvidence: input.approval.incidentEvidence,
        requiredBases: context.bases,
        recipientVenueId: context.recipientVenueId,
        generationId: block.generationId,
        blockId: block.blockId,
        currentRegisterConfirmed: true,
        consumptionConfirmed: true,
        currentEntryState: "consumed-for-event",
      };
      if (
        !isDeepStrictEqual(expected, current) ||
        !["none", "committed"].includes(current.priorActivation as string)
      )
        refuse("outside_confirmation_missing");
      const trust = enrolPaperCustodian(
        statement.trust.custodianId,
        statement.trust.publicKey,
        statement.trust.fingerprint,
      );
      const validation = validateAllocationEnvelope(input.allocation, input.approval, {
        taxpayerNif: context.taxId,
        softwareId: WAITRON_ID_SISTEMA,
        environment: context.environment,
        mode: "initial-setup",
        ...context.binding,
        operatorId: context.administratorId,
        incidentEvidence: input.approval.incidentEvidence,
        requiredBases: context.bases,
        priorActivation: "none",
        reauthentication: { eventId: context.binding.eventId, operatorId: context.administratorId },
        authority: {
          kind: "paper",
          trust,
          recipientVenueId: context.recipientVenueId,
          generationId: block.generationId,
          blockId: block.blockId,
          currentRegisterConfirmed: true,
          consumptionConfirmed: true,
          currentEntryState: "consumed-for-event",
        },
      });
      if (!validation.ok) refuse(validation.reason);
      // Only the host's owner-bound step can turn this checked statement into a short-lived grant.
      return freeze(structuredClone(expected));
    },
    async committed(tx, context, value) {
      const { input } = readInput(context, value, receiptTrust());
      const [retained] = await tx
        .select()
        .from(fiscalAllocations)
        .where(eq(fiscalAllocations.eventKey, context.binding.eventId));
      if (retained === undefined) return null;
      if (
        retained.nodeId !== context.binding.targetNodeId ||
        retained.taxpayerNif !== context.taxId ||
        retained.softwareId !== WAITRON_ID_SISTEMA ||
        retained.environment !== context.environment ||
        !isDeepStrictEqual(input.allocation, retained.allocation) ||
        !isDeepStrictEqual(input.approval, retained.approval) ||
        retained.result.activationEventId !== context.binding.eventId ||
        retained.result.sifId !== retained.sifId
      )
        refuse("event_mismatch");
      const [node] = await tx.select().from(nodes).where(eq(nodes.id, retained.nodeId));
      if (node === undefined) refuse("node_mismatch");
      const active = await readModuleAllocationSeries(
        tx,
        { nodeId: nodeId(node.id), locationId: locationId(node.locationId) },
        context.bases,
      );
      if (!isDeepStrictEqual(active, retained.result.series)) refuse("activation_superseded");
      return freeze(structuredClone(retained.result));
    },
  };

  return contribution;
}
export const FISCAL_INITIAL_SETUP = createInitialSetup(() => null);
