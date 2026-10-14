import "./errors.js";
import { AppError } from "@waitron/shared";
import type { ModuleOperationPreparation } from "@waitron/module";
import { createPaperAllocationPreparation } from "./allocation-preparation.js";

export const FISCAL_OPERATIONS: ModuleOperationPreparation = {
  prepare(operation, run) {
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
