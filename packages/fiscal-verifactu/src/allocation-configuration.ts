import "./errors.js";
import { AppError } from "@waitron/shared";
import type { ModuleOperationPreparation } from "@waitron/module";
import { createPaperAllocationPreparation } from "./allocation-preparation.js";
import { createEmergencyAllocationPreparation } from "./emergency-preparation.js";

import { createCloudAllocationFilePreparation } from "./cloud-preparation.js";

export const FISCAL_OPERATIONS: ModuleOperationPreparation = {
  prepare(operation, run) {
    if (
      typeof operation.input === "object" &&
      operation.input !== null &&
      Object.hasOwn(operation.input, "receipt")
    ) {
      const trustPath = process.env.WAITRON_FISCAL_CLOUD_TRUST_FILE;
      const confirmedFingerprint = process.env.WAITRON_FISCAL_CLOUD_FINGERPRINT;
      const confirmationPath = process.env.WAITRON_FISCAL_CONFIRMATION_FILE;
      const receiptDirectory = process.env.WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY;
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
      const confirmationPath = process.env.WAITRON_FISCAL_CONFIRMATION_FILE;
      const incidentDirectory = process.env.WAITRON_FISCAL_EMERGENCY_DIRECTORY;
      if (!confirmationPath?.trim() || !incidentDirectory?.trim())
        throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
      return createEmergencyAllocationPreparation({ confirmationPath, incidentDirectory }).prepare(
        operation,
        run,
      );
    }
    const custodianPath = process.env.WAITRON_FISCAL_CUSTODIAN_FILE;
    const confirmationPath = process.env.WAITRON_FISCAL_CONFIRMATION_FILE;
    const confirmedFingerprint = process.env.WAITRON_FISCAL_CUSTODIAN_FINGERPRINT;
    if (!custodianPath?.trim() || !confirmationPath?.trim() || !confirmedFingerprint?.trim())
      throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
    return createPaperAllocationPreparation({
      custodianPath,
      confirmationPath,
      confirmedFingerprint,
    }).prepare(operation, run);
  },
};
