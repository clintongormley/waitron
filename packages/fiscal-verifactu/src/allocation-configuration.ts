import "./errors.js";
import { AppError } from "@waitron/shared";
import type { ModuleOperationHost, ModuleOperationPreparation } from "@waitron/module";
import {
  createAllocationPreparation,
  createPaperAllocationPreparation,
} from "./allocation-preparation.js";
import { createBoundPaperAllocationSource } from "./allocation-paper-source.js";
import { createEmergencyAllocationPreparation } from "./emergency-preparation.js";

import { createCloudAllocationFilePreparation } from "./cloud-preparation.js";

function configuredOperations(
  environment: Readonly<Record<string, string | undefined>>,
  host?: ModuleOperationHost,
): ModuleOperationPreparation {
  return {
    async prepare(operation, run) {
      if (host !== undefined && operation.binding.action === "setup") {
        const evidence = await host.readPublicEvidence(operation.binding);
        if (evidence !== undefined || operation.binding.sourceId.startsWith("first-setup:")) {
          return createAllocationPreparation(
            createBoundPaperAllocationSource({
              ...host,
              readPublicEvidence: async () => evidence,
            }),
          ).prepare(operation, run);
        }
      }
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
      }).prepare(operation, run);
    },
  };
}
export const FISCAL_OPERATIONS: ModuleOperationPreparation = {
  configure(host) {
    return configuredOperations(Object.freeze({ ...host.environment }), host);
  },
  prepare(operation, run) {
    return configuredOperations(process.env).prepare(operation, run);
  },
};
