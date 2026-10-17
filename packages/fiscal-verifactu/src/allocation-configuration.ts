import { hostedHourPreparation } from "./hour-preparation.js";
import { hostedHourRecovery } from "./hosted-hour-recovery.js";
import { readHourRecoveryHistory, readHourRecoveryState } from "./hour-recovery-state.js";
import "./errors.js";
import { AppError } from "@waitron/shared";
import type { ModuleOperationHost, ModuleOperationPreparation } from "@waitron/module";
import {
  createAllocationPreparation,
  createPaperAllocationPreparation,
} from "./allocation-preparation.js";
import { createBoundPaperAllocationSource } from "./allocation-paper-source.js";
import { createEmergencyAllocationPreparation } from "./emergency-preparation.js";

import { configuredCloudTrust, readInitialCloudConfirmation } from "./initial-cloud-setup.js";
import {
  createCloudAllocationPreparation,
  createCloudAllocationFilePreparation,
} from "./cloud-preparation.js";
import { createDeclaredPaperStandbyPreparation } from "./declared-paper-standby.js";
import { FISCAL_INITIAL_SETUP } from "./initial-setup.js";
import { createDeclaredPaperPreparation } from "./declared-paper-preparation.js";

function declared(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "paper-declared-confirmation"
  );
}

function snapshotOperationInput(input: unknown): unknown {
  try {
    if (
      typeof input === "object" &&
      input !== null &&
      Reflect.ownKeys(input).some(
        (key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(input, key),
      )
    )
      throw new AppError("sif.allocation_invalid", { reason: "malformed_allocation" });
    return structuredClone(input);
  } catch {
    throw new AppError("sif.allocation_invalid", { reason: "malformed_allocation" });
  }
}

function configuredOperations(
  environment: Readonly<Record<string, string | undefined>>,
  host?: ModuleOperationHost,
): ModuleOperationPreparation {
  const setup = host === undefined ? FISCAL_INITIAL_SETUP : FISCAL_INITIAL_SETUP.configure!(host);
  return {
    readRecoveryHistory: readHourRecoveryHistory,
    readRecoveryState: readHourRecoveryState,
    async recovery(operation, proposal) {
      if (host === undefined)
        throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
      return hostedHourRecovery(host).recovery(operation, proposal);
    },
    async prepare(supplied, run) {
      const operation = {
        ...supplied,
        binding: Object.freeze({ ...supplied.binding }),
        input: snapshotOperationInput(supplied.input),
      };
      if (operation.binding.action === "setup") {
        if (host === undefined)
          throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
        return hostedHourPreparation(host).prepare(operation, run);
      }
      if (
        host?.readRecoveryFacts !== undefined &&
        ["restore", "re-register"].includes(operation.binding.action)
      )
        return hostedHourRecovery(host).prepare(operation, run);
      const retired = (await host?.readRetiredSetup?.("fiscal-verifactu")) ?? [];
      if (
        retired.some(
          (old) =>
            old.context.binding.eventId === operation.binding.eventId ||
            old.context.binding.targetNodeId === operation.binding.targetNodeId,
        )
      )
        throw new AppError("sif.allocation_invalid", { reason: "reservation_mismatch" });
      if (retired.length > 0) {
        const raw = operation.input as {
          allocation?: Record<string, unknown>;
          reservation?: {
            allocation?: Record<string, unknown>;
            payload?: { allocationId?: unknown };
          };
          block?: { payload?: { allocations?: Record<string, unknown>[] } };
        } | null;
        const allocation =
          raw?.allocation ??
          raw?.reservation?.allocation ??
          (Array.isArray(raw?.block?.payload?.allocations)
            ? raw.block.payload.allocations.find(
                (value) =>
                  typeof value === "object" &&
                  value !== null &&
                  value.allocationId === raw.reservation?.payload?.allocationId,
              )
            : undefined);
        if (allocation !== undefined) {
          const scope = [allocation.taxpayerNif, allocation.softwareId, allocation.environment];
          const keys = new Set([
            JSON.stringify([...scope, "allocation", allocation.allocationId]),
            JSON.stringify([...scope, "installation", allocation.installationIdentity]),
          ]);
          const identity = String(allocation.installationIdentity);
          const namespace = JSON.stringify([...scope, identity[0]]);
          const position = /^[SPC][0-9]{6}$/.test(identity) ? Number(identity.slice(1)) : null;
          for (const old of retired) {
            const facts = [
              {
                keys: setup.assignmentKeys!(old.context, old.input),
                positions: setup.assignmentPositions!(old.context, old.input),
              },
              ...old.publicEvidence.map((evidence) => setup.retainedAssignments!(evidence)),
            ];
            if (
              facts.some(
                (fact) =>
                  fact.keys.some((key) => keys.has(key)) ||
                  fact.positions.some(
                    (floor) =>
                      position !== null &&
                      floor.namespace === namespace &&
                      position <= floor.position,
                  ),
              )
            )
              throw new AppError("sif.allocation_invalid", { reason: "reservation_mismatch" });
          }
        }
      }

      const cloud =
        typeof operation.input === "object" &&
        operation.input !== null &&
        Object.hasOwn(operation.input, "receipt");
      if (cloud && operation.binding.action === "setup") {
        const trust = configuredCloudTrust(environment);
        const receiptDirectory = environment.WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY;
        if (host === undefined || trust === null || !receiptDirectory?.trim())
          throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
        return createCloudAllocationPreparation({
          trust,
          receiptDirectory,
          confirmationPath: "",
          readCurrent: async () => {
            const current = readInitialCloudConfirmation(
              (await host.readPublicEvidence(operation.binding))?.current,
            );
            const { kind: _, delivery: __, ...checked } = current;
            void _;
            void __;
            return checked;
          },
        }).prepare(operation, run);
      }
      if (host !== undefined) {
        const evidence = await host.readPublicEvidence(operation.binding);
        if (
          typeof evidence?.current === "object" &&
          evidence.current !== null &&
          "kind" in evidence.current &&
          evidence.current.kind === "paper-declared-standby-confirmation"
        )
          return createDeclaredPaperStandbyPreparation(async () => evidence!.current).prepare(
            operation,
            run,
          );
        if (declared(evidence?.current)) {
          return createDeclaredPaperPreparation(async () => evidence!.current).prepare(
            operation,
            run,
          );
        }
        if (
          (evidence !== undefined &&
            !["reserve", "establish"].includes(operation.binding.action)) ||
          (operation.binding.action === "setup" &&
            operation.binding.sourceId.startsWith("first-setup:"))
        ) {
          return createAllocationPreparation(
            createBoundPaperAllocationSource({
              ...host,
              readPublicEvidence: async () => evidence,
            }),
          ).prepare(operation, run);
        }
      }
      const input = operation.input as {
        allocation?: { reservationEvidence?: { kind?: unknown } };
      } | null;
      if (
        (typeof operation.input === "object" &&
          operation.input !== null &&
          "kind" in operation.input &&
          operation.input.kind === "paper-declared-reservation") ||
        input?.allocation?.reservationEvidence?.kind === "paper-declared-evidence"
      )
        throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
      if (
        typeof operation.input === "object" &&
        operation.input !== null &&
        Object.hasOwn(operation.input, "receipt")
      ) {
        const trustPath = environment.WAITRON_FISCAL_CLOUD_TRUST_FILE;
        const confirmedFingerprint = environment.WAITRON_FISCAL_CLOUD_FINGERPRINT;
        const confirmationPath = environment.WAITRON_FISCAL_CONFIRMATION_FILE;
        const receiptDirectory = environment.WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY;
        if (
          !trustPath?.trim() ||
          !confirmedFingerprint?.trim() ||
          !confirmationPath?.trim() ||
          !receiptDirectory?.trim()
        )
          throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
        return createCloudAllocationFilePreparation({
          trustPath,
          confirmedFingerprint,
          confirmationPath,
          receiptDirectory,
        }).prepare(operation, run);
      }

      if (
        typeof operation.input === "object" &&
        operation.input !== null &&
        Object.hasOwn(operation.input, "emergency")
      ) {
        const confirmationPath = environment.WAITRON_FISCAL_CONFIRMATION_FILE;
        const incidentDirectory = environment.WAITRON_FISCAL_EMERGENCY_DIRECTORY;
        if (!confirmationPath?.trim() || !incidentDirectory?.trim())
          throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
        return createEmergencyAllocationPreparation({
          confirmationPath,
          incidentDirectory,
        }).prepare(operation, run);
      }
      const custodianPath = environment.WAITRON_FISCAL_CUSTODIAN_FILE;
      const confirmationPath = environment.WAITRON_FISCAL_CONFIRMATION_FILE;
      const confirmedFingerprint = environment.WAITRON_FISCAL_CUSTODIAN_FINGERPRINT;
      if (!custodianPath?.trim() || !confirmationPath?.trim() || !confirmedFingerprint?.trim())
        throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
      return createPaperAllocationPreparation({
        custodianPath,
        confirmationPath,
        confirmedFingerprint,
        knownHistoryPath: environment.WAITRON_FISCAL_PAPER_HISTORY_FILE,
      }).prepare(operation, run);
    },
  };
}
export const FISCAL_OPERATIONS: ModuleOperationPreparation = {
  readRecoveryHistory: readHourRecoveryHistory,
  readRecoveryState: readHourRecoveryState,
  configure(host) {
    return configuredOperations(Object.freeze({ ...host.environment }), host);
  },
  prepare(operation, run) {
    return configuredOperations(process.env).prepare(operation, run);
  },
};
