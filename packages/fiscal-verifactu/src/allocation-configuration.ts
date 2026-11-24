// Historical protocol tests retain this dispatcher; production composition uses hour-configuration.
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

export interface HistoricalAllocationPaths {
  readonly custodianFile?: string;
  readonly custodianFingerprint?: string;
  readonly confirmationFile?: string;
  readonly emergencyDirectory?: string;
  readonly paperHistoryFile?: string;
  readonly cloudTrustFile?: string;
  readonly cloudFingerprint?: string;
  readonly cloudReceiptDirectory?: string;
}

export function configuredOperations(
  paths: HistoricalAllocationPaths,
  host?: ModuleOperationHost,
): ModuleOperationPreparation {
  const settings = { ...paths };
  return {
    async prepare(supplied, run) {
      const operation = {
        ...supplied,
        binding: Object.freeze({ ...supplied.binding }),
        input: snapshotOperationInput(supplied.input),
      };
      const cloud =
        typeof operation.input === "object" &&
        operation.input !== null &&
        Object.hasOwn(operation.input, "receipt");
      if (cloud && operation.binding.action === "setup") {
        const trust = configuredCloudTrust(settings);
        const receiptDirectory = settings.cloudReceiptDirectory;
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
        const trustPath = settings.cloudTrustFile;
        const confirmedFingerprint = settings.cloudFingerprint;
        const confirmationPath = settings.confirmationFile;
        const receiptDirectory = settings.cloudReceiptDirectory;
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
        const confirmationPath = settings.confirmationFile;
        const incidentDirectory = settings.emergencyDirectory;
        if (!confirmationPath?.trim() || !incidentDirectory?.trim())
          throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
        return createEmergencyAllocationPreparation({
          confirmationPath,
          incidentDirectory,
        }).prepare(operation, run);
      }
      const custodianPath = settings.custodianFile;
      const confirmationPath = settings.confirmationFile;
      const confirmedFingerprint = settings.custodianFingerprint;
      if (!custodianPath?.trim() || !confirmationPath?.trim() || !confirmedFingerprint?.trim())
        throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
      return createPaperAllocationPreparation({
        custodianPath,
        confirmationPath,
        confirmedFingerprint,
        knownHistoryPath: settings.paperHistoryFile,
      }).prepare(operation, run);
    },
  };
}
